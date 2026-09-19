"""Scores finished debate turns in order, off the voice path.

Each submitted turn becomes a background task that first awaits the task before
it, so scores reach DebateState in turn order however long each judge call
takes, and submit() never blocks the pipeline.
"""

import asyncio
import contextlib
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
        self._generation = 0

    def submit(self, by: str, text: str) -> None:
        """Queue a turn for background scoring; must be called from a running event loop, and never blocks."""
        text = text.strip()
        if self._closed or not text or self._current_stage() not in DEBATE_ROUNDS:
            return
        history = list(self._transcript)
        self._transcript.append((by, text))
        generation = self._generation
        logger.debug(
            f"scorer: accepted {by} turn in {self._current_stage()} ({len(text.split())} words)"
        )
        self._tail = asyncio.create_task(self._run(self._tail, by, text, history, generation))

    async def _run(
        self,
        previous: asyncio.Task | None,
        by: str,
        text: str,
        history: list[tuple[str, str]],
        generation: int,
    ) -> None:
        if previous:
            with contextlib.suppress(Exception):
                await previous
        if generation != self._generation:
            return
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
        except Exception:
            logger.exception(f"scorer: unexpected error scoring a {by} turn")
            return
        if generation != self._generation:
            return
        try:
            await self._state.apply_hit(by, score.damage, score.recovery, score.reason)
            logger.debug(
                f"scorer: applied {by} hit (damage={score.damage}, recovery={score.recovery}, "
                f"healths={self._state.health}, reason={score.reason!r})"
            )
        except Exception:
            logger.exception(f"scorer: unexpected error applying a {by} hit")

    async def drain(self) -> None:
        if self._tail:
            await self._tail

    def close(self) -> None:
        self._closed = True

    def reset(self) -> None:
        self._transcript = []
        self._closed = False
        self._generation += 1
        self._tail = None
