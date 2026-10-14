import pytest

from playtest import scenario
from playtest.check import Violation


def test_a_scenario_loads_and_validates_its_steps(tmp_path):
    path = tmp_path / "s.yaml"
    path.write_text(
        "name: s\nsteps:\n"
        "  - wait: {bot_stopped: 1}\n  - say: Hello.\n"
        "  - say_after: {seconds: 1.5, text: Wait.}\n  - silence: 3\n"
        "  - wait: {stage: lesson, timeout: 60}\n  - wait: {quiet: 3}\n"
        "expect: {final_stage: verdict}\n"
    )
    s = scenario.load(path)
    assert s.name == "s" and len(s.steps) == 6 and s.expect == {"final_stage": "verdict"}


@pytest.mark.parametrize("step", ["  - dance: 1\n", "  - wait: {colour: red}\n", "  - say_after: {text: x}\n"])
def test_an_unknown_step_is_refused(tmp_path, step):
    path = tmp_path / "s.yaml"
    path.write_text("name: s\nsteps:\n" + step)
    with pytest.raises(ValueError):
        scenario.load(path)


def test_expectations_are_checked_against_the_timeline():
    events = [
        {"t": 1, "kind": "tool", "name": "choose_lesson", "status": "ok"},
        {"t": 2, "kind": "snapshot", "state": {"stage": "verdict", "mode": "learn"}},
    ]
    violations = [Violation("guard-fired", "warn", 1, "x"), Violation("barge-in", "error", 1, "y")]
    expect = {"final_stage": "verdict", "final_mode": "learn", "tools_include": ["choose_lesson", "step_done"],
              "rules_allow": ["guard-fired"]}
    failures = scenario.expectation_failures(expect, events, violations)
    assert any("step_done" in f for f in failures)
    assert any("barge-in" in f for f in failures)
    assert not any("guard-fired" in f for f in failures)
    assert not any("final_stage" in f for f in failures)
