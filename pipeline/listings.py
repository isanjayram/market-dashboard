"""Top 10 watch: checks the projects on Sanjay's site against the developers' own pages.

The site publishes /watch.json: for each project, the facts it shows and, per fact,
the developer page plus a pattern that finds the same fact there. This step reads
each page, compares what it finds with what the site says, and scans the news
archive for stories naming a project. It never edits the site; it only reports,
and Sanjay decides what to change.

    python -m pipeline.listings     run the checks and print the result
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta
from typing import Any

import requests

from . import news
from .config import SETTINGS, now

# Developers' sites serve browsers; a plain script user agent gets blocked by some.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140 Safari/537.36")


def _visible_text(page: str) -> str:
    """The words a visitor sees: scripts, styles and tags removed, spaces collapsed."""
    page = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<noscript[\s\S]*?</noscript>", " ", page)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))


def _same(a: str, b: str) -> bool:
    return re.sub(r"\s+", "", a).lower() == re.sub(r"\s+", "", b).lower()


def _fetch(url: str, cache: dict[str, str | Exception]) -> str | Exception:
    if url not in cache:
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en"}, timeout=40)
            r.raise_for_status()
            cache[url] = _visible_text(r.text)
        except Exception as exc:  # one blocked site never stops the others
            cache[url] = exc
    return cache[url]


def _why(exc: Exception) -> str:
    code = getattr(getattr(exc, "response", None), "status_code", None)
    if code in (401, 403, 429):
        return "the site blocked the check"
    return f"page didn't load ({code})" if code else "page didn't load"


def check_pages(projects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cache: dict[str, str | Exception] = {}
    out = []
    for p in projects:
        for c in p.get("checks", []):
            row = {"project": p["name"], "slug": p["slug"], "page": p["url"], "label": c["label"],
                   "url": c["url"], "expect": c["expect"]}
            text = _fetch(c["url"], cache)
            if isinstance(text, Exception):
                row.update(status="error", note=_why(text))
            else:
                m = re.search(c["pattern"], text, re.I)
                if not m and p["name"].split()[0].lower() not in text.lower():
                    # The project isn't even named: a bot-check or cookie page, not the real one.
                    row.update(status="error", note="the site showed a block page to the cloud check")
                elif not m:
                    row.update(status="missing", note="couldn't find it on the page; the page may have changed")
                else:
                    found = m.group(1).strip()
                    row.update(status="ok" if _same(found, c["expect"]) else "changed", found=found)
            out.append(row)
    return out


def news_mentions(projects: list[dict[str, Any]], days: int) -> list[dict[str, Any]]:
    cutoff = now() - timedelta(days=days)
    out = []
    for it in news.archive_for_site(days):
        if datetime.fromisoformat(it["published"]) < cutoff:
            continue
        text = f" {it.get('title', '')} {it.get('headline', '')} {it.get('teaser', '')} "
        for p in projects:
            if any(re.search(rf"\b{re.escape(a)}\b", text, re.I) for a in p.get("aliases", [])):
                out.append({"project": p["name"], "page": p["url"], "title": it.get("headline") or it["title"],
                            "link": it["link"], "source": it["source"], "published": it["published"]})
                break
    return out[:8]


def run() -> dict[str, Any]:
    cfg = SETTINGS["listings"]
    r = requests.get(cfg["watch_url"], headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    projects = r.json()["projects"]
    rows = check_pages(projects)
    counts = {k: sum(1 for x in rows if x["status"] == k) for k in ("ok", "changed", "missing", "error")}
    return {
        "checked_at": now().isoformat(timespec="minutes"),
        "site": cfg["site_url"],
        "projects": len(projects),
        "counts": counts,
        "changed": [x for x in rows if x["status"] == "changed"],
        "problems": [x for x in rows if x["status"] in ("missing", "error")],
        "unchecked": [p["name"] for p in projects if not p.get("checks")],
        "news": news_mentions(projects, cfg["news_days"]),
    }


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=1, ensure_ascii=False))
