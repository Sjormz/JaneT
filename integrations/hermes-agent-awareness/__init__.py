"""Hermes lifecycle tracer for JaneT's private OSC 777 channel."""

from __future__ import annotations

import base64
import json
import sys
from typing import Any

_MAX_ID_LENGTH = 256
_SESSIONS: set[str] = set()
_TURN_BY_SESSION: dict[str, str] = {}
_PLATFORM_BY_SESSION: dict[str, str] = {}


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > _MAX_ID_LENGTH:
        return ""
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        return ""
    return value


def _write_terminal(data: str) -> None:
    path = "CONOUT$" if sys.platform == "win32" else "/dev/tty"
    try:
        with open(path, "w", encoding="ascii", newline="") as stream:
            if stream.isatty():
                stream.write(data)
                stream.flush()
    except OSError:
        pass


def _emit(
    event: str,
    session_id: Any,
    turn_id: Any = "",
    outcome: str = "",
    platform: str = "cli",
) -> None:
    session = _identifier(session_id)
    if not session:
        return
    turn = _identifier(turn_id)
    payload: dict[str, Any] = {
        "version": 1,
        "event": event,
        "sessionId": session,
    }
    if turn:
        payload["turnId"] = turn
    if outcome:
        payload["outcome"] = outcome
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).rstrip(b"=").decode("ascii")
    sequence = f"\x1b]777;janet-agent;hermes;{encoded}\x1b\\"
    if platform == "tui":
        _write_terminal(sequence)
        return
    stream = getattr(sys.stdout, "original_stdout", None) or sys.stdout
    if not getattr(stream, "isatty", lambda: False)():
        return
    stream.write(sequence)
    stream.flush()


def _on_session_start(session_id: str = "", platform: str = "", **_: Any) -> None:
    session = _identifier(session_id)
    if platform in {"cli", "tui"} and session and session not in _SESSIONS:
        _SESSIONS.add(session)
        _PLATFORM_BY_SESSION[session] = platform
        _emit("session.start", session, platform=platform)


def _on_turn_start(
    session_id: str = "",
    turn_id: str = "",
    platform: str = "",
    parent_session_id: str = "",
    **_: Any,
) -> None:
    if platform not in {"cli", "tui"} or parent_session_id:
        return
    session = _identifier(session_id)
    turn = _identifier(turn_id)
    if session and turn:
        if session not in _SESSIONS:
            _SESSIONS.add(session)
            _emit("session.start", session, platform=platform)
        _TURN_BY_SESSION[session] = turn
        _PLATFORM_BY_SESSION[session] = platform
    _emit("turn.start", session, turn, platform=platform)


def _on_attention(event: str, surface: str = "", turn_id: str = "", **_: Any) -> None:
    if surface not in {"cli", "gateway"}:
        return
    turn = _identifier(turn_id)
    sessions = [session for session, active_turn in _TURN_BY_SESSION.items() if active_turn == turn]
    if len(sessions) == 1:
        session = sessions[0]
        platform = _PLATFORM_BY_SESSION.get(session, "")
        if (surface, platform) in {("cli", "cli"), ("gateway", "tui")}:
            _emit(event, session, turn, platform=platform)


def _on_turn_end(
    session_id: str = "",
    turn_id: str = "",
    platform: str = "",
    completed: bool = False,
    failed: bool = False,
    interrupted: bool = False,
    **_: Any,
) -> None:
    if platform not in {"cli", "tui"}:
        return
    session = _identifier(session_id)
    tracked_turn = _TURN_BY_SESSION.get(session, "")
    turn = _identifier(turn_id) or tracked_turn
    if not tracked_turn or turn != tracked_turn:
        return
    outcome = "failed" if failed else "succeeded" if completed and not interrupted else "interrupted"
    _emit("turn.end", session, turn, outcome, platform)
    if session:
        _TURN_BY_SESSION.pop(session, None)


def _on_session_finalize(session_id: str = "", platform: str = "", **_: Any) -> None:
    if platform not in {"cli", "tui"}:
        return
    session = _identifier(session_id)
    _emit("session.end", session, platform=platform)
    if session:
        _SESSIONS.discard(session)
        _TURN_BY_SESSION.pop(session, None)
        _PLATFORM_BY_SESSION.pop(session, None)


def register(ctx: Any) -> None:
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("pre_llm_call", _on_turn_start)
    ctx.register_hook(
        "pre_approval_request",
        lambda **kwargs: _on_attention("attention.request", **kwargs),
    )
    ctx.register_hook(
        "post_approval_response",
        lambda **kwargs: _on_attention("attention.resolve", **kwargs),
    )
    ctx.register_hook("on_session_end", _on_turn_end)
    ctx.register_hook("on_session_finalize", _on_session_finalize)
