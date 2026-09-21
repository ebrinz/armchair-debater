import asyncio

from debate_state import DebateState
from judge import JudgeError, TurnScore
from scorer import TurnScorer


class Rig:
    """A scorer wired to a fake judge whose replies the test controls."""

    def __init__(self):
        self.state = DebateState()
        self.stage = "opening"
        self.calls = []
        self.gates: dict[str, asyncio.Event] = {}
        self.failing: set[str] = set()
        self.crashing: set[str] = set()
        self.scorer = TurnScorer(
            self.state,
            current_stage=lambda: self.stage,
            theories=lambda: ("Global Workspace Theory", "Integrated Information Theory"),
            score=self.score,
        )

    async def score(self, **kwargs):
        self.calls.append(kwargs)
        if gate := self.gates.get(kwargs["turn"]):
            await gate.wait()
        if kwargs["turn"] in self.failing:
            raise JudgeError("down")
        if kwargs["turn"] in self.crashing:
            raise RuntimeError("boom")
        return TurnScore(10, 5 if kwargs["was_hit"] else 0, f"scored {kwargs['turn']}")


async def test_scores_are_applied_in_submission_order_even_if_the_first_is_slow():
    rig = Rig()
    rig.gates["first"] = asyncio.Event()
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await asyncio.sleep(0)
    assert rig.state.hits == []
    rig.gates["first"].set()
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored first", "scored second"]


async def test_history_excludes_the_turn_being_scored():
    rig = Rig()
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()
    assert rig.calls[0]["history"] == []
    assert rig.calls[1]["history"] == [("bot", "first")]
    assert rig.calls[1]["user_theory"] == "Global Workspace Theory"


async def test_was_hit_is_true_only_after_the_opponent_has_landed_a_hit():
    rig = Rig()
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    rig.scorer.submit("bot", "third")
    await rig.scorer.drain()
    assert [c["was_hit"] for c in rig.calls] == [False, True, True]
    assert rig.state.health == {"user": 63, "bot": 83}


async def test_turns_outside_debate_rounds_and_blank_turns_are_ignored():
    rig = Rig()
    rig.stage = "setup"
    rig.scorer.submit("user", "I think it is the brain.")
    rig.stage = "verdict"
    rig.scorer.submit("bot", "You win.")
    rig.stage = "opening"
    rig.scorer.submit("bot", "   ")
    await rig.scorer.drain()
    assert rig.calls == []


async def test_a_failed_score_is_skipped_and_later_turns_still_apply():
    rig = Rig()
    rig.failing.add("first")
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored second"]


async def test_close_stops_new_turns_and_reset_reopens_with_empty_history():
    rig = Rig()
    rig.scorer.submit("bot", "first")
    rig.scorer.close()
    rig.scorer.submit("user", "ignored")
    await rig.scorer.drain()
    assert len(rig.calls) == 1
    rig.scorer.reset()
    rig.scorer.submit("user", "fresh")
    await rig.scorer.drain()
    assert rig.calls[-1]["history"] == []


async def test_drain_with_nothing_submitted_returns():
    await Rig().scorer.drain()


async def test_an_unexpected_error_is_skipped_and_later_turns_still_apply():
    rig = Rig()
    rig.crashing.add("first")
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored second"]


async def test_an_apply_hit_failure_does_not_break_the_chain():
    rig = Rig()
    rig.scorer.submit("referee", "first")
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored second"]


async def test_reset_discards_turns_still_in_flight():
    rig = Rig()
    rig.gates["first"] = asyncio.Event()
    rig.scorer.submit("bot", "first")
    in_flight = rig.scorer._tail
    await asyncio.sleep(0)
    rig.scorer.reset()
    rig.gates["first"].set()
    for _ in range(5):
        await asyncio.sleep(0)
    await in_flight
    assert rig.state.hits == []
    rig.scorer.submit("user", "fresh")
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored fresh"]
    assert rig.calls[-1]["history"] == []


async def test_a_failure_reading_the_theories_skips_that_turn_and_never_escapes_drain():
    rig = Rig()
    broken = {"second"}

    def theories():
        if rig.scorer._transcript[-1][1] in broken:
            raise KeyError("user_theory_name")
        return ("Global Workspace Theory", "Integrated Information Theory")

    rig.scorer._theories = theories
    rig.scorer.submit("bot", "first")
    await rig.scorer.drain()
    # The LAST queued turn is the one drain() awaits directly.
    rig.scorer.submit("user", "second")

    await rig.scorer.drain()  # must not raise: judge_debate awaits this before the verdict

    assert [h["reason"] for h in rig.state.hits] == ["scored first"]


async def test_abandon_discards_the_turn_in_flight_and_refuses_new_ones():
    rig = Rig()
    rig.gates["first"] = asyncio.Event()
    rig.scorer.submit("bot", "first")
    await asyncio.sleep(0)

    rig.scorer.abandon()
    rig.gates["first"].set()
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()

    assert rig.state.hits == []
    assert [call["turn"] for call in rig.calls] == ["first"]


async def test_a_cross_examination_question_is_heard_but_not_scored():
    rig = Rig()
    rig.stage = "crossexam_question"
    rig.scorer.submit("bot", "Put one question to me.")
    rig.scorer.submit("user", "How would anyone ever measure phi in a brain?")
    await rig.scorer.drain()
    assert rig.state.hits == [] and rig.calls == []

    # The answer is scored, and the judge is shown the question it answers.
    rig.stage = "crossexam_answer"
    rig.scorer.submit("bot", "It is intractable, not undefined.")
    await rig.scorer.drain()

    assert [h["reason"] for h in rig.state.hits] == ["scored It is intractable, not undefined."]
    assert rig.calls[0]["history"] == [
        ("bot", "Put one question to me."),
        ("user", "How would anyone ever measure phi in a brain?"),
    ]


async def test_the_scorer_knows_who_has_been_heard_in_a_node_and_forgets_on_reset():
    rig = Rig()
    rig.stage = "crossexam_answer"
    assert rig.scorer.heard("crossexam_answer", "bot") == 0

    rig.scorer.submit("bot", "An answer, and a question.")
    rig.scorer.submit("user", "My answer.")
    await rig.scorer.drain()

    assert rig.scorer.heard("crossexam_answer", "bot") == 1
    assert rig.scorer.heard("crossexam_answer", "user") == 1
    assert rig.scorer.heard("closing", "bot") == 0

    rig.scorer.reset()
    assert rig.scorer.heard("crossexam_answer", "bot") == 0
