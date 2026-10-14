"""The flight recorder: one JSON line per session event, for playtest/check.py.

Off unless ARMCHAIR_RECORD names a directory (bot.py decides). Files hold
transcripts of what the player said, so they stay on this machine.
"""

import json
import os
import time
from collections.abc import Callable
from pathlib import Path

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    FunctionCallResultFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed

_SPEECH = {
    UserStartedSpeakingFrame: "user_started",
    UserStoppedSpeakingFrame: "user_stopped",
    BotStartedSpeakingFrame: "bot_started",
    BotStoppedSpeakingFrame: "bot_stopped",
}


def _prune(directory: Path, keep: int) -> None:
    files = sorted(directory.glob("*.jsonl"))
    for old in files[: max(0, len(files) - keep)]:
        old.unlink(missing_ok=True)


class Recorder:
    def __init__(self, directory: Path, *, header: dict, keep: int = 50, clock=time.monotonic):
        directory = Path(directory).expanduser()
        directory.mkdir(parents=True, exist_ok=True)
        # Transcripts of what the player said: the owner's alone.
        directory.chmod(0o700)
        if keep > 0:
            _prune(directory, keep - 1)
        session = str(header.get("session") or "session")[:8]
        self.path = directory / f"{time.strftime('%Y%m%d-%H%M%S')}-{session}.jsonl"
        self._file = os.fdopen(os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), "a", encoding="utf-8")
        self._clock = clock
        self._t0 = clock()
        self._write({"t": 0, "kind": "header", "started": time.strftime("%Y-%m-%dT%H:%M:%S"), **header})

    def _write(self, record: dict) -> None:
        if self._file.closed:
            return
        self._file.write(json.dumps(record, default=str) + "\n")
        self._file.flush()

    def event(self, kind: str, **fields) -> None:
        self._write({"t": round(self._clock() - self._t0, 3), "kind": kind, **fields})

    def snapshot(self, state: dict) -> None:
        self.event("snapshot", state=state)

    def turn(self, by: str, text: str) -> None:
        self.event("user_text" if by == "user" else "bot_text", text=text)

    def close(self) -> None:
        self._file.close()


class RecorderObserver(BaseObserver):
    """Speech starts and stops, tool results, errors, and changes of flow node."""

    def __init__(self, recorder: Recorder, current_node: Callable[[], str | None]):
        super().__init__()
        self._recorder = recorder
        self._current_node = current_node
        self._node: str | None = None
        self._seen: set[int] = set()

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if frame.id in self._seen:
            return
        self._seen.add(frame.id)

        node = self._current_node()
        if node and node != self._node:
            self._node = node
            self._recorder.event("node", name=node)

        kind = _SPEECH.get(type(frame))
        if kind:
            self._recorder.event(kind)
        elif isinstance(frame, FunctionCallResultFrame):
            result = frame.result if isinstance(frame.result, dict) else {}
            self._recorder.event("tool", name=frame.function_name, args=frame.arguments, status=result.get("status"))
        elif isinstance(frame, ErrorFrame):
            self._recorder.event("error", message=str(frame.error))
