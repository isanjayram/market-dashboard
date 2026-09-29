"""Daily run: DLD sales → history → Market Pulse → page → Telegram.

    python -m pipeline.run                    normal run (what GitHub Actions calls)
    python -m pipeline.run --files a.csv.gz   use local DLD export files instead of downloading

Each step is isolated: if one fails, the others still run, the page shows the
last good data flagged STALE, and the failure is logged in data/state/runs/.
Exit code is non-zero only when no page could be built.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import duckdb

from . import dld, notify, pulse, render, store
from .config import SETTINGS, now, today
from .runlog import (RunLog, load_dld_source, load_last_good, load_status, save_dld_source,
                     save_last_good, save_status)


def refresh_sales(con: duckdb.DuckDBPyConnection, files: list[Path] | None) -> dict:
    t = today()
    bootstrap = not store.has_history()
    meta: dict = {"bootstrap": bootstrap}
    loaded = False
    if files:
        meta.update(source="local files", rows=dld.load_sales_from_files(con, files, store.window_start(t)))
        loaded = True
    elif dld.api_available() and not bootstrap:
        try:
            meta.update(source="data.dubai API", rows=dld.load_sales_from_api(con, t - timedelta(days=21)),
                        snapshot_time=now().strftime("%Y-%m-%d %H:%M"))
            loaded = True
        except Exception as exc:  # fall back to the bulk export
            meta["api_error"] = f"{type(exc).__name__}: {exc}"
    if not loaded:
        listing, paths = dld.fetch_bulk_files(SETTINGS["dld"]["transactions_dataset"], "transactions")
        meta.update(source="data.dubai bulk export", snapshot=listing["snapshot"],
                    snapshot_time=listing["snapshot_time"],
                    rows=dld.load_sales_from_files(con, paths, store.window_start(t)))
    if not meta["rows"]:
        raise dld.SourceError("DLD returned no sales rows")
    meta.update(store.write_fresh(con, t))
    meta.update(store.compact(con, t))
    meta["newest_day"] = str(con.execute("SELECT max(day) FROM fresh_sales").fetchone()[0])
    return meta


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--files", nargs="*", type=Path, help="local DLD transactions CSV(.gz) files")
    parser.add_argument("--no-notify", action="store_true")
    args = parser.parse_args()

    log = RunLog()
    con = duckdb.connect()
    status = load_status()
    pulse_data, pulse_meta = None, {}

    with log.step("dld_sales") as s:
        s.update(refresh_sales(con, args.files))
        if not args.files:  # remember which DLD file the committed history came from
            save_dld_source({k: s.get(k) for k in ("source", "snapshot", "snapshot_time", "newest_day")})
    dld_src = load_dld_source()
    pulse_meta.update(source=dld_src.get("source"), snapshot_time=dld_src.get("snapshot_time"),
                      fetched_at=dld_src.get("fetched_at"))
    pulse_meta["test"] = bool(args.files)  # local files = test run; the page says so

    with log.step("pulse") as s:
        s["rows"] = store.create_sales_view(con)
        pulse_data = pulse.compute(con)
        s["as_of"] = pulse_data["as_of"]
        save_last_good("pulse", {"pulse": pulse_data, "meta": pulse_meta})

    stale_reason = None
    if not log.ok("pulse"):
        good = load_last_good("pulse")
        if good:
            pulse_data, pulse_meta = good["pulse"], dict(good["meta"])
            stale_reason = f"market data last updated {good['saved_at'][:16].replace('T', ' ')}"
    elif not log.ok("dld_sales"):
        # A failed download only matters if the saved DLD file is itself old. data.dubai
        # publishes one file a day, so yesterday's or today's file is still current.
        snap_day = str(dld_src.get("snapshot_time") or "")[:10]
        if not snap_day or date.fromisoformat(snap_day) < today() - timedelta(days=1):
            stale_reason = f"couldn't download DLD's newer files; showing the file of {snap_day or 'an earlier day'}"
        else:
            pulse_meta["note"] = (f"data.dubai blocked this morning's cloud download, so this uses DLD's file of "
                                  f"{snap_day} (downloaded {str(dld_src.get('fetched_at'))[:16].replace('T', ' ')}).")
    if pulse_data:
        age = (today() - date.fromisoformat(pulse_data["as_of"])).days
        if age > SETTINGS["dld"]["stale_after_days"] and not stale_reason:
            stale_reason = f"newest DLD day is {age} days old ({pulse_data['as_of']})"
    pulse_meta.update(stale=bool(stale_reason), stale_reason=stale_reason,
                      stale_short="Stale data · see note" if stale_reason else None)

    with log.step("render"):
        render.build(pulse_data, pulse_meta, log.summary())

    # Telegram messages are queued here and sent by the workflow only after the page is published.
    with log.step("outbox") as s:
        messages = []
        if pulse_data:
            messages.append(notify.daily_summary(pulse_data, stale_reason))
        failed = [k for k, v in log.modules.items() if v["status"] == "failed"]
        if failed:
            messages.append("⚠ <b>Dashboard partly failed</b>: " + ", ".join(failed) + ". The page shows the last good data.")
        s["queued"] = notify.queue(messages) if not args.no_notify else 0

    record = log.save()
    status["modules"] = {k: {"status": v["status"], "at": record["finished"]} for k, v in log.modules.items()}
    snap = str(log.modules.get("dld_sales", {}).get("snapshot_time") or "")
    fresh = log.ok("dld_sales") and snap.startswith(today().isoformat())
    if log.ok("render") and log.ok("pulse") and fresh:  # else the 09:00 retry runs again
        status["last_success_date"] = today().isoformat()
        status["last_success_at"] = record["finished"]
    save_status(status)
    for name, m in record["modules"].items():
        print(f"{name:10s} {m['status']:7s} {m['seconds']:>6}s  {m.get('error', '')}")
    return 0 if log.ok("render") else 1


if __name__ == "__main__":
    sys.exit(main())
