"""Morning Brief: 5 bullets on what changed and 3 client talking points.

Built only from what is already on the page (Market Pulse, Rent, News).
Templates always work; when a free AI key is set, one call rewrites them more
naturally. The AI version is rejected if it contains any number that isn't in
the page's own facts, so it can't invent figures.
"""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

from . import llm


def _pct(v: float | None, word_up: str = "up", word_down: str = "down") -> str:
    if v is None:
        return "flat"
    return f"{word_up if v > 0 else word_down} {abs(v):.1f}%" if abs(v) >= 0.05 else "flat"


def _aed(v: float) -> str:
    return f"AED {v / 1e9:.1f}bn" if v >= 1e9 else f"AED {v / 1e6:.0f}m"


def facts(pulse: dict[str, Any] | None, news: dict[str, Any] | None, rent: dict[str, Any] | None) -> dict[str, Any]:
    """The only material the Brief may use."""
    out: dict[str, Any] = {}
    if pulse:
        k, c = pulse["kpi"], pulse["compare"]
        day = date.fromisoformat(pulse["as_of"])
        out["market"] = {
            "dld_day": day.strftime("%A %-d %B"), "sales": k["deals"], "value": _aed(k["value"]),
            "vs_typical_weekday_pct": c["deals"].get("wd"), "weekday": c.get("weekday"),
            "offplan_share_pct": k["offplan_share"], "offplan_share_7d_pct": c.get("offplan_share_7d"),
            "median_aed_per_sqft": k["median_psf"], "median_vs_30d_pct": c["psf"]["d30"],
            "median_vs_last_year_pct": c["psf"]["yoy"], "sales_per_day_this_week": round(c["deals"].get("tw_avg", c["deals"]["avg7"]) or 0),
            "sales_per_day_same_week_last_year": round(c["deals"]["ly_avg"] or 0),
            "sales_vs_same_week_last_year_pct": c["deals"]["yoy"],
            "busiest_areas_7d": [{"area": a["area"], "sales": a["deals"]} for a in pulse["top_volume"][:3]],
            "rising_ready_homes_90d": [{"area": r["area"], "change_pct": r["d90"]} for r in pulse["rising"][:2]],
        }
    if rent:
        out["rent"] = rent.get("brief_facts")
    if news:
        out["news"] = [{"headline": n["headline"], "impact": n["impact"], "why": n["why"], "source": n["source"],
                        "topic": n.get("topic")} for n in news["top"][:5]]
    return out


def template(f: dict[str, Any]) -> dict[str, Any]:
    bullets, points = [], []
    m = f.get("market")
    if m:
        wd = m["vs_typical_weekday_pct"]
        bullets.append(f"{m['dld_day']}: {m['sales']:,} sales worth {m['value']}, "
                       f"{_pct(wd)} on a typical {m['weekday']}.")
        bullets.append(f"Off-plan took {m['offplan_share_pct']:.0f}% of sales"
                       + (f" (7-day average {m['offplan_share_7d_pct']:.0f}%)." if m.get("offplan_share_7d_pct") else "."))
        bullets.append(f"Median home price AED {m['median_aed_per_sqft']:,}/sqft, {_pct(m['median_vs_30d_pct'])} "
                       f"on the last 30 days" + (f" and {_pct(m['median_vs_last_year_pct'])} on a year ago." if m.get("median_vs_last_year_pct") is not None else "."))
        busy = m["busiest_areas_7d"]
        if busy:
            line = f"Busiest this week: {busy[0]['area']} ({busy[0]['sales']:,} sales)"
            if m["rising_ready_homes_90d"]:
                r = m["rising_ready_homes_90d"][0]
                line += f"; rising fastest (ready homes): {r['area']}, {_pct(r['change_pct'])} over 90 days"
            bullets.append(line + ".")
    if f.get("rent"):
        bullets.append(f["rent"]["line"])
    news = f.get("news") or []
    high = [n for n in news if n["impact"] == "High"]
    if news and len(bullets) < 5:
        bullets.append(f"{len(high) or 'No'} high-impact news item{'s' if len(high) != 1 else ''} today"
                       + (f"; top story: {news[0]['headline']}." if news else "."))
    def news_point(n: dict[str, Any]) -> str:
        why = n["why"].rstrip(".")
        return f"{n['headline'].rstrip('.')}. {why[0].upper() + why[1:]}." if why else n["headline"]

    seen_topics: set[str] = set()
    picked = []
    for n in high + [n for n in news if n["impact"] != "High"]:
        topic = n.get("topic") or n["headline"][:25]
        if topic not in seen_topics:
            seen_topics.add(topic)
            picked.append(n)
    points += [news_point(n) for n in [n for n in picked if n["impact"] == "High"][:2]]
    if m and m.get("sales_vs_same_week_last_year_pct") is not None:
        points.append(f"Sales are running at {m['sales_per_day_this_week']:,} a day against "
                      f"{m['sales_per_day_same_week_last_year']:,} in the same week last year "
                      f"({_pct(m['sales_vs_same_week_last_year_pct'])}), while the median home price is "
                      f"{_pct(m['median_vs_last_year_pct'])} on a year ago.")
    points += [news_point(n) for n in picked if n["impact"] != "High"][: max(0, 3 - len(points))]
    if m and len(points) < 3:
        points.append(f"Off-plan is {m['offplan_share_pct']:.0f}% of sales, so payment plans still drive the market.")
    return {"bullets": bullets[:5], "talking_points": points[:3], "mode": "template"}


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "").rstrip(".").lstrip("0") or "0" for n in re.findall(r"\d[\d,]*\.?\d*", text)}


def build(pulse: dict[str, Any] | None, news: dict[str, Any] | None, rent: dict[str, Any] | None) -> dict[str, Any]:
    f = facts(pulse, news, rent)
    base = template(f)
    if not llm.available() or not f:
        return base
    system = ("You write a 60-second morning brief for a Dubai property agent. Use ONLY the facts given. "
              "Never add numbers that aren't in the facts. Plain English, short sentences, no hype, no forecasts.")
    user = ("Facts (JSON):\n" + json.dumps(f, ensure_ascii=False) +
            "\n\nReturn JSON {\"bullets\": [5 strings: what changed, most useful first], "
            "\"talking_points\": [3 strings the agent can say to clients, based on the high-impact news first]}.")
    result, provider = llm.ask_json(system, user)
    if not result or not isinstance(result.get("bullets"), list) or not isinstance(result.get("talking_points"), list):
        return base
    allowed = _numbers(json.dumps(f))
    text = " ".join(map(str, result["bullets"] + result["talking_points"]))
    unknown = _numbers(text) - allowed
    if unknown:  # the AI used a number that isn't on the page: keep the template
        return dict(base, mode=f"template (AI added unknown numbers: {sorted(unknown)[:3]})")
    return {"bullets": [str(b) for b in result["bullets"][:5]],
            "talking_points": [str(t) for t in result["talking_points"][:3]], "mode": f"AI ({provider})"}
