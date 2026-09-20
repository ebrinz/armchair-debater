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
