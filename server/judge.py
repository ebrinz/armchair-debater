"""The debate judge: score one turn, and explain the final result.

Each call is a fresh LLM context holding only what it is given, so the judge has
no memory of having argued a side. No Pipecat imports: this module is plain
Python around an OpenAI-compatible chat call, which tests replace via `complete`.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from loguru import logger

from providers import llm_config

Complete = Callable[[str, str], Awaitable[str]]

SCORE_SYSTEM = """You are the impartial judge of a spoken debate about theories of consciousness. \
You score ONE turn at a time.

Score the argument that was actually made, never which theory you find more plausible. \
The user's words are transcribed speech: ignore disfluency, filler, and transcription errors, \
and score the substance. Judge by four criteria: argument strength, responsiveness to the \
opponent, use of evidence, and clarity.

Return ONLY a JSON object with these keys:
  "damage": integer 0-25. How hard this turn hits the OPPONENT's position. 0 for a turn that \
makes no argument (a question, small talk, agreement). 5-10 for a fair point. 15-20 for a strong, \
well-supported point the opponent must answer. 21-25 only for a point that is decisive.
  "recovery": integer 0-15. How well this turn answers the last point made AGAINST the speaker. \
0 if it ignores that point or there was none. 10-15 only if it genuinely defuses it.
  "reason": one short sentence, at most 18 words, naming the point that mattered. \
Describe the argument; do not address the speakers."""

RATIONALE_SYSTEM = """You are the impartial judge of a spoken debate about theories of \
consciousness. The debate is over and the scores are final. In exactly two short sentences that \
will be read aloud, explain why the result came out as it did, naming the one or two points that \
mattered most. Refer to the sides as "the challenger" (the user) and "the house" (the bot). \
No lists, no formatting, no numbers."""


class JudgeError(Exception):
    """The judge could not be reached or did not return a usable answer."""


@dataclass(frozen=True)
class TurnScore:
    damage: int
    recovery: int
    reason: str


def parse_score(text: str) -> TurnScore:
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object in judge output")
    data, _ = json.JSONDecoder().raw_decode(text, start)
    if not isinstance(data, dict):
        raise ValueError("judge output is not a JSON object")
    damage, recovery, reason = data.get("damage"), data.get("recovery"), data.get("reason")
    for value in (damage, recovery):
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("damage and recovery must be integers")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("reason must be a non-empty string")
    return TurnScore(damage, recovery, reason.strip())


ANSWER_SYSTEM = """You are the impartial judge of a Socratic examination about theories of \
consciousness. An examiner asks probing questions; the player holds a view and answers. You \
score ONE answer at a time.

Score how well the answer defended the player's view against the question that was asked, \
never whether you find the view plausible. The player's words are transcribed speech: ignore \
disfluency, filler, and transcription errors, and score the substance.

Return ONLY a JSON object with these keys:
  "damage": integer 0-25. How much of the position the question took. 0 for an answer that \
meets the question squarely. 5-10 for an answer that is partly right but leaves the difficulty \
standing. 15-20 for a dodge, a change of subject, or an answer that contradicts what the \
player said earlier. 21-25 only for conceding the core claim or having no answer at all.
  "recovery": integer 0-15. How far this answer also repaired an EARLIER weak answer, by \
resolving the difficulty it had left open. 0 if it did not.
  "reason": one declarative sentence of 10 to 15 words naming what the examiner asked and what \
the answer did, written for the audience, e.g. "Asked what would refute the theory, named a \
result that would."
"""

FINDING_SYSTEM = """You are the impartial judge of a Socratic examination about theories of \
consciousness. The examination is over and the player's position has an integrity score out of \
100, already decided; do not dispute it. In exactly two short spoken sentences, say how the view \
held up and name the question that did the most damage, in plain prose with no markup, lists, \
or numbers other than the score. Address the audience, not the player."""


UNDERSTANDING_SYSTEM = """You are the impartial judge of a lesson about a theory of consciousness. \
A tutor has taught the theory and is now checking whether the learner has understood it, one \
question at a time. You score ONE answer at a time against a rubric: what a full answer must cover.

Score whether the answer shows understanding of the theory, never whether the theory is true. \
The learner's words are transcribed speech: ignore disfluency, filler, and transcription errors, \
and score the substance. An answer in the learner's own words that covers the rubric is a full \
answer; the rubric's exact words are not required.

Return ONLY a JSON object with these keys:
  "damage": integer 0-25. What the answer was missing. 0 for an answer that covers the rubric, \
and 0 for a request to repeat or rephrase the question, which is not an answer and costs \
nothing. 5-10 for an answer with the main idea that misses part of the rubric. 11-14 for one \
that has less than half of it. 15-20 for an answer that gets the main idea wrong or confuses \
this theory with another. 21-25 for a blank, a dodge, or the common misreading stated as the \
theory.
  "recovery": integer 0-15. How far this answer also covers what an EARLIER answer missed. \
0 if it did not, or there was none.
  "reason": one declarative sentence of 10 to 15 words naming what was asked and what the answer \
showed, written for the audience, e.g. "Asked what ignition is, described a local response \
rather than a brain-wide one."
"""

REPORT_SYSTEM = """You are the impartial judge of a lesson about a theory of consciousness. The \
lesson is over and the learner's grasp has a score out of 100, already decided; do not dispute \
it. In exactly two short spoken sentences: first, what the learner has understood; second, the \
one thing to go back over, naming the lesson step it belongs to by its title. The second \
sentence must name the specific gap in the answer that cost the most, in concrete terms taken \
from that answer's verdict (if the learner stated a misreading, say what they said and what is \
true instead); never a vague "strengthen your understanding". Plain prose, no markup, lists, or \
numbers other than the score. Address the learner as "you"."""


async def _complete(system: str, user: str) -> str:
    from openai import AsyncOpenAI

    config = llm_config()
    client = AsyncOpenAI(api_key=config.require_key(), base_url=config.base_url)
    response = await client.chat.completions.create(
        model=config.model,
        **config.limits(400, temperature=0.1),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return response.choices[0].message.content or ""


async def _twice(attempt: Callable[[], Awaitable], what: str):
    """Run ``attempt``; on any failure run it once more, then raise JudgeError."""
    for tries_left in (1, 0):
        try:
            return await attempt()
        except Exception as e:
            logger.warning(
                f"judge: {what} failed ({e}); {'retrying' if tries_left else 'giving up'}"
            )
    raise JudgeError(f"{what} failed twice")


def _label(speaker: str) -> str:
    return "USER" if speaker == "user" else "BOT"


async def score_turn(
    *,
    speaker: str,
    user_theory: str,
    bot_theory: str,
    history: list[tuple[str, str]],
    turn: str,
    was_hit: bool,
    complete: Complete | None = None,
) -> TurnScore:
    complete = complete or _complete
    transcript = "\n".join(f"{_label(who)}: {text}" for who, text in history) or "(none yet)"
    prompt = (
        f"USER defends: {user_theory}\nBOT defends: {bot_theory}\n\n"
        f"Debate so far:\n{transcript}\n\n"
        f"Score this turn by {_label(speaker)}:\n{turn}"
    )

    async def attempt() -> TurnScore:
        return parse_score(await complete(SCORE_SYSTEM, prompt))

    score = await _twice(attempt, "scoring a turn")
    return score if was_hit else TurnScore(score.damage, 0, score.reason)


async def write_rationale(
    *,
    user_theory: str,
    bot_theory: str,
    health: dict[str, int],
    winner: str,
    hits: list[dict],
    complete: Complete | None = None,
) -> str:
    complete = complete or _complete
    result = {"user": "The challenger won.", "bot": "The house won.", "draw": "It is a draw."}[
        winner
    ]
    lines = (
        "\n".join(
            f"- {_label(h['by'])} dealt {h['damage']}, recovered {h['recovery']}: {h['reason']}"
            for h in hits
        )
        or "(no turns were scored)"
    )
    prompt = (
        f"The challenger (USER) defended: {user_theory}\nThe house (BOT) defended: {bot_theory}\n"
        f"Final health: challenger {health['user']}, house {health['bot']}. {result}\n\n"
        f"Scored turns, in order:\n{lines}"
    )

    async def attempt() -> str:
        text = (await complete(RATIONALE_SYSTEM, prompt)).strip()
        if not text:
            raise ValueError("empty rationale")
        return text

    return await _twice(attempt, "writing the rationale")


async def score_answer(
    *,
    theory: str,
    history: list[tuple[str, str]],
    answer: str,
    complete: Complete | None = None,
) -> TurnScore:
    """Sparring: score one answer. The question it answers is the last thing in ``history``."""
    complete = complete or _complete
    transcript = (
        "\n".join(f"{'PLAYER' if who == 'user' else 'EXAMINER'}: {text}" for who, text in history)
        or "(nothing yet)"
    )
    prompt = (
        f"The PLAYER holds: {theory}\n\n"
        f"The examination so far, ending with the question being answered:\n{transcript}\n\n"
        f"Score this answer by the PLAYER:\n{answer}"
    )

    async def attempt() -> TurnScore:
        return parse_score(await complete(ANSWER_SYSTEM, prompt))

    return await _twice(attempt, "scoring an answer")


async def write_finding(
    *, theory: str, health: int, hits: list[dict], complete: Complete | None = None
) -> str:
    """Sparring: the examiner's finding, in two spoken sentences."""
    complete = complete or _complete
    lines = (
        "\n".join(f"- lost {h['damage']}, won back {h['recovery']}: {h['reason']}" for h in hits)
        or "(no answers were scored)"
    )
    prompt = (
        f"The player held: {theory}\nIntegrity of the position at the end: {health} out of 100.\n\n"
        f"Each answer, in order:\n{lines}"
    )

    async def attempt() -> str:
        text = (await complete(FINDING_SYSTEM, prompt)).strip()
        if not text:
            raise ValueError("empty finding")
        return text

    return await _twice(attempt, "writing the finding")


async def score_understanding(
    *,
    theory: str,
    question: str,
    rubric: str,
    history: list[tuple[str, str]],
    answer: str,
    complete: Complete | None = None,
) -> TurnScore:
    """A lesson's check: score one answer against the card's rubric for that question."""
    complete = complete or _complete
    transcript = (
        "\n".join(f"{'LEARNER' if who == 'user' else 'TUTOR'}: {text}" for who, text in history)
        or "(nothing yet)"
    )
    prompt = (
        f"The theory being learned: {theory}\n\n"
        f"The check so far:\n{transcript}\n\n"
        f"The question: {question}\nA full answer covers: {rubric}\n\n"
        f"Score this answer by the LEARNER:\n{answer}"
    )

    async def attempt() -> TurnScore:
        return parse_score(await complete(UNDERSTANDING_SYSTEM, prompt))

    return await _twice(attempt, "scoring a check answer")


async def write_report(
    *,
    theory: str,
    health: int,
    steps: list[str],
    hits: list[dict],
    complete: Complete | None = None,
) -> str:
    """A lesson's report: what landed and what to go back over, in two spoken sentences."""
    complete = complete or _complete
    lines = (
        "\n".join(f"- lost {h['damage']}, won back {h['recovery']}: {h['reason']}" for h in hits)
        or "(no answers were scored)"
    )
    costliest = max(hits, key=lambda h: h["damage"])["reason"] if hits else "(none)"
    prompt = (
        f"The theory learned: {theory}\nGrasp at the end: {health} out of 100.\n"
        f"The lesson's steps, by title: {', '.join(steps) or '(none)'}\n\n"
        f"Each answer, in order:\n{lines}\n\n"
        f"The answer that cost the most: {costliest}"
    )

    async def attempt() -> str:
        text = (await complete(REPORT_SYSTEM, prompt)).strip()
        if not text:
            raise ValueError("empty report")
        return text

    return await _twice(attempt, "writing the report")
