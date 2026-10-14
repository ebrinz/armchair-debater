"""Rules for a recorded session timeline (see recorder.py and the playtest spec).

A timeline is a list of events, one per line of a recorder file, each with a
time ``t`` in seconds and a ``kind``. ``check`` returns every rule the timeline
breaks. No Pipecat imports: this reads JSON and flow.yaml, nothing else.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

FLOW_PATH = Path(__file__).parents[1] / "flow.yaml"

ANSWER_WITHIN = 12.0
# Kokoro, the local voice, takes about 4 s to voice a first sentence on a laptop
# CPU where Gradium takes a fraction of one; a local-speech session gets that back.
LOCAL_SPEECH_ALLOWANCE = 5.0
BARGE_IN_WITHIN = 1.5
STAGE_WITHIN = 1.0
SILENCE_WARN = 30.0
GUARDS = {"teach_first", "ask_first", "answer_first"}

_NUMBER_WORDS = (
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|"
    "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred"
)
SCORE_TALK = re.compile(
    rf"\bout of (?:one )?(?:hundred|100)\b"
    rf"|\b(?:score|health|grasp|integrity)\b[^.]{{0,25}}\b(?:\d+|{_NUMBER_WORDS})\b",
    re.IGNORECASE,
)
ACTIVITY = {"user_started", "user_text", "bot_started", "bot_text"}


@dataclass(frozen=True)
class Violation:
    rule: str
    severity: str  # "error" or "warn"
    t: float
    message: str


@dataclass(frozen=True)
class Graph:
    edges: dict[str, set[str]] = field(default_factory=dict)
    stages: dict[str, str] = field(default_factory=dict)
    initial: str = ""


def load(path) -> list[dict]:
    """A recorder file as a list of events."""
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def flow_graph(path: Path = FLOW_PATH) -> Graph:
    """Where each node can lead, and the stage each node shows, from flow.yaml."""
    config = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    edges: dict[str, set[str]] = {}
    stages: dict[str, str] = {}
    for name, node in config["nodes"].items():
        targets: set[str] = set()
        for function in node.get("functions") or []:
            target = function.get("transition_to")
            if isinstance(target, str):
                targets.add(target)
            elif isinstance(target, dict):
                targets.update(target.get("cases", {}).values())
        edges[name] = targets
        for action in node.get("pre_actions") or []:
            if action.get("type") == "emit_stage":
                stages[name] = action["stage"]
    return Graph(edges=edges, stages=stages, initial=config["initial_node"])


def errors(violations: list[Violation]) -> list[Violation]:
    return [v for v in violations if v.severity == "error"]


def _of(events, kind):
    return [e for e in events if e["kind"] == kind]


def _legal_path(events, graph):
    out, previous = [], None
    for e in _of(events, "node"):
        name = e["name"]
        if name not in graph.edges:
            out.append(Violation("legal-path", "error", e["t"], f"unknown node {name!r}"))
        elif previous is None and name != graph.initial:
            out.append(Violation("legal-path", "error", e["t"], f"began at {name!r}, not {graph.initial!r}"))
        elif previous is not None and name != previous and name not in graph.edges.get(previous, set()):
            out.append(Violation("legal-path", "error", e["t"], f"{previous!r} has no way to {name!r}"))
        previous = name
    return out


def _stage_follows_node(events, graph):
    out = []
    snapshots = _of(events, "snapshot")
    for e in _of(events, "node"):
        stage = graph.stages.get(e["name"])
        if stage is None:
            continue
        if not any(s["state"].get("stage") == stage and abs(s["t"] - e["t"]) <= STAGE_WITHIN for s in snapshots):
            out.append(Violation("stage-follows-node", "error", e["t"],
                                 f"entered {e['name']!r} but the screen never showed stage {stage!r}"))
    return out


def _steps_in_order(events):
    out = []
    for key, counter in (("lesson", "step"), ("question", "number")):
        previous = None
        for s in _of(events, "snapshot"):
            value = (s["state"].get(key) or {}).get(counter)
            if value is None:
                continue
            if previous is not None and value not in (previous, previous + 1, 1):
                out.append(Violation("steps-in-order", "error", s["t"], f"{key} {counter} went {previous} → {value}"))
            previous = value
    return out


def _answered(events, within=ANSWER_WITHIN):
    out = []
    end = events[-1]["t"] if events else 0.0
    for i, e in enumerate(events):
        if e["kind"] != "user_text" or end - e["t"] < within:
            continue
        for later in events[i + 1:]:
            if later["kind"] in ("bot_started", "bot_text", "user_started", "user_text"):
                if later["kind"] in ("bot_started", "bot_text") and later["t"] - e["t"] > within:
                    out.append(Violation("answered", "error", e["t"], f"no reply to {e['text']!r} for {later['t'] - e['t']:.0f} s"))
                break
        else:
            out.append(Violation("answered", "error", e["t"], f"no reply to {e['text']!r}"))
    return out


def _no_double_reply(events):
    out, replies = [], 0
    for e in events:
        if e["kind"] == "user_text":
            replies = 0
        elif e["kind"] == "bot_text":
            replies += 1
            if replies == 2:
                out.append(Violation("no-double-reply", "warn", e["t"], "a second reply before the user spoke again"))
    return out


def _barge_in(events):
    out, speaking = [], False
    for i, e in enumerate(events):
        if e["kind"] == "bot_started":
            speaking = True
        elif e["kind"] == "bot_stopped":
            speaking = False
        elif e["kind"] == "user_started" and speaking:
            stopped = next((x for x in events[i + 1:] if x["kind"] == "bot_stopped"), None)
            if stopped is None or stopped["t"] - e["t"] > BARGE_IN_WITHIN:
                out.append(Violation("barge-in", "error", e["t"], "the bot kept talking over the user"))
    return out


def _no_early_score(events):
    out, stage = [], None
    for e in events:
        if e["kind"] == "snapshot":
            stage = e["state"].get("stage")
        elif e["kind"] == "bot_text" and stage != "verdict" and SCORE_TALK.search(e["text"] or ""):
            out.append(Violation("no-early-score", "error", e["t"], f"a score before the verdict: {e['text'][:80]!r}"))
    return out


# A verdict is written while the last answer's stage still shows; the stage
# moves to "verdict" a moment later.
VERDICT_STAGES = {"verdict", "check", "sparring", "closing"}


def _earned_rung(events):
    out, previous = [], None
    for s in _of(events, "snapshot"):
        state = s["state"]
        if (state.get("verdict") or {}).get("winner") == "user":
            if state.get("stage") not in VERDICT_STAGES:
                out.append(Violation("earned-rung", "error", s["t"], f"a won verdict at stage {state.get('stage')!r}"))
            elif previous is not None and previous.get("mode") != state.get("mode"):
                out.append(Violation("earned-rung", "error", s["t"],
                                     f"a won verdict carried from {previous.get('mode')!r} into {state.get('mode')!r}"))
        previous = state
    return out


def _warnings(events):
    out = []
    for e in events:
        if e["kind"] == "tool" and e.get("status") in GUARDS:
            out.append(Violation("guard-fired", "warn", e["t"], f"{e['name']} answered {e['status']}"))
        elif e["kind"] == "error":
            out.append(Violation("errors", "warn", e["t"], e.get("message", "")[:120]))
    active = [e for e in events if e["kind"] in ACTIVITY]
    for a, b in zip(active, active[1:]):
        if b["t"] - a["t"] > SILENCE_WARN:
            out.append(Violation("long-silence", "warn", a["t"], f"nobody spoke for {b['t'] - a['t']:.0f} s"))
    return out


def check(events: list[dict], graph: Graph | None = None) -> list[Violation]:
    graph = graph or flow_graph()
    header = next((e for e in events if e.get("kind") == "header"), {})
    within = ANSWER_WITHIN + (LOCAL_SPEECH_ALLOWANCE if header.get("speech") == "local" else 0.0)
    events = [e for e in events if e.get("kind") != "header"]
    found = [
        *_legal_path(events, graph),
        *_stage_follows_node(events, graph),
        *_steps_in_order(events),
        *_answered(events, within),
        *_no_double_reply(events),
        *_barge_in(events),
        *_no_early_score(events),
        *_earned_rung(events),
        *_warnings(events),
    ]
    return sorted(found, key=lambda v: v.t)
