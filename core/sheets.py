"""All Google Sheets I/O.

One spreadsheet, four kinds of tabs:
  * `config` — intern roster:  Slack User ID | Intern Name | Tab Name
  * `meta`   — today's thread:  Date | Channel ID | Thread TS
  * per-intern tabs:           Date | Current Task | Yesterday | Today's Goal |
                               Blockers | Submitted At | Source Msg TS

Auth: a Google service-account JSON string in GOOGLE_SERVICE_ACCOUNT_JSON.
"""
import json

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
    "Yesterday",
    "Today's Goal",
    "Blockers",
    "Submitted At",
    "Source Msg TS",
]

_spreadsheet = None


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
            }
        )
    return out


def get_meta(date: str) -> dict | None:
    """Return {channel_id, thread_ts} for `date`, or None."""
    ws = _get_spreadsheet().worksheet("meta")
    for r in ws.get_all_values()[1:]:
        if r and r[0] == date:
            return {"channel_id": r[1], "thread_ts": r[2]}
    return None


def set_meta(date: str, channel_id: str, thread_ts: str) -> None:
    """Append or update today's row in the `meta` tab."""
    ws = _get_spreadsheet().worksheet("meta")
    values = ws.get_all_values()
    for i, r in enumerate(values[1:], start=2):
        if r and r[0] == date:
            ws.update(values=[[date, channel_id, thread_ts]], range_name=f"A{i}:C{i}")
            return
    ws.append_row([date, channel_id, thread_ts], value_input_option="USER_ENTERED")


def get_entry_msg_ts(tab_name: str, date: str) -> str | None:
    """Source Msg TS already recorded for (tab, date), or None if no row."""
    ws = _get_spreadsheet().worksheet(tab_name)
    for r in ws.get_all_values()[1:]:
        if r and r[0] == date:
            return r[6] if len(r) > 6 else ""
    return None


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
        fields.get("yesterday", "Not provided"),
        fields.get("today_goal", "Not provided"),
        fields.get("blockers", "None"),
        submitted_at,
        msg_ts,
    ]
    values = ws.get_all_values()
    for i, r in enumerate(values[1:], start=2):
        if r and r[0] == date:
            existing_ts = r[6] if len(r) > 6 else ""
            if ts_newer(msg_ts, existing_ts):
                ws.update(values=[row], range_name=f"A{i}:G{i}")
                return True
            return False
    ws.append_row(row, value_input_option="USER_ENTERED")
    return True


def read_all() -> dict:
    """Build the full `data.json` structure. Derives `has_blocker` here."""
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
                    "yesterday": str(r.get("Yesterday", "")),
                    "today_goal": str(r.get("Today's Goal", "")),
                    "blockers": blockers,
                    "has_blocker": blockers not in ("None", "Not provided", ""),
                    "submitted_at": str(r.get("Submitted At", "")),
                }
            )
        entries.sort(key=lambda e: e["date"])
        interns.append({"name": c["name"], "entries": entries})
    return {"generated_at": config.now_iso(), "interns": interns}
