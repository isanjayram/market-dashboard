"""Paths, settings and clock shared by every pipeline step."""
from __future__ import annotations

import os
import tomllib
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
# MDASH_DATA / MDASH_SITE let test runs write somewhere other than the committed data/.
DATA_DIR = Path(os.environ.get("MDASH_DATA", ROOT / "data"))
STATE_DIR = DATA_DIR / "state"
SITE_DIR = Path(os.environ.get("MDASH_SITE", ROOT / "site"))
TEMPLATE_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
CACHE_DIR = Path(os.environ.get("MDASH_CACHE", ROOT / ".cache"))


def _load(name: str) -> dict:
    with open(CONFIG_DIR / f"{name}.toml", "rb") as f:
        return tomllib.load(f)


SETTINGS = _load("settings")
WATCHLIST = _load("watchlist")
TZ = ZoneInfo(SETTINGS["run"]["timezone"])


def now() -> datetime:
    return datetime.now(TZ)


def today() -> date:
    return now().date()
