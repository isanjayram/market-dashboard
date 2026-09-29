"""Free-tier LLM calls with a hard daily cap and provider fallback.

Providers are tried in the order listed in config/settings.toml [llm].
A provider is skipped when its key isn't set. Every call counts toward
daily_call_cap (stored in data/state/llm_usage.json), so free quotas are never
exceeded. Callers always have a rule-based fallback for a None result.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import requests

from .config import SETTINGS, STATE_DIR, today

USAGE_FILE = STATE_DIR / "llm_usage.json"
_run_calls = 0


def calls_this_run() -> int:
    return _run_calls


def _usage() -> dict[str, Any]:
    return json.loads(USAGE_FILE.read_text()) if USAGE_FILE.exists() else {}


def _record(provider: str) -> None:
    global _run_calls
    _run_calls += 1
    usage = _usage()
    day = usage.setdefault(today().isoformat(), {"calls": 0, "by_provider": {}})
    day["calls"] += 1
    day["by_provider"][provider] = day["by_provider"].get(provider, 0) + 1
    keep = sorted(usage)[-30:]  # a month of history is plenty
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    USAGE_FILE.write_text(json.dumps({k: usage[k] for k in keep}, indent=1))


def used_today() -> int:
    return _usage().get(today().isoformat(), {}).get("calls", 0)


def available() -> bool:
    return any(os.environ.get(p["key_env"]) for p in SETTINGS["llm"]["providers"])


def _gemini(model: str, key: str, system: str, user: str) -> str:
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": key, "Content-Type": "application/json"}, timeout=90,
        json={"systemInstruction": {"parts": [{"text": system}]},
              "contents": [{"role": "user", "parts": [{"text": user}]}],
              "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2,
                                   "maxOutputTokens": 8192}})
    r.raise_for_status()
    cand = r.json()["candidates"][0]
    if cand.get("finishReason") not in (None, "STOP"):
        raise ValueError(f"gemini stopped early: {cand.get('finishReason')}")
    # A reply can come in several parts; skip any "thought" parts.
    return "".join(part.get("text", "") for part in cand["content"]["parts"] if not part.get("thought"))


def _groq(model: str, key: str, system: str, user: str) -> str:
    r = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, timeout=90,
        json={"model": model, "temperature": 0.2, "response_format": {"type": "json_object"},
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


CALLERS = {"gemini": _gemini, "groq": _groq}


def ask_json(system: str, user: str) -> tuple[dict[str, Any] | None, str]:
    """Return (parsed JSON, provider name) or (None, reason). Never raises."""
    if used_today() >= SETTINGS["llm"]["daily_call_cap"]:
        return None, "daily AI cap reached"
    reasons = []
    for p in SETTINGS["llm"]["providers"]:
        key = os.environ.get(p["key_env"])
        if not key:
            continue
        if used_today() >= SETTINGS["llm"]["daily_call_cap"]:
            break
        try:
            _record(p["name"])
            text = CALLERS[p["name"]](p["model"], key, system, user)
            text = re.sub(r"^```(?:json)?|```$", "", text.strip()).strip()
            if not text.startswith("{"):  # tolerate a sentence before or after the JSON
                text = text[text.find("{"):text.rfind("}") + 1]
            try:
                return json.loads(text), p["name"]
            except json.JSONDecodeError:  # most common slip: a trailing comma before } or ]
                return json.loads(re.sub(r",(\s*[}\]])", r"\1", text)), p["name"]
        except Exception as exc:  # quota, outage or bad JSON: try the next provider
            reasons.append(f"{p['name']}: {type(exc).__name__}: {str(exc)[:80]}")
    return None, "; ".join(reasons) or "no AI key set"
