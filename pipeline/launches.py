"""Project Pipeline: new launches and infrastructure announcements from the news feeds.

Items are kept for 90 days in data/pipeline/items.json so "NEW since yesterday"
works. When a free AI key is set, one call extracts project fields; otherwise
the headline and link are stored and the fields show "pending". Impact notes
only cite verified catalysts from config/catalysts.toml.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

import tomllib

from . import llm
from .config import CONFIG_DIR, DATA_DIR, today
from .news import _has, _norm, _topic

ITEMS_FILE = DATA_DIR / "pipeline" / "items.json"
FIELDS = ("project", "developer", "location", "type", "launch_date", "handover", "starting_price", "payment_plan")
LAUNCH = ["launch", "launches", "unveil", "unveils", "new project", "phase", "tower", "residences", "community",
          "master plan", "masterplan", "breaks ground", "groundbreaking", "sales event", "villas", "apartments"]
INFRA = ["metro", "rail", "road", "bridge", "tunnel", "airport", "station", "school", "hospital", "mall",
         "contract awarded", "awards contract", "opens", "opening"]

with open(CONFIG_DIR / "catalysts.toml", "rb") as f:
    CATALYSTS = tomllib.load(f)["catalyst"]


def _kind(item: dict[str, Any]) -> str | None:
    title = _norm(item["headline"] + " " + item.get("title", ""))
    if item["category"] == "Infrastructure" and _has(title, INFRA):
        return "Infrastructure"
    if item["category"] == "Developer news" and _has(title, LAUNCH):
        return "Off-plan launch"
    return None


def _catalyst(text: str) -> dict[str, Any] | None:
    t = _norm(text)
    for c in CATALYSTS:
        if _has(t, c["areas"]) or _norm(c["name"]) in t:
            return {"name": c["name"], "status": c["status"], "source": c["source"], "url": c["url"]}
    return None


def _extract(new: list[dict[str, Any]]) -> str:
    if not new or not llm.available():
        return "rules only"
    payload = [{"id": i["id"], "title": i["title"], "teaser": i.get("teaser", "")[:400]} for i in new]
    system = ("Extract property project facts for a Dubai agent. Use ONLY facts stated in the input; "
              "use null when a field isn't stated. Never guess prices or dates.")
    user = ('Return {"items": [{"id", ' + ", ".join(f'"{k}"' for k in FIELDS) + "}]} for:\n" +
            json.dumps(payload, ensure_ascii=False))
    result, provider = llm.ask_json(system, user)
    if not result:
        return f"rules only ({provider})"
    by_id = {r.get("id"): r for r in result.get("items", []) if isinstance(r, dict)}
    for i in new:
        r = by_id.get(i["id"]) or {}
        i["fields"] = {k: (str(r[k])[:80] if r.get(k) not in (None, "", "null") else None) for k in FIELDS}
    return f"AI extraction ({provider})"


def run(news_items: list[dict[str, Any]]) -> dict[str, Any]:
    store: dict[str, Any] = json.loads(ITEMS_FILE.read_text()) if ITEMS_FILE.exists() else {}
    t = today().isoformat()
    new = []
    topics_today = {_topic(e) for e in store.values() if e["first_seen"] == t}
    for it in news_items:
        kind = _kind(it)
        if not kind or it["id"] in store or _topic(it) in topics_today:
            continue  # one pipeline entry per topic per day (e.g. one Etihad Rail item, not eight)
        topics_today.add(_topic(it))
        text = f"{it['title']} {it.get('teaser', '')}"
        region = "Sharjah" if "sharjah" in text.lower() else "Dubai" if "dubai" in text.lower() else "UAE"
        entry = {"id": it["id"], "title": it["headline"], "link": it["link"], "source": it["source"], "category": it["category"],
                 "published": it["published"], "first_seen": t, "kind": kind, "region": region,
                 "catalyst": _catalyst(text), "fields": {k: None for k in FIELDS}, "teaser": it.get("teaser", "")}
        new.append(entry)
    mode = _extract(new)
    for e in new:
        e.pop("teaser", None)
        store[e["id"]] = e
    cutoff = (date.fromisoformat(t) - timedelta(days=90)).isoformat()
    store = {k: v for k, v in store.items() if v["first_seen"] >= cutoff}
    ITEMS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ITEMS_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=0))
    items = sorted(store.values(), key=lambda e: (e["first_seen"], e["published"]), reverse=True)
    for e in items:
        e["new"] = e["first_seen"] == t
    return {"items": items[:30], "new_today": len(new), "mode": mode}
