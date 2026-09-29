"""Landmarks library: curated once in config/landmarks.toml, never fetched daily.

The only live number is "area price now": the DLD median AED/sqft for homes in
the landmark's DLD community over the last 12 months. "At launch" prices appear
only when the TOML entry cites a source; otherwise the page says "no reliable data".
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

import duckdb
import tomllib

from .config import CONFIG_DIR, today
from .pulse import RESI, SQFT

FILE = CONFIG_DIR / "landmarks.toml"


def load(con: duckdb.DuckDBPyConnection | None) -> list[dict[str, Any]] | None:
    if not FILE.exists():
        return None
    with open(FILE, "rb") as f:
        items = tomllib.load(f).get("landmark", [])
    for item in items:
        item["psf_now"] = None
        if con is None or not (item.get("dld_area") or item.get("dld_master")):
            continue
        col, val = ("area = ?", item["dld_area"]) if item.get("dld_area") else ("master_project ILIKE ?", item["dld_master"])
        item["price_label"] = (item.get("dld_area") or item["dld_master"]).rstrip("%")
        med, n = con.execute(f"SELECT median(price_sqm) / {SQFT}, count(*) FROM sales WHERE {col} AND day >= ? AND {RESI}",
                             [val, today() - timedelta(days=365)]).fetchone()
        if med and n >= 20:
            item["psf_now"] = round(med)
    return items
