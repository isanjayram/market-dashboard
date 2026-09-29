"""Market-impact news from free RSS feeds.

Shows headlines, links and our own summaries only. Article text is never
copied: feed teasers are used to classify items and, when a free AI key is set,
as input for a summary written in our own words.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree as ET

import requests
import tomllib

from . import llm
from .config import CONFIG_DIR, DATA_DIR, SETTINGS, TZ, WATCHLIST, now

NEWS_DIR = DATA_DIR / "news"
UA = "sanjay-market-brief/1.0 (+RSS reader)"
CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"
IMPACT_RANK = {"High": 3, "Medium": 2, "Low": 1}
STOP = set("the a an of in on for to and as with at by from is are be after over new its it this that says said will".split())

with open(CONFIG_DIR / "news_rules.toml", "rb") as f:
    RULES = tomllib.load(f)
CATEGORIES = [c["name"] for c in RULES["category"]]


def _clean(text: str | None, limit: int = 400) -> str:
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _when(item: ET.Element, default_tz: str) -> datetime | None:
    raw = item.findtext("pubDate") or item.findtext("{http://www.w3.org/2005/Atom}updated") or ""
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:  # e.g. RBI publishes Indian time without an offset
        sign = -1 if default_tz.startswith("-") else 1
        hh, mm = default_tz.strip("+-").split(":")
        dt = dt.replace(tzinfo=timezone(sign * timedelta(hours=int(hh), minutes=int(mm))))
    return dt.astimezone(TZ)


def fetch_feed(feed: dict[str, Any]) -> list[dict[str, Any]]:
    r = requests.get(feed["url"], headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    out = []
    for it in root.iter("item"):
        title = _clean(it.findtext("title"), 300)
        link = (it.findtext("link") or it.findtext("guid") or "").strip()
        when = _when(it, feed.get("tz", "+00:00"))
        if not title or not link or not when:
            continue
        cats = [_clean(c.text, 60) for c in it.findall("category") if c.text]
        teaser = _clean(it.findtext("description")) or _clean(it.findtext(CONTENT_NS))
        out.append({"id": hashlib.sha1(link.split("?")[0].encode()).hexdigest()[:12], "title": title,
                    "link": link, "source": feed["name"], "kind": feed.get("kind", "outlet"),
                    "published": when.isoformat(timespec="minutes"), "tags": cats, "teaser": teaser})
    return out


def _norm(text: str) -> str:
    """Lowercase words padded with spaces, so ' fee ' never matches 'coffee'."""
    return " " + re.sub(r"[^a-z0-9&]+", " ", text.lower()) + " "


def _has(text: str, words: list[str]) -> str | None:
    return next((w for w in words if _norm(w) in text), None)


def _count(text: str, words: list[str]) -> int:
    return sum(1 for w in words if _norm(w) in text)


def classify(item: dict[str, Any]) -> dict[str, Any] | None:
    """Rule-based relevance, category, impact and watchlist tag. None = not market news."""
    title = _norm(item["title"])
    body = _norm(f"{item['title']} {item['teaser'][:250]} {' '.join(item['tags'])}")
    if item["source"] == "US Federal Reserve":
        if "fomc statement" not in item["title"].lower():
            return None
        return dict(item, category="Rates & mortgages", impact="High", watch=False,
                    impact_reason="US rate decision; the dirham's dollar peg means UAE rates usually follow")
    if item["source"] == "Reserve Bank of India":
        if not _has(body, ["remittance", "liberalised", "lrs", "fema", "non resident", "nri", "overseas investment"]):
            return None
        return dict(item, category="Regulation & fees", impact="High", watch=True,
                    impact_reason="India rule that can affect how NRI clients send money")
    # Relevant = a market term in the headline, or at least two in the headline + teaser.
    if not (_has(title, RULES["relevant"]) or _count(body, RULES["relevant"]) >= 2):
        return None
    if _has(body, RULES["exclude"]):
        return None
    category = (next((c["name"] for c in RULES["category"] if _has(title, c["keywords"])), None)
                or next((c["name"] for c in RULES["category"] if _has(body, c["keywords"])), "Macro & geopolitics"))
    # Local stories must touch the UAE, the Gulf or India; rates and oil news are global by nature.
    if category not in ("Rates & mortgages", "Macro & geopolitics") and not _has(body, RULES["places"]):
        return None
    if category == "Macro & geopolitics" and not (_has(body, RULES["places"]) or _has(body, RULES["global_macro"])):
        return None
    rule = next((r for r in RULES["impact"] if _has(title, r["keywords"])), None)
    if rule is None:  # teaser-only matches are weaker evidence: cap them at Medium
        rule = next((r for r in RULES["impact"] if _has(body, r["keywords"])), RULES["default_impact"])
        if rule["level"] == "High":
            rule = dict(rule, level="Medium")
    watch_words = RULES["watch_terms"] + [w["name"] for w in WATCHLIST.get("dubai", [])]
    return dict(item, category=category, impact=rule["level"], impact_reason=rule["reason"],
                watch=bool(_has(body, watch_words)))


def _tokens(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if w not in STOP and len(w) > 2}


def dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Same story from several outlets → one item, listing the others in `also`."""
    priority = {f["name"]: i for i, f in enumerate(SETTINGS["news"]["feeds"])}
    items = sorted(items, key=lambda x: priority.get(x["source"], 99))
    kept: list[dict[str, Any]] = []
    for it in items:
        tok = _tokens(it["title"])
        for k in kept:
            other = _tokens(k["title"])
            overlap = len(tok & other) / max(1, len(tok | other))
            close_in_time = abs(datetime.fromisoformat(k["published"]) - datetime.fromisoformat(it["published"])) < timedelta(hours=36)
            if overlap >= 0.45 and close_in_time:
                k.setdefault("also", []).append(it["source"])
                break
        else:
            kept.append(it)
    return kept


WHY = {
    "Regulation & fees": "rules or fees may change what clients pay or who can buy, so check the details before advising.",
    "Rates & mortgages": "mortgage costs and affordability for financed buyers may shift.",
    "Macro & geopolitics": "can move investor sentiment; expect questions about where the market is heading.",
    "Supply & market reports": "fresh data on prices or supply, useful context when discussing value and timing.",
    "Developer news": "new launches or results change the options and prices you can offer clients.",
    "Infrastructure": "infrastructure can shift which areas buyers favour over time (analysis, not a forecast).",
}


def _score(it: dict[str, Any]) -> tuple:
    return (IMPACT_RANK[it["impact"]] + (0.5 if it["watch"] else 0), it["published"])


def enrich_with_ai(items: list[dict[str, Any]]) -> str:
    """One AI call rewrites headline/summary/why for the top candidates. Returns a status note."""
    if not items or not llm.available():
        return "rules only (no AI key)"
    payload = [{"id": i["id"], "source": i["source"], "title": i["title"], "teaser": i["teaser"][:300],
                "rule_category": i["category"], "rule_impact": i["impact"]} for i in items]
    system = (
        "You help a Dubai real estate agent read the morning news. For each item return JSON only. "
        "Write in your own words; never copy sentences from the input. Use only facts in the input; "
        "if the teaser is empty, keep the summary to what the title says. Categories: " + ", ".join(CATEGORIES) + ". "
        "Impact: High if it changes buyer costs, eligibility, financing, sentiment or supply; Medium for market "
        "data, launches or infrastructure; Low otherwise. Set relevant=false for items not about property, "
        "mortgages, rates, UAE residency rules, the economy, infrastructure, or NRI money rules.")
    user = ("Return {\"items\": [{\"id\", \"relevant\", \"headline\" (max 12 words), \"summary\" (max 2 short "
            "sentences), \"why\" (one sentence, no prefix), \"category\", \"impact\", \"impact_reason\" (max 10 words)}]} "
            "for these items:\n" + json.dumps(payload, ensure_ascii=False))
    result, provider = llm.ask_json(system, user)
    if not result:
        return f"rules only ({provider})"
    by_id = {r.get("id"): r for r in result.get("items", []) if isinstance(r, dict)}
    for it in items:
        r = by_id.get(it["id"])
        if not r:
            continue
        if r.get("relevant") is False:
            it["drop"] = True
            continue
        it["headline"] = str(r.get("headline") or "")[:140]
        it["summary"] = str(r.get("summary") or "")[:320]
        it["why"] = str(r.get("why") or "")[:220]
        if r.get("category") in CATEGORIES:
            it["category"] = r["category"]
        if r.get("impact") in IMPACT_RANK:
            it["impact"] = r["impact"]
            it["impact_reason"] = str(r.get("impact_reason") or it["impact_reason"])[:90]
    return f"AI summaries ({provider})"


def run() -> dict[str, Any]:
    cfg = SETTINGS["news"]
    fetched, errors = [], {}
    for feed in cfg["feeds"]:
        try:
            fetched += fetch_feed(feed)
        except Exception as exc:  # one feed down never stops the others
            errors[feed["name"]] = f"{type(exc).__name__}"
    if not fetched:
        raise RuntimeError(f"no feed answered: {errors}")
    t = now()
    recent = [i for i in fetched if t - datetime.fromisoformat(i["published"]) < timedelta(hours=48)]
    items = dedupe([c for c in (classify(i) for i in recent) if c])
    items.sort(key=_score, reverse=True)
    note = enrich_with_ai(items[:15])
    items = [i for i in items if not i.get("drop")]
    for it in items:
        it.setdefault("headline", it["title"])
        it.setdefault("summary", "")
        it["why"] = it.get("why") or WHY[it["category"]]
        it["age_hours"] = round((t - datetime.fromisoformat(it["published"])).total_seconds() / 3600, 1)
    items.sort(key=_score, reverse=True)
    window = cfg["window_hours"]
    top = [i for i in items if i["age_hours"] <= window]
    if len(top) < 3:  # quiet day or weekend: look back 48 hours and say so
        window, top = 48, items
    for it in items:
        it["topic"] = _topic(it)
    top = _limit_topics(top, cfg["top_n"])
    _archive(items, t.date().isoformat())
    return {"top": top, "all": items, "window_hours": window, "count_relevant": len(items),
            "count_fetched": len(fetched), "feed_errors": errors, "mode": note, "as_of": t.isoformat(timespec="minutes")}


def _topic(it: dict[str, Any]) -> str:
    title = _norm(it["title"])
    return _has(title, RULES["topics"]) or it["category"]


def _limit_topics(items: list[dict[str, Any]], n: int, per_topic: int = 2) -> list[dict[str, Any]]:
    """At most two items per topic (e.g. five Etihad Rail stories on its opening day)."""
    out, counts, first = [], {}, {}
    for it in items:
        key = _topic(it)
        counts[key] = counts.get(key, 0) + 1
        if counts[key] <= per_topic:
            out.append(it)
            first.setdefault(key, it)
        else:
            first[key]["more"] = first[key].get("more", 0) + 1
    return out[:n]


def _public(it: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "headline", "summary", "why", "source", "link", "published", "category", "impact",
            "impact_reason", "watch", "also", "more", "topic")
    return {k: it[k] for k in keys if k in it}


def _archive(items: list[dict[str, Any]], day: str) -> None:
    path = NEWS_DIR / day[:7] / f"{day}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(path.read_text()) if path.exists() else []
    seen = {i["id"] for i in existing}
    path.write_text(json.dumps(existing + [_public(i) for i in items if i["id"] not in seen], ensure_ascii=False, indent=0))


def archive_for_site(days: int) -> list[dict[str, Any]]:
    """Last `days` of archived items, newest first, each story once."""
    cutoff = (now().date() - timedelta(days=days)).isoformat()
    out, seen = [], set()
    for path in sorted(NEWS_DIR.glob("*/*.json"), reverse=True):
        if path.stem < cutoff:
            break
        for it in json.loads(path.read_text()):
            if it["id"] not in seen:
                seen.add(it["id"])
                out.append(it)
    return sorted(out, key=lambda i: i["published"], reverse=True)


def prune(keep_days: int = 400) -> None:
    cutoff = (now().date() - timedelta(days=keep_days)).isoformat()
    for path in NEWS_DIR.glob("*/*.json"):
        if path.stem < cutoff:
            path.unlink()
