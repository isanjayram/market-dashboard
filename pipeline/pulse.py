"""Market Pulse: what DLD sales did on the latest registration day, and how that compares.

Definitions (also shown on the page):
  - A "business day" is a day with at least `min_deals_full_day` sales. Weekends,
    holidays and partial loads fall below it and are left out of averages.
  - "vs 7-day avg" / "vs 30-day avg": the latest day against the mean of the business
    days in the previous 7 / 30 calendar days.
  - "vs same week last year": business-day average for the 7 days to the latest day,
    against the same weekday-aligned 7 days 52 weeks earlier.
  - AED/sqft uses residential units and villas only: median of each deal's price per
    sqft, and average = total value / total area.
"""
from __future__ import annotations

from datetime import date, timedelta
from statistics import mean
from typing import Any

import duckdb

from .config import SETTINGS, WATCHLIST

SQFT = 10.7639
RESI = "usage = 'Residential' AND ptype IN ('Unit', 'Villa') AND price_sqm > 0 AND size_sqm >= 15"
OFFPLAN = "reg_type = 'Off-Plan Properties'"


def _q(con: duckdb.DuckDBPyConnection, sql: str, *params: Any) -> list[tuple]:
    return con.execute(sql, list(params)).fetchall()


def _one(con: duckdb.DuckDBPyConnection, sql: str, *params: Any) -> tuple:
    return con.execute(sql, list(params)).fetchone()


def _pct(new: float | None, old: float | None) -> float | None:
    if new is None or not old:
        return None
    return round((new / old - 1) * 100, 1)


def _like_any(col: str, patterns: list[str]) -> str:
    return "(" + " OR ".join(f"COALESCE({col}, '') ILIKE '{p.replace(chr(39), chr(39) * 2)}'" for p in patterns) + ")"


def watch_filter(entry: dict[str, Any]) -> str:
    parts = []
    if entry.get("areas"):
        parts.append("area IN (" + ", ".join("'" + a.replace("'", "''") + "'" for a in entry["areas"]) + ")")
    if entry.get("master_like"):
        parts.append(_like_any("master_project", entry["master_like"]))
    where = "(" + " OR ".join(parts) + ")" if parts else "false"
    if entry.get("master_not_like"):
        where += " AND NOT " + _like_any("master_project", entry["master_not_like"])
    return where


def friendly_names(con: duckdb.DuckDBPyConnection, since: date) -> dict[str, str]:
    """DLD community name → the master project most of its sales belong to, when one dominates."""
    rows = _q(con, """
        WITH t AS (SELECT area, master_project, count(*) AS n FROM sales
                   WHERE day >= ? AND area IS NOT NULL GROUP BY ALL),
             r AS (SELECT area, master_project, n, n / sum(n) OVER (PARTITION BY area) AS share,
                          row_number() OVER (PARTITION BY area ORDER BY n DESC) AS rk FROM t)
        SELECT area, master_project, share FROM r WHERE rk = 1""", since)
    names = {}
    for area, master, share in rows:
        if master and share >= 0.5 and master.strip().lower() != area.strip().lower():
            m = master.strip()
            names[area] = m.title() if m.isupper() else m
    aliases = WATCHLIST.get("aliases", {})
    return {a: aliases.get(n, n) for a, n in names.items()}


def compute(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    cfg, pcfg = SETTINGS["dld"], SETTINGS["pulse"]
    full = cfg["min_deals_full_day"]

    daily = _q(con, f"""
        SELECT day, count(*) AS deals, sum(worth) AS val, count(*) FILTER (WHERE {OFFPLAN}) AS offplan
        FROM sales WHERE day IS NOT NULL GROUP BY day ORDER BY day""")
    if not daily:
        raise RuntimeError("no sales rows")
    series = {d: {"deals": n, "value": v or 0.0, "offplan": o} for d, n, v, o in daily}
    business = [d for d, row in series.items() if row["deals"] >= full]
    if not business:
        raise RuntimeError(f"no day with at least {full} sales")
    D = business[-1]
    newest = daily[-1][0]
    partial = {"day": newest, "deals": series[newest]["deals"]} if newest > D else None

    def bdays(lo: date, hi: date) -> list[date]:
        return [d for d in business if lo <= d <= hi]

    def avg(days: list[date], key: str) -> float | None:
        return mean(series[d][key] for d in days) if days else None

    def med_psf(lo: date, hi: date, extra: str = "true") -> tuple[float | None, int]:
        m, n = _one(con, f"SELECT median(price_sqm) / {SQFT}, count(*) FROM sales "
                         f"WHERE day BETWEEN ? AND ? AND {RESI} AND {extra}", lo, hi)
        return (round(m) if m else None), n

    k = _one(con, f"""
        SELECT count(*), sum(worth),
               count(*) FILTER (WHERE {OFFPLAN}),
               count(*) FILTER (WHERE reg_type = 'Existing Properties'),
               count(*) FILTER (WHERE {RESI}),
               count(*) FILTER (WHERE ptype = 'Land'),
               count(*) FILTER (WHERE ptype = 'Building'),
               median(price_sqm) FILTER (WHERE {RESI}) / {SQFT},
               sum(worth) FILTER (WHERE {RESI}) / sum(size_sqm * {SQFT}) FILTER (WHERE {RESI})
        FROM sales WHERE day = ?""", D)
    deals, value, offplan, ready, resi, land, bldg, med, avg_psf = k

    w7, w30 = bdays(D - timedelta(days=7), D - timedelta(days=1)), bdays(D - timedelta(days=30), D - timedelta(days=1))
    this_wk = bdays(D - timedelta(days=6), D)
    ly_end = D - timedelta(days=364)
    last_yr_wk = bdays(ly_end - timedelta(days=6), ly_end)
    med7, _ = med_psf(D - timedelta(days=7), D - timedelta(days=1))
    med30, _ = med_psf(D - timedelta(days=30), D - timedelta(days=1))
    med_wk, _ = med_psf(D - timedelta(days=6), D)
    med_ly, n_ly = med_psf(ly_end - timedelta(days=6), ly_end)

    same_wd = [d for d in business if d.weekday() == D.weekday() and D - timedelta(days=28) <= d < D]
    compare = {
        "weekday": D.strftime("%A"),
        "deals": {"wd": _pct(deals, avg(same_wd, "deals")), "wd_avg": avg(same_wd, "deals"),
                  "d7": _pct(deals, avg(w7, "deals")), "d30": _pct(deals, avg(w30, "deals")),
                  "yoy": _pct(avg(this_wk, "deals"), avg(last_yr_wk, "deals")),
                  "avg7": avg(w7, "deals"), "avg30": avg(w30, "deals"),
                  "tw_avg": avg(this_wk, "deals"), "ly_avg": avg(last_yr_wk, "deals")},
        "value": {"wd": _pct(value, avg(same_wd, "value")),
                  "d7": _pct(value, avg(w7, "value")), "d30": _pct(value, avg(w30, "value")),
                  "yoy": _pct(avg(this_wk, "value"), avg(last_yr_wk, "value"))},
        "psf": {"d7": _pct(med, med7), "d30": _pct(med, med30),
                "yoy": _pct(med_wk, med_ly) if n_ly >= pcfg["min_sample"] else None},
        "offplan_share_7d": round(100 * sum(series[d]["offplan"] for d in w7) / max(1, sum(series[d]["deals"] for d in w7)), 1) if w7 else None,
    }

    names = friendly_names(con, D - timedelta(days=365))
    label = lambda a: names.get(a, a)  # noqa: E731
    wk_lo = D - timedelta(days=6)
    top_volume = [{"area": label(a), "dld_area": a, "deals": n, "value": v} for a, n, v in _q(con, f"""
        SELECT area, count(*) AS n, sum(worth) AS v FROM sales WHERE day BETWEEN ? AND ? AND area IS NOT NULL
        GROUP BY area ORDER BY n DESC LIMIT {pcfg['busiest_n']}""", wk_lo, D)]
    top_value = [{"area": label(a), "dld_area": a, "deals": n, "value": v} for a, n, v in _q(con, f"""
        SELECT area, count(*) AS n, sum(worth) AS v FROM sales WHERE day BETWEEN ? AND ? AND area IS NOT NULL
        GROUP BY area ORDER BY v DESC LIMIT {pcfg['busiest_n']}""", wk_lo, D)]

    largest = [{"worth": w, "area": label(a), "type": _type(pt, ps, rooms), "reg": _reg(rg),
                "project": (pr or b or "").strip().title() or None, "sqft": round(sz * SQFT) if sz else None}
               for w, a, pt, ps, rooms, rg, pr, b, sz in _q(con, f"""
        SELECT worth, area, ptype, psub, rooms, reg_type, project, building, size_sqm FROM sales
        WHERE day = ? AND {RESI} ORDER BY worth DESC LIMIT {pcfg['largest_n']}""", D)]
    big_land = _one(con, """SELECT worth, area, ptype FROM sales WHERE day = ? AND ptype IN ('Land', 'Building')
                            ORDER BY worth DESC LIMIT 1""", D)

    watch = [_watch_row(con, e, D, pcfg) for e in WATCHLIST.get("dubai", [])]
    rising = _rising(con, D, pcfg, label)

    # Trend: deals per business day (+7-business-day average) and weekly median AED/sqft.
    lo12 = D - timedelta(days=371)
    trend_days = [d for d in business if d >= lo12]
    roll = []
    for i, d in enumerate(trend_days):
        window = trend_days[max(0, i - 6): i + 1]
        roll.append(round(mean(series[x]["deals"] for x in window)))
    weekly_psf = [(w, round(m)) for w, m in _q(con, f"""
        SELECT date_trunc('week', day)::DATE AS w, median(price_sqm) / {SQFT} AS m FROM sales
        WHERE day BETWEEN ? AND ? AND {RESI} GROUP BY w HAVING count(*) >= 50 ORDER BY w""", lo12, D) if m]

    return {
        "as_of": D.isoformat(),
        "partial_day": {"day": partial["day"].isoformat(), "deals": partial["deals"]} if partial else None,
        "kpi": {"deals": deals, "value": value, "offplan": offplan, "ready": ready,
                "offplan_share": round(100 * offplan / deals, 1) if deals else None,
                "residential": resi, "land": land, "buildings": bldg,
                "median_psf": round(med) if med else None, "avg_psf": round(avg_psf) if avg_psf else None},
        "compare": compare,
        "top_volume": top_volume,
        "top_value": top_value,
        "largest": largest,
        "largest_land": {"worth": big_land[0], "area": label(big_land[1]), "type": big_land[2]} if big_land else None,
        "watch": watch,
        "rising": rising,
        "trend": {"days": [d.isoformat() for d in trend_days], "deals": [series[d]["deals"] for d in trend_days],
                  "value": [round(series[d]["value"]) for d in trend_days],
                  "avg": roll, "psf_weeks": [w.isoformat() for w, _ in weekly_psf], "psf": [m for _, m in weekly_psf]},
        "business_days_used": {"d7": len(w7), "d30": len(w30), "this_week": len(this_wk), "last_year_week": len(last_yr_wk)},
    }


def _type(ptype: str | None, psub: str | None, rooms: str | None) -> str:
    kind = "Villa" if ptype == "Villa" else (psub or ptype or "Unit")
    kind = "Apartment" if kind == "Flat" else kind
    r = (rooms or "").replace(" B/R", "BR")
    r = r.title() if r.isupper() and not any(ch.isdigit() for ch in r) else r
    return f"{r} {kind.lower()}".strip() if r and r not in ("Office", "Shop") else kind


def _reg(reg: str | None) -> str:
    return "off-plan" if reg == "Off-Plan Properties" else "ready"


def _watch_row(con: duckdb.DuckDBPyConnection, entry: dict[str, Any], D: date, pcfg: dict) -> dict[str, Any]:
    where = watch_filter(entry)
    r = _one(con, f"""
        SELECT count(*) FILTER (WHERE day BETWEEN ? AND ?),
               sum(worth) FILTER (WHERE day BETWEEN ? AND ?),
               count(*) FILTER (WHERE day BETWEEN ? AND ? AND {OFFPLAN}),
               median(price_sqm) FILTER (WHERE day BETWEEN ? AND ? AND {RESI}) / {SQFT},
               count(*) FILTER (WHERE day BETWEEN ? AND ? AND {RESI}),
               median(price_sqm) FILTER (WHERE day BETWEEN ? AND ? AND {RESI}) / {SQFT},
               count(*) FILTER (WHERE day BETWEEN ? AND ? AND {RESI}),
               median(price_sqm) FILTER (WHERE day BETWEEN ? AND ? AND {RESI}) / {SQFT},
               count(*) FILTER (WHERE day BETWEEN ? AND ? AND {RESI})
        FROM sales WHERE {where}""",
        *([D - timedelta(days=29), D] * 5),
        *([D - timedelta(days=59), D - timedelta(days=30)] * 2),
        *([D - timedelta(days=119), D - timedelta(days=90)] * 2))
    deals30, value30, off30, med_now, n_now, med_prev, n_prev, med_q, n_q = r
    enough = lambda n: (n or 0) >= pcfg["min_sample"]  # noqa: E731
    return {
        "name": entry["name"], "note": entry.get("note"),
        "deals30": deals30 or 0, "value30": value30,
        "offplan_share": round(100 * off30 / deals30) if deals30 else None,
        "median_psf": round(med_now) if med_now and enough(n_now) else None,
        "d30": _pct(med_now, med_prev) if enough(n_now) and enough(n_prev) else None,
        "d90": _pct(med_now, med_q) if enough(n_now) and enough(n_q) else None,
        "sample": {"now": n_now, "prev30": n_prev, "prev90": n_q},
    }


def _rising(con: duckdb.DuckDBPyConnection, D: date, pcfg: dict, label) -> list[dict[str, Any]]:
    rows = _q(con, f"""
        WITH w AS (
          SELECT area,
                 median(price_sqm) FILTER (WHERE day BETWEEN ? AND ?) AS m_now,
                 count(*) FILTER (WHERE day BETWEEN ? AND ?) AS n_now,
                 median(price_sqm) FILTER (WHERE day BETWEEN ? AND ?) AS m_then,
                 count(*) FILTER (WHERE day BETWEEN ? AND ?) AS n_then
          FROM sales WHERE {RESI} AND reg_type = 'Existing Properties' AND area IS NOT NULL GROUP BY area)
        SELECT area, (m_now / m_then - 1) * 100 AS chg, n_now, m_now / {SQFT}
        FROM w WHERE n_now >= ? AND n_then >= ?
        ORDER BY chg DESC LIMIT ?""",
        D - timedelta(days=29), D, D - timedelta(days=29), D,
        D - timedelta(days=119), D - timedelta(days=90), D - timedelta(days=119), D - timedelta(days=90),
        pcfg["rising_min_deals"], pcfg["min_sample"], pcfg["rising_n"])
    return [{"area": label(a), "dld_area": a, "d90": round(c, 1), "deals30": n, "median_psf": round(m)}
            for a, c, n, m in rows]
