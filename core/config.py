"""Environment configuration and small time/zone helpers.

All runtime configuration comes from environment variables. For local
development you may keep them in a `.env` file (see `.env.example`); if
`python-dotenv` is installed it will be loaded automatically, otherwise the
process environment is used as-is (the GitHub Actions path).
"""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

# Optional: load a local .env for development. No hard dependency.
try:  # pragma: no cover - convenience only
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
STANDUP_CHANNEL_ID = os.environ.get("STANDUP_CHANNEL_ID", "")
ATTENDANCE_CHANNEL_ID = os.environ.get("ATTENDANCE_CHANNEL_ID", "")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_API_KEY_WEEKLY = os.environ.get("GEMINI_API_KEY_WEEKLY", "") or GEMINI_API_KEY
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")

GOOGLE_SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "")

TEAM_TIMEZONE = os.environ.get("TEAM_TIMEZONE", "Asia/Karachi")


def get_tz() -> ZoneInfo:
    """Team timezone as a tzinfo object."""
    return ZoneInfo(TEAM_TIMEZONE)


def today_str() -> str:
    """Today's date (team timezone) as YYYY-MM-DD."""
    return datetime.now(get_tz()).strftime("%Y-%m-%d")


def now_iso() -> str:
    """Current timestamp (team timezone) as ISO-8601."""
    return datetime.now(get_tz()).isoformat()


def ts_to_iso(slack_ts: str) -> str:
    """Convert a Slack message ts (epoch seconds string) to an ISO-8601
    timestamp in the team timezone."""
    return datetime.fromtimestamp(float(slack_ts), get_tz()).isoformat()


def intern_map() -> dict:
    """Map of Slack User ID -> {name, tab_name}, sourced from the Sheet's
    `config` tab. Imported lazily to avoid a circular import with `sheets`."""
    from core import sheets

    return {c["slack_user_id"]: c for c in sheets.get_config()}
