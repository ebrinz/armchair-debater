"""Generate the state-contract fixtures from the real DebateState.

    uv run python make_fixtures.py          # rewrite docs/design/*-fixtures.json
    uv run python make_fixtures.py --check  # exit 1 if any file is out of date

The fixtures are the contract the client is built against (its mock replays
them), so they are produced by the same code the server runs rather than typed
by hand: the health numbers obey the balance rules because DebateState applied
them. A test runs the generator and compares, so a change to the rules that is
not followed by a regeneration fails loudly.
"""

import asyncio
import json
import sys
from pathlib import Path

from debate_state import DebateState

DESIGN = Path(__file__).parents[1] / "docs" / "design"

GWT = ("gwt", "Global Workspace Theory")
IIT = ("iit", "Integrated Information Theory")


class Recorder:
    """A DebateState that keeps only the snapshots a scenario asks for."""

    def __init__(self):
        self.state = DebateState()
        self.frames: list[dict] = []

    def keep(self) -> None:
        self.frames.append(self.state.snapshot())


async def debate() -> list[dict]:
    r = Recorder()
    s = r.state
    await s.set_stage("mode")
    r.keep()
    await s.set_mode("debate")
    r.keep()
    await s.set_stage("setup")
    r.keep()
    await s.set_positions(*GWT, *IIT)
    r.keep()  # the lock-in: both matched, the first round not yet begun
    await s.set_stage("opening")
    r.keep()

    # (stage the hit lands in, by, raw damage, raw recovery, reason). A user's hit
    # usually lands a stage late — the round advances about a second after they
    # stop talking and the judge takes a few — so the cross-examination answer
    # is scored once CLOSING has begun.
    turns = [
        (
            "opening",
            "bot",
            12,
            0,
            "Argued that broadcast explains access, not why access feels like anything.",
        ),
        ("opening", "user", 15, 0, "Pressed that phi cannot be computed for any real brain."),
        (
            "rebuttal",
            "bot",
            4,
            10,
            "Answered that intractable is not the same as ill-defined, but added little.",
        ),
        (
            "rebuttal",
            "user",
            22,
            4,
            "Used the logic-gate objection: a trivial grid would out-score a brain.",
        ),
        (
            "crossexam",
            "bot",
            5,
            8,
            "Named a result that would count against the theory, which steadied the position.",
        ),
        ("closing", "user", 3, 6, "Said that broadcast simply is the feeling, without saying why."),
        (
            "closing",
            "bot",
            10,
            5,
            "Turned the adversarial collaboration results against late prefrontal ignition.",
        ),
        (
            "closing",
            "user",
            14,
            0,
            "Closed on testability: workspace theory makes predictions that can fail.",
        ),
    ]
    for stage, by, damage, recovery, reason in turns:
        if s.stage != stage:
            await s.set_stage(stage)
            if stage == "crossexam":
                r.keep()  # the stage change itself: a new stage, the same last hit
        await s.apply_hit(by, damage, recovery, reason)
        r.keep()

    await s.set_stage("verdict")
    await s.set_verdict(
        "The logic-gate objection was never fully answered. "
        "The challenger also closed on the stronger point about testability."
    )
    r.keep()
    return r.frames


async def sparring() -> list[dict]:
    r = Recorder()
    s = r.state
    await s.set_stage("mode")
    r.keep()
    await s.set_mode("sparring")
    await s.set_stage("setup")
    r.keep()
    await s.set_solo(*GWT)
    r.keep()
    await s.set_stage("sparring")

    # (raw damage, raw recovery, reason) for the answer to each of five questions.
    answers = [
        (6, 0, "Asked why broadcast should feel like anything, said access simply is experience."),
        (
            18,
            0,
            "Asked whether a broadcasting computer would be conscious, would not say either way.",
        ),
        (3, 12, "Asked what would refute the theory, named late ignition failing to appear."),
        (
            14,
            0,
            "Asked about the adversarial collaboration's missing prefrontal signal, waved it away.",
        ),
        (5, 9, "Asked what the workspace is made of, gave the long-range neuron account."),
    ]
    for number, (damage, recovery, reason) in enumerate(answers, start=1):
        await s.set_question(number, len(answers))
        r.keep()  # the question is put
        await s.apply_answer(damage, recovery, reason)
        r.keep()  # the answer is scored

    await s.set_stage("verdict")
    await s.set_verdict(
        "The view is shaken but standing. The machine question did the most damage: "
        "it was never answered either way."
    )
    r.keep()
    return r.frames


async def explore() -> list[dict]:
    r = Recorder()
    s = r.state
    await s.set_stage("mode")
    r.keep()
    await s.set_mode("explore")
    await s.set_stage("explore")
    r.keep()
    for theory_id in ("iit", "gwt", "illusionism"):
        await s.set_focus(theory_id)
        r.keep()
    return r.frames


FIXTURES = {
    "debate-state-fixtures.json": debate,
    "sparring-state-fixtures.json": sparring,
    "explore-state-fixtures.json": explore,
}


def render(frames: list[dict]) -> str:
    return json.dumps(frames, indent=2) + "\n"


def generate() -> dict[str, str]:
    return {name: render(asyncio.run(make())) for name, make in FIXTURES.items()}


if __name__ == "__main__":
    stale = []
    for name, text in generate().items():
        path = DESIGN / name
        if "--check" in sys.argv:
            if not path.exists() or path.read_text() != text:
                stale.append(name)
        else:
            path.write_text(text)
            print(f"wrote {path.relative_to(DESIGN.parents[1])}")
    if stale:
        sys.exit(f"out of date: {', '.join(stale)} — run `uv run python make_fixtures.py`")
