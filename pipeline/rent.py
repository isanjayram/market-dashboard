"""Rent Monitor: DLD Ejari rent contracts, new residential contracts only.

Renewals are left out because the rent-increase cap makes them lag the market.
History lives in data/dld/rent/YYYY/YYYY-MM.parquet (one file per contract
start month). Daily updates come from the data.dubai API once its key exists;
the big bulk export (about 5 GB) is only used for a one-time bootstrap:

    python -m pipeline.rent --bootstrap     (run on a UAE connection)
"""
from __future__ import annotations

import shutil
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import duckdb

from . import dld
from .config import DATA_DIR, SETTINGS, WATCHLIST, today
from .pulse import friendly_names, watch_filter
from .store import add_months, month_start

RENT_DIR = DATA_DIR / "dld" / "rent"
# Ejari has no "townhouse" label. Townhouses are recorded as Villa, like standalone villas, so the
# two can't be told apart; bedrooms are the only guide. "Complex Villas" (about 100 contracts a
# month, stored as kind 'townhouse') is too small to show alone and is counted with villas.
KINDS = ["apartment", "villa"]
KIND_LABEL = {"apartment": "Apartments", "villa": "Villas & townhouses"}
KIND_SHORT = {"apartment": "Apt", "villa": "Villa/TH"}
BEDS = {"apartment": ["studio", "1br", "2br", "3br", "4br"], "villa": ["2br", "3br", "4br", "5br"]}
VILLA_AREAS = 12  # villas and townhouses: the busiest communities market-wide, not just the watchlist
BED_LABEL = {"studio": "Studio", "1br": "1BR", "2br": "2BR", "3br": "3BR", "4br": "4BR", "5br": "5BR"}
KIND_SQL = """CASE trim(ejari_property_type_en) WHEN 'Villa' THEN 'villa' WHEN 'Complex Villas' THEN 'townhouse'
    WHEN 'Flat' THEN 'apartment' WHEN 'Studio' THEN 'apartment' END"""
BEDS_SQL = """CASE
    WHEN trim(ejari_property_sub_type_en) = 'Studio' OR trim(ejari_property_type_en) = 'Studio' THEN 'studio'
    WHEN ejari_property_sub_type_en ILIKE '1bed%' OR ejari_property_sub_type_en ILIKE '1 bed%' THEN '1br'
    WHEN ejari_property_sub_type_en ILIKE '2 bed%' THEN '2br'
    WHEN ejari_property_sub_type_en ILIKE '3 bed%' THEN '3br'
    WHEN ejari_property_sub_type_en ILIKE '4 bed%' THEN '4br'
    WHEN ejari_property_sub_type_en ILIKE '5 bed%' THEN '5br' END"""
RENT_SELECT = f"""
    contract_id,
    CAST(COALESCE(TRY_STRPTIME(contract_start_date, '%Y-%m-%d'), TRY_STRPTIME(contract_start_date, '%d-%m-%Y'),
                  TRY_STRPTIME(contract_start_date, '%Y-%m-%dT%H:%M:%S')) AS DATE) AS start,
    area_name_en AS area, master_project_en AS master_project, project_name_en AS project,
    {KIND_SQL} AS kind, {BEDS_SQL} AS beds, TRY_CAST(annual_amount AS DOUBLE) AS rent,
    TRY_CAST(actual_area AS DOUBLE) AS size_sqm"""
RENT_WHERE = """trim(property_usage_en) = 'Residential' AND contract_reg_type_en = 'New'
    AND TRY_CAST(no_of_prop AS INTEGER) = 1"""
# Yield is worked out for apartments only: DLD sales don't separate standalone villas from townhouses.
SALE_BEDS = """CASE WHEN ptype = 'Unit' AND rooms = 'Studio' THEN 'studio' WHEN ptype = 'Unit' AND rooms = '1 B/R' THEN '1br'
    WHEN ptype = 'Unit' AND rooms = '2 B/R' THEN '2br' WHEN ptype = 'Unit' AND rooms = '3 B/R' THEN '3br'
    WHEN ptype = 'Unit' AND rooms = '4 B/R' THEN '4br' END"""


def has_data() -> bool:
    return RENT_DIR.exists() and any(RENT_DIR.rglob("*.parquet"))


def _save(con: duckdb.DuckDBPyConnection, since: date) -> int:
    """Write fresh_rent into monthly files (rewritten only when their rows change)."""
    months = [r[0] for r in con.execute("SELECT DISTINCT date_trunc('month', start)::DATE FROM fresh_rent "
                                        "WHERE start >= ? ORDER BY 1", [since]).fetchall()]
    written = 0
    for m in months:
        path = RENT_DIR / f"{m:%Y}" / f"{m:%Y-%m}.parquet"
        where = f"start >= DATE '{m}' AND start < DATE '{add_months(m, 1)}'"
        new = con.execute(f"SELECT count(*), bit_xor(hash(contract_id)) FROM fresh_rent WHERE {where}").fetchone()
        if path.exists() and con.execute(f"SELECT count(*), bit_xor(hash(contract_id)) FROM read_parquet('{path}')").fetchone() == new:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        con.execute(f"COPY (SELECT * FROM fresh_rent WHERE {where} ORDER BY start, contract_id) "
                    f"TO '{path}' (FORMAT parquet, COMPRESSION zstd)")
        written += 1
    keep_from = add_months(month_start(today()), -SETTINGS["dld"]["keep_raw_months"])
    for old in RENT_DIR.glob("*/*.parquet"):
        if date.fromisoformat(old.stem + "-01") < keep_from:
            old.unlink()
    return written


def refresh(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    """Daily update through the data.dubai API (needs its key). Bulk is bootstrap-only."""
    if not dld.api_available():
        raise dld.SourceError("rent updates need the data.dubai API key")
    since = today() - timedelta(days=45)
    rows = dld.api_rows("dld_rent_contracts-open-api",
                        f"contract_start_date >= '{since.isoformat()}' AND contract_reg_type_en = 'New'",
                        ["contract_id", "contract_start_date", "area_name_en", "master_project_en", "project_name_en",
                         "ejari_property_type_en", "ejari_property_sub_type_en", "annual_amount", "actual_area",
                         "property_usage_en", "contract_reg_type_en", "no_of_prop"])
    path = dld.dump_rows(rows, "api_rent.ndjson")
    con.execute(f"""CREATE OR REPLACE TABLE fresh_rent AS SELECT * FROM (SELECT {RENT_SELECT}
                    FROM read_json('{path}', format = 'newline_delimited') WHERE {RENT_WHERE})
                    WHERE kind IS NOT NULL AND beds IS NOT NULL AND rent BETWEEN 5000 AND 5000000""")
    return {"source": "data.dubai API", "files_written": _save(con, since)}


def bootstrap(paths: list[Path] | None = None) -> dict[str, Any]:
    con = duckdb.connect()
    if paths is None:
        listing, paths = dld.fetch_bulk_files(SETTINGS["dld"]["rents_dataset"], "rent")
    since = add_months(month_start(today()), -SETTINGS["dld"]["keep_raw_months"])
    kinds = {dld._compression(p) for p in paths}
    files = ", ".join(f"'{p}'" for p in paths)
    con.execute(f"""CREATE OR REPLACE TABLE fresh_rent AS SELECT * FROM (SELECT {RENT_SELECT}
        FROM read_csv([{files}], header = true, all_varchar = true, union_by_name = true, compression = '{kinds.pop()}')
        WHERE {RENT_WHERE}) WHERE kind IS NOT NULL AND beds IS NOT NULL AND rent BETWEEN 5000 AND 5000000 AND start >= DATE '{since}'""")
    rows = con.execute("SELECT count(*) FROM fresh_rent").fetchone()[0]
    if not rows:
        raise dld.SourceError("rent export had no usable rows")
    shutil.rmtree(RENT_DIR, ignore_errors=True)  # a bootstrap replaces the whole history
    return {"rows": rows, "files_written": _save(con, since),
            "by_kind": con.execute("SELECT kind, count(*) FROM fresh_rent GROUP BY 1 ORDER BY 1").fetchall()}


def compute(con: duckdb.DuckDBPyConnection, sales_ready: bool) -> dict[str, Any] | None:
    if not has_data():
        return None
    con.execute(f"CREATE OR REPLACE VIEW rent AS SELECT * FROM read_parquet('{RENT_DIR}/**/*.parquet', union_by_name = true)")
    M = add_months(month_start(today()), -1)  # last complete month
    windows = {"m": (M, add_months(M, 1)), "p": (add_months(M, -1), M), "y": (add_months(M, -12), add_months(M, -11))}
    min_n = SETTINGS["pulse"]["min_sample"]
    if "kind" not in [c[0] for c in con.execute("DESCRIBE rent").fetchall()]:
        return None  # history saved before apartments / villas / townhouses were split; needs a bootstrap
    con.execute("CREATE OR REPLACE VIEW rent AS SELECT * REPLACE (CASE WHEN kind = 'townhouse' THEN 'villa' ELSE kind END AS kind) "
                f"FROM read_parquet('{RENT_DIR}/**/*.parquet', union_by_name = true)")
    names = friendly_names(con, M - timedelta(days=365)) if sales_ready else {}
    busiest = [a for (a,) in con.execute("SELECT area FROM rent WHERE kind = 'villa' AND start >= ? AND start < ? AND area IS NOT NULL "
                                         "GROUP BY 1 ORDER BY count(*) DESC LIMIT ?", [M, add_months(M, 1), VILLA_AREAS]).fetchall()]
    places = {"apartment": [(e["name"], watch_filter(e)) for e in WATCHLIST.get("dubai", [])],
              "villa": [(names.get(a, a), "area = '" + a.replace("'", "''") + "'") for a in busiest]}
    rows, alerts = [], []
    for kind in KINDS:
        for name, where in places[kind]:
            for beds in BEDS[kind]:
                stats = {}
                for key, (lo, hi) in windows.items():
                    stats[key] = con.execute(f"SELECT median(rent), count(*) FROM rent WHERE {where} AND kind = ? AND beds = ? "
                                             f"AND start >= ? AND start < ?", [kind, beds, lo, hi]).fetchone()
                (m_med, m_n), (p_med, p_n), (y_med, y_n) = stats["m"], stats["p"], stats["y"]
                if not m_med or m_n < min_n:
                    continue
                mom = round((m_med / p_med - 1) * 100, 1) if p_med and p_n >= min_n else None
                yoy = round((m_med / y_med - 1) * 100, 1) if y_med and y_n >= min_n else None
                gross = None
                if sales_ready and kind == "apartment":
                    price, sn = con.execute(f"SELECT median(worth), count(*) FROM sales WHERE {where} AND ({SALE_BEDS}) = ? "
                                            f"AND usage = 'Residential' AND day >= ?", [beds, M - timedelta(days=180)]).fetchone()
                    if price and sn >= min_n:
                        gross = round(m_med / price * 100, 1)
                row = {"area": name, "kind": kind, "beds": beds, "label": f"{KIND_SHORT[kind]} {BED_LABEL[beds]}",
                       "median": round(m_med), "n": m_n, "mom": mom, "yoy": yoy, "gross_yield": gross}
                rows.append(row)
                if mom is not None and abs(mom) >= 5 and p_n >= 30 and m_n >= 30:
                    alerts.append(row)
    if not rows:
        return None
    pick = next((r for r in rows if r["area"] == "JVC" and r["kind"] == "apartment" and r["beds"] == "1br"), rows[0])
    line = (f"Rents (new contracts, {M:%B}): {pick['area']} {BED_LABEL[pick['beds']]} "
            f"apartment median AED {pick['median']:,} a year"
            + (f", {'up' if pick['mom'] > 0 else 'down'} {abs(pick['mom']):.1f}% on the month" if pick["mom"] else "") + ".")
    kinds = [{"key": k, "label": KIND_LABEL[k], "beds": [b for b in BEDS[k] if any(r["kind"] == k and r["beds"] == b for r in rows)]}
             for k in KINDS]
    return {"month": M.strftime("%B %Y"), "rows": rows, "alerts": alerts, "kinds": kinds, "bed_labels": BED_LABEL,
            "brief_facts": {"line": line}}


if __name__ == "__main__":
    if "--bootstrap" in sys.argv:
        files = [Path(a) for a in sys.argv[2:]] or None
        print(bootstrap(files))
