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


def test_the_frames_reach_the_worker_not_the_params():
    """PipelineParams silently drops unknown keys, so the wiring is checked at the source."""
    import ast
    import inspect
    from pathlib import Path

    from pipecat.pipeline.worker import PipelineParams, PipelineWorker

    assert "idle_timeout_frames" in inspect.signature(PipelineWorker.__init__).parameters
    assert "idle_timeout_frames" not in PipelineParams.model_fields

    tree = ast.parse(Path(bot.__file__).read_text())
    worker_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and getattr(node.func, "id", None) == "PipelineWorker"
    ]
    assert len(worker_calls) == 1
    keywords = {kw.arg: kw.value for kw in worker_calls[0].keywords}
    assert getattr(keywords.get("idle_timeout_frames"), "id", None) == "IDLE_TIMEOUT_FRAMES"


def test_the_bot_cannot_be_interrupted_by_a_word_or_two():
    # Recorded sessions, 2026-10-14: 6 of 7 cut-off replies were stopped by
    # room chatter ("what the hell", "straight up. what?"). While the bot is
    # speaking it now takes three words to interrupt it; when it is quiet, one
    # word still starts the player's turn.
    from pipecat.turns.user_start import MinWordsUserTurnStartStrategy

    strategies = bot.user_turn_strategies()
    assert len(strategies.start) == 1
    start = strategies.start[0]
    assert isinstance(start, MinWordsUserTurnStartStrategy)
    assert start._min_words == bot.INTERRUPT_MIN_WORDS == 3
    assert strategies.stop  # the default stop strategies are kept
