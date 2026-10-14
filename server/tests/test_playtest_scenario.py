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


def test_the_bot_is_started_the_way_armchair_starts_it(tmp_path):
    from playtest import driver

    command = driver.bot_command(7861)
    assert command[:3] == ["uv", "run", "bot.py"]
    assert command[command.index("--host") + 1] == "127.0.0.1"
    origins = command[command.index("--allowed-origins") + 1:]
    assert origins == ["http://127.0.0.1:7861", "http://localhost:7861"]

    env = driver.bot_env(7861, tmp_path, real_speech=False, base={})
    assert env["ARMCHAIR_LOCAL"] == "1" and env["ARMCHAIR_ORIGIN"] == "http://127.0.0.1:7861"
    assert env["ARMCHAIR_RECORD"] == str(tmp_path) and env["SPEECH_PROVIDER"] == "local"
    assert "SPEECH_PROVIDER" not in driver.bot_env(7861, tmp_path, real_speech=True, base={})


def test_a_missing_arcade_build_is_reported_before_any_bot_starts(tmp_path, monkeypatch):
    from playtest import driver

    monkeypatch.setattr(driver, "CLIENT_DIST", tmp_path / "nope")
    try:
        driver.require_build()
    except SystemExit as e:
        assert "./armchair --playtest" in str(e) or "npm run build" in str(e)
    else:
        raise AssertionError("expected SystemExit")


def test_scenarios_can_be_named_without_their_path():
    from playtest import driver

    paths = driver.resolve(["learn_happy", "playtest/scenarios/sparring_happy.yaml"])
    assert [p.name for p in paths] == ["learn_happy.yaml", "sparring_happy.yaml"]
    assert [p.name for p in driver.resolve([])][:1] == ["debate_from_lesson.yaml"]  # none named: all of them


def test_the_playtest_asks_for_local_speech_in_a_way_dotenv_cannot_undo(tmp_path):
    from playtest import driver

    env = driver.bot_env(7861, tmp_path, real_speech=False, base={})
    assert env["ARMCHAIR_SPEECH_PROVIDER"] == "local"
    assert "ARMCHAIR_SPEECH_PROVIDER" not in driver.bot_env(7861, tmp_path, real_speech=True, base={})


def test_a_session_that_was_not_local_is_a_failure_unless_real_speech_was_asked_for():
    from playtest import driver

    assert driver.speech_mismatch({"speech": "gradium"}, real_speech=False)
    assert driver.speech_mismatch({"speech": "local"}, real_speech=False) is None
    assert driver.speech_mismatch({"speech": "gradium"}, real_speech=True) is None


def test_a_bot_that_never_starts_fails_its_scenario_and_the_batch_goes_on(tmp_path, monkeypatch):
    from playtest import driver

    calls = []
    monkeypatch.setattr(driver, "RUNS", tmp_path)
    monkeypatch.setattr(driver, "require_build", lambda: None)

    def broken_start(port, record_dir, real_speech):
        calls.append(port)
        raise RuntimeError("the bot did not start; see bot.log")

    monkeypatch.setattr(driver, "_start_bot", broken_start)
    scenarios = driver.resolve(["menu_from_anywhere", "learn_ask_to_skip"])
    assert driver.main([str(p) for p in scenarios]) == 1
    assert len(calls) == 2  # the second scenario still ran


def test_a_bot_that_ignores_terminate_is_killed(monkeypatch):
    import subprocess

    from playtest import driver

    class Stubborn:
        def __init__(self):
            self.killed = False

        def terminate(self):
            pass

        def wait(self, timeout=None):
            if not self.killed and timeout is not None:
                raise subprocess.TimeoutExpired("bot", timeout)

        def kill(self):
            self.killed = True

    bot = Stubborn()
    driver.stop_bot(bot)
    assert bot.killed
