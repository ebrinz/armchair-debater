import pytest
from pipecat.flows import TRANSITION_IN_YAML
from pipecat.frames.frames import TTSSpeakFrame

import handlers
import judge
from debate_state import DebateState


class FakeScorer:
    def __init__(self, on_drain=None):
        self.log = []
        self._on_drain = on_drain

    def reset(self):
        self.log.append("reset")

    def close(self):
        self.log.append("close")

    async def drain(self):
        self.log.append("drain")
        if self._on_drain:
            await self._on_drain()


class FakeWorker:
    def __init__(self):
        self.frames = []

    async def queue_frames(self, frames):
        self.frames.extend(frames)


class FakeFlowManager:
    def __init__(self, scorer=None):
        self.state = {"debate": DebateState(), "scorer": scorer or FakeScorer()}
        self.worker = FakeWorker()


async def test_emit_stage_sets_the_stage():
    fm = FakeFlowManager()
    await handlers.emit_stage({"type": "emit_stage", "stage": "rebuttal"}, fm)
    assert fm.state["debate"].stage == "rebuttal"


async def test_set_positions_stores_cards_and_resets():
    fm = FakeFlowManager()
    result, nxt = await handlers.set_positions(fm, user_theory="GWT", bot_theory="iit")
    assert nxt is TRANSITION_IN_YAML
    assert result == {
        "status": "ok",
        "user_theory": "Global Workspace Theory",
        "bot_theory": "Integrated Information Theory",
    }
    assert fm.state["user_theory_name"] == "Global Workspace Theory"
    assert "Papers you may cite" in fm.state["bot_card"]
    assert "Tononi 2004" in fm.state["bot_card"]
    assert fm.state["scorer"].log == ["reset"]
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["user"]["theory_id"] == "gwt" and snapshot["bot"]["theory_id"] == "iit"


async def test_set_positions_substitutes_a_rival_when_bot_theory_is_not_one():
    fm = FakeFlowManager()
    result, _ = await handlers.set_positions(fm, user_theory="gwt", bot_theory="gwt")
    assert result["status"] == "ok"
    assert fm.state["debate"].snapshot()["bot"]["theory_id"] == "iit"


async def test_set_positions_reports_unknown_ids_without_touching_state():
    fm = FakeFlowManager()
    result, nxt = await handlers.set_positions(fm, user_theory="vibes", bot_theory="iit")
    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "unknown_theory"
    assert "gwt" in result["valid_ids"]
    assert "user_card" not in fm.state


async def ready_for_verdict(monkeypatch, write_rationale):
    monkeypatch.setattr(handlers, "write_rationale", write_rationale)

    async def late_hit():
        await fm.state["debate"].apply_hit("user", 20, 0, "The closing point.")

    fm = FakeFlowManager(scorer=FakeScorer(on_drain=late_hit))
    await handlers.set_positions(fm, user_theory="gwt", bot_theory="iit")
    fm.state["scorer"].log.clear()
    return fm


async def test_judge_debate_closes_speaks_drains_then_decides(monkeypatch):
    async def write_rationale(**kwargs):
        assert kwargs["winner"] == "user"  # the hit applied during drain() counted
        assert kwargs["health"] == {"user": 100, "bot": 80}
        return "The challenger closed strongly."

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    result, nxt = await handlers.judge_debate(fm)
    assert nxt is TRANSITION_IN_YAML
    assert fm.state["scorer"].log == ["close", "drain"]
    assert isinstance(fm.worker.frames[0], TTSSpeakFrame)
    assert fm.worker.frames[0].append_to_context is False
    assert result["status"] == "ok" and result["winner"] == "user"
    assert fm.state["debate"].snapshot()["verdict"] == {
        "winner": "user",
        "rationale": "The challenger closed strongly.",
    }
    assert "The challenger closed strongly." in fm.state["verdict_text"]
    assert "100" in fm.state["verdict_text"] and "80" in fm.state["verdict_text"]


async def test_judge_debate_falls_back_to_the_biggest_hit_when_the_judge_fails(monkeypatch):
    async def write_rationale(**kwargs):
        raise judge.JudgeError("down")

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    await handlers.judge_debate(fm)
    assert "The closing point." in fm.state["debate"].snapshot()["verdict"]["rationale"]


def test_fallback_rationale_with_no_hits():
    assert "could not" in handlers.fallback_rationale([])
