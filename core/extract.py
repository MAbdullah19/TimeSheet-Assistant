"""Gemini-powered extraction of the four standup fields from a free-text reply.

`extract_fields(reply_text)` always returns a dict with exactly these keys:
    current_task, yesterday, today_goal, blockers
It never raises — on any failure it falls back to a safe dict.
"""
import json
import re
import time

from core import config

KEYS = ["current_task", "yesterday", "today_goal", "blockers"]

SYSTEM_INSTRUCTION = (
    "You are a data-extraction assistant for a daily standup tool. Extract "
    "exactly four fields from the intern's message and return ONLY a valid JSON "
    "object — no prose, no markdown fences:\n\n"
    "{\n"
    '  "current_task": "what they are currently working on",\n'
    '  "yesterday":    "what they did yesterday",\n'
    '  "today_goal":   "their goal or plan for today",\n'
    '  "blockers":     "any blockers or challenges; use \\"None\\" if none are mentioned"\n'
    "}\n\n"
    "Use the intern's own words, lightly cleaned. Unmentioned fields → "
    '"Not provided" (blockers → "None"). One to three sentences per field. '
    "Output must be parseable by json.loads with exactly these four keys and no "
    "others."
)

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _coerce(data: dict) -> dict:
    """Force the dict to exactly the four expected keys with string values."""
    out = {}
    for k in KEYS:
        v = data.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            out[k] = "None" if k == "blockers" else "Not provided"
        else:
            out[k] = str(v).strip()
    return out


def _fallback(raw_text: str) -> dict:
    """Used when the model output cannot be parsed as JSON."""
    return {
        "current_task": (raw_text or "").strip() or "Parse error",
        "yesterday": "Parse error",
        "today_goal": "Parse error",
        "blockers": "Parse error",
    }


def _parse(text: str) -> dict:
    """Parse model output, retrying once after stripping ```json fences."""
    text = (text or "").strip()
    try:
        return _coerce(json.loads(text))
    except Exception:
        pass

    cleaned = _FENCE_RE.sub("", text).strip()
    try:
        return _coerce(json.loads(cleaned))
    except Exception:
        return _fallback(text)


def extract_fields(reply_text: str) -> dict:
    """Extract the four standup fields. Never raises."""
    try:
        from google import genai
        from google.genai import types
    except Exception:
        return _fallback(reply_text)

    try:
        client = genai.Client(api_key=config.GEMINI_API_KEY)
    except Exception:
        return _fallback(reply_text)

    gen_config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
    )

    delay = 1
    for attempt in range(3):
        try:
            resp = client.models.generate_content(
                model=config.GEMINI_MODEL,
                contents=reply_text,
                config=gen_config,
            )
            return _parse(getattr(resp, "text", ""))
        except Exception as e:  # noqa: BLE001
            if "429" in str(e) and attempt < 2:
                time.sleep(delay)
                delay *= 2
                continue
            break

    return _fallback(reply_text)
