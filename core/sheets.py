"""All Google Sheets I/O.

One spreadsheet, five kinds of tabs:
  * `config` — intern roster:  Slack User ID | Intern Name | Tab Name |
                               Supervisor (optional — groups interns on the
                               dashboard; blank rows fall under "Unassigned")
  * `meta`   — today's thread:  Date | Channel ID | Thread TS
  * per-intern tabs:           Date | Current Task | Previous Workday |
                               Today's Goal | Blockers | Submitted At |
                               Source Msg TS
  * `weekly` — one row per (week, intern), filled by the weekly-report job:
                               Week Start | Week End | Tab Name | Intern Name |
                               Summary | Status | Generated At

Auth: a Google service-account JSON string in GOOGLE_SERVICE_ACCOUNT_JSON.
"""
import functools
import json
import random
import time

import gspread
from google.oauth2.service_account import Credentials

from core import config

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Per-intern tab header, in column order.
ENTRY_HEADER = [
    "Date",
    "Current Task",
    "Previous Workday",
    "Today's Goal",
    "Blockers",
    "Submitted At",
    "Source Msg TS",
]

# `weekly` tab header, in column order. One row per (Week Start, Tab Name).
WEEKLY_TAB = "weekly"
WEEKLY_HEADER = [
    "Week Start",
    "Week End",
    "Tab Name",
    "Intern Name",
    "Summary",
    "Status",
    "Generated At",
]

_spreadsheet = None

# Transient Google Sheets API failures worth retrying: server-side 5xx and the
# 429 rate-limit. Backoff (seconds) between attempts — anything else (e.g. a
# 403 unshared sheet or 404 wrong ID) is permanent and re-raises immediately so
# real misconfiguration surfaces fast instead of being buried behind retries.
_RETRY_BACKOFF = (2, 4, 8, 16)
_RETRY_STATUS = {429, 500, 502, 503, 504}


def _is_transient(err: gspread.exceptions.APIError) -> bool:
    response = getattr(err, "response", None)
    return getattr(response, "status_code", None) in _RETRY_STATUS


def _retry(fn):
    """Retry a Sheets operation on transient Google API errors (5xx / 429).

    Reads are naturally safe to retry. The read-then-write helpers re-check the
    sheet on each attempt, so a retry after a write that actually landed
    server-side (but whose response 500'd) updates the row in place rather than
    appending a duplicate."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        for delay in _RETRY_BACKOFF:
            try:
                return fn(*args, **kwargs)
            except gspread.exceptions.APIError as err:
                if not _is_transient(err):
                    raise
                sleep_for = delay + random.uniform(0, delay * 0.1)
                print(f"Transient Sheets API error ({err}); retrying in {sleep_for:.1f}s.")
                time.sleep(sleep_for)
        # Final attempt: let whatever it raises propagate.
        return fn(*args, **kwargs)

    return wrapper


def _as_text(value: str) -> str:
    """Force Sheets to store a value as literal text (with USER_ENTERED input).

    A leading apostrophe marks the cell as plain text; the apostrophe itself is
    not stored and is absent on read-back. This prevents Sheets from coercing a
    purely-numeric Slack ts (e.g. ``1749513600.123456``) into a float64, which
    would lose trailing precision on read and break thread/message lookups."""
    return f"'{value}"


def _get_spreadsheet():
    """Lazily authorize and open the spreadsheet (cached per process)."""
    global _spreadsheet
    if _spreadsheet is None:
        info = json.loads(config.GOOGLE_SERVICE_ACCOUNT_JSON)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
        client = gspread.authorize(creds)
        _spreadsheet = client.open_by_key(config.SPREADSHEET_ID)
    return _spreadsheet


def ts_newer(incoming: str, existing: str) -> bool:
    """True if `incoming` Slack ts is strictly newer than `existing`.

    An empty/absent existing ts counts as older (so the first write wins)."""
    if not existing:
        return True
    try:
        return float(incoming) > float(existing)
    except (TypeError, ValueError):
        return incoming != existing


@_retry
def get_config() -> list[dict]:
    """All rows from the `config` tab, normalized."""
    ws = _get_spreadsheet().worksheet("config")
    out = []
    for r in ws.get_all_records():
        slack_id = str(r.get("Slack User ID", "")).strip()
        if not slack_id:
            continue
        out.append(
            {
                "slack_user_id": slack_id,
                "name": str(r.get("Intern Name", "")).strip(),
                "tab_name": str(r.get("Tab Name", "")).strip(),
                "supervisor": str(r.get("Supervisor", "")).strip(),
            }
        )
    return out


@_retry
def get_meta(date: str) -> dict | None:
    """Return {channel_id, thread_ts} for `date`, or None."""
    ws = _get_spreadsheet().worksheet("meta")
    for r in ws.get_all_values()[1:]:
        if r and r[0] == date:
            return {"channel_id": r[1], "thread_ts": r[2]}
    return None


@_retry
def set_meta(date: str, channel_id: str, thread_ts: str) -> None:
    """Append or update today's row in the `meta` tab."""
    ws = _get_spreadsheet().worksheet("meta")
    row = [_as_text(date), _as_text(channel_id), _as_text(thread_ts)]
    values = ws.get_all_values()
    for i, r in enumerate(values[1:], start=2):
        if r and r[0] == date:
            ws.update(values=[row], range_name=f"A{i}:C{i}", value_input_option="USER_ENTERED")
            return
    ws.append_row(row, value_input_option="USER_ENTERED")


@_retry
def get_entry_msg_ts(tab_name: str, date: str) -> str | None:
    """Source Msg TS already recorded for (tab, date), or None if no row."""
    ws = _get_spreadsheet().worksheet(tab_name)
    for r in ws.get_all_values()[1:]:
        if r and r[0] == date:
            return r[6] if len(r) > 6 else ""
    return None


@_retry
def upsert_entry(
    tab_name: str, date: str, fields: dict, submitted_at: str, msg_ts: str
) -> bool:
    """One row per date in `tab_name`. Overwrite an existing row only when the
    incoming `msg_ts` is newer; otherwise leave it untouched. Returns True if a
    write occurred."""
    ws = _get_spreadsheet().worksheet(tab_name)
    row = [
        date,
        fields.get("current_task", "Not provided"),
        fields.get("previous_workday", "Not provided"),
        fields.get("today_goal", "Not provided"),
        fields.get("blockers", "None"),
        submitted_at,
        msg_ts,
    ]
    text_row = [_as_text(v) for v in row]
    values = ws.get_all_values()
    for i, r in enumerate(values[1:], start=2):
        if r and r[0] == date:
            existing_ts = r[6] if len(r) > 6 else ""
            if ts_newer(msg_ts, existing_ts):
                ws.update(values=[text_row], range_name=f"A{i}:G{i}", value_input_option="USER_ENTERED")
                return True
            return False
    ws.append_row(text_row, value_input_option="USER_ENTERED")
    return True


@_retry
def get_entry_field(tab_name: str, date: str, header: str) -> str:
    """Return the value of one column (`header`) for a given date in `tab_name`,
    or "" if there's no row for that date. Used by the weekly-report job to pull
    each `Previous Workday` cell across a span of dates."""
    ws = _get_spreadsheet().worksheet(tab_name)
    for r in ws.get_all_records():
        if str(r.get("Date", "")).strip() == date:
            return str(r.get(header, "")).strip()
    return ""


@_retry
def _ensure_weekly_tab():
    """Return the `weekly` worksheet, creating it (with headers) if absent so the
    job is self-provisioning rather than failing on a missing tab."""
    ss = _get_spreadsheet()
    try:
        return ss.worksheet(WEEKLY_TAB)
    except gspread.exceptions.WorksheetNotFound:
        ws = ss.add_worksheet(title=WEEKLY_TAB, rows=100, cols=len(WEEKLY_HEADER))
        ws.update(values=[WEEKLY_HEADER], range_name="A1", value_input_option="USER_ENTERED")
        return ws


@_retry
def upsert_weekly(
    week_start: str,
    week_end: str,
    tab_name: str,
    intern_name: str,
    summary: str,
    status: str,
    generated_at: str,
) -> None:
    """One row per (Week Start, Tab Name) in the `weekly` tab. Re-running the
    job for the same week overwrites the existing row rather than duplicating."""
    ws = _ensure_weekly_tab()
    row = [week_start, week_end, tab_name, intern_name, summary, status, generated_at]
    text_row = [_as_text(v) for v in row]
    values = ws.get_all_values()
    for i, r in enumerate(values[1:], start=2):
        if len(r) >= 3 and r[0] == week_start and r[2] == tab_name:
            ws.update(values=[text_row], range_name=f"A{i}:G{i}", value_input_option="USER_ENTERED")
            return
    ws.append_row(text_row, value_input_option="USER_ENTERED")


@_retry
def _read_weekly_by_tab() -> dict:
    """Group every `weekly` row by Tab Name → list of summary dicts. Returns an
    empty mapping if the tab doesn't exist yet (no weekly run has happened)."""
    ss = _get_spreadsheet()
    try:
        ws = ss.worksheet(WEEKLY_TAB)
    except gspread.exceptions.WorksheetNotFound:
        return {}
    out: dict[str, list] = {}
    for r in ws.get_all_records():
        tab = str(r.get("Tab Name", "")).strip()
        week_start = str(r.get("Week Start", "")).strip()
        if not tab or not week_start:
            continue
        out.setdefault(tab, []).append(
            {
                "week_start": week_start,
                "week_end": str(r.get("Week End", "")).strip(),
                "summary": str(r.get("Summary", "")),
                "status": str(r.get("Status", "")).strip() or "ok",
                "generated_at": str(r.get("Generated At", "")).strip(),
            }
        )
    return out


@_retry
def read_all() -> dict:
    """Build the full `data.json` structure. Derives `has_blocker` here."""
    weekly_by_tab = _read_weekly_by_tab()
    interns = []
    for c in get_config():
        ws = _get_spreadsheet().worksheet(c["tab_name"])
        entries = []
        for r in ws.get_all_records():
            date = str(r.get("Date", "")).strip()
            if not date:
                continue
            blockers = str(r.get("Blockers", "None")).strip()
            entries.append(
                {
                    "date": date,
                    "current_task": str(r.get("Current Task", "")),
                    "previous_workday": str(r.get("Previous Workday", "")),
                    "today_goal": str(r.get("Today's Goal", "")),
                    "blockers": blockers,
                    "has_blocker": blockers not in ("None", "Not provided", ""),
                    "submitted_at": str(r.get("Submitted At", "")),
                }
            )
        entries.sort(key=lambda e: e["date"])
        weekly = sorted(
            weekly_by_tab.get(c["tab_name"], []),
            key=lambda w: w["week_start"],
            reverse=True,  # newest week first
        )
        interns.append(
            {
                "name": c["name"],
                "supervisor": c.get("supervisor", ""),
                "entries": entries,
                "weekly": weekly,
            }
        )
    return {"generated_at": config.now_iso(), "interns": interns}
