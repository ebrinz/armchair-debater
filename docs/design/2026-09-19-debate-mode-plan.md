# Debate Mode v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A voice bot that debates the user on theories of consciousness through opening, rebuttal, and closing rounds, with a judge scoring every turn into two live health bars that decide the winner.

**Architecture:** Pipecat Flows (YAML `FlowConfig`) drives five conversation nodes over the scaffolded cascade pipeline. Plain-Python modules hold the theory cards, the debate state, the judge's LLM calls, and an ordered background turn scorer; the state is pushed to the React client as RTVI server messages and rendered as health bars.

**Tech Stack:** Python 3.12, pipecat-ai 1.11.0 (`pipecat.flows`, `pipecat.evals`), `openai` async client against General Compute, PyYAML, pytest + pytest-asyncio, uv. React 19 + Vite + Tailwind 4 + zustand, `@pipecat-ai/client-react`.

**Spec:** `docs/design/2026-09-19-debate-mode-design.md` — read it first. State contract examples: `docs/design/debate-state-fixtures.json`.

## Global Constraints

- Pipecat is pinned at 1.11.0. Verify any Pipecat class, import, or parameter not shown in this plan with the `pipecat-context-hub` MCP tools (`check_deprecation`, `search_api`) or by reading `server/.venv/lib/python3.12/site-packages/pipecat/` before using it. Never write Pipecat APIs from memory. Use `PipelineWorker` / `WorkerRunner`, never `PipelineTask` / `PipelineRunner`.
- Use `uv` for everything Python: `uv run`, `uv add`. Never `pip`.
- All server commands run from `server/`. All client commands run from `client/`.
- Keep the scaffold's service constructors, transports, and `bot(runner_args)` entry point as they are.
- The voice guard sentence is carried verbatim: "Your responses will be spoken aloud, so avoid emojis, bullet points, or other formatting that can't be spoken."
- The bot cites only papers present on a loaded theory card.
- Theory card ids are fixed: `gwt`, `iit`, `hot`, `rpt`, `predictive_processing`, `ast`, `illusionism`, `biological_naturalism`, `orch_or`, `panpsychism`, `property_dualism`, `analytic_idealism`.
- Flow node names equal stage names: `setup`, `opening`, `rebuttal`, `closing`, `verdict`.
- Health: start 100, damage 0–25, recovery 0–15, floor 0, cap 100, draw margin 5 (absolute difference ≤ 5 is a draw).
- Commit messages end with: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Never commit `server/.env`.

## Who runs what

| Part | Who | When | Owns (nobody else edits these) |
|---|---|---|---|
| **0 — Foundation** | Session 1 | first; Session 2 waits for the commit | everything it creates, until handed off below |
| **A — Cards** | background agent dispatched by Session 1 at the end of Part 0 | parallel | `server/cards/theories.yaml`, `server/tests/test_cards_complete.py` |
| **B — Server** | Session 1 | parallel | `server/*.py` except `knowledge.py`; `server/flow.yaml`; `server/evals/`; `server/tests/` except `test_knowledge.py` and `test_cards_complete.py`; `server/Dockerfile` |
| **C — UI** | Session 2 | parallel, starts once Part 0 is committed | `client/` |
| **D — Integration** | Session 1, with the user at the browser | after A, B, C | — |

Isolation: Session 1 works in the main checkout on branch `debate-mode`. Session 2 works in a git worktree on branch `debate-ui`. The cards agent works in a worktree on branch `debate-cards`. `pyproject.toml` and `uv.lock` change only in Part 0, so the branches merge without conflicts.

---

# Part 0 — Foundation (Session 1)

### Task 0.1: Repository baseline and branches

**Files:**
- Modify: none (git only)

**Interfaces:**
- Produces: branch `debate-mode` containing the committed scaffold, spec, plan, and fixtures.

- [ ] **Step 1: Confirm nothing secret is staged**

Run from the repo root:

```bash
git status --short
git check-ignore server/.env server/.venv server/smoke_audio__smoke_audio.eval.log
```

Expected: `check-ignore` prints all three paths (they are ignored).

- [ ] **Step 2: Create the branch and commit the scaffold**

```bash
git checkout -b debate-mode
git add -A
git status --short | grep -E '\.env$' && echo "STOP: .env is staged" || echo "ok"
git commit -m "chore: pipecat scaffold, debate mode spec and plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `ok`, then a commit on `debate-mode`.

---

### Task 0.2: Card schema, `knowledge.py`, and two seed cards

**Files:**
- Modify: `server/pyproject.toml`
- Create: `server/cards/theories.yaml`
- Create: `server/knowledge.py`
- Create: `server/tests/test_knowledge.py`

**Interfaces:**
- Produces:
  - `knowledge.Theory` — frozen dataclass: `id: str`, `name: str`, `aliases: tuple[str, ...]`, `kuhn_category: str`, `claim: str`, `arguments: tuple[str, ...]`, `objections: tuple[str, ...]`, `rivals: tuple[str, ...]`, `citations: tuple[str, ...]`
  - `knowledge.CardError(ValueError)`
  - `knowledge.load(path: Path = CARDS_PATH) -> dict[str, Theory]` — validates; raises `CardError`
  - `knowledge.THEORIES: dict[str, Theory]` — loaded at import
  - `knowledge.get(key: str) -> Theory | None` — by id, name, or alias; case-insensitive
  - `knowledge.ids() -> list[str]`
  - `knowledge.index() -> str` — one line per card: `gwt: Global Workspace Theory (rivals: iit, hot)`
  - `knowledge.brief(theory: Theory) -> str` — prompt-ready text block

- [ ] **Step 1: Add dependencies and pytest config**

```bash
cd server
uv add pyyaml
uv add --dev pytest pytest-asyncio
```

Append to `server/pyproject.toml`:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Write the failing tests**

Create `server/tests/test_knowledge.py`:

```python
from pathlib import Path

import pytest
import yaml

import knowledge
from knowledge import CardError


def card(**overrides):
    base = {
        "id": "alpha",
        "name": "Alpha Theory",
        "aliases": ["alpha"],
        "kuhn_category": "Materialism > Test",
        "claim": "Consciousness is alpha.",
        "arguments": ["a1", "a2", "a3"],
        "objections": ["o1", "o2", "o3"],
        "rivals": ["beta"],
        "citations": ["Author 2000, Journal, Title", "Author 2001, Journal, Title"],
    }
    base.update(overrides)
    return base


def beta(**overrides):
    defaults = {"id": "beta", "name": "Beta Theory", "aliases": ["beta"], "rivals": ["alpha"]}
    defaults.update(overrides)
    return card(**defaults)


def write(tmp_path: Path, cards) -> Path:
    path = tmp_path / "theories.yaml"
    path.write_text(yaml.safe_dump(cards), encoding="utf-8")
    return path


def test_loads_valid_cards(tmp_path):
    theories = knowledge.load(write(tmp_path, [card(), beta()]))
    assert set(theories) == {"alpha", "beta"}
    assert theories["alpha"].rivals == ("beta",)


def test_rejects_missing_field(tmp_path):
    bad = card()
    del bad["claim"]
    with pytest.raises(CardError, match="alpha.*claim"):
        knowledge.load(write(tmp_path, [bad, beta()]))


@pytest.mark.parametrize("field", ["arguments", "objections"])
def test_rejects_wrong_argument_count(tmp_path, field):
    with pytest.raises(CardError, match=field):
        knowledge.load(write(tmp_path, [card(**{field: ["only one"]}), beta()]))


@pytest.mark.parametrize("citations", [["one"], ["1", "2", "3", "4", "5"]])
def test_rejects_citation_count_outside_two_to_four(tmp_path, citations):
    with pytest.raises(CardError, match="citations"):
        knowledge.load(write(tmp_path, [card(citations=citations), beta()]))


def test_rejects_unresolved_rival(tmp_path):
    with pytest.raises(CardError, match="gamma"):
        knowledge.load(write(tmp_path, [card(rivals=["gamma"]), beta()]))


def test_rejects_self_rival(tmp_path):
    with pytest.raises(CardError, match="itself"):
        knowledge.load(write(tmp_path, [card(rivals=["alpha"]), beta()]))


def test_rejects_duplicate_id(tmp_path):
    with pytest.raises(CardError, match="duplicate"):
        knowledge.load(write(tmp_path, [card(), card(), beta()]))


def test_rejects_alias_shared_by_two_cards(tmp_path):
    with pytest.raises(CardError, match="shared"):
        knowledge.load(write(tmp_path, [card(aliases=["same"]), beta(aliases=["same"])]))


def test_real_cards_load_and_lookup_is_case_insensitive():
    assert knowledge.get("GWT").id == "gwt"
    assert knowledge.get("global workspace theory").id == "gwt"
    assert knowledge.get("phi").id == "iit"
    assert knowledge.get("no such theory") is None


def test_index_lists_every_card_with_rivals():
    lines = knowledge.index().splitlines()
    assert len(lines) == len(knowledge.ids())
    assert any(line.startswith("gwt: Global Workspace Theory (rivals: ") for line in lines)


def test_brief_contains_claim_arguments_objections_citations():
    theory = knowledge.get("iit")
    text = knowledge.brief(theory)
    assert theory.claim in text
    for item in (*theory.arguments, *theory.objections, *theory.citations):
        assert item in text
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/test_knowledge.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'knowledge'`.

- [ ] **Step 4: Write `knowledge.py`**

Create `server/knowledge.py`:

```python
"""Theory cards: load, validate, and look up.

The cards in cards/theories.yaml are the bot's only source for claims and
citations. Loading validates every card, and the module loads at import, so a
bad card stops the bot at boot rather than mid-debate.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml

CARDS_PATH = Path(__file__).parent / "cards" / "theories.yaml"

_TEXT_FIELDS = ("id", "name", "kuhn_category", "claim")
_LIST_FIELDS = ("aliases", "arguments", "objections", "rivals", "citations")


class CardError(ValueError):
    """A theory card breaks the schema."""


@dataclass(frozen=True)
class Theory:
    id: str
    name: str
    aliases: tuple[str, ...]
    kuhn_category: str
    claim: str
    arguments: tuple[str, ...]
    objections: tuple[str, ...]
    rivals: tuple[str, ...]
    citations: tuple[str, ...]


def _parse(raw: dict) -> Theory:
    label = raw.get("id", "<no id>") if isinstance(raw, dict) else "<not a mapping>"
    if not isinstance(raw, dict):
        raise CardError(f"card {label}: must be a mapping")
    for field in _TEXT_FIELDS:
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise CardError(f"card {label}: '{field}' must be a non-empty string")
    for field in _LIST_FIELDS:
        value = raw.get(field)
        if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
            raise CardError(f"card {label}: '{field}' must be a non-empty list of strings")
    for field in ("arguments", "objections"):
        if len(raw[field]) != 3:
            raise CardError(f"card {label}: '{field}' must have exactly three entries")
    if not 2 <= len(raw["citations"]) <= 4:
        raise CardError(f"card {label}: 'citations' must have two to four entries")
    return Theory(
        **{f: raw[f].strip() for f in _TEXT_FIELDS},
        **{f: tuple(raw[f]) for f in _LIST_FIELDS},
    )


def _build_lookup(theories: dict[str, Theory]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for theory in theories.values():
        for key in (theory.id, theory.name, *theory.aliases):
            key = key.lower()
            if lookup.get(key, theory.id) != theory.id:
                raise CardError(f"'{key}' is shared by cards {lookup[key]} and {theory.id}")
            lookup[key] = theory.id
    return lookup


def load(path: Path = CARDS_PATH) -> dict[str, Theory]:
    """Load and validate the cards at ``path``."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise CardError("theories.yaml must be a non-empty list of cards")
    theories: dict[str, Theory] = {}
    for entry in raw:
        theory = _parse(entry)
        if theory.id in theories:
            raise CardError(f"duplicate card id '{theory.id}'")
        theories[theory.id] = theory
    for theory in theories.values():
        for rival in theory.rivals:
            if rival == theory.id:
                raise CardError(f"card {theory.id}: lists itself as a rival")
            if rival not in theories:
                raise CardError(f"card {theory.id}: rival '{rival}' is not a card id")
    _build_lookup(theories)
    return theories


THEORIES = load()
_LOOKUP = _build_lookup(THEORIES)


def get(key: str) -> Theory | None:
    """Look a card up by id, name, or alias, ignoring case."""
    theory_id = _LOOKUP.get(key.strip().lower())
    return THEORIES[theory_id] if theory_id else None


def ids() -> list[str]:
    return list(THEORIES)


def index() -> str:
    """One line per card, for the setup prompt."""
    return "\n".join(
        f"{t.id}: {t.name} (rivals: {', '.join(t.rivals)})" for t in THEORIES.values()
    )


def brief(theory: Theory) -> str:
    """A card as prompt text."""

    def bullets(items: tuple[str, ...]) -> str:
        return "\n".join(f"- {item}" for item in items)

    return (
        f"{theory.name} ({theory.kuhn_category})\n"
        f"Claim: {theory.claim}\n"
        f"Arguments for:\n{bullets(theory.arguments)}\n"
        f"Known objections:\n{bullets(theory.objections)}\n"
        f"Papers you may cite:\n{bullets(theory.citations)}"
    )
```

- [ ] **Step 5: Write the two seed cards**

Create `server/cards/theories.yaml`:

```yaml
# Theory cards. Schema and rules: docs/design/2026-09-19-debate-mode-design.md
# Every citation here has been confirmed by web search. Unconfirmed ones are left off.

- id: gwt
  name: Global Workspace Theory
  aliases: [GWT, global workspace, global neuronal workspace, GNWT, workspace theory]
  kuhn_category: Materialism > Neurobiological > Global workspace
  claim: >-
    A mental content becomes conscious when it wins the competition for a
    limited-capacity workspace and is broadcast across the brain, making it
    available to memory, language, and action all at once.
  arguments:
    - Conscious perception coincides with a sudden brain-wide ignition of activity, while unconscious processing of the same stimulus stays local.
    - It explains why consciousness is serial and limited in capacity even though the brain computes massively in parallel.
    - It makes predictions that can fail, such as late prefrontal ignition, which masking and attentional blink experiments have repeatedly tested.
  objections:
    - Broadcast explains why information is accessible, but not why being accessible should feel like anything at all.
    - The Cogitate adversarial collaboration did not find the sustained prefrontal signal or the ignition at stimulus offset that the theory predicted.
    - Much of the evidence relies on subjects reporting their experience, so it may track the machinery of report rather than experience itself.
  rivals: [iit]
  citations:
    - "Baars 1988, Cambridge University Press, A Cognitive Theory of Consciousness"
    - "Dehaene and Naccache 2001, Cognition, Towards a cognitive neuroscience of consciousness: basic evidence and a workspace framework"
    - "Dehaene and Changeux 2011, Neuron, Experimental and theoretical approaches to conscious processing"
    - "Mashour, Roelfsema, Changeux and Dehaene 2020, Neuron, Conscious processing and the global neuronal workspace hypothesis"

- id: iit
  name: Integrated Information Theory
  aliases: [IIT, phi, integrated information]
  kuhn_category: Materialism > Integrated information
  claim: >-
    Consciousness is identical to a system's integrated cause-effect structure.
    The quantity of consciousness is phi, the amount of information the whole
    system specifies beyond its parts.
  arguments:
    - It starts from the undeniable features of experience itself and derives what a physical system must be like to have them, rather than starting from behavior.
    - It explains why the cerebellum, with more neurons than the cortex, contributes almost nothing to consciousness, since its wiring is modular rather than integrated.
    - It inspired the perturbational complexity index, which distinguishes conscious from unconscious patients without requiring any report.
  objections:
    - Phi cannot be computed for any realistic brain, so the central quantity of the theory can never actually be measured.
    - It implies that a simple but highly integrated grid of logic gates would be more conscious than a human, which many take as a reductio.
    - More than a hundred researchers signed a 2023 open letter calling the theory pseudoscience, arguing that its core claims are untestable.
  rivals: [gwt]
  citations:
    - "Tononi 2004, BMC Neuroscience, An information integration theory of consciousness"
    - "Oizumi, Albantakis and Tononi 2014, PLoS Computational Biology, From the phenomenology to the mechanisms of consciousness: Integrated Information Theory 3.0"
    - "Tononi, Boly, Massimini and Koch 2016, Nature Reviews Neuroscience, Integrated information theory: from consciousness to its physical substrate"
    - "Albantakis et al. 2023, PLoS Computational Biology, Integrated information theory (IIT) 4.0"
```

- [ ] **Step 6: Verify the eight seed citations by web search**

Search each citation's title with its first author. Confirm author, year, and venue. Correct any detail that is off; delete any citation that cannot be confirmed (a card needs at least two). Also confirm the two factual objections: the Cogitate result (published in Nature, 2025) and the 2023 open letter on IIT.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `uv run pytest tests/test_knowledge.py -q`
Expected: 13 passed.

- [ ] **Step 8: Commit**

```bash
git add server/pyproject.toml server/uv.lock server/knowledge.py server/cards server/tests/test_knowledge.py
git commit -m "feat: theory card schema, loader, and gwt/iit seed cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 0.3: `DebateState` and the state contract

**Files:**
- Create: `server/debate_state.py`
- Create: `server/tests/test_debate_state.py`
- Read: `docs/design/debate-state-fixtures.json`

**Interfaces:**
- Produces:
  - Constants: `DEBATE_ROUNDS = ("opening", "rebuttal", "closing")`, `STAGES = ("setup", *DEBATE_ROUNDS, "verdict")`, `MAX_HEALTH = 100`, `MAX_DAMAGE = 25`, `MAX_RECOVERY = 15`, `DRAW_MARGIN = 5`
  - `DebateState(on_change: Callable[[dict], Awaitable[None]] | None = None)`
  - `await state.set_stage(stage: str)` — `"setup"` also resets positions, health, hits, verdict
  - `await state.set_positions(user_id: str, user_name: str, bot_id: str, bot_name: str)` — resets health, hits, verdict
  - `await state.apply_hit(by: str, damage: int, recovery: int, reason: str)` — `by` is `"user"` or `"bot"`; clamps
  - `state.winner() -> str` — `"user"`, `"bot"`, or `"draw"`
  - `await state.set_verdict(rationale: str)`
  - `state.snapshot() -> dict` — the state contract
  - `state.hits: list[dict]` — every applied hit, in order
  - `state.health: dict[str, int]` — keys `"user"`, `"bot"`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_debate_state.py`:

```python
import json
from pathlib import Path

import pytest

from debate_state import DebateState

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "docs/design/debate-state-fixtures.json").read_text()
)


async def started() -> DebateState:
    state = DebateState()
    await state.set_positions("gwt", "Global Workspace Theory", "iit", "Integrated Information Theory")
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
    assert state.snapshot()["last_hit"] == {"by": "user", "damage": 18, "recovery": 6, "reason": "r2"}
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_debate_state.py -q`
Expected: `ModuleNotFoundError: No module named 'debate_state'`.

- [ ] **Step 3: Write `debate_state.py`**

Create `server/debate_state.py`:

```python
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
        self.health[opponent] = max(0, self.health[opponent] - damage)
        self.health[by] = min(MAX_HEALTH, self.health[by] + recovery)
        self.hits.append({"by": by, "damage": damage, "recovery": recovery, "reason": reason})
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest -q`
Expected: 27 passed (13 knowledge + 14 debate state).

- [ ] **Step 5: Commit**

```bash
git add server/debate_state.py server/tests/test_debate_state.py
git commit -m "feat: DebateState and the debate_state snapshot contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 0.4: Hand off to the parallel streams

**Files:** none

- [ ] **Step 1: Create the two worktrees**

From the repo root:

```bash
git worktree add ../armchair-debater-ui -b debate-ui debate-mode
git worktree add ../armchair-debater-cards -b debate-cards debate-mode
```

- [ ] **Step 2: Tell the user Session 2 can start**

Say: "Foundation is committed. Open a second Claude Code session in `../armchair-debater-ui` and tell it: *Execute Part C of `docs/design/2026-09-19-debate-mode-plan.md`.*"

- [ ] **Step 3: Dispatch the cards agent in the background**

Use the Agent tool, `subagent_type: general-purpose`, with this prompt:

> Work only in `/Users/crashy/Development/armchair-debater-cards` (a git worktree on branch `debate-cards`). Read `docs/design/2026-09-19-debate-mode-design.md` (section "Knowledge base") and then execute **Part A** of `docs/design/2026-09-19-debate-mode-plan.md` exactly. You may edit only `server/cards/theories.yaml` and `server/tests/test_cards_complete.py`. Every citation must be confirmed by web search before it goes on a card; leave off any you cannot confirm. Run `uv sync` in `server/` first. Finish by running `uv run pytest -q` in `server/` and committing. Report: the cards written, any citation you dropped and why, and the final pytest output.

- [ ] **Step 4: Continue with Part B without waiting**

---

# Part A — Cards (background agent, worktree `../armchair-debater-cards`)

### Task A.1: The remaining ten cards

**Files:**
- Modify: `server/cards/theories.yaml`
- Create: `server/tests/test_cards_complete.py`

**Interfaces:**
- Consumes: the card schema enforced by `knowledge.load` (Task 0.2).
- Produces: twelve valid cards with the fixed ids from Global Constraints.

- [ ] **Step 1: Write the completeness test**

Create `server/tests/test_cards_complete.py`:

```python
import knowledge

EXPECTED_IDS = {
    "gwt",
    "iit",
    "hot",
    "rpt",
    "predictive_processing",
    "ast",
    "illusionism",
    "biological_naturalism",
    "orch_or",
    "panpsychism",
    "property_dualism",
    "analytic_idealism",
}


def test_all_twelve_cards_are_present():
    assert set(knowledge.ids()) == EXPECTED_IDS


def test_every_card_has_at_least_two_rivals():
    for theory in knowledge.THEORIES.values():
        assert len(theory.rivals) >= 2, theory.id


def test_rivalry_is_mutual_somewhere():
    """Every card is some other card's rival, so any theory can be opposed and oppose."""
    named = {rival for theory in knowledge.THEORIES.values() for rival in theory.rivals}
    assert named == EXPECTED_IDS


def test_text_is_speakable():
    for theory in knowledge.THEORIES.values():
        for text in (theory.claim, *theory.arguments, *theory.objections):
            assert not any(ch in text for ch in "*#_`[]"), (theory.id, text)
            assert len(text.split()) <= 45, (theory.id, text)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && uv sync && uv run pytest tests/test_cards_complete.py -q`
Expected: `test_all_twelve_cards_are_present` fails — only `gwt` and `iit` exist.

- [ ] **Step 3: Write the ten cards**

Append to `server/cards/theories.yaml`, following the `gwt` and `iit` cards' shape and tone exactly. For each: `claim` is one or two spoken sentences; each argument and objection is one spoken sentence of at most 45 words with no markdown characters; `kuhn_category` follows Kuhn's "A Landscape of Consciousness" (2024) taxonomy; objections are the ones the theory's actual critics press, not strawmen.

| id | name | principal authors to build from | rivals (at least these) |
|---|---|---|---|
| `hot` | Higher-Order Thought Theory | Rosenthal; Lau and Rosenthal; Brown, Lau and LeDoux | `rpt`, `iit` |
| `rpt` | Recurrent Processing Theory | Lamme | `hot`, `gwt` |
| `predictive_processing` | Predictive Processing | Seth; Clark; Hohwy; Friston | `iit`, `property_dualism` |
| `ast` | Attention Schema Theory | Graziano; Webb and Graziano | `panpsychism`, `iit` |
| `illusionism` | Illusionism | Frankish; Dennett | `property_dualism`, `panpsychism` |
| `biological_naturalism` | Biological Naturalism | Searle | `gwt`, `illusionism` |
| `orch_or` | Orchestrated Objective Reduction | Penrose; Hameroff and Penrose | `gwt`, `illusionism` |
| `panpsychism` | Panpsychism | Strawson; Goff; Chalmers on the combination problem | `illusionism`, `ast` |
| `property_dualism` | Property Dualism | Chalmers; Jackson; Nagel | `illusionism`, `predictive_processing` |
| `analytic_idealism` | Analytic Idealism | Kastrup | `illusionism`, `biological_naturalism` |

Also extend the two seed cards' `rivals`: `gwt` to `[iit, rpt, biological_naturalism]`, `iit` to `[gwt, illusionism, ast]`.

Add aliases a person would actually say aloud — for example `illusionism`: `[illusionist, consciousness is an illusion, Dennett's view]`; `property_dualism`: `[the hard problem, dualism, Chalmers' view, zombies]`. No alias may appear on two cards.

- [ ] **Step 4: Verify every citation by web search**

For each citation, search the title with the first author and confirm author, year, venue, and title. Fix details that are off. Delete any citation you cannot confirm; if a card drops below two, find a different confirmable paper by the same principal authors. Keep a list of anything dropped for your report.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest -q`
Expected: all tests pass, including the four in `test_cards_complete.py`.

- [ ] **Step 6: Commit**

```bash
git add server/cards/theories.yaml server/tests/test_cards_complete.py
git commit -m "feat: complete the twelve theory cards with verified citations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

# Part B — Server (Session 1, main checkout, branch `debate-mode`)

### Task B.1: `judge.py`

**Files:**
- Create: `server/judge.py`
- Create: `server/tests/test_judge.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `judge.TurnScore` — frozen dataclass: `damage: int`, `recovery: int`, `reason: str`
  - `judge.JudgeError(Exception)`
  - `judge.Complete = Callable[[str, str], Awaitable[str]]` — `(system, user) -> text`
  - `judge.parse_score(text: str) -> TurnScore` — raises `ValueError`
  - `await judge.score_turn(*, speaker: str, user_theory: str, bot_theory: str, history: list[tuple[str, str]], turn: str, was_hit: bool, complete: Complete | None = None) -> TurnScore` — one retry, then `JudgeError`. `speaker` is `"user"` or `"bot"`. `history` is `(speaker, text)` pairs before this turn.
  - `await judge.write_rationale(*, user_theory: str, bot_theory: str, health: dict[str, int], winner: str, hits: list[dict], complete: Complete | None = None) -> str` — one retry, then `JudgeError`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_judge.py`:

```python
import pytest

import judge
from judge import JudgeError, TurnScore


def scripted(*replies):
    """A fake LLM returning each reply in turn; exceptions are raised."""
    calls = []
    queue = list(replies)

    async def complete(system: str, user: str) -> str:
        calls.append((system, user))
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    complete.calls = calls
    return complete


def test_parse_score_reads_plain_json():
    assert judge.parse_score('{"damage": 12, "recovery": 3, "reason": "Good point."}') == TurnScore(
        12, 3, "Good point."
    )


def test_parse_score_finds_json_inside_prose_and_fences():
    text = 'Sure:\n```json\n{"damage": 5, "recovery": 0, "reason": "Weak."}\n```'
    assert judge.parse_score(text) == TurnScore(5, 0, "Weak.")


@pytest.mark.parametrize(
    "text",
    [
        "no json here",
        '{"damage": 5}',
        '{"damage": "lots", "recovery": 0, "reason": "x"}',
        '{"damage": 5, "recovery": 0, "reason": ""}',
        '{"damage": true, "recovery": 0, "reason": "x"}',
    ],
)
def test_parse_score_rejects_malformed(text):
    with pytest.raises(ValueError):
        judge.parse_score(text)


async def score(complete, **overrides):
    args = dict(
        speaker="user",
        user_theory="Global Workspace Theory",
        bot_theory="Integrated Information Theory",
        history=[("bot", "Phi is what matters.")],
        turn="Phi cannot be computed.",
        was_hit=True,
        complete=complete,
    )
    args.update(overrides)
    return await judge.score_turn(**args)


async def test_score_turn_sends_the_turn_and_history():
    complete = scripted('{"damage": 18, "recovery": 4, "reason": "Landed."}')
    result = await score(complete)
    assert result == TurnScore(18, 4, "Landed.")
    system, user = complete.calls[0]
    assert "Phi cannot be computed." in user
    assert "Phi is what matters." in user
    assert "Global Workspace Theory" in user
    assert "plausible" in system  # the judge is told not to score by plausibility


async def test_recovery_is_zero_when_speaker_was_never_hit():
    complete = scripted('{"damage": 10, "recovery": 9, "reason": "x"}')
    assert (await score(complete, was_hit=False)).recovery == 0


async def test_score_turn_retries_once_then_succeeds():
    complete = scripted("garbage", '{"damage": 1, "recovery": 0, "reason": "ok"}')
    assert (await score(complete)).damage == 1
    assert len(complete.calls) == 2


async def test_score_turn_raises_after_two_failures():
    complete = scripted(RuntimeError("down"), "garbage")
    with pytest.raises(JudgeError):
        await score(complete)
    assert len(complete.calls) == 2


async def rationale(complete):
    return await judge.write_rationale(
        user_theory="Global Workspace Theory",
        bot_theory="Integrated Information Theory",
        health={"user": 74, "bot": 61},
        winner="user",
        hits=[{"by": "user", "damage": 22, "recovery": 6, "reason": "Expander graphs."}],
        complete=complete,
    )


async def test_write_rationale_returns_stripped_text_and_sees_the_hits():
    complete = scripted("  The user won on testability.  ")
    assert await rationale(complete) == "The user won on testability."
    assert "Expander graphs." in complete.calls[0][1]
    assert "74" in complete.calls[0][1]


async def test_write_rationale_retries_on_empty_then_raises():
    with pytest.raises(JudgeError):
        await rationale(scripted("", "   "))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_judge.py -q`
Expected: `ModuleNotFoundError: No module named 'judge'`.

- [ ] **Step 3: Write `judge.py`**

Create `server/judge.py`:

```python
"""The debate judge: score one turn, and explain the final result.

Each call is a fresh LLM context holding only what it is given, so the judge has
no memory of having argued a side. No Pipecat imports: this module is plain
Python around an OpenAI-compatible chat call, which tests replace via `complete`.
"""

import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from loguru import logger

Complete = Callable[[str, str], Awaitable[str]]

BASE_URL = "https://api.generalcompute.com/v1"

SCORE_SYSTEM = """You are the impartial judge of a spoken debate about theories of consciousness. \
You score ONE turn at a time.

Score the argument that was actually made, never which theory you find more plausible. \
The user's words are transcribed speech: ignore disfluency, filler, and transcription errors, \
and score the substance. Judge by four criteria: argument strength, responsiveness to the \
opponent, use of evidence, and clarity.

Return ONLY a JSON object with these keys:
  "damage": integer 0-25. How hard this turn hits the OPPONENT's position. 0 for a turn that \
makes no argument (a question, small talk, agreement). 5-10 for a fair point. 15-20 for a strong, \
well-supported point the opponent must answer. 21-25 only for a point that is decisive.
  "recovery": integer 0-15. How well this turn answers the last point made AGAINST the speaker. \
0 if it ignores that point or there was none. 10-15 only if it genuinely defuses it.
  "reason": one short sentence, at most 18 words, naming the point that mattered. \
Describe the argument; do not address the speakers."""

RATIONALE_SYSTEM = """You are the impartial judge of a spoken debate about theories of \
consciousness. The debate is over and the scores are final. In exactly two short sentences that \
will be read aloud, explain why the result came out as it did, naming the one or two points that \
mattered most. Refer to the sides as "the challenger" (the user) and "the house" (the bot). \
No lists, no formatting, no numbers."""


class JudgeError(Exception):
    """The judge could not be reached or did not return a usable answer."""


@dataclass(frozen=True)
class TurnScore:
    damage: int
    recovery: int
    reason: str


def parse_score(text: str) -> TurnScore:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in judge output")
    data = json.loads(text[start : end + 1])
    damage, recovery, reason = data.get("damage"), data.get("recovery"), data.get("reason")
    for value in (damage, recovery):
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("damage and recovery must be integers")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("reason must be a non-empty string")
    return TurnScore(damage, recovery, reason.strip())


async def _complete(system: str, user: str) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=os.environ["GENERAL_COMPUTE_API_KEY"], base_url=BASE_URL)
    response = await client.chat.completions.create(
        model=os.getenv("GENERAL_COMPUTE_MODEL", "deepseek-v3.2"),
        temperature=0.1,
        max_tokens=400,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return response.choices[0].message.content or ""


async def _twice(attempt: Callable[[], Awaitable], what: str):
    """Run ``attempt``; on any failure run it once more, then raise JudgeError."""
    for tries_left in (1, 0):
        try:
            return await attempt()
        except Exception as e:
            logger.warning(f"judge: {what} failed ({e}); {'retrying' if tries_left else 'giving up'}")
    raise JudgeError(f"{what} failed twice")


def _label(speaker: str) -> str:
    return "USER" if speaker == "user" else "BOT"


async def score_turn(
    *,
    speaker: str,
    user_theory: str,
    bot_theory: str,
    history: list[tuple[str, str]],
    turn: str,
    was_hit: bool,
    complete: Complete | None = None,
) -> TurnScore:
    complete = complete or _complete
    transcript = "\n".join(f"{_label(who)}: {text}" for who, text in history) or "(none yet)"
    prompt = (
        f"USER defends: {user_theory}\nBOT defends: {bot_theory}\n\n"
        f"Debate so far:\n{transcript}\n\n"
        f"Score this turn by {_label(speaker)}:\n{turn}"
    )

    async def attempt() -> TurnScore:
        return parse_score(await complete(SCORE_SYSTEM, prompt))

    score = await _twice(attempt, "scoring a turn")
    return score if was_hit else TurnScore(score.damage, 0, score.reason)


async def write_rationale(
    *,
    user_theory: str,
    bot_theory: str,
    health: dict[str, int],
    winner: str,
    hits: list[dict],
    complete: Complete | None = None,
) -> str:
    complete = complete or _complete
    result = {"user": "The challenger won.", "bot": "The house won.", "draw": "It is a draw."}[winner]
    lines = "\n".join(
        f"- {_label(h['by'])} dealt {h['damage']}, recovered {h['recovery']}: {h['reason']}"
        for h in hits
    ) or "(no turns were scored)"
    prompt = (
        f"The challenger (USER) defended: {user_theory}\nThe house (BOT) defended: {bot_theory}\n"
        f"Final health: challenger {health['user']}, house {health['bot']}. {result}\n\n"
        f"Scored turns, in order:\n{lines}"
    )

    async def attempt() -> str:
        text = (await complete(RATIONALE_SYSTEM, prompt)).strip()
        if not text:
            raise ValueError("empty rationale")
        return text

    return await _twice(attempt, "writing the rationale")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_judge.py -q`
Expected: 13 passed.

- [ ] **Step 5: Try the real endpoint once**

Run:

```bash
uv run python -c "
import asyncio, judge
from dotenv import load_dotenv; load_dotenv()
print(asyncio.run(judge.score_turn(speaker='user', user_theory='Global Workspace Theory', bot_theory='Integrated Information Theory', history=[('bot','Consciousness is integrated information, measured by phi.')], turn='But phi cannot be computed for any real brain, so your theory can never be tested.', was_hit=True)))"
```

Expected: a `TurnScore` with damage roughly 10–20 and a sensible reason, in a few seconds. If the model returns empty content (a reasoning model spending `max_tokens` on thinking), raise `max_tokens` to 1500 and re-run. Note the latency; it is how far the bars lag a turn.

- [ ] **Step 6: Commit**

```bash
git add server/judge.py server/tests/test_judge.py
git commit -m "feat: per-turn debate judge and closing rationale

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B.2: `scorer.py`

**Files:**
- Create: `server/scorer.py`
- Create: `server/tests/test_scorer.py`

**Interfaces:**
- Consumes: `DebateState`, `DEBATE_ROUNDS` (Task 0.3); `judge.score_turn`, `judge.JudgeError`, `judge.TurnScore` (Task B.1).
- Produces:
  - `TurnScorer(state: DebateState, current_stage: Callable[[], str | None], theories: Callable[[], tuple[str, str]], score=judge.score_turn)` — `theories()` returns `(user_theory_name, bot_theory_name)`
  - `scorer.submit(by: str, text: str) -> None` — non-blocking; ignored when closed, when `current_stage()` is not a debate round, or when `text` is blank
  - `await scorer.drain() -> None` — waits for every submitted turn to be scored
  - `scorer.close() -> None` — stop accepting turns
  - `scorer.reset() -> None` — clear the transcript and reopen

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_scorer.py`:

```python
import asyncio

from debate_state import DebateState
from judge import JudgeError, TurnScore
from scorer import TurnScorer


class Rig:
    """A scorer wired to a fake judge whose replies the test controls."""

    def __init__(self):
        self.state = DebateState()
        self.stage = "opening"
        self.calls = []
        self.gates: dict[str, asyncio.Event] = {}
        self.failing: set[str] = set()
        self.scorer = TurnScorer(
            self.state,
            current_stage=lambda: self.stage,
            theories=lambda: ("Global Workspace Theory", "Integrated Information Theory"),
            score=self.score,
        )

    async def score(self, **kwargs):
        self.calls.append(kwargs)
        if gate := self.gates.get(kwargs["turn"]):
            await gate.wait()
        if kwargs["turn"] in self.failing:
            raise JudgeError("down")
        return TurnScore(10, 5 if kwargs["was_hit"] else 0, f"scored {kwargs['turn']}")


async def test_scores_are_applied_in_submission_order_even_if_the_first_is_slow():
    rig = Rig()
    rig.gates["first"] = asyncio.Event()
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await asyncio.sleep(0)
    assert rig.state.hits == []
    rig.gates["first"].set()
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored first", "scored second"]


async def test_history_excludes_the_turn_being_scored():
    rig = Rig()
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()
    assert rig.calls[0]["history"] == []
    assert rig.calls[1]["history"] == [("bot", "first")]
    assert rig.calls[1]["user_theory"] == "Global Workspace Theory"


async def test_was_hit_is_true_only_after_the_opponent_has_landed_a_hit():
    rig = Rig()
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    rig.scorer.submit("bot", "third")
    await rig.scorer.drain()
    assert [c["was_hit"] for c in rig.calls] == [False, True, True]
    assert rig.state.health == {"user": 85, "bot": 95}


async def test_turns_outside_debate_rounds_and_blank_turns_are_ignored():
    rig = Rig()
    rig.stage = "setup"
    rig.scorer.submit("user", "I think it is the brain.")
    rig.stage = "verdict"
    rig.scorer.submit("bot", "You win.")
    rig.stage = "opening"
    rig.scorer.submit("bot", "   ")
    await rig.scorer.drain()
    assert rig.calls == []


async def test_a_failed_score_is_skipped_and_later_turns_still_apply():
    rig = Rig()
    rig.failing.add("first")
    rig.scorer.submit("bot", "first")
    rig.scorer.submit("user", "second")
    await rig.scorer.drain()
    assert [h["reason"] for h in rig.state.hits] == ["scored second"]


async def test_close_stops_new_turns_and_reset_reopens_with_empty_history():
    rig = Rig()
    rig.scorer.submit("bot", "first")
    rig.scorer.close()
    rig.scorer.submit("user", "ignored")
    await rig.scorer.drain()
    assert len(rig.calls) == 1
    rig.scorer.reset()
    rig.scorer.submit("user", "fresh")
    await rig.scorer.drain()
    assert rig.calls[-1]["history"] == []


async def test_drain_with_nothing_submitted_returns():
    await Rig().scorer.drain()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_scorer.py -q`
Expected: `ModuleNotFoundError: No module named 'scorer'`.

- [ ] **Step 3: Write `scorer.py`**

Create `server/scorer.py`:

```python
"""Scores finished debate turns in order, off the voice path.

Each submitted turn becomes a background task that first awaits the task before
it, so scores reach DebateState in turn order however long each judge call
takes, and submit() never blocks the pipeline.
"""

import asyncio
from collections.abc import Callable

from loguru import logger

import judge
from debate_state import DEBATE_ROUNDS, DebateState


class TurnScorer:
    def __init__(
        self,
        state: DebateState,
        current_stage: Callable[[], str | None],
        theories: Callable[[], tuple[str, str]],
        score=judge.score_turn,
    ):
        self._state = state
        self._current_stage = current_stage
        self._theories = theories
        self._score = score
        self._transcript: list[tuple[str, str]] = []
        self._tail: asyncio.Task | None = None
        self._closed = False

    def submit(self, by: str, text: str) -> None:
        text = text.strip()
        if self._closed or not text or self._current_stage() not in DEBATE_ROUNDS:
            return
        history = list(self._transcript)
        self._transcript.append((by, text))
        self._tail = asyncio.create_task(self._run(self._tail, by, text, history))

    async def _run(self, previous: asyncio.Task | None, by: str, text: str, history) -> None:
        if previous:
            await previous
        user_theory, bot_theory = self._theories()
        try:
            score = await self._score(
                speaker=by,
                user_theory=user_theory,
                bot_theory=bot_theory,
                history=history,
                turn=text,
                was_hit=any(hit["by"] != by for hit in self._state.hits),
            )
        except judge.JudgeError:
            logger.warning(f"scorer: skipping an unscored {by} turn")
            return
        await self._state.apply_hit(by, score.damage, score.recovery, score.reason)

    async def drain(self) -> None:
        if self._tail:
            await self._tail

    def close(self) -> None:
        self._closed = True

    def reset(self) -> None:
        self._transcript = []
        self._closed = False
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_scorer.py -q`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add server/scorer.py server/tests/test_scorer.py
git commit -m "feat: ordered background turn scorer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B.3: `handlers.py` and `flow.yaml`

**Files:**
- Create: `server/handlers.py`
- Create: `server/flow.yaml`
- Create: `server/tests/test_handlers.py`

**Interfaces:**
- Consumes: `knowledge.get/ids/brief`; `DebateState`; `TurnScorer.reset/close/drain`; `judge.write_rationale`, `judge.JudgeError`.
- Consumes from `flow_manager.state` (set by `bot.py`, Task B.4): `"debate": DebateState`, `"scorer": TurnScorer`, `"theory_index": str`.
- Produces in `flow_manager.state`: `user_card`, `bot_card`, `user_theory_name`, `bot_theory_name` (set by `set_positions`); `verdict_text` (set by `judge_debate`).
- Produces for `flow.yaml`:
  - action handler `async emit_stage(action: dict, flow_manager) -> None` — reads `action["stage"]`
  - tool `async set_positions(flow_manager, user_theory: str, bot_theory: str)` → result has `status`: `"ok"` or `"unknown_theory"`
  - tool `async judge_debate(flow_manager)` → result has `status: "ok"`
- Verified against pipecat 1.11.0 source: Flows direct functions take `flow_manager` first and, in a YAML flow, return `(result, TRANSITION_IN_YAML)`; action handlers take `(action, flow_manager)`; a branch with no matching case and no `default` stays on the current node; `flow_manager.worker` is the `PipelineWorker`; `TTSSpeakFrame(text, append_to_context=False)`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_handlers.py`:

```python
import pytest
from pipecat.flows import TRANSITION_IN_YAML
from pipecat.frames.frames import TTSSpeakFrame

import handlers
import judge
from debate_state import DebateState


class FakeScorer:
    def __init__(self, on_drain=None):
        self.log = []
        self._on_drain = on_drain

    def reset(self):
        self.log.append("reset")

    def close(self):
        self.log.append("close")

    async def drain(self):
        self.log.append("drain")
        if self._on_drain:
            await self._on_drain()


class FakeWorker:
    def __init__(self):
        self.frames = []

    async def queue_frames(self, frames):
        self.frames.extend(frames)


class FakeFlowManager:
    def __init__(self, scorer=None):
        self.state = {"debate": DebateState(), "scorer": scorer or FakeScorer()}
        self.worker = FakeWorker()


async def test_emit_stage_sets_the_stage():
    fm = FakeFlowManager()
    await handlers.emit_stage({"type": "emit_stage", "stage": "rebuttal"}, fm)
    assert fm.state["debate"].stage == "rebuttal"


async def test_set_positions_stores_cards_and_resets():
    fm = FakeFlowManager()
    result, nxt = await handlers.set_positions(fm, user_theory="GWT", bot_theory="iit")
    assert nxt is TRANSITION_IN_YAML
    assert result == {
        "status": "ok",
        "user_theory": "Global Workspace Theory",
        "bot_theory": "Integrated Information Theory",
    }
    assert fm.state["user_theory_name"] == "Global Workspace Theory"
    assert "Papers you may cite" in fm.state["bot_card"]
    assert "Tononi 2004" in fm.state["bot_card"]
    assert fm.state["scorer"].log == ["reset"]
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["user"]["theory_id"] == "gwt" and snapshot["bot"]["theory_id"] == "iit"


async def test_set_positions_substitutes_a_rival_when_bot_theory_is_not_one():
    fm = FakeFlowManager()
    result, _ = await handlers.set_positions(fm, user_theory="gwt", bot_theory="gwt")
    assert result["status"] == "ok"
    assert fm.state["debate"].snapshot()["bot"]["theory_id"] == "iit"


async def test_set_positions_reports_unknown_ids_without_touching_state():
    fm = FakeFlowManager()
    result, nxt = await handlers.set_positions(fm, user_theory="vibes", bot_theory="iit")
    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "unknown_theory"
    assert "gwt" in result["valid_ids"]
    assert "user_card" not in fm.state


async def ready_for_verdict(monkeypatch, write_rationale):
    monkeypatch.setattr(handlers, "write_rationale", write_rationale)

    async def late_hit():
        await fm.state["debate"].apply_hit("user", 20, 0, "The closing point.")

    fm = FakeFlowManager(scorer=FakeScorer(on_drain=late_hit))
    await handlers.set_positions(fm, user_theory="gwt", bot_theory="iit")
    fm.state["scorer"].log.clear()
    return fm


async def test_judge_debate_closes_speaks_drains_then_decides(monkeypatch):
    async def write_rationale(**kwargs):
        assert kwargs["winner"] == "user"  # the hit applied during drain() counted
        assert kwargs["health"] == {"user": 100, "bot": 80}
        return "The challenger closed strongly."

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    result, nxt = await handlers.judge_debate(fm)
    assert nxt is TRANSITION_IN_YAML
    assert fm.state["scorer"].log == ["close", "drain"]
    assert isinstance(fm.worker.frames[0], TTSSpeakFrame)
    assert fm.worker.frames[0].append_to_context is False
    assert result["status"] == "ok" and result["winner"] == "user"
    assert fm.state["debate"].snapshot()["verdict"] == {
        "winner": "user",
        "rationale": "The challenger closed strongly.",
    }
    assert "The challenger closed strongly." in fm.state["verdict_text"]
    assert "100" in fm.state["verdict_text"] and "80" in fm.state["verdict_text"]


async def test_judge_debate_falls_back_to_the_biggest_hit_when_the_judge_fails(monkeypatch):
    async def write_rationale(**kwargs):
        raise judge.JudgeError("down")

    fm = await ready_for_verdict(monkeypatch, write_rationale)
    await handlers.judge_debate(fm)
    assert "The closing point." in fm.state["debate"].snapshot()["verdict"]["rationale"]


def test_fallback_rationale_with_no_hits():
    assert "could not" in handlers.fallback_rationale([])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_handlers.py -q`
Expected: `ModuleNotFoundError: No module named 'handlers'`.

- [ ] **Step 3: Write `handlers.py`**

Create `server/handlers.py`:

```python
"""Tools and actions for the debate flow defined in flow.yaml.

Each tool is a Flows direct function: its name, description, and parameters come
from the signature and docstring. None chooses the next node; they return
``(result, TRANSITION_IN_YAML)`` and flow.yaml decides where each one leads.

bot.py puts the session's DebateState and TurnScorer in ``flow_manager.state``
under "debate" and "scorer".
"""

from pipecat.flows import TRANSITION_IN_YAML, FlowManager
from pipecat.frames.frames import TTSSpeakFrame

import knowledge
from judge import JudgeError, write_rationale

_WINNER_TEXT = {
    "user": "The user wins.",
    "bot": "You win.",
    "draw": "It is a draw.",
}


async def emit_stage(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action on every node: record the stage, which pushes a snapshot to the client."""
    await flow_manager.state["debate"].set_stage(action["stage"])


async def set_positions(flow_manager: FlowManager, user_theory: str, bot_theory: str):
    """Record which theory the user holds and which rival theory you will defend.

    Call this once you know the user's view. Use ids from the theory index.

    Args:
        user_theory: The id of the theory closest to the view the user described.
        bot_theory: The id of the rival theory you will defend. Pick one of the
            rivals listed for the user's theory.
    """
    user, bot = knowledge.get(user_theory), knowledge.get(bot_theory)
    if user is None or bot is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML
    if bot.id not in user.rivals:
        bot = knowledge.THEORIES[user.rivals[0]]

    state = flow_manager.state
    state.update(
        user_card=knowledge.brief(user),
        bot_card=knowledge.brief(bot),
        user_theory_name=user.name,
        bot_theory_name=bot.name,
    )
    state["scorer"].reset()
    await state["debate"].set_positions(user.id, user.name, bot.id, bot.name)
    return {"status": "ok", "user_theory": user.name, "bot_theory": bot.name}, TRANSITION_IN_YAML


def fallback_rationale(hits: list[dict]) -> str:
    """What to say when the judge cannot write a rationale."""
    if not hits:
        return "The judge could not score this debate, so the result stands on the bars alone."
    biggest = max(hits, key=lambda hit: hit["damage"])
    return f"The point that mattered most was this. {biggest['reason']}"


async def judge_debate(flow_manager: FlowManager):
    """Hand the finished debate to the judge.

    Call this exactly once, as soon as the user has given their closing
    statement. Do not reply to the closing statement first.
    """
    state = flow_manager.state
    debate, scorer = state["debate"], state["scorer"]

    scorer.close()
    await flow_manager.worker.queue_frames(
        [TTSSpeakFrame("Thank you. The judge is tallying the scores.", append_to_context=False)]
    )
    await scorer.drain()

    winner = debate.winner()
    try:
        rationale = await write_rationale(
            user_theory=state["user_theory_name"],
            bot_theory=state["bot_theory_name"],
            health=dict(debate.health),
            winner=winner,
            hits=list(debate.hits),
        )
    except JudgeError:
        rationale = fallback_rationale(debate.hits)
    await debate.set_verdict(rationale)

    state["verdict_text"] = (
        f"Final health: the user {debate.health['user']}, you {debate.health['bot']}. "
        f"{_WINNER_TEXT[winner]} The judge's rationale: {rationale}"
    )
    return {
        "status": "ok",
        "winner": winner,
        "user_health": debate.health["user"],
        "bot_health": debate.health["bot"],
    }, TRANSITION_IN_YAML
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_handlers.py -q`
Expected: 7 passed.

- [ ] **Step 5: Write `flow.yaml`**

Create `server/flow.yaml`:

```yaml
# The debate, as a Pipecat Flows config. Node names are the stage names the
# client shows. Tools live in handlers.py; this file decides where they lead.
# {{ key }} placeholders are filled from flow_manager.state on entering a node.

initial_node: setup

nodes:
  setup:
    role_message: >-
      You are the Armchair Debater, a sharp, good-humored debating opponent on
      theories of consciousness. Your responses will be spoken aloud, so avoid
      emojis, bullet points, or other formatting that can't be spoken.
      Speak two to four sentences per turn and make one argument at a time.
      Cite only papers listed on the theory cards you are given, spoken
      naturally as author and year, and never invent a paper. If asked for a
      source your card lacks, say you don't have one to hand.
      Concede a genuinely good point in a few words and then keep arguing;
      never fold just to be agreeable, and never switch to the user's side.
      Never mention health, scores, or the judge before the verdict.
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: setup
    task_messages:
      - role: developer
        content: |
          Greet the user in one sentence as the Armchair Debater, then ask what
          they think consciousness is. They do not need to name a theory; a
          hunch in their own words is fine.

          When they answer, match their view to the closest theory in this
          index, and choose one of its listed rivals for yourself:

          {{ theory_index }}

          Then call set_positions with both ids. Do not start arguing yet. If
          their answer is too vague to match, ask one short follow-up question
          instead. If set_positions reports unknown_theory, call it again with
          ids from the index.
    functions:
      - name: set_positions
        transition_to:
          field: status
          cases:
            ok: opening

  opening:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: opening
    task_messages:
      - role: developer
        content: |
          The debate begins. This is the OPENING round of three.
          The user holds: {{ user_theory_name }}. You defend: {{ bot_theory_name }}.

          Your card. Argue from this, and cite only these papers:
          {{ bot_card }}

          The user's card, so you know what is coming. Do not argue their side:
          {{ user_card }}

          Now, in one turn: tell the user their view sounds closest to
          {{ user_theory_name }} and that you will defend {{ bot_theory_name }}
          against it; give your opening argument; then invite their opening
          statement.

          When the user has given their opening statement, call opening_done
          immediately, without replying to it; your rebuttal comes next round.
          If instead they ask a question or object to the theory you matched
          them with, answer briefly and invite their opening statement again.
    functions:
      - name: opening_done
        transition_only: true
        description: The user has finished their opening statement. Moves the debate to the rebuttal round.
        transition_to: rebuttal

  rebuttal:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: rebuttal
    task_messages:
      - role: developer
        content: |
          This is the REBUTTAL round. Rebut the strongest point in the user's
          opening statement directly, using your card's arguments or the known
          objections on their card. If they landed a fair point, concede it in
          a few words first. Then invite their rebuttal.

          When the user has given their rebuttal, call rebuttal_done
          immediately, without replying to it; your closing comes next round.
    functions:
      - name: rebuttal_done
        transition_only: true
        description: The user has finished their rebuttal. Moves the debate to the closing round.
        transition_to: closing

  closing:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: closing
    task_messages:
      - role: developer
        content: |
          This is the CLOSING round. Answer the user's rebuttal in a sentence,
          then give your closing statement: the single strongest reason to
          prefer {{ bot_theory_name }}. Then invite the user's closing
          statement and tell them it is the last word before the judge decides.

          When the user has given their closing statement, call judge_debate
          immediately, without replying to it.
    functions:
      - name: judge_debate
        transition_to: verdict

  verdict:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: verdict
    task_messages:
      - role: developer
        content: |
          The judge has decided. Announce the result to the user now:

          {{ verdict_text }}

          Say the two final health numbers, say who won, and give the judge's
          rationale in your own spoken words. Be gracious whether you won or
          lost. Then offer a rematch, on the same question or a different one.

          If the user wants a rematch, call rematch. Otherwise chat freely
          about the debate; the scoring is over.
    functions:
      - name: rematch
        transition_only: true
        description: The user wants another debate. Returns to the start.
        transition_to: setup
```

- [ ] **Step 6: Verify the flow loads and resolves every handler**

Run:

```bash
uv run python -c "
import handlers
from pipecat.flows import Flow, FlowConfig
flow = Flow(FlowConfig.from_file('flow.yaml'), handlers=handlers)
print('ok:', sorted(flow.config.nodes))"
```

Expected: `ok: ['closing', 'opening', 'rebuttal', 'setup', 'verdict']`. A `FlowReferenceError` lists every tool or handler name that did not resolve; fix the names and re-run.

- [ ] **Step 7: Commit**

```bash
git add server/handlers.py server/flow.yaml server/tests/test_handlers.py
git commit -m "feat: debate flow and its tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B.4: Wire the flow into `bot.py`

**Files:**
- Modify: `server/bot.py`
- Modify: `server/Dockerfile`

**Interfaces:**
- Consumes: everything above.
- Produces: a bot that, on client ready, enters the `setup` node; sends a `debate_state` RTVI server message on every state change; and submits every finished user and bot turn to the `TurnScorer`.
- Verified against pipecat 1.11.0 source: `LLMContextAggregatorPair` has `.user()` and `.assistant()`; the user aggregator fires `on_user_turn_message_added(aggregator, message)` with `message.content` whenever a user message enters the context (text and audio modes alike); the assistant aggregator fires `on_assistant_turn_stopped(aggregator, message)` with `message.content`; `worker.rtvi.send_server_message(data)` sends an RTVI server message; `FlowManager(worker=, llm=, context_aggregator=, transport=, global_functions=)`; `flow_manager.current_node` is the active node's name.

- [ ] **Step 1: Update the module docstring and imports**

In `server/bot.py`, replace the docstring's first two lines

```python
"""armchair-debater - Pipecat Voice Agent

This bot uses a cascade pipeline: Speech-to-Text → LLM → Text-to-Speech
```

with

```python
"""armchair-debater - a voice bot that debates theories of consciousness

A cascade pipeline (Speech-to-Text → LLM → Text-to-Speech) driven by the Pipecat
Flows config in flow.yaml. A judge scores each turn in the background and the
debate state is pushed to the client as RTVI server messages.
```

Replace the import block from `import os` through `from pipecat.workers.runner import WorkerRunner` with:

```python
import os
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.evals.transport import EvalTransportParams
from pipecat.flows import Flow, FlowConfig, FlowManager
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.gradium.stt import GradiumSTTService
from pipecat.services.gradium.tts import GradiumTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner

import handlers
import knowledge
from debate_state import DebateState
from scorer import TurnScorer
```

(`LLMRunFrame` is no longer imported: Flows triggers the first turn.) Below `load_dotenv(override=True)` add:

```python
FLOW_CONFIG_PATH = Path(__file__).with_name("flow.yaml")
```

- [ ] **Step 2: Remove the scaffold's system instruction**

In the `OpenAILLMService.Settings(...)` call, delete the `system_instruction="You are a helpful assistant ..."` argument, leaving only `model=`. The `setup` node's `role_message` is sent as the system instruction instead.

- [ ] **Step 3: Keep the aggregator pair as one object**

Replace

```python
    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )
```

with

```python
    context = LLMContext()
    context_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )
```

and in the `Pipeline([...])` list replace `user_aggregator,` with `context_aggregator.user(),` and `assistant_aggregator,` with `context_aggregator.assistant(),`.

- [ ] **Step 4: Build the flow, the state, and the scorer; replace the greeting**

Replace the whole `on_client_ready` handler

```python
    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        # Kick off the conversation
        context.add_message(
            {"role": "developer", "content": "Start by concisely introducing yourself."}
        )
        await worker.queue_frames([LLMRunFrame()])
```

with

```python
    # Join the flow graph to its tools. Constructing the Flow checks that every
    # tool and handler flow.yaml names exists, and reports all misses together.
    flow = Flow(FlowConfig.from_file(FLOW_CONFIG_PATH), handlers=handlers)
    flow_manager = FlowManager(
        worker=worker,
        llm=llm,
        context_aggregator=context_aggregator,
        transport=transport,
        global_functions=flow.global_functions,
    )

    # Every change to the debate state goes to the client as a full snapshot.
    debate = DebateState(on_change=worker.rtvi.send_server_message)
    scorer = TurnScorer(
        debate,
        current_stage=lambda: flow_manager.current_node,
        theories=lambda: (
            flow_manager.state["user_theory_name"],
            flow_manager.state["bot_theory_name"],
        ),
    )
    flow_manager.state.update(
        {"debate": debate, "scorer": scorer, "theory_index": knowledge.index()}
    )

    # Finished turns are scored in the background; submit() never blocks.
    @context_aggregator.user().event_handler("on_user_turn_message_added")
    async def on_user_turn_message_added(aggregator, message):
        scorer.submit("user", message.content or "")

    @context_aggregator.assistant().event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(aggregator, message):
        scorer.submit("bot", message.content or "")

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        await flow_manager.initialize(flow.initial_node)
```

- [ ] **Step 5: Ship the new files in the container image**

In `server/Dockerfile`, replace

```dockerfile
COPY ./bot.py bot.py
```

with

```dockerfile
COPY ./bot.py ./handlers.py ./knowledge.py ./debate_state.py ./judge.py ./scorer.py ./flow.yaml ./
COPY ./cards cards
```

- [ ] **Step 6: Lint and smoke boot**

```bash
uv run ruff check --fix . && uv run ruff format .
uv run pytest -q
uv run bot.py -t eval 2>&1 | tee /tmp/pipecat-output.txt
```

Expected: ruff reports nothing left to fix (it sorts imports and reformats in place); pytest passes; the bot logs that it is serving and stays up with no traceback. Leave it running for Task B.5. If it exits, `grep -n "Error\|Traceback" /tmp/pipecat-output.txt`.

- [ ] **Step 7: Commit**

```bash
git add server/bot.py server/Dockerfile
git commit -m "feat: run the debate flow, live scoring, and state messages in the bot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B.5: Evals

**Files:**
- Create: `server/evals/debate_text.yaml`
- Create: `server/evals/debate_simulated.yaml`
- Create: `server/evals/suite.yaml`
- Delete: `server/evals/starter_text.yaml`
- Modify: `server/evals/starter_audio.yaml` (only if its greeting criterion fails — see Step 6)

**Interfaces:**
- Consumes: the running bot from Task B.4 (`uv run bot.py -t eval`).
- The eval judge and the simulated caller both run on the harness default: local Ollama `gemma4:12b` (already pulled on this machine). Scenario files therefore carry no `judge:` or `simulator:` block. Rationale: it keeps eval traffic off General Compute, which the bot and the live debate judge are already using during a run. (The live judge in `judge.py` stays on General Compute: measured 1.45 s per turn there against 5–9 s on local Ollama.)
- Verified against pipecat 1.11.0 source: with no `judge.eval` block the harness builds an Ollama service at `http://localhost:11434/v1` with model `gemma4:12b`; a scripted `expect` entry accepts `event`, `text_contains`, `eval`, and `calls` (a list of `{name, args}`); `pipecat eval suite` takes a manifest whose `bot`, `bots_dir`, and `scenarios_dir` paths resolve relative to the manifest file, and spawns a fresh bot per scenario with `{python} {bot} -t eval --port {port}`.

- [ ] **Step 1: Confirm the local judge is available**

```bash
ollama list | grep gemma4:12b && curl -s -m 3 http://localhost:11434/api/tags > /dev/null && echo "ollama ok"
```

Expected: the model line, then `ollama ok`. If the server is not running, start it with `ollama serve` in another terminal. If the model is missing, stop and report — pulling it (7.6 GB) is the user's call.

- [ ] **Step 2: Write the scripted scenarios**

Create `server/evals/debate_text.yaml`:

```yaml
name: debate_text

# Scripted, text mode: the bot's decisions, turn by turn. Run from server/:
#
#   uv run pipecat eval suite evals/suite.yaml -k script
#
# The suite starts a fresh bot per scenario, so each one begins in the setup
# node. `eval:` criteria are judged by local Ollama (`ollama pull gemma4:12b`).

scenarios:
  - name: setup_matches_view_and_opposes
    turns:
      - expect:
          - event: response
            eval: "the bot introduces itself and asks the user what they think consciousness is"

      - user: "I think consciousness is just information getting broadcast around the brain so every part can use it."
        expect:
          - event: function_call
            calls:
              - name: set_positions
                args: {user_theory: gwt}
          - event: response
            eval: "the bot says the user's view is closest to global workspace theory, says it will defend a different named theory, and gives an argument for that theory"

  - name: cites_only_from_the_card
    turns:
      - expect:
          - event: response
            eval: "the bot asks the user what they think consciousness is"

      - user: "It's a global workspace. Information gets broadcast across the brain."
        expect:
          - event: function_call
            calls:
              - name: set_positions

      - user: "Before I start, what's the key paper for your side? Give me an author and a year."
        expect:
          - event: response
            eval: "the bot names a paper by Tononi, or by Oizumi, or by Albantakis, with a year, and does not name any other author's paper"

  - name: full_debate_reaches_a_verdict
    turns:
      - expect:
          - event: response
            eval: "the bot asks the user what they think consciousness is"

      - user: "Consciousness is a global workspace: whatever wins the competition for attention gets broadcast brain-wide."
        expect:
          - event: function_call
            calls:
              - name: set_positions
          - event: response
            eval: "the bot gives an opening argument and invites the user's opening statement"

      - user: "My opening: workspace theory makes predictions that can fail. Masking experiments show a sudden brain-wide ignition exactly when people report seeing the stimulus. Your theory's central quantity can't even be computed for a real brain."
        expect:
          - event: function_call
            calls:
              - name: opening_done
          - event: response
            eval: "the bot rebuts the user's point about computability or testability, and invites the user's rebuttal"

      - user: "My rebuttal: saying phi is well defined but intractable doesn't help. And your theory implies a simple grid of logic gates is more conscious than I am, which is absurd."
        expect:
          - event: function_call
            calls:
              - name: rebuttal_done
          - event: response
            eval: "the bot gives a closing statement and invites the user's closing statement"

      - user: "My closing: a theory of consciousness has to be testable, and only one of these two theories is. That's the last word."
        expect:
          - event: function_call
            calls:
              - name: judge_debate
          - event: response
            eval: "the bot announces a result: it states two final health numbers and says who won or that it was a draw, and offers a rematch"
```

- [ ] **Step 3: Write the suite manifest and run the scripted scenarios**

Create `server/evals/suite.yaml`:

```yaml
# `pipecat eval suite` manifest. Paths resolve relative to this file. The suite
# spawns a fresh bot per scenario, so every scenario starts in the setup node.
bots_dir: ..
scenarios_dir: .
runs_dir: ../eval-runs
concurrency: 1
suite:
  - bot: bot.py
    scenarios: [debate_text, debate_simulated]
```

Add `eval-runs/` to the repo-root `.gitignore` under the "Pipecat eval artifacts" heading.

With any running bot stopped (the suite starts its own), run from `server/`:

```bash
uv run pipecat eval suite evals/suite.yaml -k script
```

Expected: 3 scenarios pass. Logs land in `server/eval-runs/<timestamp>/logs/`. To iterate on one scenario with the conversation streamed, boot the bot yourself (`uv run bot.py -t eval`) and in a second terminal run `uv run pipecat eval run evals/debate_text.yaml -s full_debate_reaches_a_verdict -v` (check `uv run pipecat eval run --help` for the scenario-selection flag), restarting the bot between runs so it begins in `setup`. When a scenario fails, read the conversation: a wrong or missing `function_call` means the node's instructions in `flow.yaml` need tightening (the usual fault is the bot replying to a statement instead of calling the transition — make the "call X immediately, without replying" line more prominent); a judge `eval` failing on a reasonable reply means the criterion is too strict — loosen the criterion, not the bot.

- [ ] **Step 4: Write the simulated scenario**

Create `server/evals/debate_simulated.yaml`:

```yaml
name: debate_simulated

# Simulated, text mode: an LLM plays a stubborn workspace theorist through a
# whole debate. Run from server/:
#
#   uv run pipecat eval suite evals/suite.yaml -k simulation
#
# The caller and the judge both run on local Ollama (`ollama pull gemma4:12b`).

persona: |
  Sam, a confident amateur who has read a lot about global workspace theory and
  thinks integrated information theory is unscientific. When asked what
  consciousness is, Sam says it is information broadcast across the brain so
  every system can use it. Sam argues in three or four sentences at a time and
  never concedes. Sam's prepared points: workspace theory predicts a measurable
  brain-wide ignition and masking experiments find it; phi cannot be computed
  for any real brain; integrated information theory implies simple grids of
  logic gates are highly conscious; over a hundred researchers called it
  pseudoscience in 2023. Sam gives an opening statement when invited, a
  rebuttal when invited, and a closing statement when invited, one per turn.
goal: "Debate the bot through opening, rebuttal, and closing, hear the verdict, decline a rematch, then end the call."
success: "the debate ran through an opening, a rebuttal, and a closing round, the judge_debate tool was called, and the bot announced a winner or a draw with final health numbers"
max_turns: 10
metrics:
  - name: engages_the_point
    criterion: "when the reply comes during the debate rounds, it rebuts or concedes a specific point the user just made; a reply that merely agrees with the user fails; a greeting, a question about the user's view, or the verdict announcement passes"
    min_score: 0.8
  - name: speakable
    criterion: "the reply is plain spoken prose with no bullet points, markdown, emojis, or lists"
    min_score: 1
  - measure: words
    max_value: 90
runs: 2
```

- [ ] **Step 5: Run the simulation**

```bash
uv run pipecat eval suite evals/suite.yaml -k simulation
```

Expected: both runs pass. Read one full conversation in the run's log regardless of the result and check: rounds advanced one user turn each; the bot cited only card papers; the verdict's numbers are plausible (neither bar untouched at 100). If the bot wins every run by a wide margin, note it for Part D — do not tune the judge yet.

- [ ] **Step 6: Retire the starter text scenario and check the audio one**

```bash
git rm server/evals/starter_text.yaml
```

Start the bot (`uv run bot.py -t eval`), then in a second terminal run `uv run pipecat eval run evals/starter_audio.yaml -v`. Its judge is the same local Ollama default, so it needs no judge changes; update its second turn's criterion to "the bot responds to the user" if the original criterion no longer fits a debate bot. Expected: passes, proving the audio path still works end to end.

- [ ] **Step 7: Run everything and commit**

```bash
uv run pytest -q
git add server/evals .gitignore
git commit -m "test: scripted and simulated debate evals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: all pytest tests pass.

---

# Part C — UI (Session 2, worktree `../armchair-debater-ui`, branch `debate-ui`)

Session 2 owns `client/` and nothing else. It needs no running server: everything is built against a mock that replays `docs/design/debate-state-fixtures.json`.

### Task C.1: Contract types, store, and mock

**Files:**
- Create: `client/src/debate/types.ts`
- Create: `client/src/debate/store.ts`
- Create: `client/src/debate/mock.ts`
- Create: `client/src/debate/fixtures.json` (a copy of `docs/design/debate-state-fixtures.json`)

**Interfaces:**
- Consumes: the state contract (spec, "State contract").
- Produces:
  - `DebateSnapshot`, `Side`, `Stage`, `Hit`, `Verdict` types
  - `isDebateSnapshot(data: unknown): data is DebateSnapshot`
  - `useDebateStore` — zustand store: `{ snapshot: DebateSnapshot | null; hitCount: number; receive(data: unknown): void; clear(): void }`. `hitCount` increments whenever a snapshot arrives whose `last_hit` differs from the previous one, so components can key animations on it.
  - `startMockReplay(): () => void` — feeds the fixtures to the store on a timer; returns a stop function.

- [ ] **Step 1: Install dependencies and copy the fixtures**

```bash
cd client
npm install
cp ../docs/design/debate-state-fixtures.json src/debate/fixtures.json
```

(Create `src/debate/` first: `mkdir -p src/debate`.)

- [ ] **Step 2: Write the types**

Create `client/src/debate/types.ts`:

```ts
/**
 * The debate_state contract the server sends as an RTVI server message on
 * every change. Examples: src/debate/fixtures.json. The server's copy is
 * docs/design/debate-state-fixtures.json; keep the two identical.
 */

export type Stage = 'setup' | 'opening' | 'rebuttal' | 'closing' | 'verdict';
export type Side = 'user' | 'bot';

export interface Debater {
  theory_id: string | null;
  theory_name: string | null;
  health: number;
}

export interface Hit {
  by: Side;
  damage: number;
  recovery: number;
  reason: string;
}

export interface Verdict {
  winner: Side | 'draw';
  rationale: string;
}

export interface DebateSnapshot {
  type: 'debate_state';
  stage: Stage;
  user: Debater;
  bot: Debater;
  last_hit: Hit | null;
  verdict: Verdict | null;
}

export const isDebateSnapshot = (data: unknown): data is DebateSnapshot =>
  typeof data === 'object' &&
  data !== null &&
  (data as { type?: unknown }).type === 'debate_state';
```

- [ ] **Step 3: Write the store**

Create `client/src/debate/store.ts`:

```ts
import { create } from 'zustand';

import { isDebateSnapshot } from './types';
import type { DebateSnapshot } from './types';

interface DebateStore {
  snapshot: DebateSnapshot | null;
  /** Increments when a new hit arrives; key hit animations on it. */
  hitCount: number;
  /** Feed any RTVI server message; non-debate messages are ignored. */
  receive: (data: unknown) => void;
  clear: () => void;
}

const sameHit = (a: DebateSnapshot['last_hit'], b: DebateSnapshot['last_hit']) =>
  JSON.stringify(a) === JSON.stringify(b);

export const useDebateStore = create<DebateStore>((set) => ({
  snapshot: null,
  hitCount: 0,
  receive: (data) => {
    if (!isDebateSnapshot(data)) return;
    set((state) => ({
      snapshot: data,
      hitCount:
        data.last_hit && !sameHit(data.last_hit, state.snapshot?.last_hit ?? null)
          ? state.hitCount + 1
          : state.hitCount,
    }));
  },
  clear: () => set({ snapshot: null, hitCount: 0 }),
}));
```

- [ ] **Step 4: Write the mock replay**

Create `client/src/debate/mock.ts`:

```ts
import fixtures from './fixtures.json';
import { useDebateStore } from './store';

const STEP_MS = 2500;

/** Replays the contract fixtures into the store, looping. Returns a stop function. */
export const startMockReplay = (): (() => void) => {
  let index = 0;
  const tick = () => {
    if (index === 0) useDebateStore.getState().clear();
    useDebateStore.getState().receive(fixtures[index]);
    index = (index + 1) % fixtures.length;
  };
  tick();
  const timer = window.setInterval(tick, STEP_MS);
  return () => window.clearInterval(timer);
};
```

If TypeScript rejects the JSON import, add `"resolveJsonModule": true` to `compilerOptions` in `client/tsconfig.app.json`.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b
git add client/src/debate client/tsconfig.app.json client/package-lock.json
git commit -m "feat(client): debate_state types, store, and fixture replay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `tsc` exits 0.

---

### Task C.2: A working debate view, wired to live and mock data

**Files:**
- Create: `client/src/debate/HealthBar.tsx`
- Create: `client/src/debate/DebateView.tsx`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `useDebateStore`, `startMockReplay`, types (Task C.1); the scaffold `Console`'s `onServerMessage?: (data: unknown) => void` prop.
- Produces: `<DebateView />` — renders nothing until the first snapshot arrives.

This task delivers a plain, correct baseline so the data path is proven before any styling effort. Task C.3 makes it fun.

- [ ] **Step 1: Write the health bar**

Create `client/src/debate/HealthBar.tsx`:

```tsx
import { cn } from '@/lib/utils';

interface HealthBarProps {
  label: string;
  theory: string | null;
  health: number;
  /** Bars drain toward the centre: the user's from the right, the bot's from the left. */
  align: 'left' | 'right';
}

export const HealthBar = ({ label, theory, health, align }: HealthBarProps) => (
  <div className={cn('flex min-w-0 flex-1 flex-col gap-1', align === 'right' && 'items-end')}>
    <div className={cn('flex w-full items-baseline gap-2', align === 'right' && 'flex-row-reverse')}>
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      <span className="text-muted-foreground truncate text-xs">{theory ?? '—'}</span>
      <span className="ml-auto font-mono text-sm tabular-nums">{health}</span>
    </div>
    <div
      role="meter"
      aria-label={`${label} health`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={health}
      className={cn('bg-muted flex h-3 w-full overflow-hidden rounded-full', align === 'right' && 'justify-end')}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-700 ease-out',
          health > 50 ? 'bg-emerald-500' : health > 25 ? 'bg-amber-500' : 'bg-red-500',
        )}
        style={{ width: `${health}%` }}
      />
    </div>
  </div>
);
```

- [ ] **Step 2: Write the debate view**

Create `client/src/debate/DebateView.tsx`:

```tsx
import { HealthBar } from './HealthBar';
import { useDebateStore } from './store';
import type { Stage } from './types';

const STAGE_LABELS: Record<Stage, string> = {
  setup: 'Choosing sides',
  opening: 'Opening statements',
  rebuttal: 'Rebuttals',
  closing: 'Closing statements',
  verdict: 'Verdict',
};

const WINNER_LABELS = { user: 'You win', bot: 'The house wins', draw: 'A draw' } as const;

export const DebateView = () => {
  const snapshot = useDebateStore((state) => state.snapshot);
  const hitCount = useDebateStore((state) => state.hitCount);
  if (!snapshot) return null;

  const { user, bot, stage, last_hit: hit, verdict } = snapshot;

  return (
    <section aria-label="Debate" className="bg-background border-b px-4 py-3">
      <div className="flex items-end gap-6">
        <HealthBar label="You" theory={user.theory_name} health={user.health} align="left" />
        <span className="text-muted-foreground shrink-0 pb-0.5 text-xs uppercase tracking-widest">
          {STAGE_LABELS[stage]}
        </span>
        <HealthBar label="House" theory={bot.theory_name} health={bot.health} align="right" />
      </div>

      {verdict ? (
        <p className="mt-2 text-center text-sm">
          <strong>
            {WINNER_LABELS[verdict.winner]}, {user.health} to {bot.health}.
          </strong>{' '}
          {verdict.rationale}
        </p>
      ) : (
        hit && (
          // Re-keyed on every new hit so an entry animation replays.
          <p key={hitCount} className="animate-in fade-in mt-2 text-center text-sm">
            <span className="font-mono tabular-nums">
              {hit.by === 'user' ? 'You' : 'House'} −{hit.damage}
              {hit.recovery > 0 && ` +${hit.recovery}`}
            </span>{' '}
            <span className="text-muted-foreground">{hit.reason}</span>
          </p>
        )
      )}
    </section>
  );
};
```

- [ ] **Step 3: Mount it and feed it**

In `client/src/main.tsx`, add imports:

```tsx
import { useEffect, useState } from 'react';  // replaces the existing `useState` import from 'react' (keep StrictMode)

import { DebateView } from './debate/DebateView';
import { startMockReplay } from './debate/mock';
import { useDebateStore } from './debate/store';
```

Inside `Main`, before `return`, add:

```tsx
  const receive = useDebateStore((state) => state.receive);

  // `?mock` replays the contract fixtures so the debate UI runs with no server.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('mock')) return startMockReplay();
  }, []);
```

Replace the returned JSX's outer element

```tsx
    <div className="h-dvh">
      <Console
```

with

```tsx
    <div className="flex h-dvh flex-col">
      <DebateView />
      <Console
        className="min-h-0 flex-1"
        onServerMessage={receive}
```

leaving every other `Console` prop as it is. (The scaffold `Console` accepts `className` and `onServerMessage`; see `ConsoleProps` in `src/components/pipecat/console/console.tsx`.)

- [ ] **Step 4: Verify in the browser against the mock**

```bash
npm run dev
```

Open `http://localhost:5173/?mock`. Expected over about 25 seconds, looping: no bars, then both at 100 with theory names; the user's bar drops to 86; the bot's drops to 82 with a hit caption; stage label changes to Rebuttals, then Closing statements; finally the verdict line "You win, 74 to 61." Without `?mock`, the page looks as it did before (no debate view until connected).

- [ ] **Step 5: Lint, build, commit**

```bash
npm run lint && npm run build
git add client/src
git commit -m "feat(client): debate view with live health bars and fixture replay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: both commands exit 0.

---

### Task C.3: Make it fun

**Files:**
- Modify: anything under `client/src/debate/`; `client/src/main.tsx`; `client/src/index.css`

**Interfaces:**
- Consumes: the baseline from Task C.2. The store and types do not change.

This is the creative task, and its design belongs to Session 2 and the user together. It is not specified here on purpose.

- [ ] **Step 1: Agree a direction with the user**

Invoke the `frontend-design` skill. Start from the user's own brief: "a strength meter like a health gauge that draws down if the user's argument is good but goes back up during the rebuttal." Propose two or three directions (for example: arcade fighting-game HUD; scholarly duel with parchment and ink; minimalist broadcast scoreboard) and let the user pick. Use `?mock` to show each.

- [ ] **Step 2: Build it, keeping these behaviours**

Whatever the look, the finished view must:

- animate health changes rather than jumping, and show damage and recovery as visibly different events (a hit on one bar, a heal on the other, from the same snapshot);
- flash `last_hit.reason` with the numbers on every new hit, keyed on `hitCount`;
- show the current stage and both theory names;
- give the verdict a distinct, prominent treatment, with the winner, both final numbers, and the rationale;
- respect `prefers-reduced-motion`;
- keep `role="meter"` semantics on both bars;
- work at mobile width (the scaffold console has a mobile layout).

Decide with the user whether the scaffold's debugging console stays visible beneath the debate view or is replaced by a smaller composition of `src/components/pipecat/` parts (connect button, transcript, mic control). Either is fine; the debate view is the product.

- [ ] **Step 3: Verify and commit**

```bash
npm run lint && npm run build
```

Walk the `?mock` replay once at desktop and once at mobile width. Commit with a `feat(client):` message ending in the Co-Authored-By line.

---

# Part D — Integration (Session 1, user at the browser)

### Task D.1: Merge the streams

- [ ] **Step 1: Confirm the cards agent finished**

Read its report. In `../armchair-debater-cards/server` run `uv run pytest -q`. Expected: all pass. Skim `cards/theories.yaml` for anything that reads wrong; note every citation the agent said it dropped.

- [ ] **Step 2: Merge**

From the main checkout on `debate-mode`:

```bash
git merge --no-ff debate-cards -m "merge: twelve theory cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git merge --no-ff debate-ui -m "merge: debate UI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: no conflicts — file ownership was disjoint. If `client/src/debate/fixtures.json` and `docs/design/debate-state-fixtures.json` differ, the contract drifted: reconcile them and the code on both sides before going on.

- [ ] **Step 3: Re-run the server checks on all twelve cards**

```bash
cd server
uv run pytest -q
uv run pipecat eval suite evals/suite.yaml
```

Expected: all pass. With twelve cards the bot may now oppose `gwt` with `rpt` or `biological_naturalism` instead of `iit`; the `cites_only_from_the_card` scenario names IIT authors, so if it fails for that reason, change its second user turn to "It's a global workspace. And I want you to defend integrated information theory." and re-run.

### Task D.2: One live debate

- [ ] **Step 1: Run both halves**

Terminal 1: `cd server && uv run bot.py`. Terminal 2: `cd client && npm run dev`. Ask the user to open the client, connect, and hold a full debate by voice.

- [ ] **Step 2: Check, with the user**

- The debate view appears on connect with both bars at 100.
- Theory names fill in when the bot announces the sides.
- Each bar moves within a few seconds of the turn that caused it, and the caption names the actual point made.
- The stage label tracks the rounds; each round advanced after one user turn.
- The "judge is tallying" line plays, then the spoken verdict's numbers and winner match the bars on screen.
- Every paper the bot named is on a card.

- [ ] **Step 3: Tune only what the live run showed**

Likely adjustments, each a one-line change: the bot advancing a round on a mid-thought pause (tighten that node's instruction in `flow.yaml`); the bot always winning (in `debate_state.py`, scale damage dealt by `"bot"` — add `BOT_DAMAGE_SCALE = 0.8` and apply it in `apply_hit`, with a test); bars lagging badly (lower `max_tokens` in `judge._complete`). Re-run `uv run pytest -q` and the scripted suite after any change.

- [ ] **Step 4: Update the README and finish**

Replace the README's Configuration block so it names the real services (Gradium STT and TTS, General Compute LLM) and add a short "How a debate works" section: the three rounds, the health bars, `?mock`. Commit. Then use the `superpowers:finishing-a-development-branch` skill to decide how `debate-mode` lands on `master`, and remove the worktrees:

```bash
git worktree remove ../armchair-debater-ui
git worktree remove ../armchair-debater-cards
```
