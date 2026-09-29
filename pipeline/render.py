"""Render the static dashboard into site/ (one HTML file with inline CSS and JS)."""
from __future__ import annotations

import json
import shutil
from datetime import date, datetime
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import charts
from .config import SETTINGS, SITE_DIR, STATIC_DIR, TEMPLATE_DIR, WATCHLIST, now


def aed(v: float | None) -> str:
    if v is None:
        return "n/a"
    if v >= 1e9:
        return f"AED {v / 1e9:.1f}bn"
    if v >= 1e6:
        return f"AED {v / 1e6:.1f}m" if v < 1e7 else f"AED {v / 1e6:.0f}m"
    return f"AED {v / 1e3:.0f}k"


def num(v: float | None) -> str:
    return "n/a" if v is None else f"{round(v):,}"


def delta(v: float | None, suffix: str = "%") -> dict[str, str]:
    if v is None:
        return {"text": "n/a", "cls": "flat"}
    arrow = "▲" if v > 0 else "▼" if v < 0 else "•"
    return {"text": f"{arrow} {abs(v):.1f}{suffix}", "cls": "up" if v > 0 else "down" if v < 0 else "flat"}


def day_label(iso: str, fmt: str = "%a %-d %b") -> str:
    return date.fromisoformat(iso).strftime(fmt)


def _trend_charts(trend: dict[str, Any]) -> dict[str, str]:
    days = [date.fromisoformat(d) for d in trend["days"]]
    out = {}
    if not days:
        return out
    last = days[-1]
    for key, span in (("d30", 30), ("d90", 90), ("m12", 371)):
        idx = [i for i, d in enumerate(days) if (last - d).days < span]
        vals = [trend["avg"][i] for i in idx]
        labels = [days[i].strftime("%-d %b") for i in idx]
        tips = [days[i].strftime("%a %-d %b") for i in idx]
        ticks = sorted({0, len(vals) // 2, len(vals) - 1}) if vals else []
        out[key] = charts.line_chart(vals, labels, ticks, tip_labels=tips, label=f"Deals per business day, 7-day average, last {key}")
    weeks = [date.fromisoformat(w) for w in trend["psf_weeks"]]
    if weeks:
        ticks = sorted({0, len(weeks) // 2, len(weeks) - 1})
        out["psf"] = charts.line_chart(trend["psf"], [w.strftime("%b %y") for w in weeks], ticks,
                                       tip_labels=[f"Week of {w:%-d %b %Y}" for w in weeks],
                                       label="Median AED per sqft, weekly, residential")
    return out


def build(pulse: dict[str, Any] | None, pulse_meta: dict[str, Any], run: dict[str, Any]) -> None:
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape(["html", "j2"]))
    env.filters.update(aed=aed, num=num, delta=delta, day_label=day_label)
    stamp = now()
    ctx: dict[str, Any] = {
        "now": stamp,
        "today_label": stamp.strftime("%a %-d %b %Y"),
        "updated": stamp.strftime("%H:%M"),
        "pulse": pulse,
        "meta": pulse_meta,
        "run": run,
        "watch_sharjah": WATCHLIST.get("sharjah", []),
        "settings": SETTINGS,
        "css": (STATIC_DIR / "app.css").read_text(),
        "js": (STATIC_DIR / "app.js").read_text(),
    }
    if pulse:
        k = pulse["kpi"]
        ctx["charts"] = _trend_charts(pulse["trend"])
        ctx["charts"]["top_volume"] = charts.bar_list(
            [(r["area"], r["deals"], f"{r['deals']:,}") for r in pulse["top_volume"]], label="Busiest areas by deals, last 7 days")
        ctx["charts"]["top_value"] = charts.bar_list(
            [(r["area"], r["value"], aed(r["value"])) for r in pulse["top_value"]], label="Top areas by value, last 7 days")
        ctx["spark_value"] = charts.sparkline(pulse["trend"].get("value", pulse["trend"]["deals"])[-14:])
        ctx["spark_psf"] = charts.sparkline(pulse["trend"]["psf"][-14:])
        ctx["offplan_pct"] = k["offplan_share"] or 0
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    html = env.get_template("index.html.j2").render(**ctx)
    (SITE_DIR / "index.html").write_text(html)
    (SITE_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
    health = {"updated": stamp.isoformat(timespec="minutes"), "dld_as_of": pulse and pulse.get("as_of"),
              "stale": bool(pulse_meta.get("stale"))}
    (SITE_DIR / "health.json").write_text(json.dumps(health))
    for extra in STATIC_DIR.glob("*.svg"):
        shutil.copy(extra, SITE_DIR / extra.name)
