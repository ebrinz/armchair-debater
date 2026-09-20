#
# Copyright (c) 2024-2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""Reads both sides' finished turns from frames, not aggregator events.

User turns: every user turn, spoken or typed, causes exactly one
`LLMContextFrame` to be pushed downstream into the LLM service, with the
context's last message being the user's. `bot.py` used to score these from
`LLMUserAggregator`'s `on_user_turn_message_added` event, but that event only
fires on the speech path (STT -> aggregation -> push_aggregation); typed
input is appended straight to the context via an RTVI client message and
never fires it. Reading the context frame works for both input modalities.

Bot turns: `bot.py` used to score these from the assistant context
aggregator's `on_assistant_turn_stopped` event. That aggregator sits
downstream of TTS and `transport.output()` (by design, so it records what was
actually produced), and a barge-in's `InterruptionFrame` -- broadcast out of
band, ahead of the normal frame queue -- can reach it before the
still-in-flight `LLMFullResponseEndFrame` for the turn just spoken does.
Whichever arrives first wins (both trigger the same "turn stopped" call, and
the second is a no-op), so the interrupted-first call can fire with less text
than the LLM actually produced, sometimes none at all -- silently dropping or
truncating the turn. Traced live: under the eval harness's back-to-back
scripted turns, this happened on 1 of 3 bot turns in one run and on 3 of 3 in
another.

Reading straight from the LLM's own output avoids the race entirely: nothing
sits between the source and this observer, so there is nothing for an
interruption to outrun. A bot turn is reported once it actually finishes
speaking (`BotStoppedSpeakingFrame`, which the base output transport always
emits). As a failsafe -- that frame is a signal, not a guarantee -- any
still-pending bot text is also flushed immediately before the next user turn
is reported. Text from a response an interruption cut off before its
`LLMFullResponseEndFrame` is not lost either: it is carried into the pending
bot turn as soon as the next response's `LLMFullResponseStartFrame` arrives
(the same fold-forward the End-frame branch does), so it still reaches
whichever flush -- the next stop event or the next user turn -- reports the
turn it belongs to.
"""

from collections.abc import Callable

from loguru import logger
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.processors.frame_processor import FrameProcessor


class TurnObserver(BaseObserver):
    """Calls `on_turn(by, text)` once per confirmed turn, `by` "user" or "bot"."""

    def __init__(self, llm: FrameProcessor, on_turn: Callable[[str, str], None]):
        super().__init__()
        self._llm = llm
        self._on_turn = on_turn
        self._last_reported_user: tuple[int, str] | None = None
        # Text streaming out of the LLM response currently in progress.
        self._response_parts: list[str] = []
        # Complete responses already folded in, not yet flushed as a turn --
        # e.g. a tool-call response (no text) followed by the spoken one.
        self._pending_bot_parts: list[str] = []
        # BotStoppedSpeakingFrame is emitted as two frame instances (one
        # downstream, one upstream, linked by broadcast_sibling_id) and each
        # is then relayed hop by hop, so the same event reaches this observer
        # several times; this tracks what's already been handled.
        self._handled_stop_ids: set[int] = set()

    async def on_push_frame(self, data: FramePushed) -> None:
        frame = data.frame

        if isinstance(frame, BotStoppedSpeakingFrame):
            if self._is_new_stop(frame):
                self._flush_bot_turn()
            return

        if data.source is self._llm:
            if isinstance(frame, LLMFullResponseStartFrame):
                # The previous response may never have gotten its End frame
                # (cut off by an interruption); fold whatever it had streamed
                # so far forward instead of discarding it.
                text = "".join(self._response_parts).strip()
                if text:
                    self._pending_bot_parts.append(text)
                self._response_parts = []
            elif isinstance(frame, LLMTextFrame):
                self._response_parts.append(frame.text)
            elif isinstance(frame, LLMFullResponseEndFrame):
                text = "".join(self._response_parts).strip()
                self._response_parts = []
                if text:
                    self._pending_bot_parts.append(text)
            return

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
        if key == self._last_reported_user:
            return
        self._last_reported_user = key

        # The bot's turn always precedes the user's reply to it.
        self._flush_bot_turn()
        self._report("user", text)

    def _is_new_stop(self, frame: BotStoppedSpeakingFrame) -> bool:
        if frame.id in self._handled_stop_ids:
            return False
        self._handled_stop_ids = {frame.id}
        if frame.broadcast_sibling_id is not None:
            self._handled_stop_ids.add(frame.broadcast_sibling_id)
        return True

    def _flush_bot_turn(self) -> None:
        parts = list(self._pending_bot_parts)
        current = "".join(self._response_parts).strip()
        if current:
            parts.append(current)
        self._pending_bot_parts = []
        self._response_parts = []

        text = " ".join(parts).strip()
        if text:
            self._report("bot", text)

    def _report(self, by: str, text: str) -> None:
        try:
            self._on_turn(by, text)
        except Exception:
            logger.exception(f"TurnObserver: on_turn callback raised for a {by} turn")


def _turn_text(content) -> str:
    """Extract the spoken/typed text from a context message's content field."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [part["text"] for part in content if isinstance(part, dict) and "text" in part]
        return " ".join(parts).strip()
    return ""
