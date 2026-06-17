"""Weekly job: build one technical progress paragraph per intern and store it.

Runs on the new week's Tuesday (see `core/weekly.py` for why Tuesday). For each
intern it pulls the previous week's five `Previous Workday` cells, summarizes the
non-empty ones with Gemini, and upserts a row into the `weekly` tab. The
dashboard build step (run next in the workflow) then surfaces these.

Idempotent — re-running for the same week overwrites each intern's row rather
than appending, so a double-trigger just regenerates in place.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config, sheets, weekly  # noqa: E402


def main() -> None:
    reported_monday, reported_friday = weekly.reported_week()
    week_start = reported_monday.strftime("%Y-%m-%d")
    week_end = reported_friday.strftime("%Y-%m-%d")
    generated_at = config.now_iso()

    interns = sheets.get_config()
    print(f"Building weekly reports for {week_start} → {week_end} ({len(interns)} interns).")

    for c in interns:
        summary, status = weekly.build_intern_summary(c["tab_name"], reported_monday)
        sheets.upsert_weekly(
            week_start, week_end, c["tab_name"], c["name"], summary, status, generated_at
        )
        print(f"  {c['name']} ({c['tab_name']}): {status}")

    print(f"Weekly report complete for {week_start} → {week_end}.")


if __name__ == "__main__":
    main()
