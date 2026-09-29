# Sanjay's Morning Market Brief

A private phone app (home-screen web app) that rebuilds itself every morning at no cost, so the day's market numbers are ready by 9:30 AM Gulf time. Nothing runs on your laptop.

**Tabs:** Brief (5 bullets + 3 talking points + top news) · Market (DLD sales) · Rent (Ejari) · News (top 8 + 30-day archive) · More (Project pipeline, Developers, Landmarks).

**Live:** https://sanjay-market-brief.pages.dev (password). On iPhone: open in Safari → Share → Add to Home Screen.

## How it works

```
08:30 Gulf time   GitHub Actions (free) starts the run
                    │
                    ├─ downloads DLD sales from data.dubai (open data)
                    ├─ saves the day's rows to data/ in this repo (history builds up here)
                    ├─ calculates Market Pulse with DuckDB
                    ├─ builds one HTML page (site/index.html)
                    ├─ publishes it to Cloudflare Pages behind your password
                    └─ sends the summary to your Telegram
09:00 Gulf time   A second run starts. It only does the work if 08:30 failed or DLD's file wasn't fresh yet.
```

If any step fails, the rest still runs. The page keeps the last good numbers, marked **STALE** when they're really out of date. GitHub emails you if a run fails (Telegram alerts are optional: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets to switch them on).

**Known limit (29 Sep 2026):** data.dubai blocks GitHub's servers, so DLD numbers can't refresh from the cloud until the data.dubai **API key** arrives (requested, ticket 877830181; add it as `DATADUBAI_API_KEY` / `DATADUBAI_API_SECRET`). Until then, DLD data is refreshed by running the pipeline on a UAE connection (see "Run it locally").

## Free-tier limits and current usage

| Service | Free limit | This project uses | Headroom | If the limit is hit |
|---|---|---|---|---|
| GitHub Actions (private repo) | 2,000 min/month | ~5–8 min/day, about 150–250 min/month | ≥ 87% | Runs stop until the 1st of next month. You can't be charged: no card is on file, so the spending limit is $0. |
| GitHub repo storage | ~1 GB recommended | ~15 MB in year one (see Retention) | ≥ 95% | Push warnings. The fix is the yearly history squash below. |
| Cloudflare Pages | Unlimited static traffic; 500 deploys/month | 1–2 deploys a day | ≥ 88% | The new deploy fails and yesterday's page stays up. |
| Cloudflare Pages Functions (password gate) | 100,000 requests/day | Under 100/day | > 99% | The gate errors until midnight UTC. |
| Telegram Bot API (optional) | ~30 messages/second | 0 (not set up) | 100% | Messages retry. |
| data.dubai (DLD open data) | Free; limits not published | 1 bulk download a day (~1.2 GB), or a few API calls once keys arrive | n/a | Falls back to the other route, then to the last saved day. |
| Gemini / Groq (News and Brief modules) | Free tiers, no card | Capped at 10 calls/day in `config/settings.toml` | ≥ 50% | Rule-based fallback (keywords and templates). |

Every run logs its steps, timings and AI calls in `data/state/runs/`.

## One-time setup

Follow [SETUP-KIT.md](SETUP-KIT.md). It takes about 40 minutes and has seven steps: data.dubai, GitHub, Google AI Studio, Groq, Telegram, Cloudflare, and GitHub Secrets. Nothing needs a card.

## What the numbers mean

- **Source:** Dubai Land Department open data via data.dubai, under the Dubai Open Data Licence. Every card shows its "as of" date.
- **Sales** are DLD's "Sales" transaction group minus *Sell Development* and its delayed variants. On 29 Sep 2026 this matched DLD's published weekly totals within about 1% (7–11 Sep and 21–25 Sep). The list is `exclude_procedures` in `config/settings.toml`.
- **Data lag:** data.dubai's daily file runs a few days behind. The 29 Sep file ended on Fri 25 Sep, so the dashboard always names the DLD day it shows.
- **The latest day** is the newest DLD registration day with at least 100 sales. Weekends and holidays fall below that, so Monday's page shows Friday.
- **7-day and 30-day averages** use business days only.
- **Same week last year** compares the 7 days to the latest day with the same weekday-aligned 7 days 52 weeks earlier.
- **AED/sqft** covers residential units and villas only. The median is each deal's price per sqft; the average is total value divided by total area. DLD publishes per square metre, so values are divided by 10.7639.
- **Watchlist %:** "30d" compares the median of the last 30 days with the previous 30 days. "90d" compares it with the same 30-day window three months earlier. Windows with fewer than 20 home sales show n/a instead of a noisy number.
- **Sharjah** publishes monthly totals only (SRERD press releases), so Sharjah rows never show daily or per-project prices.

## Edit the watchlist

Open `config/watchlist.toml`, copy a `[[dubai]]` block, then change the name and match rules. DLD uses official community names; for example, JVC is "Al Barsha South Fourth" and Dubai Hills Estate is "Hadaeq Sheikh Mohammed Bin Rashid". The file lists the ones in use. Commit the change, and the next run uses it. The "Busiest" and "Rising fastest" lists are automatic.

## Add or replace a data source

- **DLD:** `pipeline/dld.py`. The API route is used automatically once `DATADUBAI_API_KEY` and `DATADUBAI_API_SECRET` exist as GitHub Secrets. Otherwise the run uses the bulk export. Dataset ids are in `config/settings.toml`.
- **A new module:** add a `pipeline/<module>.py` that returns a dict, run it inside `log.step(...)` in `pipeline/run.py`, save it with `save_last_good`, and add a card to `templates/index.html.j2`.
- **Never** scrape sites whose terms forbid it. Bayut and Property Finder are excluded for that reason.

## Free AI (optional) and switching providers

Without a key, everything works with rules and templates. With a free key the news summaries, the Brief and the pipeline details read better:
1. Google AI Studio → Get API key (free, no card) → add it as the GitHub secret `GEMINI_API_KEY`.
2. Optional backup: Groq console → API key → `GROQ_API_KEY`.

Providers are tried in the order listed under `[llm]` in `config/settings.toml`; the run never makes more than `daily_call_cap` calls (10) a day. If a free tier changes, reorder the list or change the model name. The Brief rejects any AI text that contains a number not found in the page's own data.

## Rent and Developers data (one-time loads)

Both need DLD files that data.dubai only serves to UAE connections (and, later, through the API key):
```bash
.venv/bin/python -m pipeline.rent --bootstrap        # Ejari rent contracts, ~5 GB download, keeps 25 months of new contracts
.venv/bin/python -m pipeline.developers --refresh    # DLD projects list, ~3 MB
```
Commit the new files in `data/` afterwards; the cloud keeps them updated once the API key exists.

## Edit the news rules, landmarks and developer lists

- `config/news_rules.toml`: which words make a story relevant, its category and impact.
- `config/landmarks.toml`: one block per landmark; keep a source link for every fact.
- `config/developers.toml`: the Sharjah top 5.
- `config/catalysts.toml`: verified infrastructure used for "Analysis, not a forecast" notes.

## Storage and retention

- `data/dld/sales/YYYY/MM/YYYY-MM-DD.parquet`: one small file per day for the current and previous month.
- `data/dld/sales/YYYY/YYYY-MM.parquet`: closed months, merged automatically.
- After 25 months, raw rows become monthly aggregates in `data/dld/agg/sales_monthly.parquet`.
- Files are only rewritten when their rows change, so the repo grows by about the size of each new day.
- **Once a year (optional):** squash git history to keep `.git` small. Ask Claude to do it; it's one command, run after a backup.

## Common failures and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Telegram: "Dashboard run failed" | GitHub runner or network error | Open the log link. Re-run from Actions → Daily dashboard → Run workflow. |
| Page says STALE, DLD download failed | data.dubai was down or changed its export | It retries at 09:00 and the next morning. If it persists 2+ days, the portal likely changed; update `listing_url` in settings. |
| "no DLD sales history yet" | The first run failed before anything was saved | Run the workflow manually once. |
| Login page says the password isn't set | `DASHBOARD_PASSWORD` secret missing | Add it in GitHub Secrets, then re-run the workflow. |
| Numbers look odd for one area | Small sample or a mislabelled DLD community | Check the match rules in `config/watchlist.toml`. |

## Run it locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.run --no-notify
python3 -m http.server 8787 --directory site
```

## Mac refresh (temporary, until the data.dubai API key arrives)

data.dubai blocks GitHub's servers, so a scheduled job on the Mac downloads DLD's
daily export (about 1.15 GB) at 07:00 (retries 07:45 and 08:15; runs on wake if
the Mac was asleep), saves the updated history and pushes it. The push starts the
cloud build. The raw export is deleted afterwards. The job works in its own copy
of the repo in `~/Library/Application Support/MorningBrief`.

    python -m pipeline.mac_refresh --install      # set up (already done)
    python -m pipeline.mac_refresh --uninstall    # remove once the API key works

Log: `~/Library/Logs/MorningBrief/refresh.log`. If the Mac is off for 5+ days the
Market tab shows STALE until it runs again.
