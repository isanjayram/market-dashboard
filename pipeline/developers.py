"""Developers: Dubai top 5 computed from DLD sales, Sharjah top 5 from config.

Dubai ranking = off-plan sales value over the last 12 months, joined to DLD's
projects list (project number → developer). The projects list is small and is
saved as data/dld/projects.parquet; refresh it with

    python -m pipeline.developers --refresh     (run on a UAE connection)
"""
from __future__ import annotations

import sys
from datetime import timedelta
from typing import Any

import duckdb
import tomllib

from . import dld
from .config import CONFIG_DIR, DATA_DIR, SETTINGS, today
from .news import _has, _norm

PROJECTS_FILE = DATA_DIR / "dld" / "projects.parquet"
SQFT = 10.7639

with open(CONFIG_DIR / "developers.toml", "rb") as f:
    SHARJAH = tomllib.load(f)["sharjah"]


def refresh_projects() -> dict[str, Any]:
    listing, paths = dld.fetch_bulk_files(SETTINGS["dld"]["projects_dataset"], "projects")
    con = duckdb.connect()
    kinds = {dld._compression(p) for p in paths}
    files = ", ".join(f"'{p}'" for p in paths)
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""COPY (
        SELECT TRY_CAST(project_number AS BIGINT) AS project_number, project_name, developer_name,
               master_developer_name, project_status, TRY_CAST(percent_completed AS DOUBLE) AS percent_completed,
               CAST(TRY_STRPTIME(project_start_date, '%Y-%m-%d') AS DATE) AS start_date,
               CAST(TRY_STRPTIME(project_end_date, '%Y-%m-%d') AS DATE) AS end_date,
               area_name_en AS area, TRY_CAST(no_of_units AS INTEGER) AS units
        FROM read_csv([{files}], header = true, all_varchar = true, union_by_name = true, compression = '{kinds.pop()}'))
        TO '{PROJECTS_FILE}' (FORMAT parquet, COMPRESSION zstd)""")
    return {"snapshot": listing["snapshot"], "rows": con.execute(f"SELECT count(*) FROM '{PROJECTS_FILE}'").fetchone()[0]}


def _title(name: str | None) -> str:
    return (name or "").strip().title() if (name or "").isupper() else (name or "").strip()


def dubai(con: duckdb.DuckDBPyConnection, as_of: str) -> list[dict[str, Any]] | None:
    if not PROJECTS_FILE.exists():
        return None
    con.execute(f"CREATE OR REPLACE VIEW projects AS SELECT * FROM read_parquet('{PROJECTS_FILE}')")
    since = today() - timedelta(days=365)
    top = con.execute("""
        SELECT p.developer_name, sum(s.worth) AS value, count(*) AS deals
        FROM sales s JOIN projects p ON s.project_number = p.project_number
        WHERE s.reg_type = 'Off-Plan Properties' AND s.day >= ? AND p.developer_name IS NOT NULL
        GROUP BY 1 ORDER BY value DESC LIMIT 5""", [since]).fetchall()
    out = []
    for dev, value, deals in top:
        projects = con.execute(f"""
            SELECT coalesce(s.project, p.project_name) AS project, count(*) AS n,
                   median(s.price_sqm) FILTER (WHERE s.reg_type = 'Off-Plan Properties') / {SQFT} AS offplan_psf,
                   median(s.price_sqm) FILTER (WHERE s.reg_type = 'Existing Properties') / {SQFT} AS resale_psf,
                   count(*) FILTER (WHERE s.reg_type = 'Existing Properties') AS n_resale,
                   any_value(p.area) AS area
            FROM sales s JOIN projects p ON s.project_number = p.project_number
            WHERE p.developer_name = ? AND s.day >= ? AND s.usage = 'Residential'
            GROUP BY 1 ORDER BY n DESC LIMIT 3""", [dev, since]).fetchall()
        launches = con.execute("""SELECT project_name, area, start_date FROM projects WHERE developer_name = ?
                                  AND start_date >= ? ORDER BY start_date DESC LIMIT 3""", [dev, since]).fetchall()
        out.append({
            "name": _title(dev), "value_12m": value, "offplan_deals_12m": deals,
            "top_projects": [{"project": _title(p), "sales_12m": n, "area": a,
                              "offplan_psf": round(o) if o else None,
                              "resale_psf": round(r) if r and nr >= 10 else None} for p, n, o, r, nr, a in projects],
            "recent_launches": [{"project": _title(n), "area": a, "registered": str(d)} for n, a, d in launches],
        })
    return out


def sharjah(news_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for d in SHARJAH:
        mentions = [n for n in news_items if _has(_norm(f"{n['title']} {n.get('teaser', '')}"), d["match"])]
        out.append({"name": d["name"], "flagships": d["flagships"],
                    "news": [{"headline": n["headline"], "link": n["link"], "source": n["source"]} for n in mentions[:2]]})
    return out


if __name__ == "__main__":
    if "--refresh" in sys.argv:
        print(refresh_projects())
