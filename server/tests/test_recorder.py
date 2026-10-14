import json
from types import SimpleNamespace

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    FunctionCallResultFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)

from pathlib import Path

import bot
from recorder import Recorder, RecorderObserver


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_the_recorder_writes_a_header_and_timed_events(tmp_path):
    clock = Clock()
    rec = Recorder(tmp_path / "sessions", header={"session": "abc123"}, clock=clock)
    clock.now = 101.5
    rec.snapshot({"stage": "mode"})
    rec.turn("user", "Hello.")
    rec.turn("bot", "Hi.")
    rec.close()

    events = lines(rec.path)
    assert events[0]["kind"] == "header" and events[0]["session"] == "abc123" and events[0]["t"] == 0
    assert events[1] == {"t": 1.5, "kind": "snapshot", "state": {"stage": "mode"}}
    assert [e["kind"] for e in events[2:]] == ["user_text", "bot_text"]


def test_the_recorder_creates_and_expands_its_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    rec = Recorder(Path("~/deep/sessions"), header={})
    assert rec.path.parent == tmp_path / "deep" / "sessions" and rec.path.exists()


def test_the_recorder_keeps_only_the_latest_sessions(tmp_path):
    for i in range(5):
        (tmp_path / f"2026010{i}-000000-x.jsonl").write_text("{}\n")
    Recorder(tmp_path, header={"session": "new"}, keep=3)
    assert len(list(tmp_path.glob("*.jsonl"))) == 3


async def push(observer, frame):
    await observer.on_push_frame(SimpleNamespace(frame=frame))


async def test_the_observer_records_speech_tools_errors_and_node_changes(tmp_path):
    rec = Recorder(tmp_path, header={})
    node = {"name": "mode_select"}
    observer = RecorderObserver(rec, current_node=lambda: node["name"])

    started = UserStartedSpeakingFrame()
    await push(observer, started)
    await push(observer, started)  # the same frame passing the next processor
    await push(observer, UserStoppedSpeakingFrame())
    node["name"] = "tutor_setup"
    await push(observer, BotStartedSpeakingFrame())
    await push(observer, BotStoppedSpeakingFrame())
    await push(observer, FunctionCallResultFrame(
        function_name="step_done", tool_call_id="1", arguments={}, result={"status": "more"}))
    await push(observer, ErrorFrame(error="boom"))
    rec.close()

    kinds = [(e["kind"], e.get("name") or e.get("status") or e.get("message")) for e in lines(rec.path)[1:]]
    assert kinds == [
        ("node", "mode_select"),
        ("user_started", None),
        ("user_stopped", None),
        ("node", "tutor_setup"),
        ("bot_started", None),
        ("bot_stopped", None),
        ("tool", "step_done"),
        ("error", "boom"),
    ]
    tool = [e for e in lines(rec.path) if e["kind"] == "tool"][0]
    assert tool["status"] == "more" and tool["args"] == {}


def test_the_bot_records_nothing_unless_asked(monkeypatch, tmp_path):
    monkeypatch.delenv("ARMCHAIR_RECORD", raising=False)
    assert bot._open_recorder(SimpleNamespace(session_id="s")) is None

    monkeypatch.setenv("ARMCHAIR_RECORD", str(tmp_path / "rec"))
    rec = bot._open_recorder(SimpleNamespace(session_id="s1"))
    rec.close()
    header = lines(rec.path)[0]
    assert header["session"] == "s1" and "commit" in header and "llm" in header
