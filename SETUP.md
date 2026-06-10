# Setup Guide — Intern Daily Standup Bot

This walks you from an empty project to a live, self-running bot. Everything the
code needs already exists; what remains is creating a few free accounts,
collecting credentials, testing locally, and pushing to GitHub.

**Time:** ~45–60 minutes the first time.
**Cost:** $0/month (Slack free, Google free tier, Gemini free tier, public GitHub repo).

You will collect **seven** values along the way. Keep them somewhere handy —
they go into a local `.env` first, then into GitHub repo secrets:

| Value | Example | Collected in |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-1234-5678-abcd…` | Step 1 |
| `STANDUP_CHANNEL_ID` | `C01XXXXXXXX` | Step 1 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",…}` | Step 2 |
| `SPREADSHEET_ID` | `1AbC…xyz` | Step 3 |
| `GEMINI_API_KEY` | `AIza…` | Step 4 |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | (fixed default) |
| `TEAM_TIMEZONE` | `Asia/Karachi` | (fixed default) |

---

## Step 1 — Slack app

### 1.1 Create the app
1. Go to **https://api.slack.com/apps** and click **Create New App → From scratch**.
2. Give it a name (e.g. `Standup Bot`) and select your workspace. Click **Create App**.

### 1.2 Add bot permission scopes
1. In the left sidebar, open **OAuth & Permissions**.
2. Scroll to **Scopes → Bot Token Scopes** and click **Add an OAuth Scope** for each of:

   | Scope | Why it's needed |
   |---|---|
   | `chat:write` | Post the standup message |
   | `channels:history` | Read replies in the thread |
   | `channels:read` | Resolve channel info |
   | `reactions:write` | Add the ✅ reaction |
   | `users:read` | Look up intern users |

   > If `#standup` is a **private** channel, also add `groups:history` and
   > `groups:read` (the `channels:*` scopes only cover public channels).

### 1.3 Install and copy the token
1. Scroll up on the same page and click **Install to Workspace**, then **Allow**.
2. Copy the **Bot User OAuth Token** — it starts with `xoxb-`.
   → This is **`SLACK_BOT_TOKEN`**.

### 1.4 Invite the bot to the channel
1. In Slack, open (or create) the channel where standups should be posted, e.g. `#standup`.
2. Type and send: `/invite @Standup Bot` (use your app's name).
   The bot must be a member or it cannot post or read replies.

### 1.5 Get the channel ID
1. Click the channel name at the top → a popup opens.
2. Scroll to the very bottom of the popup; you'll see **Channel ID** like `C01XXXXXXXX`.
   → This is **`STANDUP_CHANNEL_ID`**.

---

## Step 2 — Google service account

This is the identity the bot uses to read/write your spreadsheet.

### 2.1 Create a Google Cloud project
1. Go to **https://console.cloud.google.com**.
2. Top bar → project dropdown → **New Project**. Name it (e.g. `standup-bot`) → **Create**.
3. Make sure the new project is selected in the top bar.

### 2.2 Enable the two APIs
1. Go to **APIs & Services → Library**.
2. Search **Google Sheets API** → open it → **Enable**.
3. Go back to Library, search **Google Drive API** → open it → **Enable**.
   (gspread needs Drive to open the sheet by key.)

### 2.3 Create the service account + key
1. Go to **APIs & Services → Credentials**.
2. **Create Credentials → Service account**. Give it a name → **Create and Continue** →
   skip the optional role/grant steps → **Done**.
3. In the credentials list, click the new service account.
4. Open the **Keys** tab → **Add Key → Create new key → JSON → Create**.
   A `.json` file downloads. **This whole file is a secret — never commit it.**

### 2.4 Note two things from the JSON
Open the downloaded file in a text editor:
- The **entire file contents** → this becomes **`GOOGLE_SERVICE_ACCOUNT_JSON`**.
- The `"client_email"` value (looks like
  `standup-bot@your-project.iam.gserviceaccount.com`) → you'll share the sheet
  with this address in the next step.

---

## Step 3 — Google Sheet

### 3.1 Create the spreadsheet and get its ID
1. Go to **https://sheets.google.com** → blank spreadsheet. Name it anything.
2. Look at the URL:
   `https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`
   The bold part is **`SPREADSHEET_ID`**.

### 3.2 Create the tabs
Use the **+** at the bottom to add tabs. Rename each by double-clicking its name.
You need these exact tab names:

- `config`
- `meta`
- One tab per intern — the names are **your choice**, but they must match the
  `Tab Name` column in `config` exactly. The examples below use `Intern A`,
  `Intern B`, `Intern C`.

### 3.3 Add the header rows
Type these into **row 1** of each tab, one header per cell (A1, B1, C1, …).
The text must match exactly (the code reads columns by header name).

**`config` tab** (row 1):

| A | B | C |
|---|---|---|
| `Slack User ID` | `Intern Name` | `Tab Name` |

**`meta` tab** (row 1):

| A | B | C |
|---|---|---|
| `Date` | `Channel ID` | `Thread TS` |

**Each per-intern tab** (`Intern A`, `Intern B`, …) (row 1):

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| `Date` | `Current Task` | `Yesterday` | `Today's Goal` | `Blockers` | `Submitted At` | `Source Msg TS` |

> Leave rows 2+ of `meta` and the intern tabs empty — the bot fills them in.

### 3.4 Fill in the roster (`config` tab)
Add one row per intern under the headers. Example:

| Slack User ID | Intern Name | Tab Name |
|---|---|---|
| `U01ABCDEF` | Alice | Intern A |
| `U02GHIJKL` | Bob | Intern B |
| `U03MNOPQR` | Carol | Intern C |

**How to get each Slack User ID:** in Slack, click the person's name/avatar →
**View full profile** → **⋮ (More) → Copy member ID**. It starts with `U`.

> `Tab Name` must be spelled identically to the actual tab. `Intern A` ≠ `intern a`.

### 3.5 Share the sheet with the service account
1. Click **Share** (top-right of the spreadsheet).
2. Paste the service account's `client_email` from Step 2.4.
3. Set its role to **Editor**. Untick "Notify people". Click **Share**.

Without this, the bot gets a `403 PermissionDenied` — it's the most common setup mistake.

---

## Step 4 — Gemini API key

1. Go to **https://aistudio.google.com/apikey**.
2. Click **Create API key** (you can reuse the Cloud project from Step 2 or let it
   create one). Copy the key (`AIza…`).
   → This is **`GEMINI_API_KEY`**.

The default model `gemini-2.5-flash-lite` is on the free tier and needs no billing card.

---

## Step 5 — Test locally

Testing locally first means you find mistakes in seconds instead of waiting on a
cron schedule. All commands run from the project root in PowerShell.

### 5.1 Create your `.env`
```powershell
Copy-Item .env.example .env
```
Open `.env` and fill in every value. Notes:
- **`GOOGLE_SERVICE_ACCOUNT_JSON`** must be the JSON **on a single line**, wrapped
  in single quotes. Minify it (remove newlines) and paste like:
  ```
  GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...", ... }'
  ```
- Leave `GEMINI_MODEL=gemini-2.5-flash-lite` and `TEAM_TIMEZONE=Asia/Karachi`
  unless you have a reason to change them.

### 5.2 Install dependencies
```powershell
pip install -r requirements.txt
pip install python-dotenv   # local-only: lets the scripts read your .env
```
(`python-dotenv` is intentionally not in `requirements.txt` because GitHub
Actions supplies the variables directly — it's only for local runs.)

### 5.3 Run the morning poster
```powershell
python scripts/post_questions.py
```
**Expect:** a "Daily Standup" message with `@mentions` appears in `#standup`, and
the `meta` tab gets a new row with today's date, channel ID, and thread TS.
Re-running prints "meta already exists" and does nothing (idempotent).

### 5.4 Reply in Slack, then run the poller
1. In the Slack thread, post a reply **as one of the configured interns** (or ask
   them to). Example: *"Working on the login page. Yesterday I set up the repo.
   Today I'll finish the form. No blockers."*
2. Run:
   ```powershell
   python scripts/poll_and_record.py
   ```
**Expect:** the reply is parsed by Gemini into four fields, written to that
intern's tab, and a ✅ reaction appears on their message. Re-running makes no
changes unless they edit/repost.

### 5.5 Build and preview the dashboard
```powershell
python scripts/build_dashboard_data.py
python -m http.server -d docs 8000
```
Open **http://localhost:8000**. You should see today's board with the intern's
entry, the date selector, and a blocker badge if they reported one.

> If any step errors, fix it now — the same credentials run in GitHub Actions, so
> a local success means the cloud run will succeed too.

---

## Step 6 — Push to a public GitHub repo

The repo must be **public** for free GitHub Pages and unlimited Actions minutes.

### 6.1 Confirm secrets won't be committed
`.gitignore` already excludes `.env` and service-account JSON files. Verify:
```powershell
git init
git add .
git status   # confirm .env and any *.json key are NOT listed
```
If you see `.env` or your key file in the list, **stop** and check `.gitignore`
before committing.

### 6.2 Commit and create the repo
```powershell
git commit -m "Intern standup bot"
gh repo create intern-standup-bot --public --source=. --push
```
(If you don't have the GitHub CLI, create an empty public repo on github.com,
then `git remote add origin <url>` and `git push -u origin main`.)

---

## Step 7 — Add repo secrets

In your repo on github.com:
1. **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** and add each of these (name on the left, value
   from your `.env` on the right):

   - `SLACK_BOT_TOKEN`
   - `STANDUP_CHANNEL_ID`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` → `gemini-2.5-flash-lite`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → paste the full JSON (the GitHub UI accepts
     multi-line, so you can paste it as-is here)
   - `SPREADSHEET_ID`
   - `TEAM_TIMEZONE` → `Asia/Karachi`

---

## Step 8 — Enable Pages and trigger the workflows

### 8.1 Enable Pages
1. **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.

### 8.2 Run the workflows once by hand
Both workflows have a manual trigger (`workflow_dispatch`).
1. **Actions** tab → **Post Standup** → **Run workflow**. Confirm the message
   posts in Slack.
2. Reply in the Slack thread as an intern.
3. **Actions** tab → **Poll Standup & Deploy** → **Run workflow**. This records
   replies, rebuilds `data.json`, and deploys Pages.

### 8.3 Visit the dashboard
Your dashboard is live at:
```
https://<your-username>.github.io/intern-standup-bot/
```
(The first Pages deployment can take a minute or two to appear.)

---

## Step 9 — It's now self-running

The cron schedules take over automatically:
- **Post Standup** — 09:00 PKT, Mon–Fri (`cron: "0 4 * * 1-5"`, UTC).
- **Poll Standup & Deploy** — every hour 09:00–19:00 PKT, Mon–Fri.

To change times, edit the `cron` lines in `.github/workflows/*.yml` (times are in
**UTC**; PKT is UTC+5).

---

## Sharing with the supervisor

The supervisor is a **view-only** user — they don't need a Google, Slack, or
GitHub account, and they're **not** added to the `config` tab (that's interns
only). The whole project stays under your accounts; nothing is transferred.

All they need is the public dashboard link from Step 8.3:
```
https://<your-username>.github.io/intern-standup-bot/
```
Send them that URL. It opens in any browser with no login and always shows the
latest standups (the dashboard refreshes after each hourly poll). They can use
the date selector to look back at previous days and the history tables to see
each intern's full record.

**Optional:** if you'd also like the supervisor to read replies in Slack as they
come in, invite them to the `#standup` channel. This is not required — the
dashboard already mirrors everything.

> **Privacy note:** because the repo is public and GitHub Pages serves the
> dashboard without authentication, anyone who has (or finds) the link can read
> the standups. This is inherent to the free, serverless design. It's normally
> fine for intern standups, but don't put anything confidential in the replies.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `403` / `PermissionDenied` from Sheets | Sheet not shared with the service account | Share it as **Editor** with the `client_email` (Step 3.5) |
| `APIError: ... has not been used / disabled` | Sheets or Drive API not enabled | Enable both APIs (Step 2.2) |
| Bot can't post: `not_in_channel` | Bot not invited | `/invite @YourBot` in the channel (Step 1.4) |
| Bot can't read replies: `missing_scope` | Scope not added/installed | Add scope, then **reinstall** the app (Step 1.2–1.3) |
| Replies ignored | Slack User ID in `config` doesn't match the replier | Re-copy the member ID (Step 3.4) |
| Entry lands in the wrong/blank tab | `Tab Name` typo in `config` | Make it match the tab name exactly |
| Fields all say "Parse error" | Bad/missing `GEMINI_API_KEY` | Re-check the key (Step 4) |
| Local script can't see `.env` | `python-dotenv` not installed | `pip install python-dotenv` (Step 5.2) |
| Dashboard shows old data | Pages deployed stale `data.json` | Re-run **Poll Standup & Deploy** |

---

## Quick reference — where each secret comes from

| Secret | Source |
|---|---|
| `SLACK_BOT_TOKEN` | Slack → OAuth & Permissions (`xoxb-…`) |
| `STANDUP_CHANNEL_ID` | Slack channel details popup (`C…`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Downloaded service-account `.json` |
| `SPREADSHEET_ID` | Spreadsheet URL (`/d/<id>/edit`) |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |
| `GEMINI_MODEL` | Fixed: `gemini-2.5-flash-lite` |
| `TEAM_TIMEZONE` | Fixed: `Asia/Karachi` |
