# Intern Daily Standup Bot — Build Plan

A Slack bot that posts 4 standup questions every weekday morning. Interns reply in the
thread. A GitHub Actions workflow (hourly) reads replies, uses Gemini to extract structured
fields, writes to Google Sheets, reacts ✅, and publishes a static dashboard to GitHub Pages.
**Fully serverless. $0/month.**

---

## Stack

| Concern | Tool |
|---|---|
| Slack bot | Slack Web API — `slack_sdk` |
| AI extraction | Google Gemini API — `gemini-2.5-flash-lite` (free tier, no card) |
| Storage | Google Sheets API — `gspread` |
| Scheduling | GitHub Actions (cron) |
| Dashboard | Static HTML/CSS/JS on GitHub Pages (public, no login) |
| Language | Python 3.11+ |

---

## Project structure

```
intern-standup-bot/              # public repo (free Pages + unlimited Actions)
├── core/
│   ├── config.py                # loads env vars, exposes INTERN_MAP
│   ├── sheets.py                # all Sheets I/O
│   ├── extract.py               # Gemini extraction
│   └── slack.py                 # post, get_replies, react
├── scripts/
│   ├── post_questions.py        # morning: post standup, write meta
│   ├── poll_and_record.py       # hourly: read replies, extract, upsert, react
│   └── build_dashboard_data.py  # read_all() → docs/data.json
├── docs/                        # GitHub Pages root
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── data.json                # generated hourly; commit a sample for dev
├── .github/workflows/
│   ├── post-standup.yml
│   └── poll-standup.yml         # poll → rebuild data.json → deploy Pages
├── requirements.txt             # slack_sdk gspread google-auth google-genai
└── .env.example
```

---

## Google Sheet schema

One spreadsheet, four tabs.

**`config`** — intern roster (edit here, never hardcode):
| Slack User ID | Intern Name | Tab Name |

**`meta`** — today's standup thread (poster writes, poller reads):
| Date | Channel ID | Thread TS |

**Per-intern tabs** (one each, e.g. `Intern A`):
| Date | Current Task | Yesterday | Today's Goal | Blockers | Submitted At | Source Msg TS |

Upsert rule: one row per tab per date. If a row for today exists and the incoming `msg_ts`
is newer, overwrite it. `Source Msg TS` is the idempotency key.

---

## `data.json` schema (dashboard contract)

```json
{
  "generated_at": "2026-06-09T10:00:00+05:00",
  "interns": [
    {
      "name": "Intern A",
      "entries": [
        {
          "date": "2026-06-09",
          "current_task": "...",
          "yesterday": "...",
          "today_goal": "...",
          "blockers": "None",
          "has_blocker": false,
          "submitted_at": "2026-06-09T09:45:00+05:00"
        }
      ]
    }
  ]
}
```

`has_blocker` is derived in `read_all()`: `blockers not in {"None", "Not provided", ""}`.
It is not a stored column.

---

## Gemini extraction (`core/extract.py`)

**Function:** `extract_fields(reply_text: str) -> dict`

**System instruction:**
```
You are a data-extraction assistant for a daily standup tool. Extract exactly four fields
from the intern's message and return ONLY a valid JSON object — no prose, no markdown fences:

{
  "current_task": "what they are currently working on",
  "yesterday":    "what they did yesterday",
  "today_goal":   "their goal or plan for today",
  "blockers":     "any blockers or challenges; use \"None\" if none are mentioned"
}

Use the intern's own words, lightly cleaned. Unmentioned fields → "Not provided"
(blockers → "None"). One to three sentences per field. Output must be parseable by
json.loads with exactly these four keys and no others.
```

**Implementation:**
- SDK: `from google import genai`. Set `response_mime_type="application/json"` in config.
- On parse failure: strip ```json fences, retry `json.loads`. If still failing, store raw
  text in `current_task` and `"Parse error"` in the rest. Never raise.
- On `429`: retry with backoff 1s → 2s → 4s.

---

## Environment variables (`.env.example`)

```
SLACK_BOT_TOKEN=xoxb-...
STANDUP_CHANNEL_ID=C01XXXXXXXX

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

GOOGLE_SERVICE_ACCOUNT_JSON=    # full service-account JSON as a string
SPREADSHEET_ID=

TEAM_TIMEZONE=Asia/Karachi
```

All of these become GitHub repo secrets for the workflows.

---

## Build phases

### Phase 0 — Scaffold
Create the full directory structure, `requirements.txt`, `.env.example`, `.gitignore`
(exclude `.env`, service-account JSON, `__pycache__`). Commit a sample `docs/data.json`
matching the schema above.

**Done:** `python -c "import slack_sdk, gspread; from google import genai"` runs clean.

---

### Phase 1 — Sheets module (`core/sheets.py`)

Implement these five functions against the schema above:

- `get_config() -> list[dict]` — returns all rows from `config` tab
- `get_meta(date: str) -> dict | None` — returns `{channel_id, thread_ts}` or None
- `set_meta(date, channel_id, thread_ts)` — appends or updates today's row
- `upsert_entry(tab_name, date, fields, submitted_at, msg_ts)` — one row per date;
  update if newer `msg_ts`, else append
- `read_all() -> dict` — returns the full `data.json` interns structure; derives
  `has_blocker` here

Auth: service account JSON from `GOOGLE_SERVICE_ACCOUNT_JSON` env var.

**Done:** write a sample row, call again with same `msg_ts` → no duplicate. `read_all()`
returns the correct shape.

---

### Phase 2 — Extraction module (`core/extract.py`)

Implement `extract_fields()` per the spec above.

**Done:** three test inputs (tidy reply, messy reply, reply with no blockers) all return
valid four-key dicts. Parse error path returns a dict without raising.

---

### Phase 3 — Morning poster (`scripts/post_questions.py`)

1. Read intern list from `get_config()`.
2. Post to `STANDUP_CHANNEL_ID`:
   ```
   :clipboard: *Daily Standup*
   @intern1 @intern2 @intern3 — please reply in this thread:
   1. What is your current task?
   2. What did you do yesterday?
   3. What is the goal today?
   4. Any blockers or challenges?
   ```
3. Call `set_meta(today, channel_id, thread_ts)`. Skip if meta for today already exists.

**Done:** message appears in Slack with `@` mentions. `meta` tab has today's row.

---

### Phase 4 — Poller (`scripts/poll_and_record.py`)

1. `get_meta(today)` — skip if None (no thread yet).
2. Fetch thread replies via `slack.get_replies(channel_id, thread_ts)`.
3. For each reply whose `user` is in `get_config()`:
   - Skip if `Source Msg TS` already recorded and not newer.
   - `extract_fields(reply.text)` → `upsert_entry(tab, date, fields, submitted_at, msg_ts)`.
   - `slack.react(channel_id, msg_ts, "white_check_mark")` — ignore `already_reacted`.

**Done:** reply → correct row in correct tab + ✅. Re-run → no change.

---

### Phase 5 — Dashboard (`docs/`)

**`scripts/build_dashboard_data.py`:** calls `read_all()`, writes result to `docs/data.json`.

**`docs/app.js`:** fetches `./data.json` on load. Renders:
- A date selector defaulting to today.
- Three equal columns, one per intern (stack on mobile).
- Each column: intern name + four labeled field blocks (Current Task / Yesterday / Today's
  Goal / Blockers).
- **Blocker badge** (amber/red background) when `has_blocker: true`. Muted when false.
- Empty state: "No update yet today."
- Per-intern history table showing all past entries.

No build step, no framework, no login.

**Done:** page renders against sample `docs/data.json`. Blockers are visually distinct.
Date selector re-renders. Empty state shows for missing interns.

---

### Phase 6 — Scheduling & deploy

**`.github/workflows/post-standup.yml`**
```yaml
on:
  schedule:
    - cron: "0 4 * * 1-5"   # 09:00 PKT (UTC+5), Mon–Fri
  workflow_dispatch: {}
jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r requirements.txt
      - run: python scripts/post_questions.py
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          STANDUP_CHANNEL_ID: ${{ secrets.STANDUP_CHANNEL_ID }}
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          SPREADSHEET_ID: ${{ secrets.SPREADSHEET_ID }}
          TEAM_TIMEZONE: ${{ secrets.TEAM_TIMEZONE }}
```

**`.github/workflows/poll-standup.yml`**
```yaml
on:
  schedule:
    - cron: "0 4-14 * * 1-5"  # top of each hour, 09:00–19:00 PKT, Mon–Fri
  workflow_dispatch: {}
jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r requirements.txt
      - run: python scripts/poll_and_record.py
      - run: python scripts/build_dashboard_data.py
        env:  # pass all secrets to both scripts
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          STANDUP_CHANNEL_ID: ${{ secrets.STANDUP_CHANNEL_ID }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GEMINI_MODEL: ${{ secrets.GEMINI_MODEL }}
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          SPREADSHEET_ID: ${{ secrets.SPREADSHEET_ID }}
          TEAM_TIMEZONE: ${{ secrets.TEAM_TIMEZONE }}
  deploy:
    needs: poll
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
    steps:
      - uses: actions/upload-pages-artifact@v3
        with: { path: docs/ }
      - uses: actions/deploy-pages@v4
```

**Done:** full loop runs unattended. Reply recorded within ~1 hour. Dashboard at
`https://<username>.github.io/<repo>/` shows live data.

---

## One-time setup checklist

**Slack** (`api.slack.com/apps` → Create from scratch):
- Bot Token Scopes: `chat:write`, `channels:history`, `channels:read`, `reactions:write`, `users:read`
- Install to workspace → save Bot Token (`xoxb-...`)
- Invite bot to `#standup`

**Google**:
- New project → enable Google Sheets API + Google Drive API
- Create Service Account → download JSON key
- Create spreadsheet, add tabs (`config`, `meta`, `Intern A`, `Intern B`, `Intern C`), add header rows
- Share spreadsheet with the service account email as **Editor**

**Gemini**:
- Free API key at `aistudio.google.com/apikey`

**GitHub**:
- Make repo **public**
- Add all env vars as repo secrets (Settings → Secrets → Actions)
- Enable Pages: Settings → Pages → Source → **GitHub Actions**
