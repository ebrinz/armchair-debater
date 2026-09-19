import pytest

import judge
from judge import JudgeError, TurnScore


def scripted(*replies):
    """A fake LLM returning each reply in turn; exceptions are raised."""
    calls = []
    queue = list(replies)

    async def complete(system: str, user: str) -> str:
        calls.append((system, user))
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    complete.calls = calls
    return complete


def test_parse_score_reads_plain_json():
    assert judge.parse_score('{"damage": 12, "recovery": 3, "reason": "Good point."}') == TurnScore(
        12, 3, "Good point."
    )


def test_parse_score_finds_json_inside_prose_and_fences():
    text = 'Sure:\n```json\n{"damage": 5, "recovery": 0, "reason": "Weak."}\n```'
    assert judge.parse_score(text) == TurnScore(5, 0, "Weak.")


@pytest.mark.parametrize(
    "text",
    [
        "no json here",
        '{"damage": 5}',
        '{"damage": "lots", "recovery": 0, "reason": "x"}',
        '{"damage": 5, "recovery": 0, "reason": ""}',
        '{"damage": true, "recovery": 0, "reason": "x"}',
    ],
)
def test_parse_score_rejects_malformed(text):
    with pytest.raises(ValueError):
        judge.parse_score(text)


async def score(complete, **overrides):
    args = dict(
        speaker="user",
        user_theory="Global Workspace Theory",
        bot_theory="Integrated Information Theory",
        history=[("bot", "Phi is what matters.")],
        turn="Phi cannot be computed.",
        was_hit=True,
        complete=complete,
    )
    args.update(overrides)
    return await judge.score_turn(**args)


async def test_score_turn_sends_the_turn_and_history():
    complete = scripted('{"damage": 18, "recovery": 4, "reason": "Landed."}')
    result = await score(complete)
    assert result == TurnScore(18, 4, "Landed.")
    system, user = complete.calls[0]
    assert "Phi cannot be computed." in user
    assert "Phi is what matters." in user
    assert "Global Workspace Theory" in user
    assert "plausible" in system  # the judge is told not to score by plausibility


async def test_recovery_is_zero_when_speaker_was_never_hit():
    complete = scripted('{"damage": 10, "recovery": 9, "reason": "x"}')
    assert (await score(complete, was_hit=False)).recovery == 0


async def test_score_turn_retries_once_then_succeeds():
    complete = scripted("garbage", '{"damage": 1, "recovery": 0, "reason": "ok"}')
    assert (await score(complete)).damage == 1
    assert len(complete.calls) == 2


async def test_score_turn_raises_after_two_failures():
    complete = scripted(RuntimeError("down"), "garbage")
    with pytest.raises(JudgeError):
        await score(complete)
    assert len(complete.calls) == 2


async def rationale(complete):
    return await judge.write_rationale(
        user_theory="Global Workspace Theory",
        bot_theory="Integrated Information Theory",
        health={"user": 74, "bot": 61},
        winner="user",
        hits=[{"by": "user", "damage": 22, "recovery": 6, "reason": "Expander graphs."}],
        complete=complete,
    )


async def test_write_rationale_returns_stripped_text_and_sees_the_hits():
    complete = scripted("  The user won on testability.  ")
    assert await rationale(complete) == "The user won on testability."
    assert "Expander graphs." in complete.calls[0][1]
    assert "74" in complete.calls[0][1]


async def test_write_rationale_retries_on_empty_then_raises():
    with pytest.raises(JudgeError):
        await rationale(scripted("", "   "))
