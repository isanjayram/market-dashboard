"""Telegram messages: the daily summary, staleness warnings and run failures.

Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (GitHub Secrets). Without them it
does nothing, so local test runs never message anyone.

CLI (used by the workflow):
    python -m pipeline.notify outbox             send what the run queued (after publishing)
    python -m pipeline.notify failure <run-url>  the run itself failed
"""
from __future__ import annotations

import html
import os
import sys
from typing import Any

import requests

from .config import CACHE_DIR, SETTINGS

OUTBOX = CACHE_DIR / "outbox.txt"
SEP = "\n\u241e\n"


def send(text: str) -> bool:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return False
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=20, json={
        "chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})
    return r.ok


def queue(messages: list[str]) -> int:
    OUTBOX.parent.mkdir(parents=True, exist_ok=True)
    OUTBOX.write_text(SEP.join(messages))
    return len(messages)


def send_outbox() -> int:
    if not OUTBOX.exists():
        return 0
    sent = sum(send(m) for m in OUTBOX.read_text().split(SEP) if m.strip())
    OUTBOX.unlink()
    return sent


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{'▲' if v > 0 else '▼' if v < 0 else '•'}{abs(v):.1f}%"


def daily_summary(pulse: dict[str, Any], stale_reason: str | None) -> str:
    from .render import aed, day_label  # local import keeps this module light for the CLI

    k, c = pulse["kpi"], pulse["compare"]
    lines = [
        f"<b>Market pulse · {html.escape(day_label(pulse['as_of']))}</b>",
        f"{k['deals']:,} deals, {aed(k['value'])} ({_pct(c['deals']['wd'])} vs a typical {c['weekday']})",
        f"Off-plan {k['offplan_share']:.0f}% · homes median AED {k['median_psf']:,}/sqft ({_pct(c['psf']['d30'])} 30d)",
    ]
    if pulse["rising"]:
        r = pulse["rising"][0]
        lines.append(f"Rising fastest (ready homes): {html.escape(r['area'])} {_pct(r['d90'])} over 90 days")
    if stale_reason:
        lines.append(f"⚠ STALE: {html.escape(stale_reason)}")
    lines.append(SETTINGS["run"]["dashboard_url"])
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "outbox":
        print(f"sent {send_outbox()} message(s)")
    elif len(sys.argv) >= 2 and sys.argv[1] == "failure":
        url = sys.argv[2] if len(sys.argv) > 2 else ""
        send(f"❌ <b>Dashboard run failed</b>\nYesterday's page stays up. Log: {html.escape(url)}")
