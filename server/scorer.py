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
HEARD_NODES = (
    "opening",
    "rebuttal",
    "crossexam_question",
    "crossexam_answer",
    "closing",
    "sparring",
    "lesson",
    "check",
)
# Nodes where the user's turns are answers to a question the bot just asked, and
# which judge call scores them. The bot's turns there are heard, not scored.
ANSWER_NODES = {"sparring": "answer", "check": "understanding"}
# ...and the ones where nothing said is an argument: the house's invitation and
# the user's question in cross-examination, and the whole lesson (heard, so the
# tutor's turns can be counted; the check resets the transcript before it starts).
UNSCORED_NODES = ("crossexam_question", "lesson")


class TurnScorer:
    def __init__(
        self,
        state: DebateState,
        current_stage: Callable[[], str | None],
        theories: Callable[[], tuple[str, str]],
        score=judge.score_turn,
        score_answer=judge.score_answer,
        score_understanding=judge.score_understanding,
        rubric: Callable[[], str] = lambda: "",
    ):
        self._state = state
        self._current_stage = current_stage
        self._theories = theories
        self._score = score
        self._score_answer = score_answer
        self._score_understanding = score_understanding
        self._rubric = rubric
        self._transcript: list[tuple[str, str]] = []
        self._heard: dict[tuple[str, str], int] = {}
        # An answer in progress, per answer node: where its parts sit in the
        # transcript. A pause mid-answer splits it into several user turns; it is
        # scored once, joined, when the bot's tool says it is complete.
        self._pending: dict[str, list[int]] = {}
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
        self._heard[(node, by)] = self._heard.get((node, by), 0) + 1
        kind = ANSWER_NODES.get(node)
        if kind and by == "user":
            self._pending.setdefault(node, []).append(len(self._transcript) - 1)
            logger.debug(f"scorer: holding part of an answer in {node} until it is complete")
            return
        if node in UNSCORED_NODES or (kind and by == "bot"):
            # Kept for the judge to read — an answer means little without its
            # question — but a question is not an argument, so it is not scored.
            logger.debug(f"scorer: heard an unscored {by} turn in {node}")
            return
        # The rubric is read now, not when the judge gets round to it: by then
        # the handler may have moved the check on to its next question.
        rubric = self._rubric() if kind == "understanding" else ""
        generation = self._generation
        logger.debug(
            f"scorer: accepted {by} turn in {self._current_stage()} ({len(text.split())} words)"
        )
        self._tail = asyncio.create_task(
            self._run(self._tail, by, text, history, generation, kind=kind, rubric=rubric)
        )

    async def _run(
        self,
        previous: asyncio.Task | None,
        by: str,
        text: str,
        history: list[tuple[str, str]],
        generation: int,
        kind: str | None = None,
        rubric: str = "",
        question: str | None = None,
    ) -> None:
        if previous:
            with contextlib.suppress(Exception):
                await previous
        if generation != self._generation:
            return
        try:
            user_theory, bot_theory = self._theories()
            if kind == "answer":
                score = await self._score_answer(theory=user_theory, history=history, answer=text)
            elif kind == "understanding":
                question = question or next((t for who, t in reversed(history) if who == "bot"), "")
                score = await self._score_understanding(
                    theory=user_theory,
                    question=question,
                    rubric=rubric,
                    history=history,
                    answer=text,
                )
            else:
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
            if kind:
                await self._state.apply_answer(score.damage, score.recovery, score.reason)
            else:
                await self._state.apply_hit(by, score.damage, score.recovery, score.reason)
            logger.debug(
                f"scorer: applied {by} hit (damage={score.damage}, recovery={score.recovery}, "
                f"healths={self._state.health}, reason={score.reason!r})"
            )
        except Exception:
            logger.exception(f"scorer: unexpected error applying a {by} hit")

    def answer_complete(self, node: str, question: str | None = None) -> None:
        """The bot's tool has heard a whole answer in ``node``: score it, once.

        Call it before moving the question on, so a check answer is scored
        against the rubric (and ``question``) of the question it answered. The
        judge's history is the transcript as it stands now, without the
        answer's own parts, so a part spoken over the next question is judged
        against that question, not the one before it.
        """
        kind = ANSWER_NODES.get(node)
        held = self._pending.pop(node, None)
        if self._closed or kind is None or not held:
            return
        parts = [self._transcript[i][1] for i in held]
        history = [turn for i, turn in enumerate(self._transcript) if i not in set(held)]
        rubric = self._rubric() if kind == "understanding" else ""
        self._tail = asyncio.create_task(
            self._run(
                self._tail, "user", " ".join(parts), history, self._generation,
                kind=kind, rubric=rubric, question=question,
            )
        )

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

    def heard(self, node: str, by: str) -> int:
        """How many finished turns ``by`` has had in flow node ``node`` this debate."""
        return self._heard.get((node, by), 0)

    def reset(self) -> None:
        self._transcript = []
        self._heard = {}
        self._pending = {}
        self._closed = False
        self._generation += 1
        self._tail = None
