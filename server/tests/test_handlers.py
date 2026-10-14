from pipecat.flows import TRANSITION_IN_YAML
from pipecat.frames.frames import TTSSpeakFrame

import handlers
import judge
from debate_state import DebateState


class FakeScorer:
    def __init__(self, on_drain=None):
        self.log = []
        self.heard_turns = {}
        self._on_drain = on_drain

    def reset(self):
        self.log.append("reset")

    def close(self):
        self.log.append("close")

    def heard(self, node, by):
        return self.heard_turns.get((node, by), 0)

    def answer_complete(self, node):
        self.log.append(f"answer_complete:{node}")

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
        assert kwargs["health"] == {"user": 100, "bot": 60}
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
    assert "100" in fm.state["verdict_text"] and "60" in fm.state["verdict_text"]


async def test_judge_debate_falls_back_to_the_biggest_hit_when_the_judge_fails(monkeypatch):
    async def write_rationale(**kwargs):
        raise judge.JudgeError("down")

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    await handlers.judge_debate(fm)
    assert "The closing point." in fm.state["debate"].snapshot()["verdict"]["rationale"]


def test_fallback_rationale_with_no_hits():
    assert "could not" in handlers.fallback_rationale([])


async def test_judge_debate_called_twice_decides_once(monkeypatch):
    import asyncio

    calls = []

    async def write_rationale(**kwargs):
        calls.append(kwargs)
        await asyncio.sleep(0)
        return "The challenger closed strongly."

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    (first, _), (second, _) = await asyncio.gather(
        handlers.judge_debate(fm), handlers.judge_debate(fm)
    )
    third, nxt = await handlers.judge_debate(fm)

    assert len(calls) == 1
    assert len(fm.worker.frames) == 1
    assert fm.state["scorer"].log == ["close", "drain"]
    assert first == second == third and first["status"] == "ok"
    assert nxt is TRANSITION_IN_YAML


async def test_a_rematch_is_judged_afresh(monkeypatch):
    calls = []

    async def write_rationale(**kwargs):
        calls.append(kwargs)
        return "A rationale."

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    await handlers.judge_debate(fm)
    await handlers.set_positions(fm, user_theory="iit", bot_theory="gwt")
    await handlers.judge_debate(fm)

    assert len(calls) == 2


async def test_a_crash_while_deciding_is_not_remembered_so_a_retry_can_succeed(monkeypatch):
    import pytest

    attempts = []

    async def write_rationale(**kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:
            raise RuntimeError("not a JudgeError: nothing catches this")
        return "Second time lucky."

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    with pytest.raises(RuntimeError):
        await handlers.judge_debate(fm)

    result, _ = await handlers.judge_debate(fm)

    assert result["status"] == "ok"
    assert fm.state["debate"].snapshot()["verdict"]["rationale"] == "Second time lucky."


async def test_answer_given_waits_until_the_house_has_answered_and_asked():
    # A barge-in during the house's answer leaves it with no finished turn in
    # this node; what the user said then is not an answer to a question they
    # have not been asked.
    fm = FakeFlowManager()

    result, nxt = await handlers.answer_given(fm)
    assert result["status"] == "answer_first"
    assert nxt is TRANSITION_IN_YAML

    fm.state["scorer"].heard_turns[("crossexam_answer", "bot")] = 1
    result, _ = await handlers.answer_given(fm)
    assert result["status"] == "ok"


async def test_use_voice_does_nothing_when_no_judge_voice_is_configured(monkeypatch):
    monkeypatch.setattr(handlers.providers, "voices", lambda: None)
    fm = FakeFlowManager()

    await handlers.use_voice({"type": "use_voice", "who": "judge"}, fm)

    assert fm.worker.frames == []


async def test_use_voice_switches_the_tts_voice_with_a_frame_in_order(monkeypatch):
    from pipecat.frames.frames import TTSUpdateSettingsFrame

    monkeypatch.setattr(handlers.providers, "voices", lambda: {"house": "h", "judge": "j"})
    fm = FakeFlowManager()

    await handlers.use_voice({"type": "use_voice", "who": "judge"}, fm)
    await handlers.use_voice({"type": "use_voice", "who": "house"}, fm)

    assert [type(f) for f in fm.worker.frames] == [TTSUpdateSettingsFrame, TTSUpdateSettingsFrame]
    assert [f.delta.voice for f in fm.worker.frames] == ["j", "h"]


# --- the front door ------------------------------------------------------------


async def test_choose_mode_records_the_mode_and_reports_it_for_the_flow_to_branch_on():
    fm = FakeFlowManager()

    for mode in ("debate", "sparring", "explore"):
        result, nxt = await handlers.choose_mode(fm, mode=mode)
        assert result == {"status": mode}
        assert nxt is TRANSITION_IN_YAML
        assert fm.state["debate"].snapshot()["mode"] == mode


async def test_choose_mode_turns_down_anything_else_and_stays_put():
    fm = FakeFlowManager()

    result, _ = await handlers.choose_mode(fm, mode="karaoke")

    assert result["status"] == "unknown_mode"
    assert result["valid_modes"] == ["debate", "sparring", "explore", "learn"]
    assert fm.state["debate"].snapshot()["mode"] is None


# --- sparring -------------------------------------------------------------------


async def sparring_at(question: int, monkeypatch, heard_by_examiner: int | None = None):
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("sparring")
    await handlers.take_position(fm, user_theory="gwt")
    fm.state["spar_q"] = question
    fm.state["scorer"].heard_turns[("sparring", "bot")] = (
        question if heard_by_examiner is None else heard_by_examiner
    )
    fm.state["scorer"].log.clear()
    return fm


async def test_take_position_seats_the_player_alone_and_resets():
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("sparring")

    result, nxt = await handlers.take_position(fm, user_theory="gwt")

    assert result == {"status": "ok", "user_theory": "Global Workspace Theory"}
    assert nxt is TRANSITION_IN_YAML
    assert fm.state["scorer"].log == ["reset"]
    assert fm.state["spar_q"] == 1
    assert fm.state["user_theory_name"] == "Global Workspace Theory"
    assert fm.state["bot_theory_name"] == "The Examiner"
    assert "Known objections" in fm.state["user_card"]
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["user"]["theory_id"] == "gwt" and snapshot["bot"]["theory_id"] is None


async def test_take_position_reports_an_unknown_id():
    fm = FakeFlowManager()
    result, _ = await handlers.take_position(fm, user_theory="nope")
    assert result["status"] == "unknown_theory"


async def test_answer_heard_moves_to_the_next_question(monkeypatch):
    fm = await sparring_at(2, monkeypatch)

    result, nxt = await handlers.answer_heard(fm)

    assert result == {"status": "more", "question": 3, "of": 5}
    assert nxt is TRANSITION_IN_YAML
    assert fm.state["spar_q"] == 3


async def test_answer_heard_waits_until_the_examiner_has_asked(monkeypatch):
    # Two questions asked so far, and this is the third visit: a barge-in before
    # the third question is not an answer to it.
    fm = await sparring_at(3, monkeypatch, heard_by_examiner=2)

    result, _ = await handlers.answer_heard(fm)

    assert result["status"] == "ask_first"
    assert fm.state["spar_q"] == 3


async def test_the_fifth_answer_brings_the_finding(monkeypatch):
    async def write_finding(**kwargs):
        assert kwargs["theory"] == "Global Workspace Theory"
        assert kwargs["health"] == 80
        return "Shaken but standing."

    monkeypatch.setattr(handlers, "write_finding", write_finding)
    fm = await sparring_at(5, monkeypatch)
    await fm.state["debate"].apply_answer(20, 0, "Dodged the machine question.")

    first, _ = await handlers.answer_heard(fm)
    again, _ = await handlers.answer_heard(fm)  # a repeat decides nothing new

    assert first == again == {"status": "done", "integrity": 80, "holds": True}
    assert fm.state["scorer"].log == ["answer_complete:sparring", "close", "drain", "answer_complete:sparring"]
    assert len(fm.worker.frames) == 1 and isinstance(fm.worker.frames[0], TTSSpeakFrame)
    assert fm.state["debate"].snapshot()["verdict"] == {
        "winner": "user",
        "rationale": "Shaken but standing.",
    }
    assert "80" in fm.state["finding_text"] and "Shaken but standing." in fm.state["finding_text"]


async def test_the_finding_falls_back_to_the_question_that_cost_most(monkeypatch):
    async def write_finding(**kwargs):
        raise handlers.JudgeError("down")

    monkeypatch.setattr(handlers, "write_finding", write_finding)
    fm = await sparring_at(5, monkeypatch)
    await fm.state["debate"].apply_answer(4, 0, "A small slip.")
    await fm.state["debate"].apply_answer(21, 0, "Could not say what would refute it.")

    await handlers.answer_heard(fm)

    assert (
        "Could not say what would refute it."
        in (fm.state["debate"].snapshot()["verdict"]["rationale"])
    )


# --- the explorer ---------------------------------------------------------------


async def test_show_theory_focuses_the_card_and_hands_over_all_of_it():
    fm = FakeFlowManager()

    result, nxt = await handlers.show_theory(fm, theory_id="iit")

    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "shown"
    assert "Known objections" in result["card"] and "Papers you may cite" in result["card"]
    assert result["rivals"] == ["Global Workspace Theory", "Illusionism", "Attention Schema Theory"]
    assert fm.state["debate"].snapshot()["focus"] == "iit"


async def test_show_theory_reports_an_unknown_id_and_leaves_the_focus_alone():
    fm = FakeFlowManager()
    await handlers.show_theory(fm, theory_id="iit")

    result, _ = await handlers.show_theory(fm, theory_id="nope")

    assert result["status"] == "unknown_theory" and "iit" in result["valid_ids"]
    assert fm.state["debate"].snapshot()["focus"] == "iit"


# --- the tutor ------------------------------------------------------------------


async def lesson_at(step: int, heard_by_tutor: int | None = None):
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("learn")
    await handlers.choose_lesson(fm, theory_id="gwt")
    fm.state["lesson_step"] = step
    fm.state["scorer"].heard_turns[("lesson", "bot")] = (
        step if heard_by_tutor is None else heard_by_tutor
    )
    fm.state["scorer"].log.clear()
    return fm


async def check_at(question: int, heard_by_tutor: int | None = None):
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("learn")
    await handlers.choose_lesson(fm, theory_id="gwt")
    fm.state["check_q"] = question
    fm.state["scorer"].heard_turns[("check", "bot")] = (
        question if heard_by_tutor is None else heard_by_tutor
    )
    fm.state["scorer"].log.clear()
    return fm


async def test_choose_mode_knows_learn():
    fm = FakeFlowManager()
    result, _ = await handlers.choose_mode(fm, mode="learn")
    assert result == {"status": "learn"}
    assert fm.state["debate"].snapshot()["mode"] == "learn"


async def test_choose_lesson_seats_the_tutor_and_opens_step_one():
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("learn")
    fm.state.update(check_q=3, report_task="stale")

    result, nxt = await handlers.choose_lesson(fm, theory_id="GWT")

    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "ok" and result["theory"] == "Global Workspace Theory"
    assert result["steps"] == ["The idea", "The terms", "The case for it", "What it's up against"]
    assert fm.state["scorer"].log == ["reset"]
    assert fm.state["lesson_theory"] == "gwt"
    assert (fm.state["lesson_step"], fm.state["check_q"]) == (1, 1)
    assert fm.state["lesson_title"] == "The idea"
    assert "in plain words" in fm.state["lesson_material"]
    # The first check question is ready before the node that asks it is entered:
    # Flows renders a node's prompt from state as it enters, before pre-actions.
    assert fm.state["check_question"].startswith("In your own words")
    assert fm.state["bot_theory_name"] == "The Tutor"
    assert "report_task" not in fm.state
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["user"]["theory_id"] == "gwt" and snapshot["bot"]["theory_name"] == "The Tutor"
    assert snapshot["user"]["health"] == 100


async def test_choose_lesson_reports_an_unknown_id():
    fm = FakeFlowManager()
    result, _ = await handlers.choose_lesson(fm, theory_id="nope")
    assert result["status"] == "unknown_theory" and "gwt" in result["valid_ids"]


async def test_emit_step_tells_the_client_where_the_lesson_is():
    fm = await lesson_at(2)
    fm.state["lesson_title"] = "The terms"
    await handlers.emit_step({"type": "emit_step"}, fm)
    assert fm.state["debate"].snapshot()["lesson"] == {"step": 2, "of": 4, "title": "The terms"}


async def test_step_done_moves_to_the_next_step_with_its_material():
    fm = await lesson_at(2)

    result, nxt = await handlers.step_done(fm)

    assert result == {"status": "more", "step": 3, "of": 4, "title": "The case for it"}
    assert nxt is TRANSITION_IN_YAML
    assert fm.state["lesson_step"] == 3
    assert "arguments for it" in fm.state["lesson_material"]


async def test_step_done_waits_until_the_tutor_has_taught():
    fm = await lesson_at(3, heard_by_tutor=2)
    result, _ = await handlers.step_done(fm)
    assert result["status"] == "teach_first"
    assert fm.state["lesson_step"] == 3


async def test_the_fourth_step_done_opens_the_check():
    fm = await lesson_at(4)
    fm.state["check_q"] = 2  # a stale value from an earlier lesson
    fm.state["check_question"] = "stale"
    result, _ = await handlers.step_done(fm)
    assert result == {"status": "done"}
    assert fm.state["check_q"] == 1
    assert fm.state["check_question"].startswith("In your own words")
    assert "broadcast" in fm.state["check_rubric"]


async def test_emit_check_resets_the_scorer_on_the_first_question_and_tells_the_client():
    fm = await check_at(1)
    await handlers.emit_check({"type": "emit_check"}, fm)
    assert fm.state["scorer"].log == ["reset"]
    assert fm.state["debate"].snapshot()["question"] == {"number": 1, "of": 3}

    # The second and third questions do not reset the exam's transcript.
    fm.state["check_q"] = 2
    fm.state["scorer"].log.clear()
    await handlers.emit_check({"type": "emit_check"}, fm)
    assert fm.state["scorer"].log == []
    assert fm.state["debate"].snapshot()["question"] == {"number": 2, "of": 3}


async def test_check_answered_moves_to_the_next_question_and_readies_it():
    fm = await check_at(1)
    result, _ = await handlers.check_answered(fm)
    assert result == {"status": "more", "question": 2, "of": 3}
    assert fm.state["check_q"] == 2
    # The card's first check, and its rubric, are in state before the node re-enters.
    assert fm.state["check_question"].endswith("?")
    assert "In your own words" not in fm.state["check_question"]
    assert "ignition" in fm.state["check_rubric"]


async def test_check_answered_waits_until_the_tutor_has_asked():
    fm = await check_at(2, heard_by_tutor=1)
    result, _ = await handlers.check_answered(fm)
    assert result["status"] == "ask_first"
    assert fm.state["check_q"] == 2


async def test_the_third_answer_brings_the_report(monkeypatch):
    async def write_report(**kwargs):
        assert kwargs["theory"] == "Global Workspace Theory"
        assert kwargs["health"] == 84
        assert kwargs["steps"] == ["The idea", "The terms", "The case for it", "What it's up against"]
        return "You have the broadcast. Go back over The terms."

    monkeypatch.setattr(handlers, "write_report", write_report)
    fm = await check_at(3)
    await fm.state["debate"].apply_answer(16, 0, "Described a local response.")

    first, _ = await handlers.check_answered(fm)
    again, _ = await handlers.check_answered(fm)

    assert first == again == {"status": "done", "grasp": 84, "got_it": True}
    assert fm.state["scorer"].log == ["answer_complete:check", "close", "drain", "answer_complete:check"]
    assert len(fm.worker.frames) == 1 and isinstance(fm.worker.frames[0], TTSSpeakFrame)
    assert fm.state["debate"].snapshot()["verdict"] == {
        "winner": "user",
        "rationale": "You have the broadcast. Go back over The terms.",
    }
    assert "84" in fm.state["report_text"] and "got it" in fm.state["report_text"]


async def test_the_report_falls_back_to_the_question_with_the_biggest_gap(monkeypatch):
    async def write_report(**kwargs):
        raise handlers.JudgeError("down")

    monkeypatch.setattr(handlers, "write_report", write_report)
    fm = await check_at(3)
    await fm.state["debate"].apply_answer(4, 0, "A small slip.")
    await fm.state["debate"].apply_answer(21, 0, "Stated the misreading as the theory.")

    await handlers.check_answered(fm)

    assert (
        "Stated the misreading as the theory."
        in fm.state["debate"].snapshot()["verdict"]["rationale"]
    )


def test_fallback_report_with_no_hits():
    assert "could not score" in handlers.fallback_report([])


async def test_spar_this_switches_the_mode_and_seats_the_player_for_sparring():
    fm = await check_at(3)
    result, nxt = await handlers.spar_this(fm)
    assert nxt is TRANSITION_IN_YAML
    assert result == {"status": "ok", "user_theory": "Global Workspace Theory"}
    assert fm.state["spar_q"] == 1
    assert fm.state["bot_theory_name"] == "The Examiner"
    assert fm.state["scorer"].log == ["reset"]
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["mode"] == "sparring"
    assert snapshot["user"]["theory_id"] == "gwt"
    assert snapshot["bot"]["theory_name"] == "The Examiner"


async def test_debate_this_switches_the_mode_and_tells_the_llm_what_the_user_holds():
    fm = await check_at(3)
    result, nxt = await handlers.debate_this(fm)
    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "ok" and result["user_theory"] == "gwt"
    assert "set_positions" in result["instruction"] and "gwt" in result["instruction"]
    assert fm.state["debate"].snapshot()["mode"] == "debate"


async def test_the_hand_offs_never_emit_the_lessons_verdict_under_the_new_mode():
    """The client lights a rung on any snapshot with a won verdict in a scored
    mode, so the lesson's verdict must be gone before the mode changes."""
    for hand_off in (handlers.spar_this, handlers.debate_this):
        fm = await check_at(3)
        seen = []

        async def on_change(snapshot):
            seen.append(snapshot)

        fm.state["debate"]._on_change = on_change
        await fm.state["debate"].set_verdict("You have got it.")
        seen.clear()

        await hand_off(fm)

        assert seen, hand_off.__name__
        for snapshot in seen:
            assert snapshot["verdict"] is None, (hand_off.__name__, snapshot["mode"])



async def test_an_answer_is_completed_before_the_examiner_moves_on():
    fm = await sparring_at(2, None)
    await handlers.answer_heard(fm)
    assert fm.state["scorer"].log == ["answer_complete:sparring"]


async def test_a_barge_in_completes_no_answer():
    fm = await sparring_at(3, None, heard_by_examiner=2)
    await handlers.answer_heard(fm)
    assert fm.state["scorer"].log == []


async def test_a_check_answer_is_completed_while_its_rubric_is_still_current():
    fm = await check_at(1)
    rubric_when_completed = []
    scorer = fm.state["scorer"]
    scorer.answer_complete = lambda node: rubric_when_completed.append(fm.state["check_rubric"])
    first_rubric = fm.state["check_rubric"]
    await handlers.check_answered(fm)
    assert rubric_when_completed == [first_rubric]
    assert fm.state["check_rubric"] != first_rubric  # and only then did it move on
