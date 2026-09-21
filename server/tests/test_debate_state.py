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


async def test_the_lock_in_snapshot_is_in_the_fixture():
    # Positions are set while the stage is still "setup": the UI locks the card in on this.
    state = DebateState()
    await state.set_mode("debate")
    await state.set_stage("setup")
    await state.set_positions(
        "gwt", "Global Workspace Theory", "iit", "Integrated Information Theory"
    )
    assert state.snapshot() in FIXTURES


def test_the_committed_fixtures_are_what_the_generator_makes():
    import make_fixtures

    for name, text in make_fixtures.generate().items():
        assert (make_fixtures.DESIGN / name).read_text() == text, (
            f"{name} is out of date: run `uv run python make_fixtures.py`"
        )


async def test_snapshot_shape_matches_final_fixture():
    state = await started()
    await state.set_stage("closing")
    await state.apply_hit("user", 14, 0, "reason")
    await state.set_stage("verdict")
    await state.set_verdict("rationale")
    assert keys(state.snapshot()) == keys(FIXTURES[-1])


async def test_hit_damages_opponent_and_heals_speaker():
    state = await started()
    # bot: dealt = 14*2 = 28; user had never hit bot, so last_hit_taken = 0 -> healed 0.
    await state.apply_hit("bot", 14, 0, "r1")
    # user: dealt = 18*2 = 36; last_hit_taken = bot's dealt (28);
    # healed = int(28*0.5*6/15 + 0.5) = int(5.6 + 0.5) = int(6.1) = 6, uncapped (missing 28).
    await state.apply_hit("user", 18, 6, "r2")
    assert state.health == {"user": 78, "bot": 64}
    assert state.snapshot()["last_hit"] == {
        "by": "user",
        "damage": 36,
        "recovery": 6,
        "reason": "r2",
    }
    assert len(state.hits) == 2


async def test_values_are_clamped():
    state = await started()
    # damage clamped to 25 -> dealt 50; recovery clamped to 15, but the speaker
    # (user) has never been hit, so last_hit_taken = 0 -> healed 0.
    await state.apply_hit("user", 999, 999, "too much")
    assert state.health == {"user": 100, "bot": 50}
    assert state.snapshot()["last_hit"]["damage"] == 50
    assert state.snapshot()["last_hit"]["recovery"] == 0
    for _ in range(10):
        await state.apply_hit("user", 25, 0, "again")
    assert state.health["bot"] == 0


async def test_negative_values_are_clamped_to_zero():
    state = await started()
    await state.apply_hit("user", -5, -5, "nonsense")
    assert state.health == {"user": 100, "bot": 100}


@pytest.mark.parametrize(
    "user_damage, bot_damage, expected",
    [
        # With recovery always 0 here, healed is always 0 (numerator has a 0
        # recovery factor), so the gap between the bars is exactly
        # 2 * (user_damage - bot_damage) (damage is doubled for both sides).
        (20, 10, "user"),  # gap = 2*(20-10) = 20  -> |20| > 5 -> user
        (10, 20, "bot"),  # gap = 2*(10-20) = -20 -> |20| > 5 -> bot
        (12, 10, "draw"),  # gap = 2*(12-10) = 4   -> |4| <= 5 -> draw (on the margin:
        #                     the largest even gap that still falls inside DRAW_MARGIN)
        (10, 13, "bot"),  # gap = 2*(10-13) = -6  -> |6| > 5 -> bot (just outside the margin)
        (0, 0, "draw"),  # gap = 0 -> draw
    ],
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
    assert state.snapshot() == {**DebateState().snapshot(), "stage": "setup"}
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


async def test_recovery_is_zero_when_the_speaker_has_not_been_hit():
    state = await started()
    await state.apply_hit("user", 0, 15, "u")
    assert state.health == {"user": 100, "bot": 100}
    assert state.snapshot()["last_hit"]["recovery"] == 0


async def test_recovery_heals_at_most_half_of_the_last_hit_taken():
    # bot: dealt = 20*2 = 40 -> user 60.
    state = await started()
    await state.apply_hit("bot", 20, 0, "b")
    # user: raw recovery 15 (max) -> healed = int(40*0.5*15/15 + 0.5) = int(20.5) = 20 -> user 80.
    await state.apply_hit("user", 0, 15, "u")
    assert state.health == {"user": 80, "bot": 100}
    assert state.snapshot()["last_hit"]["recovery"] == 20

    other = await started()
    await other.apply_hit("bot", 20, 0, "b")
    # user: raw recovery 7 -> healed = int(40*0.5*7/15 + 0.5) = int(9.333 + 0.5) = int(9.833) = 9.
    await other.apply_hit("user", 0, 7, "u")
    assert other.health["user"] == 69
    assert other.snapshot()["last_hit"]["recovery"] == 9


async def test_recovery_uses_the_most_recent_hit_taken_not_the_largest():
    state = await started()
    # bot: dealt 40 -> user 60.
    await state.apply_hit("bot", 20, 0, "b1")
    # bot again: dealt 10 -> user 50. This is now the most recent hit taken by user.
    await state.apply_hit("bot", 5, 0, "b2")
    # user: recovery heals half of the SECOND hit (dealt 10), not the first (dealt 40):
    # healed = int(10*0.5*15/15 + 0.5) = int(5.5) = 5 -> user 55.
    await state.apply_hit("user", 0, 15, "u")
    assert state.health["user"] == 55
    assert state.snapshot()["last_hit"]["recovery"] == 5


async def test_recovery_is_capped_at_missing_health():
    state = await started()
    state.health["user"] = 96
    state.hits.append({"by": "bot", "damage": 30, "recovery": 0, "reason": "prior"})
    # uncapped heal = int(30*0.5*10/15 + 0.5) = int(10.5) = 10, but user is only missing 4.
    await state.apply_hit("user", 0, 10, "reason")
    assert state.health["user"] == 100
    assert state.snapshot()["last_hit"] == {
        "by": "user",
        "damage": 0,
        "recovery": 4,
        "reason": "reason",
    }


async def test_replaying_the_fixture_debate_reproduces_the_fixture_healths():
    state = await started()
    turns = [
        ("bot", 12, 0, "opening bot"),
        ("user", 15, 0, "opening user"),
        ("bot", 4, 10, "rebuttal bot"),
        ("user", 22, 4, "rebuttal user"),
        ("bot", 5, 8, "crossexam bot"),
        ("user", 3, 6, "crossexam user"),
        ("bot", 10, 5, "closing bot"),
        ("user", 14, 0, "closing user"),
    ]
    # One snapshot per scored turn: those whose hit is new. Picked by content,
    # not position — a stage change re-sends the last hit under the new stage,
    # and the verdict re-sends the final one.
    fixture_snapshots = [
        f
        for previous, f in zip(FIXTURES, FIXTURES[1:], strict=False)
        if f["last_hit"] and f["last_hit"] != previous["last_hit"]
    ]
    for (by, damage, recovery, reason), fixture in zip(turns, fixture_snapshots, strict=True):
        await state.apply_hit(by, damage, recovery, reason)
        assert state.health["user"] == fixture["user"]["health"]
        assert state.health["bot"] == fixture["bot"]["health"]
        last_hit = state.snapshot()["last_hit"]
        assert last_hit["damage"] == fixture["last_hit"]["damage"]
        assert last_hit["recovery"] == fixture["last_hit"]["recovery"]


# --- modes --------------------------------------------------------------------


async def test_a_fresh_state_has_no_mode_focus_or_question():
    snapshot = DebateState().snapshot()
    assert (snapshot["mode"], snapshot["focus"], snapshot["question"]) == (None, None, None)


async def test_the_front_door_forgets_everything_including_the_mode():
    state = await started()
    await state.set_mode("debate")
    await state.apply_hit("bot", 10, 0, "r")

    await state.set_stage("mode")

    snapshot = state.snapshot()
    assert snapshot["mode"] is None
    assert snapshot["user"] == {"theory_id": None, "theory_name": None, "health": 100}
    assert snapshot["last_hit"] is None


async def test_setup_keeps_the_mode_so_a_rematch_stays_in_it():
    state = DebateState()
    await state.set_mode("sparring")
    await state.set_stage("setup")
    assert state.snapshot()["mode"] == "sparring"


async def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError):
        await DebateState().set_mode("karaoke")


async def test_every_change_of_mode_focus_or_question_is_emitted():
    seen = []

    async def on_change(snapshot):
        seen.append((snapshot["mode"], snapshot["focus"], snapshot["question"]))

    state = DebateState(on_change=on_change)
    await state.set_mode("explore")
    await state.set_focus("iit")
    await state.set_question(2, 5)

    assert seen == [
        ("explore", None, None),
        ("explore", "iit", None),
        ("explore", "iit", {"number": 2, "of": 5}),
    ]


async def test_sparring_has_a_player_and_an_examiner_with_no_theory():
    state = DebateState()
    await state.set_mode("sparring")
    await state.set_solo("gwt", "Global Workspace Theory")

    snapshot = state.snapshot()
    assert snapshot["user"]["theory_id"] == "gwt"
    assert snapshot["bot"] == {"theory_id": None, "theory_name": "The Examiner", "health": 100}


async def test_a_sparring_answer_costs_the_player_at_scale_one_and_heals_the_player():
    state = DebateState()
    await state.set_mode("sparring")
    await state.set_solo("gwt", "Global Workspace Theory")

    await state.apply_answer(20, 0, "Dodged the question.")
    assert state.health == {"user": 80, "bot": 100}
    assert state.snapshot()["last_hit"] == {
        "by": "bot",
        "damage": 20,
        "recovery": 0,
        "reason": "Dodged the question.",
    }

    # A full answer costs nothing and wins back at most half the last loss.
    await state.apply_answer(0, 15, "Answered it squarely, and repaired the last one.")
    assert state.health == {"user": 90, "bot": 100}
    assert state.snapshot()["last_hit"]["recovery"] == 10

    # Clamped like any other score, and never above full health.
    await state.apply_answer(99, 99, "r")
    assert state.health["user"] == 90 - 25


async def test_the_sparring_finding_is_the_players_bar_not_a_comparison():
    state = DebateState()
    await state.set_mode("sparring")
    await state.set_solo("gwt", "Global Workspace Theory")
    await state.apply_answer(25, 0, "r")
    await state.apply_answer(24, 0, "r")
    assert state.health["user"] == 51 and state.winner() == "user"
    await state.apply_answer(2, 0, "r")
    assert state.health["user"] == 49 and state.winner() == "bot"
