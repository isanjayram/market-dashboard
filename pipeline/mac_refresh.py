"""Mac bridge: refresh DLD sales from Sanjay's Mac until the data.dubai API key arrives.

data.dubai rejects GitHub's cloud servers, so a scheduled job on the Mac downloads
DLD's daily export (about 1.15 GB), saves the updated history into the repo and
pushes it. That push starts the cloud workflow, which builds and publishes the
dashboard as usual. The raw export is deleted afterwards.

The job works in its own copy of the repo, so it never touches a working copy
that's being edited. It runs at login and at several times each day; if the Mac
is asleep at a scheduled time, macOS runs the job when it wakes.

    python -m pipeline.mac_refresh --install     set up the daily job
    python -m pipeline.mac_refresh --uninstall   remove it
    python -m pipeline.mac_refresh               one refresh (what the job runs)
"""
from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

LABEL = "com.sanjay.morningbrief.refresh"
HOME = Path.home()
APP_DIR = HOME / "Library" / "Application Support" / "MorningBrief"
REPO = APP_DIR / "repo"
VENV = APP_DIR / "venv"
CACHE = HOME / "Library" / "Caches" / "MorningBrief"
LOG = HOME / "Library" / "Logs" / "MorningBrief" / "refresh.log"
PLIST = HOME / "Library" / "LaunchAgents" / f"{LABEL}.plist"
# DLD rebuilds its export around 06:35 Dubai time. The Mac is usually switched on after 9,
# so the job also runs at login and several times through the day; once the day's file
# is in, later runs just check and stop.
TIMES = [(7, 0), (8, 15), (9, 15), (9, 45), (10, 30), (12, 0), (15, 0)]
ROOT = Path(__file__).resolve().parents[1]
MAC_SOURCE = "data.dubai bulk export (downloaded on Sanjay's Mac; GitHub's servers are blocked)"


def log(msg: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M} {msg}", flush=True)


def git(*args: str, cwd: Path = REPO) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def notify(msg: str) -> None:
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "Morning Brief"'], capture_output=True)


def refresh() -> int:
    git("pull", "--rebase", "--quiet")
    # Imported after the pull so this run uses the latest pipeline code.
    import duckdb

    from . import dld
    from .config import CACHE_DIR, SETTINGS
    from .run import refresh_sales
    from .runlog import load_dld_source, save_dld_source

    listing = dld.list_bulk(SETTINGS["dld"]["transactions_dataset"])
    have = load_dld_source().get("snapshot")
    if listing["snapshot"] == have:
        log(f"already have {have}; nothing to do")
        tick()
        return 0
    log(f"new DLD export {listing['snapshot']}; downloading")
    meta = refresh_sales(duckdb.connect(), None)
    save_dld_source({"source": MAC_SOURCE, **{k: meta.get(k) for k in ("snapshot", "snapshot_time", "newest_day")}})
    shutil.rmtree(CACHE_DIR / "transactions", ignore_errors=True)  # raw export no longer needed
    git("add", "data/dld", "data/state/dld_source.json")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO).returncode:
        git("commit", "--quiet", "-m", f"data: DLD {meta['snapshot']} (Mac refresh)")
        git("pull", "--rebase", "--quiet")
        git("push", "--quiet")
    log(f"pushed {meta['snapshot']} (newest day {meta['newest_day']}, {meta.get('rows')} rows)")
    return 0


def tick() -> None:
    """First run of the day with no new DLD file: push a small marker so the cloud still rebuilds
    (GitHub's own scheduler can start hours late)."""
    marker = REPO / "data" / "state" / "mac_tick.json"
    today = f"{datetime.now():%Y-%m-%d}"
    if marker.exists() and today in marker.read_text():
        return
    if today in git("log", "-1", "--format=%cs", "--", "data/state/dld_source.json"):
        return  # today's DLD push already started a build
    marker.write_text(f'{{"date": "{today}"}}\n')
    git("add", "data/state/mac_tick.json")
    git("commit", "--quiet", "-m", f"tick: {today} (Mac switched on)")
    git("pull", "--rebase", "--quiet")
    git("push", "--quiet")
    log("no new DLD file; asked the cloud to rebuild")


def install() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    if not (REPO / ".git").exists():
        subprocess.run(["git", "clone", "--quiet", git("remote", "get-url", "origin", cwd=ROOT), str(REPO)], check=True)
    for key in ("user.name", "user.email"):  # commit as the same person as the main copy
        git("config", key, git("config", key, cwd=ROOT))
    if not (VENV / "bin" / "python").exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    subprocess.run([str(VENV / "bin" / "pip"), "install", "--quiet", "-r", str(REPO / "requirements.txt")], check=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    uninstall(quiet=True)
    with open(PLIST, "wb") as f:
        plistlib.dump({
            "Label": LABEL,
            "ProgramArguments": [str(VENV / "bin" / "python"), "-m", "pipeline.mac_refresh"],
            "WorkingDirectory": str(REPO),
            "EnvironmentVariables": {"MDASH_CACHE": str(CACHE), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"},
            "StartCalendarInterval": [{"Hour": h, "Minute": m} for h, m in TIMES],
            "RunAtLoad": True,  # also run at login, i.e. when the Mac is switched on
            "StandardOutPath": str(LOG), "StandardErrorPath": str(LOG),
        }, f)
    subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(PLIST)], check=True)
    print(f"installed: runs daily at {', '.join(f'{h:02d}:{m:02d}' for h, m in TIMES)}; log at {LOG}")


def uninstall(quiet: bool = False) -> None:
    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"], capture_output=True)
    PLIST.unlink(missing_ok=True)
    if not quiet:
        print("removed the daily job (the repo copy in Application Support can be deleted by hand)")


if __name__ == "__main__":
    if "--install" in sys.argv:
        install()
    elif "--uninstall" in sys.argv:
        uninstall()
    else:
        try:
            sys.exit(refresh())
        except Exception as exc:
            log(f"FAILED {type(exc).__name__}: {exc}")
            notify("DLD refresh failed; it will retry at the next scheduled time.")
            sys.exit(1)
