import json
from pathlib import Path

import pytest

from debate_state import DebateState

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "docs/design/debate-state-fixtures.json").read_text()
)


async def started() -> DebateState:
    state = DebateState()
    await state.set_positions(
        "gwt", "Global Workspace Theory", "iit", "Integrated Information Theory"
    )
    return state


def keys(value):
    """The nested key structure of a snapshot, ignoring values."""
    if isinstance(value, dict):
        return {k: keys(v) for k, v in value.items()}
    return None


async def test_initial_snapshot_matches_first_fixture():
    assert DebateState().snapshot() == FIXTURES[0]


async def test_snapshot_shape_matches_final_fixture():
    state = await started()
    await state.set_stage("closing")
    await state.apply_hit("user", 14, 0, "reason")
    await state.set_stage("verdict")
    await state.set_verdict("rationale")
    assert keys(state.snapshot()) == keys(FIXTURES[-1])


async def test_hit_damages_opponent_and_heals_speaker():
    state = await started()
    await state.apply_hit("bot", 14, 0, "r1")
    await state.apply_hit("user", 18, 6, "r2")
    assert state.health == {"user": 92, "bot": 82}
    assert state.snapshot()["last_hit"] == {
        "by": "user",
        "damage": 18,
        "recovery": 6,
        "reason": "r2",
    }
    assert len(state.hits) == 2


async def test_values_are_clamped():
    state = await started()
    await state.apply_hit("user", 999, 999, "too much")
    assert state.health == {"user": 100, "bot": 75}
    assert state.snapshot()["last_hit"]["damage"] == 25
    assert state.snapshot()["last_hit"]["recovery"] == 15
    for _ in range(10):
        await state.apply_hit("user", 25, 0, "again")
    assert state.health["bot"] == 0


async def test_negative_values_are_clamped_to_zero():
    state = await started()
    await state.apply_hit("user", -5, -5, "nonsense")
    assert state.health == {"user": 100, "bot": 100}


@pytest.mark.parametrize(
    "user_damage, bot_damage, expected",
    [(20, 10, "user"), (10, 20, "bot"), (10, 15, "draw"), (10, 16, "bot"), (0, 0, "draw")],
)
async def test_winner_uses_draw_margin(user_damage, bot_damage, expected):
    state = await started()
    await state.apply_hit("user", user_damage, 0, "u")
    await state.apply_hit("bot", bot_damage, 0, "b")
    assert state.winner() == expected


async def test_set_verdict_records_winner_and_rationale():
    state = await started()
    await state.apply_hit("user", 20, 0, "u")
    await state.set_verdict("Because.")
    assert state.snapshot()["verdict"] == {"winner": "user", "rationale": "Because."}


async def test_setup_stage_resets_everything():
    state = await started()
    await state.apply_hit("user", 20, 0, "u")
    await state.set_verdict("Because.")
    await state.set_stage("setup")
    assert state.snapshot() == FIXTURES[0]
    assert state.hits == []


async def test_unknown_stage_is_rejected():
    with pytest.raises(ValueError):
        await DebateState().set_stage("halftime")


async def test_on_change_receives_a_snapshot_for_every_change():
    seen = []

    async def record(snapshot):
        seen.append(snapshot)

    state = DebateState(on_change=record)
    await state.set_stage("setup")
    await state.set_positions("gwt", "G", "iit", "I")
    await state.set_stage("opening")
    await state.apply_hit("bot", 5, 0, "r")
    await state.set_verdict("x")
    assert [s["stage"] for s in seen] == ["setup", "setup", "opening", "opening", "opening"]
    assert seen[-1]["verdict"]["rationale"] == "x"
