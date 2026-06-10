"""Thin wrapper over the Slack Web API: post, read thread replies, react."""
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from core import config

_client = None


def _c() -> WebClient:
    global _client
    if _client is None:
        _client = WebClient(token=config.SLACK_BOT_TOKEN)
    return _client


def post(channel: str, text: str) -> str:
    """Post a message; return its thread ts."""
    resp = _c().chat_postMessage(channel=channel, text=text)
    return resp["ts"]


def get_replies(channel: str, thread_ts: str) -> list[dict]:
    """All replies in a thread, excluding the parent message. Paginated."""
    messages: list[dict] = []
    cursor = None
    while True:
        resp = _c().conversations_replies(
            channel=channel, ts=thread_ts, cursor=cursor, limit=200
        )
        messages.extend(resp.get("messages", []))
        cursor = (resp.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            break
    return [m for m in messages if m.get("ts") != thread_ts]


def react(channel: str, ts: str, name: str) -> None:
    """Add a reaction; ignore `already_reacted`."""
    try:
        _c().reactions_add(channel=channel, timestamp=ts, name=name)
    except SlackApiError as e:
        if (e.response or {}).get("error") == "already_reacted":
            return
        raise
