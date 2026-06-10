"""Hourly job: read thread replies, extract fields, upsert rows, react ✅.

Idempotent — only the newest message per intern is processed, and an entry is
re-written only when the incoming message ts is newer than what's stored.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config, extract, sheets, slack  # noqa: E402


def _latest_per_user(replies: list[dict], known: dict) -> dict:
    """Keep only the newest reply from each known intern."""
    latest: dict[str, dict] = {}
    for msg in replies:
        user = msg.get("user")
        ts = msg.get("ts")
        if user not in known or not ts:
            continue
        prev = latest.get(user)
        if prev is None or sheets.ts_newer(ts, prev.get("ts", "")):
            latest[user] = msg
    return latest


def main() -> None:
    date = config.today_str()

    meta = sheets.get_meta(date)
    if not meta:
        print(f"No standup thread for {date} — nothing to poll.")
        return

    known = {c["slack_user_id"]: c for c in sheets.get_config()}
    replies = slack.get_replies(meta["channel_id"], meta["thread_ts"])
    latest = _latest_per_user(replies, known)

    for user, msg in latest.items():
        tab = known[user]["tab_name"]
        msg_ts = msg["ts"]

        existing_ts = sheets.get_entry_msg_ts(tab, date)
        if existing_ts and not sheets.ts_newer(msg_ts, existing_ts):
            # Already recorded and not newer — still ensure the ✅ is present.
            slack.react(meta["channel_id"], msg_ts, "white_check_mark")
            continue

        fields = extract.extract_fields(msg.get("text", ""))
        submitted_at = config.ts_to_iso(msg_ts)
        sheets.upsert_entry(tab, date, fields, submitted_at, msg_ts)
        slack.react(meta["channel_id"], msg_ts, "white_check_mark")
        print(f"Recorded {known[user]['name']} ({tab}) for {date}.")

    print(f"Poll complete for {date}: {len(latest)} intern(s) with replies.")


if __name__ == "__main__":
    main()
