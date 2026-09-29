"""Developers: Dubai top 5 computed from DLD sales, Sharjah top 5 from config.

Dubai ranking = off-plan sales value over the last 12 months, joined to DLD's
projects list (project number → developer). The projects list is small and is
saved as data/dld/projects.parquet; refresh it with

    python -m pipeline.developers --refresh     (run on a UAE connection)
"""
from __future__ import annotations

import json
import sys
from datetime import timedelta
from typing import Any

import duckdb
import tomllib

from . import dld
from .config import CONFIG_DIR, DATA_DIR, SETTINGS, today
from .news import _has, _norm

PROJECTS_FILE = DATA_DIR / "dld" / "projects.parquet"
PROJECTS_SOURCE = DATA_DIR / "dld" / "projects_source.json"
SQFT = 10.7639

with open(CONFIG_DIR / "developers.toml", "rb") as f:
    SHARJAH = tomllib.load(f)["sharjah"]


def refresh_projects() -> dict[str, Any]:
    """Projects list + developers list (the projects file only has Arabic developer names)."""
    listing, paths = dld.fetch_bulk_files(SETTINGS["dld"]["projects_dataset"], "projects")
    _, dev_paths = dld.fetch_bulk_files(SETTINGS["dld"]["developers_dataset"], "developers")
    con = duckdb.connect()

    def src(ps: list) -> str:
        return (f"read_csv([{', '.join(repr(str(p)) for p in ps)}], header = true, all_varchar = true, "
                f"union_by_name = true, compression = '{dld._compression(ps[0])}')")
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""COPY (
        SELECT TRY_CAST(p.project_number AS BIGINT) AS project_number, p.project_name,
               coalesce(nullif(trim(d.developer_name_en), ''), p.developer_name) AS developer_name,
               p.master_developer_name, p.project_status, TRY_CAST(p.percent_completed AS DOUBLE) AS percent_completed,
               CAST(TRY_STRPTIME(p.project_start_date, '%Y-%m-%d') AS DATE) AS start_date,
               CAST(TRY_STRPTIME(p.project_end_date, '%Y-%m-%d') AS DATE) AS end_date,
               p.area_name_en AS area, TRY_CAST(p.no_of_units AS INTEGER) AS units
        FROM {src(paths)} p
        LEFT JOIN (SELECT DISTINCT ON (developer_id) developer_id, developer_name_en FROM {src(dev_paths)}) d
          ON d.developer_id = p.developer_id)
        TO '{PROJECTS_FILE}' (FORMAT parquet, COMPRESSION zstd)""")
    for kind in ("projects", "developers"):  # raw exports are no longer needed
        for f in (dld.CACHE_DIR / kind).glob("*"):
            f.unlink()
    rows, english = con.execute(f"SELECT count(*), count(*) FILTER (WHERE regexp_matches(developer_name, '[A-Za-z]')) "
                                f"FROM '{PROJECTS_FILE}'").fetchone()
    PROJECTS_SOURCE.write_text(json.dumps({"snapshot": listing["snapshot"], "snapshot_time": listing["snapshot_time"]}))
    return {"snapshot": listing["snapshot"], "rows": rows, "english_names": english}


def projects_as_of() -> str | None:
    """Date of DLD's projects list (data.dubai refreshes it rarely)."""
    return json.loads(PROJECTS_SOURCE.read_text())["snapshot_time"][:10] if PROJECTS_SOURCE.exists() else None


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
        # The projects list names projects in Arabic; use the English name from DLD sales when there is one.
        launches = con.execute("""SELECT n.project, p.area, p.start_date FROM projects p
                                  JOIN (SELECT project_number, any_value(project) AS project FROM sales
                                        WHERE project IS NOT NULL GROUP BY 1) n USING (project_number)
                                  WHERE p.developer_name = ? AND p.start_date >= ?
                                  ORDER BY p.start_date DESC LIMIT 3""", [dev, since]).fetchall()
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
