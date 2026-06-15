"""Attendance job: post an ID-card scan reminder to the attendance channel.

Fires twice a day (08:55 and 16:55 PKT, Mon–Fri) via a single cron-job.org
trigger that calls this workflow's `workflow_dispatch`. There is no GitHub
`schedule:` fallback, so cron-job.org is the only clock — that means a single
trigger per slot, so the post is stateless (no sheet/dedup needed).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config, slack  # noqa: E402


def main() -> None:
    text = (
        ":identification_card: *Attendance Reminder*\n"
        "Please scan your ID card for attendance at the *main entrance* of the "
        "*SINES* building."
    )

    ts = slack.post(config.ATTENDANCE_CHANNEL_ID, text)
    print(f"Posted attendance reminder to {config.ATTENDANCE_CHANNEL_ID} (ts {ts}).")


if __name__ == "__main__":
    main()
