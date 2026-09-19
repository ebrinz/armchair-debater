"""Scores finished debate turns in order, off the voice path.

Each submitted turn becomes a background task that first awaits the task before
it, so scores reach DebateState in turn order however long each judge call
takes, and submit() never blocks the pipeline.
"""

import asyncio
from collections.abc import Callable

from loguru import logger

import judge
from debate_state import DEBATE_ROUNDS, DebateState


class TurnScorer:
    def __init__(
        self,
        state: DebateState,
        current_stage: Callable[[], str | None],
        theories: Callable[[], tuple[str, str]],
        score=judge.score_turn,
    ):
        self._state = state
        self._current_stage = current_stage
        self._theories = theories
        self._score = score
        self._transcript: list[tuple[str, str]] = []
        self._tail: asyncio.Task | None = None
        self._closed = False

    def submit(self, by: str, text: str) -> None:
        text = text.strip()
        if self._closed or not text or self._current_stage() not in DEBATE_ROUNDS:
            return
        history = list(self._transcript)
        self._transcript.append((by, text))
        self._tail = asyncio.create_task(self._run(self._tail, by, text, history))

    async def _run(self, previous: asyncio.Task | None, by: str, text: str, history) -> None:
        if previous:
            await previous
        user_theory, bot_theory = self._theories()
        try:
            score = await self._score(
                speaker=by,
                user_theory=user_theory,
                bot_theory=bot_theory,
                history=history,
                turn=text,
                was_hit=any(hit["by"] != by for hit in self._state.hits),
            )
        except judge.JudgeError:
            logger.warning(f"scorer: skipping an unscored {by} turn")
            return
        await self._state.apply_hit(by, score.damage, score.recovery, score.reason)

    async def drain(self) -> None:
        if self._tail:
            await self._tail

    def close(self) -> None:
        self._closed = True

    def reset(self) -> None:
        self._transcript = []
        self._closed = False
