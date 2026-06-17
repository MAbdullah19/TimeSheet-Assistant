"""Weekly per-intern progress reports.

The daily standup stores, per intern per day, a `Previous Workday` field: the
work that intern completed on their previous working day. That field is the only
one used here — stitched across a week it reconstructs each workday's output.

The catch is timing. The work an intern does on a given workday is only logged
the *next* working morning, so:

    work done Monday    → captured in Tuesday's    `Previous Workday`
    work done Tuesday   → captured in Wednesday's   `Previous Workday`
    work done Wednesday → captured in Thursday's    `Previous Workday`
    work done Thursday  → captured in Friday's      `Previous Workday`
    work done Friday    → captured in next Monday's  `Previous Workday`

So a full Mon–Fri week can only be assembled once the *following* Monday's
standup is in — which is why the weekly job runs on the new week's **Tuesday**
(by then Monday's reply, carrying last Friday's work, has been recorded).

`reported_week(run_date)` returns the Mon–Fri being reported on, and
`source_dates(...)` returns the five entry-dates whose `Previous Workday` cells
hold that week's five workdays. `build_intern_summary(...)` pulls those cells for
one intern and turns the non-empty ones into a single technical paragraph via
Gemini — it never raises.
"""
from datetime import date as _date, timedelta

from core import config, sheets

# Values that mean "no real content was logged" for a Previous Workday cell.
_EMPTY = {"", "not provided", "parse error", "n/a", "na", "none", "-"}

# Ordered workday labels (Mon→Fri) and the day-offset from the reported week's
# Monday at which each workday's output lands in a `Previous Workday` cell.
_WORKDAY_OFFSETS = [
    ("Monday", 1),     # captured in Tuesday's entry
    ("Tuesday", 2),    # captured in Wednesday's entry
    ("Wednesday", 3),  # captured in Thursday's entry
    ("Thursday", 4),   # captured in Friday's entry
    ("Friday", 7),     # captured in the *next* Monday's entry
]

SYSTEM_INSTRUCTION = (
    "You are a technical writer at a deep-learning research lab. You are given an "
    "intern's day-by-day notes describing the engineering and research work they "
    "completed over one work week. Synthesize them into a SINGLE cohesive "
    "paragraph that reads as a polished weekly progress summary.\n\n"
    "Requirements:\n"
    "- Use precise, technical language; preserve concrete details (models, "
    "datasets, metrics, tools, components, experiments) the intern mentions.\n"
    "- Write in the third person, past tense.\n"
    "- Produce exactly one paragraph of flowing prose — no bullet points, no "
    "headings, no day-by-day enumeration, no markdown.\n"
    "- Do NOT mention that any day is missing, sparse, or that information is "
    "incomplete. Summarize only what is present.\n"
    "- Return only the paragraph text, nothing else."
)


def _is_empty(value: str) -> bool:
    return (value or "").strip().lower() in _EMPTY


def _team_today() -> _date:
    """Today's date in the team timezone, as a date object."""
    from datetime import datetime

    return datetime.now(config.get_tz()).date()


def reported_week(run_date: _date | None = None) -> tuple[_date, _date]:
    """(monday, friday) of the week the report covers, given the date the job
    runs. The reported week is the full week *before* the run date's week, so a
    Tuesday run reports on the immediately preceding Mon–Fri."""
    run_date = run_date or _team_today()
    this_week_monday = run_date - timedelta(days=run_date.weekday())
    reported_monday = this_week_monday - timedelta(days=7)
    return reported_monday, reported_monday + timedelta(days=4)


def source_dates(reported_monday: _date) -> list[tuple[str, str]]:
    """For the reported week's Monday, the list of (workday_label, entry_date)
    whose `Previous Workday` cell holds that workday's output. `entry_date` is a
    YYYY-MM-DD string."""
    return [
        (label, (reported_monday + timedelta(days=off)).strftime("%Y-%m-%d"))
        for label, off in _WORKDAY_OFFSETS
    ]


def collect_pieces(tab_name: str, reported_monday: _date) -> list[str]:
    """Non-empty `Previous Workday` cells for one intern across the reported
    week, in Mon→Fri order. Empty/placeholder cells are dropped silently."""
    pieces = []
    for _label, entry_date in source_dates(reported_monday):
        value = sheets.get_entry_field(tab_name, entry_date, "Previous Workday")
        if not _is_empty(value):
            pieces.append(value.strip())
    return pieces


def generate_summary(pieces: list[str]) -> str:
    """Turn the week's daily notes into one technical paragraph via Gemini.
    Never raises; on any failure returns a plain newline-joined fallback so the
    week still gets a usable (if unpolished) summary."""
    joined = "\n".join(f"- {p}" for p in pieces)
    fallback = " ".join(pieces)

    try:
        from google import genai
        from google.genai import types
    except Exception:
        return fallback

    try:
        client = genai.Client(api_key=config.GEMINI_API_KEY)
    except Exception:
        return fallback

    gen_config = types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION)
    prompt = "Daily notes for the week:\n" + joined

    import time

    delay = 1
    for attempt in range(3):
        try:
            resp = client.models.generate_content(
                model=config.GEMINI_MODEL, contents=prompt, config=gen_config
            )
            text = (getattr(resp, "text", "") or "").strip()
            return text or fallback
        except Exception as e:  # noqa: BLE001
            if "429" in str(e) and attempt < 2:
                time.sleep(delay)
                delay *= 2
                continue
            break
    return fallback


# When an intern logged nothing all week, store this instead of an empty cell.
NO_DATA_MESSAGE = (
    "No work activity was logged for this intern during the reporting week."
)


def build_intern_summary(tab_name: str, reported_monday: _date) -> tuple[str, str]:
    """Return (summary_text, status) for one intern. `status` is "ok" when at
    least one workday had content, or "no_data" when the whole week was empty —
    in which case `summary_text` is `NO_DATA_MESSAGE`."""
    pieces = collect_pieces(tab_name, reported_monday)
    if not pieces:
        return NO_DATA_MESSAGE, "no_data"
    return generate_summary(pieces), "ok"
