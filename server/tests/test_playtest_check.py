from playtest import check
from playtest.check import Violation

G = check.flow_graph()


def snap(t, stage, mode=None, *, lesson=None, question=None, verdict=None):
    state = {"stage": stage, "mode": mode, "lesson": lesson, "question": question, "verdict": verdict}
    return {"t": t, "kind": "snapshot", "state": state}


def ev(t, kind, **fields):
    return {"t": t, "kind": kind, **fields}


def rules(events):
    return {v.rule for v in check.check(events, G)}


def test_the_graph_is_read_from_flow_yaml():
    assert G.initial == "mode_select"
    assert "tutor_setup" in G.edges["mode_select"]
    assert G.edges["lesson"] >= {"lesson", "check"}
    assert G.stages["lesson"] == "lesson" and G.stages["lesson_report"] == "verdict"
    assert "crossexam_answer" not in G.stages


def test_a_clean_lesson_passes():
    events = [
        ev(0, "node", name="mode_select"), snap(0.1, "mode"),
        ev(1, "bot_started"), ev(1.1, "bot_text", text="Welcome."), ev(3, "bot_stopped"),
        ev(4, "user_started"), ev(5, "user_stopped"), ev(5.1, "user_text", text="Teach me GWT."),
        ev(6, "tool", name="choose_mode", args={"mode": "learn"}, status="learn"),
        ev(6.1, "node", name="tutor_setup"), snap(6.2, "setup", "learn"),
        ev(7, "tool", name="choose_lesson", args={"theory_id": "gwt"}, status="ok"),
        ev(7.1, "node", name="lesson"), snap(7.2, "lesson", "learn", lesson={"step": 1, "of": 4, "title": "The idea"}),
        ev(8, "bot_started"), ev(8.1, "bot_text", text="The idea is..."), ev(12, "bot_stopped"),
        ev(13, "user_started"), ev(14, "user_stopped"), ev(14.1, "user_text", text="Go on."),
        ev(15, "tool", name="step_done", args={}, status="more"),
        snap(15.1, "lesson", "learn", lesson={"step": 2, "of": 4, "title": "The terms"}),
        ev(16, "bot_started"), ev(16.1, "bot_text", text="The terms..."), ev(20, "bot_stopped"),
    ]
    assert check.check(events, G) == []


def test_an_illegal_jump_between_nodes():
    events = [ev(0, "node", name="mode_select"), ev(1, "node", name="closing")]
    assert "legal-path" in rules(events)


def test_the_first_node_must_be_the_front_door():
    assert "legal-path" in rules([ev(0, "node", name="lesson")])


def test_a_node_reentered_under_its_own_name_is_not_a_jump():
    events = [ev(0, "node", name="mode_select"), ev(1, "node", name="tutor_setup"),
              ev(2, "node", name="lesson"), snap(2.1, "lesson", "learn")]
    assert "legal-path" not in rules(events)


def test_a_node_whose_stage_never_reaches_the_screen():
    events = [ev(0, "node", name="mode_select"), snap(0.1, "mode"), ev(1, "node", name="tutor_setup")]
    assert "stage-follows-node" in rules(events)


def test_a_skipped_lesson_step_and_a_skipped_question():
    events = [snap(1, "lesson", lesson={"step": 1}), snap(2, "lesson", lesson={"step": 3})]
    assert "steps-in-order" in rules(events)
    events = [snap(1, "check", question={"number": 1}), snap(2, "check", question={"number": 3})]
    assert "steps-in-order" in rules(events)


def test_a_repeat_or_a_new_lesson_is_in_order():
    events = [snap(1, "lesson", lesson={"step": 2}), snap(2, "lesson", lesson={"step": 2}),
              snap(3, "lesson", lesson={"step": 1})]
    assert "steps-in-order" not in rules(events)


def test_a_user_turn_left_unanswered():
    # A reply that comes 20 s later is too late; the user speaking again first is not a miss.
    assert "answered" in rules([ev(0, "user_text", text="Hello?"), ev(20, "bot_started")])
    assert "answered" in rules([ev(0, "user_text", text="Hello?"), ev(20, "snapshot", state={})])
    assert "answered" not in rules([ev(0, "user_text", text="Hello?"), ev(20, "user_started")])


def test_a_turn_at_the_very_end_of_a_session_is_not_counted_as_unanswered():
    assert "answered" not in rules([ev(0, "bot_text", text="Hi."), ev(5, "user_text", text="Bye.")])


def test_two_replies_to_one_turn():
    events = [ev(0, "user_text", text="Hi."), ev(1, "bot_text", text="One."), ev(2, "bot_text", text="Two.")]
    found = [v for v in check.check(events, G) if v.rule == "no-double-reply"]
    assert found and found[0].severity == "warn"


def test_the_bot_keeps_talking_over_a_barge_in():
    events = [ev(0, "bot_started"), ev(2, "user_started"), ev(5, "bot_stopped")]
    assert "barge-in" in rules(events)
    events = [ev(0, "bot_started"), ev(2, "user_started"), ev(2.8, "bot_stopped")]
    assert "barge-in" not in rules(events)


def test_a_score_spoken_before_the_verdict():
    events = [snap(0, "lesson"), ev(1, "bot_text", text="Your grasp is seventy out of one hundred.")]
    assert "no-early-score" in rules(events)
    events = [snap(0, "verdict"), ev(1, "bot_text", text="Your grasp is seventy out of one hundred.")]
    assert "no-early-score" not in rules(events)
    events = [snap(0, "lesson"), ev(1, "bot_text", text="Grasp of this idea comes with practice.")]
    assert "no-early-score" not in rules(events)


def test_a_won_verdict_carried_into_another_mode():
    won = {"winner": "user", "rationale": "r"}
    events = [snap(0, "verdict", "learn", verdict=won), snap(1, "verdict", "sparring", verdict=won)]
    assert "earned-rung" in rules(events)
    assert "earned-rung" in rules([snap(0, "lesson", "learn", verdict=won)])
    assert "earned-rung" not in rules([snap(0, "verdict", "learn", verdict=won)])
    # The verdict is written while the last answer's stage still shows (found by
    # the debate_from_lesson playtest), in every mode: that is earned.
    for stage, mode in (("check", "learn"), ("sparring", "sparring"), ("closing", "debate")):
        assert "earned-rung" not in rules([snap(0, stage, mode), snap(1, stage, mode, verdict=won)]), stage


def test_guards_errors_and_silence_are_warnings():
    events = [ev(0, "tool", name="step_done", args={}, status="teach_first"),
              ev(1, "error", message="boom"), ev(2, "user_text", text="a"),
              ev(2.5, "bot_text", text="b"), ev(40, "user_text", text="c"), ev(41, "bot_text", text="d")]
    found = {v.rule: v.severity for v in check.check(events, G)}
    assert found["guard-fired"] == found["errors"] == found["long-silence"] == "warn"
    assert check.errors(check.check(events, G)) == []


def test_violations_come_back_in_time_order():
    events = [ev(0, "node", name="lesson"), ev(5, "error", message="x")]
    times = [v.t for v in check.check(events, G)]
    assert times == sorted(times)


def test_load_skips_blank_lines_and_keeps_the_header(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text('{"t": 0, "kind": "header", "session": "abc"}\n\n{"t": 1, "kind": "bot_started"}\n')
    events = check.load(path)
    assert [e["kind"] for e in events] == ["header", "bot_started"]


def test_local_speech_gets_extra_time_to_answer():
    # Kokoro on this Mac takes about 4 s to voice a first sentence; Gradium does not.
    late = [ev(0, "user_text", text="Hi."), ev(15, "bot_started"), ev(30, "user_started")]
    assert "answered" in rules(late)
    assert "answered" not in rules([{"t": 0, "kind": "header", "speech": "local"}, *late])
    too_late = [{"t": 0, "kind": "header", "speech": "local"}, ev(0, "user_text", text="Hi."), ev(18, "bot_started")]
    assert "answered" in rules(too_late)
