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
from debate_state import DebateState

# Flow nodes (not client stages) whose turns belong to the debate. Everything
# said in them goes into the transcript the judge reads.
HEARD_NODES = ("opening", "rebuttal", "crossexam_question", "crossexam_answer", "closing")
# ...and the ones where what is said is not an argument: the house's invitation
# and the user's question. Both of the answers that follow are scored.
UNSCORED_NODES = ("crossexam_question",)


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
        """Queue a turn for background scoring. Never blocks; needs a running event loop."""
        text = text.strip()
        node = self._current_stage()
        if self._closed or not text or node not in HEARD_NODES:
            return
        history = list(self._transcript)
        self._transcript.append((by, text))
        if node in UNSCORED_NODES:
            # Kept for the judge to read — an answer means little without its
            # question — but a question is not an argument, so it is not scored.
            logger.debug(f"scorer: heard an unscored {by} turn in {node}")
            return
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
        try:
            user_theory, bot_theory = self._theories()
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
        # Nothing a scored turn does may stop the verdict that waits on this.
        if self._tail:
            with contextlib.suppress(Exception):
                await self._tail

    def close(self) -> None:
        self._closed = True

    def abandon(self) -> None:
        """The session is over: take no more turns and drop the one in flight."""
        self._closed = True
        self._generation += 1

    def reset(self) -> None:
        self._transcript = []
        self._closed = False
        self._generation += 1
        self._tail = None
