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
    "You are a senior technical writer at a deep-learning research lab. You are "
    "given an intern's terse, day-by-day notes describing the engineering and "
    "research work they completed over one work week. Your job is NOT to copy the "
    "notes — it is to rewrite them into a SINGLE polished, detailed, technical "
    "paragraph that reads as a professional weekly progress report.\n\n"
    "Actively transform the input:\n"
    "- Expand shorthand and terse phrasing into complete, fluent technical "
    "sentences. Where a note is a fragment, develop it into a proper statement of "
    "what was done and why it mattered.\n"
    "- Refine and elevate the language: use precise domain vocabulary appropriate "
    "to deep-learning engineering and research (architectures, training "
    "procedures, datasets, pipelines, infrastructure, evaluation, tooling).\n"
    "- Add reasonable technical context and significance for the work described — "
    "explain the purpose, approach, or engineering rationale that a knowledgeable "
    "reader would infer — so the paragraph reads as substantive and informative.\n"
    "- Preserve every concrete detail the intern mentions (specific models, "
    "datasets, metrics, tools, components, experiments, results). Never drop them.\n\n"
    "Hard constraints:\n"
    "- Do NOT invent specific quantitative results, metrics, accuracies, dataset "
    "names, or outcomes that the notes do not contain. Elaborate on the meaning "
    "and context of the stated work, but do not fabricate facts or numbers.\n"
    "- Write in the third person, past tense, referring to the person as 'the "
    "intern'.\n"
    "- Produce exactly one cohesive paragraph of flowing prose — no bullet points, "
    "no headings, no day-by-day enumeration, no markdown.\n"
    "- Strip all meta-commentary and filler: never mention weekends, days off, "
    "that no work was done on some day, that any day is missing or sparse, or that "
    "information is incomplete. Summarize only the actual work that is present.\n"
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
        client = genai.Client(api_key=config.GEMINI_API_KEY_WEEKLY)
    except Exception:
        return fallback

    gen_config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION, temperature=0.2
    )
    prompt = (
        "Rewrite the following terse daily notes into one detailed, polished, "
        "technical weekly progress paragraph, following the system instruction. "
        "Elaborate and refine; do not copy the notes verbatim.\n\n"
        "Daily notes for the week:\n" + joined
    )

    import time

    # Try the primary model first, then a fallback if the primary is
    # persistently unavailable (503 / 5xx). The fallback is always on the
    # free tier so it costs nothing extra.
    _FALLBACK_MODEL = "gemini-2.0-flash"
    models_to_try = [config.GEMINI_MODEL]
    if config.GEMINI_MODEL != _FALLBACK_MODEL:
        models_to_try.append(_FALLBACK_MODEL)

    _TRANSIENT_CODES = ("429", "500", "502", "503", "504")

    for model in models_to_try:
        delay = 2
        for attempt in range(4):
            try:
                resp = client.models.generate_content(
                    model=model, contents=prompt, config=gen_config
                )
                # resp.text is a property that can raise ValueError (not
                # AttributeError) when the response has no valid candidates or
                # was blocked.  getattr(..., default) only catches
                # AttributeError, so a ValueError would propagate to the outer
                # except, hit the non-transient `break`, and silently return
                # the raw fallback — which is just the daily notes
                # concatenated verbatim.
                try:
                    text = (resp.text or "").strip()
                except Exception as text_err:  # noqa: BLE001
                    print(f"  [weekly] Could not read Gemini response text: {text_err}")
                    text = ""
                if text:
                    return text
                print(f"  [weekly] {model} returned empty text; retrying.")
            except Exception as e:  # noqa: BLE001
                err_str = str(e)
                is_transient = any(code in err_str for code in _TRANSIENT_CODES)
                print(f"  [weekly] {model} attempt {attempt + 1}/4 failed: {e}")
                if is_transient and attempt < 3:
                    time.sleep(delay)
                    delay *= 2
                    continue
                if not is_transient:
                    break  # permanent error — don't retry this model
        # If we're here, all attempts for this model failed; try next model.
        if len(models_to_try) > 1 and model == models_to_try[0]:
            print(f"  [weekly] {model} exhausted; falling back to {_FALLBACK_MODEL}.")

    print("  [weekly] All models exhausted; returning raw fallback.")
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
