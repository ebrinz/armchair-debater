"""A playthrough script: steps to play against the bot, and what must be true after."""

from dataclasses import dataclass
from pathlib import Path

import yaml

WAIT_KEYS = {"bot_started", "bot_stopped", "quiet", "stage", "mode", "step", "question", "timeout"}
DEFAULT_TIMEOUT = 45.0


@dataclass(frozen=True)
class Scenario:
    name: str
    steps: list[dict]
    expect: dict


def _validate(step: dict) -> None:
    if not isinstance(step, dict) or len(step) != 1:
        raise ValueError(f"a step is one key: {step!r}")
    (kind, value), = step.items()
    if kind == "wait":
        if not isinstance(value, dict) or not set(value) <= WAIT_KEYS or not set(value) - {"timeout"}:
            raise ValueError(f"wait takes one of {sorted(WAIT_KEYS - {'timeout'})}: {value!r}")
    elif kind == "say":
        if not isinstance(value, str) or not value.strip():
            raise ValueError("say takes a line of text")
    elif kind == "say_after":
        if not isinstance(value, dict) or set(value) != {"seconds", "text"}:
            raise ValueError("say_after takes seconds and text")
    elif kind == "silence":
        if not isinstance(value, (int, float)) or value <= 0:
            raise ValueError("silence takes a number of seconds")
    else:
        raise ValueError(f"unknown step {kind!r}")


def load(path) -> Scenario:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    steps = raw.get("steps") or []
    for step in steps:
        _validate(step)
    return Scenario(name=raw["name"], steps=steps, expect=raw.get("expect") or {})


def expectation_failures(expect: dict, events: list[dict], violations) -> list[str]:
    failures = []
    snapshots = [e["state"] for e in events if e.get("kind") == "snapshot"]
    final = snapshots[-1] if snapshots else {}
    for key, field in (("final_stage", "stage"), ("final_mode", "mode")):
        if key in expect and final.get(field) != expect[key]:
            failures.append(f"{key}: wanted {expect[key]!r}, ended at {final.get(field)!r}")
    called = {e["name"] for e in events if e.get("kind") == "tool"}
    for tool in expect.get("tools_include", []):
        if tool not in called:
            failures.append(f"tools_include: {tool!r} was never called")
    allowed = set(expect.get("rules_allow", []))
    for v in violations:
        if v.rule not in allowed and (v.severity == "error" or v.rule in expect.get("rules_forbid", [])):
            failures.append(f"rule {v.rule} at {v.t:.1f}s: {v.message}")
    return failures
