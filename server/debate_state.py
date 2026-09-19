"""The state of one debate, and the snapshot the client renders.

The snapshot shape is the contract with the client; examples live in
docs/design/debate-state-fixtures.json. Every change emits a full snapshot, so
the client only ever renders the latest one.
"""

from collections.abc import Awaitable, Callable

DEBATE_ROUNDS = ("opening", "rebuttal", "closing")
STAGES = ("setup", *DEBATE_ROUNDS, "verdict")

MAX_HEALTH = 100
MAX_DAMAGE = 25
MAX_RECOVERY = 15
DRAW_MARGIN = 5

# The judge's raw scores, applied one-for-one, let each side heal most of what
# it had just taken, and debates stalled near 80-80. Damage is now doubled,
# and a rebuttal can heal at most half of the last hit the speaker took.
DAMAGE_SCALE = 2
RECOVERY_SHARE = 0.5

_SIDES = ("user", "bot")


class DebateState:
    def __init__(self, on_change: Callable[[dict], Awaitable[None]] | None = None):
        self._on_change = on_change
        self.stage = "setup"
        self._reset()

    def _reset(self) -> None:
        self._theories: dict[str, dict[str, str | None]] = {
            side: {"theory_id": None, "theory_name": None} for side in _SIDES
        }
        self._reset_scores()

    def _reset_scores(self) -> None:
        self.health = {side: MAX_HEALTH for side in _SIDES}
        self.hits: list[dict] = []
        self._verdict: dict | None = None

    async def _changed(self) -> None:
        if self._on_change:
            await self._on_change(self.snapshot())

    async def set_stage(self, stage: str) -> None:
        if stage not in STAGES:
            raise ValueError(f"unknown stage '{stage}'")
        self.stage = stage
        if stage == "setup":
            self._reset()
        await self._changed()

    async def set_positions(self, user_id: str, user_name: str, bot_id: str, bot_name: str) -> None:
        self._theories = {
            "user": {"theory_id": user_id, "theory_name": user_name},
            "bot": {"theory_id": bot_id, "theory_name": bot_name},
        }
        self._reset_scores()
        await self._changed()

    async def apply_hit(self, by: str, damage: int, recovery: int, reason: str) -> None:
        if by not in _SIDES:
            raise ValueError(f"unknown side '{by}'")
        opponent = "bot" if by == "user" else "user"
        damage = max(0, min(MAX_DAMAGE, damage))
        recovery = max(0, min(MAX_RECOVERY, recovery))
        dealt = damage * DAMAGE_SCALE
        last_hit_taken = next(
            (hit["damage"] for hit in reversed(self.hits) if hit["by"] == opponent), 0
        )
        healed = int(last_hit_taken * RECOVERY_SHARE * recovery / MAX_RECOVERY + 0.5)
        healed = min(healed, MAX_HEALTH - self.health[by])
        self.health[opponent] = max(0, self.health[opponent] - dealt)
        self.health[by] += healed
        self.hits.append({"by": by, "damage": dealt, "recovery": healed, "reason": reason})
        await self._changed()

    def winner(self) -> str:
        difference = self.health["user"] - self.health["bot"]
        if abs(difference) <= DRAW_MARGIN:
            return "draw"
        return "user" if difference > 0 else "bot"

    async def set_verdict(self, rationale: str) -> None:
        self._verdict = {"winner": self.winner(), "rationale": rationale}
        await self._changed()

    def snapshot(self) -> dict:
        return {
            "type": "debate_state",
            "stage": self.stage,
            "user": {**self._theories["user"], "health": self.health["user"]},
            "bot": {**self._theories["bot"], "health": self.health["bot"]},
            "last_hit": dict(self.hits[-1]) if self.hits else None,
            "verdict": dict(self._verdict) if self._verdict else None,
        }
