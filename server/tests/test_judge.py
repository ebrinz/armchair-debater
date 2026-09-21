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
        'prefix {"a": 1} suffix',
    ],
)
def test_parse_score_rejects_malformed(text):
    with pytest.raises(ValueError):
        judge.parse_score(text)


def test_parse_score_ignores_trailing_text_with_braces():
    text = '{"damage": 5, "recovery": 0, "reason": "Weak."} Let me know if you want {more} detail.'
    assert judge.parse_score(text) == TurnScore(5, 0, "Weak.")


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


class _RecordingOpenAI:
    """Stands in for ``openai.AsyncOpenAI``: records how it was built and called."""

    instances: list["_RecordingOpenAI"] = []

    def __init__(self, **kwargs):
        self.init = kwargs
        self.calls = []
        self.chat = type("Chat", (), {"completions": self})()
        _RecordingOpenAI.instances.append(self)

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        message = type("Message", (), {"content": "ok"})()
        return type("Response", (), {"choices": [type("Choice", (), {"message": message})()]})()


@pytest.fixture
def recording_openai(monkeypatch):
    import openai

    _RecordingOpenAI.instances = []
    monkeypatch.setattr(openai, "AsyncOpenAI", _RecordingOpenAI)
    return _RecordingOpenAI.instances


async def test_the_judge_calls_general_compute_by_default(monkeypatch, recording_openai):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("GENERAL_COMPUTE_MODEL", raising=False)
    monkeypatch.setenv("GENERAL_COMPUTE_API_KEY", "gc-key")

    assert await judge._complete("system", "user") == "ok"

    (client,) = recording_openai
    assert client.init == {"api_key": "gc-key", "base_url": "https://api.generalcompute.com/v1"}
    assert client.calls[0]["model"] == "deepseek-v3.2"
    assert client.calls[0]["max_tokens"] == 400
    assert client.calls[0]["temperature"] == 0.1


async def test_the_judge_follows_the_llm_provider_switch(monkeypatch, recording_openai):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "oa-key")
    monkeypatch.setenv("OPENAI_MODEL", "an-openai-model")

    await judge._complete("system", "user")

    (client,) = recording_openai
    assert client.init == {"api_key": "oa-key", "base_url": None}
    assert client.calls[0]["model"] == "an-openai-model"
    assert client.calls[0]["max_completion_tokens"] == 400
    assert "max_tokens" not in client.calls[0]


async def test_score_answer_shows_the_judge_the_question_and_reads_a_score():
    complete = scripted('{"damage": 9, "recovery": 4, "reason": "Half an answer."}')

    score = await judge.score_answer(
        theory="Global Workspace Theory",
        history=[("bot", "Would a broadcasting computer be conscious?")],
        answer="Maybe. It depends what you mean.",
        complete=complete,
    )

    assert score == TurnScore(9, 4, "Half an answer.")
    system, user = complete.calls[0]
    assert "examin" in system.lower() and "damage" in system
    assert "Would a broadcasting computer be conscious?" in user
    assert "Maybe. It depends what you mean." in user
    assert "Global Workspace Theory" in user


async def test_score_answer_retries_once_then_gives_up():
    with pytest.raises(JudgeError):
        await judge.score_answer(
            theory="T", history=[], answer="a", complete=scripted("nope", "still nope")
        )


async def test_write_finding_names_the_bar_and_the_costliest_question():
    complete = scripted("The view held, mostly.")

    text = await judge.write_finding(
        theory="Global Workspace Theory",
        health=80,
        hits=[{"by": "bot", "damage": 20, "recovery": 0, "reason": "Dodged the machine question."}],
        complete=complete,
    )

    assert text == "The view held, mostly."
    _, user = complete.calls[0]
    assert "80" in user and "Dodged the machine question." in user
