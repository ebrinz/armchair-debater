#
# Copyright (c) 2024-2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""Scores the user's turns from the LLM context frame, not the aggregator event.

`bot.py` used to feed the scorer from `LLMUserAggregator`'s
`on_user_turn_message_added` event, but that event only fires on the speech
path (STT -> aggregation -> push_aggregation). Typed input -- the eval
harness's text mode and the web client's text box -- is appended straight to
the LLM context via an RTVI client message and never goes through that
aggregation step, so the event never fires for it and typed user turns went
unscored.

Every user turn, spoken or typed, does cause exactly one `LLMContextFrame` to
be pushed downstream into the LLM service, with the context's last message
being the user's -- so this observer watches for that hop instead, which
works for both input modalities.
"""

from collections.abc import Callable

from loguru import logger
from pipecat.frames.frames import LLMContextFrame
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.processors.frame_processor import FrameProcessor


class UserTurnObserver(BaseObserver):
    """Calls `on_user_turn(text)` once per confirmed user turn reaching `llm`."""

    def __init__(self, llm: FrameProcessor, on_user_turn: Callable[[str], None]):
        super().__init__()
        self._llm = llm
        self._on_user_turn = on_user_turn
        self._last_reported: tuple[int, str] | None = None

    async def on_push_frame(self, data: FramePushed) -> None:
        frame = data.frame
        if not isinstance(frame, LLMContextFrame):
            return
        if data.destination is not self._llm:
            return
        if frame.speculation:
            return

        messages = frame.context.get_messages()
        if not messages:
            return

        last = messages[-1]
        if not isinstance(last, dict) or last.get("role") != "user":
            return

        text = _turn_text(last.get("content"))
        if not text:
            return

        key = (len(messages), text)
        if key == self._last_reported:
            return
        self._last_reported = key

        try:
            self._on_user_turn(text)
        except Exception:
            logger.exception("UserTurnObserver: on_user_turn callback raised")


def _turn_text(content) -> str:
    """Extract the spoken/typed text from a context message's content field."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [part["text"] for part in content if isinstance(part, dict) and "text" in part]
        return " ".join(parts).strip()
    return ""
