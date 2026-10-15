"""When a speech service gives up reconnecting, the session is over: the arcade
is told why, then the pipeline ends, instead of a bot that looks alive but is
deaf and mute (a venue session on 2026-10-14 ended that way, 15 errors deep)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

from pipecat.frames.frames import ErrorFrame

import bot

GAVE_UP = "GradiumSTTService#0 failed to reconnect after 3 attempts: [Errno 8] nodename nor servname provided"


def error(usable: bool, text: str = GAVE_UP) -> ErrorFrame:
    return ErrorFrame(error=text, processor=SimpleNamespace(is_usable=usable, name="GradiumSTTService#0"))


def test_a_passing_error_is_not_a_lost_session():
    # The LLM's "Connection error." on one turn, and a reconnect that will be retried.
    assert bot.session_lost(ErrorFrame(error="Error during completion: Connection error.")) is None
    assert bot.session_lost(error(usable=True)) is None


def test_a_service_that_gave_up_is_a_lost_session():
    assert bot.session_lost(error(usable=False)) == {"type": "session_lost", "reason": GAVE_UP}


async def test_the_arcade_is_told_before_the_session_ends_and_only_once():
    calls = []
    worker = SimpleNamespace(
        rtvi=SimpleNamespace(send_server_message=AsyncMock(side_effect=lambda m: calls.append(("told", m)))),
        stop_when_done=AsyncMock(side_effect=lambda: calls.append(("ended",))),
    )
    on_error = bot.end_lost_session(worker)

    await on_error(worker, ErrorFrame(error="Error during completion: Connection error."))
    assert calls == []

    await on_error(worker, error(usable=False))
    await on_error(worker, error(usable=False, text="GradiumTTSService#0 failed to reconnect"))  # the voice goes too
    assert calls == [("told", {"type": "session_lost", "reason": GAVE_UP}), ("ended",)]


def test_the_handler_is_wired_to_the_worker():
    from pathlib import Path

    source = Path(bot.__file__).read_text()
    assert 'add_event_handler("on_pipeline_error", end_lost_session(worker))' in source
