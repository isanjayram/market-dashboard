"""Run log, per-module status and last-good outputs.

Every module runs inside RunLog.step(), so one failure is recorded and the
rest of the run carries on. Successful outputs are saved as "last good" so a
later failure can still show them, flagged STALE.
"""
from __future__ import annotations

import json
import time
import traceback
from contextlib import contextmanager
from typing import Any

from .config import SETTINGS, STATE_DIR, now

LAST_GOOD_DIR = STATE_DIR / "last_good"
STATUS_FILE = STATE_DIR / "status.json"
DLD_SOURCE_FILE = STATE_DIR / "dld_source.json"


class RunLog:
    def __init__(self) -> None:
        self.started = now()
        self.modules: dict[str, dict[str, Any]] = {}
        self.llm_calls = 0

    @contextmanager
    def step(self, name: str):
        entry: dict[str, Any] = {"status": "running"}
        self.modules[name] = entry
        t0 = time.monotonic()
        try:
            yield entry
            if entry["status"] == "running":
                entry["status"] = "ok"
        except Exception as exc:  # isolate: record and keep going
            entry["status"] = "failed"
            entry["error"] = f"{type(exc).__name__}: {exc}"
            entry["trace"] = traceback.format_exc(limit=8)
        finally:
            entry["seconds"] = round(time.monotonic() - t0, 1)

    def ok(self, name: str) -> bool:
        return self.modules.get(name, {}).get("status") == "ok"

    def summary(self) -> dict[str, Any]:
        return {
            "started": self.started.isoformat(timespec="seconds"),
            "finished": now().isoformat(timespec="seconds"),
            "llm_calls": self.llm_calls,
            "llm_cap": SETTINGS["llm"]["daily_call_cap"],
            "modules": {k: {kk: vv for kk, vv in v.items() if kk != "trace"} for k, v in self.modules.items()},
        }

    def save(self) -> dict[str, Any]:
        record = self.summary()
        record["traces"] = {k: v["trace"] for k, v in self.modules.items() if "trace" in v}
        path = STATE_DIR / "runs" / f"{self.started:%Y-%m}" / f"{self.started:%Y-%m-%d}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=1, default=str))
        return record


def save_last_good(module: str, payload: dict[str, Any]) -> None:
    LAST_GOOD_DIR.mkdir(parents=True, exist_ok=True)
    payload = dict(payload, saved_at=now().isoformat(timespec="minutes"))
    (LAST_GOOD_DIR / f"{module}.json").write_text(json.dumps(payload, indent=1, default=str))


def load_last_good(module: str) -> dict[str, Any] | None:
    path = LAST_GOOD_DIR / f"{module}.json"
    return json.loads(path.read_text()) if path.exists() else None


def load_status() -> dict[str, Any]:
    return json.loads(STATUS_FILE.read_text()) if STATUS_FILE.exists() else {}


def save_status(status: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(json.dumps(status, indent=1, default=str))


def save_dld_source(info: dict[str, Any]) -> None:
    """Which DLD export the committed history came from (written only after a successful download)."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    DLD_SOURCE_FILE.write_text(json.dumps(dict(info, fetched_at=now().isoformat(timespec="minutes")), indent=1))


def load_dld_source() -> dict[str, Any]:
    return json.loads(DLD_SOURCE_FILE.read_text()) if DLD_SOURCE_FILE.exists() else {}
