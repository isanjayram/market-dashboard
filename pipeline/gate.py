"""Decide whether a scheduled run should do the work.

The workflow runs twice each morning (08:30 and 09:00 Gulf time). The second
run only works if the first one didn't finish today, so retries cost almost
no Actions minutes.

    python -m pipeline.gate [--force]    → writes skip=true|false to $GITHUB_OUTPUT
"""
from __future__ import annotations

import os
import sys

from .config import today
from .runlog import load_status


def main() -> None:
    force = "--force" in sys.argv
    done_today = load_status().get("last_success_date") == today().isoformat()
    skip = done_today and not force
    print(f"last_success_date={load_status().get('last_success_date')} today={today()} skip={skip}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"skip={'true' if skip else 'false'}\n")


if __name__ == "__main__":
    main()
