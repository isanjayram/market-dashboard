"""Dubai Land Department open data from data.dubai.

Two routes, tried in order:
  1. Data API (needs DATADUBAI_API_KEY / DATADUBAI_API_SECRET): pulls only
     the last few weeks, so each run is small.
  2. Bulk files (no account): the portal's own daily CSV.gz export. About
     1.2 GB for sales, so it's downloaded once per snapshot and cached.

Both load the same slim table, `fresh_sales`, into DuckDB.
Licence: Dubai Open Data Licence. Credit: "Dubai Land Department via data.dubai".
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import date
from pathlib import Path
from typing import Any

import duckdb
import requests

from .config import CACHE_DIR, SETTINGS

DLD = SETTINGS["dld"]
UA = "sanjay-market-brief/1.0 (once-daily open-data refresh)"
SQM_TO_SQFT = 10.7639

# Columns we keep, as they appear in DLD's transactions export.
SALES_SELECT = """
    transaction_id,
    procedure_name_en AS procedure,
    CAST(COALESCE(
        TRY_STRPTIME(instance_date, '%Y-%m-%d'),
        TRY_STRPTIME(instance_date, '%d-%m-%Y'),
        TRY_STRPTIME(instance_date, '%Y-%m-%d %H:%M:%S'),
        TRY_STRPTIME(instance_date, '%Y-%m-%dT%H:%M:%S'),
        TRY_STRPTIME(instance_date, '%d/%m/%Y')
    ) AS DATE) AS day,
    reg_type_en AS reg_type,
    property_type_en AS ptype,
    property_sub_type_en AS psub,
    TRIM(property_usage_en) AS usage,
    area_name_en AS area,
    master_project_en AS master_project,
    project_name_en AS project,
    TRY_CAST(project_number AS BIGINT) AS project_number,
    building_name_en AS building,
    rooms_en AS rooms,
    TRY_CAST(procedure_area AS DOUBLE) AS size_sqm,
    TRY_CAST(actual_worth AS DOUBLE) AS worth,
    TRY_CAST(meter_sale_price AS DOUBLE) AS price_sqm
"""
API_COLUMNS = [
    "transaction_id", "procedure_name_en", "instance_date", "reg_type_en", "property_type_en",
    "property_sub_type_en", "property_usage_en", "area_name_en", "master_project_en",
    "project_name_en", "project_number", "building_name_en", "rooms_en", "procedure_area",
    "actual_worth", "meter_sale_price", "trans_group_en",
]


class SourceError(RuntimeError):
    pass


def _sql_list(values: list[str]) -> str:
    return ", ".join("'" + v.replace("'", "''") + "'" for v in values)


# ---------- bulk files ----------

def list_bulk(dataset_id: int) -> dict[str, Any]:
    """Current export for a dataset: snapshot label, time, and signed CSV links (valid ~10 min)."""
    r = requests.get(DLD["listing_url"].format(id=dataset_id),
                     headers={"User-Agent": UA, "Accept": "application/json"}, timeout=60)
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise SourceError(f"data.dubai listing failed: {body.get('message')}")
    folders = body["data"]["metadata"]
    files = [f for folder in folders for f in folder["files"] if f["file_extension"] == "csv"]
    if not files:
        raise SourceError("data.dubai listing has no CSV files")
    snapshot = re.sub(r"_\d{4}$", "", folders[0]["file_folder"])
    m = re.search(r"(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})", snapshot)
    return {
        "snapshot": snapshot,
        "snapshot_time": f"{m[1]} {m[2]}:{m[3]}" if m else None,
        "files": [{"name": f["file_name"], "url": f["file_url"], "bytes": f["file_size"]} for f in files],
    }


def _download(name: str, size: int, dataset_id: int, dest_dir: Path) -> Path:
    dest = dest_dir / name
    if dest.exists() and dest.stat().st_size == size:
        return dest
    part = dest.with_name(dest.name + ".part")
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            # Links expire after ~10 minutes, so re-list before every attempt.
            url = next(f["url"] for f in list_bulk(dataset_id)["files"] if f["name"] == name)
            with requests.get(url, headers={"User-Agent": UA}, stream=True, timeout=(30, 300)) as r:
                r.raise_for_status()
                with open(part, "wb") as out:
                    for chunk in r.iter_content(chunk_size=8 << 20):
                        out.write(chunk)
            if part.stat().st_size != size:
                raise SourceError(f"{name}: got {part.stat().st_size} bytes, expected {size}")
            part.rename(dest)
            return dest
        except Exception as exc:  # retry with a fresh link
            last_error = exc
            time.sleep(15 * (attempt + 1))
    raise SourceError(f"download failed for {name}: {last_error}")


def fetch_bulk_files(dataset_id: int, kind: str) -> tuple[dict[str, Any], list[Path]]:
    listing = list_bulk(dataset_id)
    dest_dir = CACHE_DIR / kind
    dest_dir.mkdir(parents=True, exist_ok=True)
    keep = {f["name"] for f in listing["files"]}
    for old in dest_dir.glob("*.csv.gz*"):  # drop older snapshots
        if old.name.removesuffix(".part") not in keep:
            old.unlink()
    paths = [_download(f["name"], f["bytes"], dataset_id, dest_dir) for f in listing["files"]]
    return listing, paths


def _compression(path: Path) -> str:
    """data.dubai names its exports .csv.gz, but they are sometimes plain CSV. Trust the bytes."""
    with open(path, "rb") as f:
        return "gzip" if f.read(2) == b"\x1f\x8b" else "none"


def load_sales_from_files(con: duckdb.DuckDBPyConnection, paths: list[Path], since: date) -> int:
    files = _sql_list([str(p) for p in paths])
    excluded = _sql_list(DLD["exclude_procedures"])
    kinds = {_compression(p) for p in paths}
    if len(kinds) > 1:
        raise SourceError("export files mix gzip and plain CSV")
    base = (f"read_csv([{files}], header = true, all_varchar = true, union_by_name = true, "
            f"compression = '{kinds.pop()}'{{extra}})")
    for extra in ("", ", ignore_errors = true"):
        try:
            con.execute(f"""
                CREATE OR REPLACE TABLE fresh_sales AS
                SELECT * FROM (SELECT {SALES_SELECT} FROM {base.format(extra=extra)}
                               WHERE trans_group_en = 'Sales' AND procedure_name_en NOT IN ({excluded}))
                WHERE day >= DATE '{since.isoformat()}'
            """)
            break
        except duckdb.Error:
            if extra:
                raise
    return con.execute("SELECT count(*) FROM fresh_sales").fetchone()[0]


# ---------- Data API ----------

def api_available() -> bool:
    return bool(os.environ.get("DATADUBAI_API_KEY") and os.environ.get("DATADUBAI_API_SECRET"))


def _api_token() -> str:
    r = requests.post(DLD["token_url"], timeout=30, headers={"User-Agent": UA},
                      data={"client_id": os.environ["DATADUBAI_API_KEY"],
                            "client_secret": os.environ["DATADUBAI_API_SECRET"]})
    r.raise_for_status()
    return r.json()["access_token"]


def api_rows(dataset: str, filter_expr: str, columns: list[str], page: int = 5000) -> list[dict[str, Any]]:
    """Page through a data.dubai API dataset. The response shape is checked defensively
    because the API moved from Dubai Pulse to data.dubai and may differ slightly."""
    headers = {"Authorization": f"Bearer {_api_token()}", "User-Agent": UA}
    url = f"{DLD['api_base']}/{dataset}"
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        r = requests.get(url, headers=headers, timeout=120, params={
            "filter": filter_expr, "column": ",".join(columns),
            "limit": page, "offset": offset, "order_by": "transaction_id"})
        r.raise_for_status()
        body = r.json()
        batch = body if isinstance(body, list) else (
            body.get("results") or body.get("result") or body.get("data") or body.get("records") or [])
        if isinstance(batch, dict):
            batch = batch.get("records") or batch.get("results") or []
        rows.extend(batch)
        if len(batch) < page:
            return rows
        offset += page
        if offset > 400_000:
            raise SourceError("API paging runaway")


def load_sales_from_api(con: duckdb.DuckDBPyConnection, since: date) -> int:
    excluded = _sql_list(DLD["exclude_procedures"])
    rows = api_rows("dld_transactions-open-api",
                    f"instance_date >= '{since.isoformat()}' AND trans_group_en = 'Sales'", API_COLUMNS)
    if not rows:
        raise SourceError("API returned no rows")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dump = CACHE_DIR / "api_sales.ndjson"
    with open(dump, "w") as f:
        for row in rows:
            f.write(json.dumps({k: (None if v is None else str(v)) for k, v in row.items()}) + "\n")
    con.execute(f"CREATE OR REPLACE TEMP TABLE api_raw AS SELECT * FROM read_json('{dump}', format = 'newline_delimited')")
    con.execute(f"""
        CREATE OR REPLACE TABLE fresh_sales AS
        SELECT * FROM (SELECT {SALES_SELECT} FROM api_raw WHERE procedure_name_en NOT IN ({excluded}))
        WHERE day >= DATE '{since.isoformat()}'
    """)
    return con.execute("SELECT count(*) FROM fresh_sales").fetchone()[0]
