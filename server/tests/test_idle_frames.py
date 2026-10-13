"""A typed conversation must count as activity, or the pipeline's idle timeout
cancels a text-mode eval that outlasts it (the defaults are all speech frames)."""

from pipecat.frames.frames import (
    BotSpeakingFrame,
    LLMFullResponseEndFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
)

import bot


def test_a_finished_llm_reply_keeps_the_pipeline_awake():
    assert LLMFullResponseEndFrame in bot.IDLE_TIMEOUT_FRAMES


def test_the_speech_frames_still_count():
    for frame in (BotSpeakingFrame, TranscriptionFrame, UserStartedSpeakingFrame):
        assert frame in bot.IDLE_TIMEOUT_FRAMES
