"""Morning job: post the standup prompt to Slack and record today's thread.

Idempotent — if today's `meta` row already exists, it does nothing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config, sheets, slack  # noqa: E402


def main() -> None:
    date = config.today_str()

    if sheets.get_meta(date):
        print(f"meta for {date} already exists — nothing to post.")
        return

    interns = sheets.get_config()
    mentions = " ".join(f"<@{c['slack_user_id']}>" for c in interns)

    text = (
        ":clipboard: *Daily Standup*\n"
        f"{mentions} — please reply in this thread:\n"
        "1. What is your current task?\n"
        "2. What did you do yesterday?\n"
        "3. What is the goal today?\n"
        "4. Any blockers or challenges?"
    )

    thread_ts = slack.post(config.STANDUP_CHANNEL_ID, text)
    sheets.set_meta(date, config.STANDUP_CHANNEL_ID, thread_ts)
    print(f"Posted standup for {date} (thread {thread_ts}).")


if __name__ == "__main__":
    main()
