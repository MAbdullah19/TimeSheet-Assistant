#TimeSheet Assistant

A $0/month, fully serverless standup bot. Every weekday morning it posts four
standup questions to Slack; interns reply in the thread. An hourly GitHub
Actions job reads the replies, uses Gemini to extract structured fields, writes
them to Google Sheets, reacts ✅, and publishes a static dashboard to GitHub
Pages.

## How it works

```
post_questions.py   → Slack thread + meta row        (morning, cron)
poll_and_record.py  → replies → Gemini → Sheets + ✅  (hourly, cron)
build_dashboard_data.py → Sheets → docs/data.json    (hourly, cron)
docs/ (HTML/CSS/JS) → GitHub Pages dashboard
```

## Layout

- `core/` — `config` (env), `sheets` (all Sheets I/O), `extract` (Gemini),
  `slack` (post / replies / react).
- `scripts/` — the three entry points run by the workflows.
- `docs/` — static dashboard + generated `data.json` (a sample is committed).
- `.github/workflows/` — `post-standup.yml` (morning) and `poll-standup.yml`
  (hourly poll → rebuild → deploy Pages).

## Local development

```bash
pip install -r requirements.txt
cp .env.example .env        # fill in your values
python scripts/post_questions.py
python scripts/poll_and_record.py
python scripts/build_dashboard_data.py
```

`.env` is loaded automatically if `python-dotenv` is installed; otherwise rely
on the process environment (the GitHub Actions path).

Preview the dashboard against the committed sample:

```bash
python -m http.server -d docs 8000   # open http://localhost:8000
```

## One-time setup

See **One-time setup checklist** in `intern-standup-bot-plan.md` for Slack
scopes, the Google service account + spreadsheet tabs, the Gemini key, and the
GitHub secrets / Pages configuration. All `.env` keys become repo secrets.
# TimeSheet-Assistant
