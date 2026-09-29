"""Committed history of DLD sales, as small Parquet files in data/dld/sales/.

Layout
  data/dld/sales/2026/2026-07.parquet        one file per closed month
  data/dld/sales/2026/09/2026-09-28.parquet  one file per day for the current
                                             and previous month (late
                                             registrations can still arrive)
  data/dld/agg/sales_monthly.parquet         monthly aggregates for months
                                             older than keep_raw_months

Files are only rewritten when their rows change, so git history grows by
roughly the size of each new day.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import duckdb

from .config import DATA_DIR, SETTINGS

SALES_DIR = DATA_DIR / "dld" / "sales"
AGG_FILE = DATA_DIR / "dld" / "agg" / "sales_monthly.parquet"
COLUMNS = ("transaction_id, procedure, day, reg_type, ptype, psub, usage, area, master_project, "
           "project, project_number, building, rooms, size_sqm, worth, price_sqm")


def month_start(d: date) -> date:
    return d.replace(day=1)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def open_from(today: date) -> date:
    """First day kept as daily files: the start of the previous month."""
    return add_months(month_start(today), -1)


def window_start(today: date) -> date:
    return add_months(month_start(today), -SETTINGS["dld"]["keep_raw_months"])


def month_file(m: date) -> Path:
    return SALES_DIR / f"{m:%Y}" / f"{m:%Y-%m}.parquet"


def day_file(d: date) -> Path:
    return SALES_DIR / f"{d:%Y}" / f"{d:%m}" / f"{d:%Y-%m-%d}.parquet"


def has_history() -> bool:
    return SALES_DIR.exists() and any(SALES_DIR.rglob("*.parquet"))


def _fingerprint(con: duckdb.DuckDBPyConnection, relation: str, where: str) -> tuple:
    return con.execute(
        f"SELECT count(*), round(sum(worth)), bit_xor(hash(transaction_id)) FROM {relation} WHERE {where}"
    ).fetchone()


def _write(con: duckdb.DuckDBPyConnection, where: str, path: Path) -> bool:
    """Write fresh_sales rows matching `where` to `path` if they differ from what's there."""
    new = _fingerprint(con, "fresh_sales", where)
    if new[0] == 0:
        return False
    if path.exists():
        old = _fingerprint(con, f"read_parquet('{path}')", "true")
        if old == new:
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""
        COPY (SELECT {COLUMNS} FROM fresh_sales WHERE {where} ORDER BY day, transaction_id)
        TO '{path}' (FORMAT parquet, COMPRESSION zstd)
    """)
    return True


def write_fresh(con: duckdb.DuckDBPyConnection, today: date) -> dict:
    """Save fresh_sales into partitions. Returns counts of files written."""
    lo, hi = con.execute("SELECT min(day), max(day) FROM fresh_sales").fetchone()
    if lo is None:
        return {"days_written": 0, "months_written": 0}
    cut = open_from(today)
    days = months = 0
    d = max(lo, cut)
    while d <= hi:
        days += _write(con, f"day = DATE '{d}'", day_file(d))
        d += timedelta(days=1)
    m = month_start(max(lo, window_start(today)))
    while m < cut:
        nxt = add_months(m, 1)
        path = month_file(m)
        # A closed month is complete in a bulk load only if the load covers the whole month.
        if lo <= m:
            months += _write(con, f"day >= DATE '{m}' AND day < DATE '{nxt}'", path)
        m = nxt
    return {"days_written": days, "months_written": months}


def compact(con: duckdb.DuckDBPyConnection, today: date) -> dict:
    """Merge daily files of months that are now closed; age out months past retention."""
    merged = dropped = 0
    cut = open_from(today)
    for year_dir in sorted(p for p in SALES_DIR.glob("*") if p.is_dir()):
        for month_dir in sorted(p for p in year_dir.glob("*") if p.is_dir()):
            m = date(int(year_dir.name), int(month_dir.name), 1)
            if m >= cut:
                continue
            dailies = sorted(month_dir.glob("*.parquet"))
            if dailies:
                files = ", ".join(f"'{p}'" for p in dailies + ([month_file(m)] if month_file(m).exists() else []))
                tmp = month_file(m).with_suffix(".tmp")
                con.execute(f"""
                    COPY (SELECT DISTINCT ON (transaction_id) {COLUMNS}
                          FROM read_parquet([{files}], union_by_name = true) ORDER BY day, transaction_id)
                    TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)
                """)
                tmp.replace(month_file(m))
                for p in dailies:
                    p.unlink()
                merged += 1
            if not any(month_dir.iterdir()):
                month_dir.rmdir()
    oldest = window_start(today)
    old_files = [p for p in SALES_DIR.glob("*/*.parquet") if date.fromisoformat(p.stem + "-01") < oldest]
    if old_files:
        _aggregate(con, old_files)
        for p in old_files:
            p.unlink()
            dropped += 1
    return {"months_merged": merged, "months_aged_out": dropped}


def _aggregate(con: duckdb.DuckDBPyConnection, files: list[Path]) -> None:
    listed = ", ".join(f"'{p}'" for p in files)
    new = f"""
        SELECT date_trunc('month', day)::DATE AS month, area, ptype, reg_type, rooms,
               count(*) AS deals, sum(worth) AS value,
               median(price_sqm) / 10.7639 AS median_psf,
               quantile_cont(price_sqm, 0.25) / 10.7639 AS p25_psf,
               quantile_cont(price_sqm, 0.75) / 10.7639 AS p75_psf
        FROM read_parquet([{listed}], union_by_name = true)
        GROUP BY ALL
    """
    AGG_FILE.parent.mkdir(parents=True, exist_ok=True)
    source = new if not AGG_FILE.exists() else f"""
        SELECT * FROM read_parquet('{AGG_FILE}') WHERE month NOT IN (SELECT DISTINCT month FROM ({new}))
        UNION ALL {new}"""
    tmp = AGG_FILE.with_suffix(".tmp")
    con.execute(f"COPY ({source} ORDER BY month, area) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)")
    tmp.replace(AGG_FILE)


def create_sales_view(con: duckdb.DuckDBPyConnection) -> int:
    """`sales` = everything committed under data/dld/sales (fresh rows are already written there)."""
    if not has_history():
        raise RuntimeError("no DLD sales history yet")
    con.execute(f"""
        CREATE OR REPLACE VIEW sales AS
        SELECT DISTINCT ON (transaction_id) *
        FROM read_parquet('{SALES_DIR}/**/*.parquet', union_by_name = true)
    """)
    return con.execute("SELECT count(*) FROM sales").fetchone()[0]
