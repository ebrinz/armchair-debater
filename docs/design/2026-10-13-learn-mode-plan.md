# Learn Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spoken tutor that teaches one chosen theory of consciousness in four steps, checks the learner on it with a judged three-question exam, and clears the first rung of a LEARN → SPAR → DEBATE ladder shown on every card.

**Architecture:** Five new Pipecat Flows nodes in `flow.yaml` (pick, lesson ×4, check ×3, report), built exactly like sparring: one node entered once per step, a handler that counts, a barge-in guard. The cards gain a `lesson` block the tutor teaches from and the judge grades against. The scorer gains a node-to-judge-call table. The client gains a `learn` mode, a lesson screen, learn variants of the fight and decision screens, and a `localStorage` ladder. The voice path (`bot.py`'s pipeline) is untouched.

**Tech Stack:** Python 3.12, pipecat-ai 1.11 (`pipecat.flows`, `pipecat.evals`), PyYAML, pytest + pytest-asyncio, uv. React 19 + Vite + zustand + vitest.

**Spec:** `docs/design/2026-10-13-learn-mode-design.md`. Read it first. The sparring half of `docs/design/2026-09-20-modes-design.md` is the pattern every server task copies.

## Global Constraints

- Pipecat is pinned at 1.11. Verify any Pipecat class, import, or parameter not shown here with `pipecat context-hub check-deprecation <Symbol>` / `search-api`, or by reading `server/.venv/lib/python3.12/site-packages/pipecat/`. Never write Pipecat APIs from memory.
- `uv run` for everything Python, from `server/`. `npm` from `client/`. Never `pip`.
- The voice path is not under test until the end. Every eval here is text mode (`pipecat eval suite … -k script`, and the simulated scenario). Do not run `starter_audio.yaml` or a live session until Task 14.
- Every prompt carries the voice guard through `{{ voice_rules }}`; no markdown reaches speech.
- The tutor speaks only from the card. Citations only from the card's `citations`.
- Mode ids: `debate`, `sparring`, `explore`, `learn`. New stages: `lesson`, `check`. New node names: `tutor_setup`, `lesson`, `check`, `lesson_report`. Bot name in learn mode: `The Tutor`.
- Lesson: four steps titled, in order, `The idea`, `The terms`, `The case for it`, `What it's up against`. Check: three questions. GRASP starts at 100, answers scored at scale 1 by `apply_answer`; *got it* at 70 or more (`GOT_IT_AT = 70`); banners `YOU'VE GOT IT` ≥ 70, `NEARLY` 40–69, `NOT YET` < 40.
- The ladder lives in the client under `localStorage` key `armchair.ladder`; a rung lights only on `verdict.winner === "user"`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Push `debate-mode` and fast-forward `master` at each Part's end (see the memory `push-at-milestones`). Never commit `server/.env` or `eval-runs/`.

## Review Focus

Inputs the spec implies but a reader might not test. Each has its test in the task named.

1. **A theory named at the front door** ("Teach me global workspace theory.") must go through `choose_mode(learn)` and then `choose_lesson` without the tutor asking which theory. The scripted eval in Task 13 opens this way.
2. **The rubric must be the one for the question being answered.** The scorer scores in the background, after the handler may already have moved `check_q` on; it must capture the rubric at submit time. Task 5 pins this.
3. **A second lesson in one session** (`learn_again`, or learn → menu → learn) must start at step 1, check 1, GRASP 100, with no leftover report. Task 6 pins `choose_lesson` resetting all of it.
4. **A `localStorage` that is missing, blocked, or holds garbage** must read as an empty ladder, not crash the UI. Task 9 pins this.
5. **A verdict snapshot that is a draw, or has no `user.theory_id`** must light no rung. Task 9 pins this.

---

# Part 1 — The lesson on the card

### Task 1: Lesson schema and lesson text in `knowledge.py`

**Files:**
- Modify: `server/knowledge.py`
- Test: `server/tests/test_knowledge.py`

**Interfaces:**
- Produces: `Term(term, means)`, `Check(question, looks_for)`, `Lesson(in_plain_words, terms, example, misreading, checks)` frozen dataclasses; `Theory.lesson: Lesson`; `LESSON_STEPS: tuple[str, str, str, str]`; `CHECKS = 3`; `lesson_step(theory, step: int) -> str` (prompt text for step 1–4); `check_questions(theory) -> list[tuple[str, str]]` (three `(question, rubric)` pairs, the first being "in your own words").

- [ ] **Step 1: Give the test card a lesson, and write the failing tests**

In `server/tests/test_knowledge.py`, add a `lesson()` helper above `card()` and a `"lesson": lesson()` entry to `card()`'s `base` dict:

```python
def lesson(**overrides):
    base = {
        "in_plain_words": "Alpha, in plain words.",
        "terms": [
            {"term": "alpha", "means": "the first thing"},
            {"term": "beta", "means": "the second thing"},
            {"term": "gamma", "means": "the third thing"},
        ],
        "example": "An example alpha handles well.",
        "misreading": "People think alpha is beta. It is not.",
        "checks": [
            {"question": "What is alpha?", "looks_for": "the first thing"},
            {"question": "Why not beta?", "looks_for": "beta is the second thing"},
        ],
    }
    base.update(overrides)
    return base
```

Then append these tests:

```python
def test_a_card_carries_its_lesson(tmp_path):
    theory = knowledge.load(write(tmp_path, [card(), beta()]))["alpha"]
    assert theory.lesson.in_plain_words == "Alpha, in plain words."
    assert theory.lesson.terms[0] == knowledge.Term("alpha", "the first thing")
    assert theory.lesson.checks[1] == knowledge.Check("Why not beta?", "beta is the second thing")


def test_rejects_a_card_with_no_lesson(tmp_path):
    bad = card()
    del bad["lesson"]
    with pytest.raises(CardError, match="alpha.*lesson"):
        knowledge.load(write(tmp_path, [bad, beta()]))


@pytest.mark.parametrize("field", ["in_plain_words", "example", "misreading"])
def test_rejects_an_empty_lesson_text(tmp_path, field):
    with pytest.raises(CardError, match=field):
        knowledge.load(write(tmp_path, [card(lesson=lesson(**{field: "  "})), beta()]))


@pytest.mark.parametrize("count", [2, 5])
def test_rejects_terms_outside_three_to_four(tmp_path, count):
    terms = [{"term": f"t{i}", "means": f"m{i}"} for i in range(count)]
    with pytest.raises(CardError, match="terms"):
        knowledge.load(write(tmp_path, [card(lesson=lesson(terms=terms)), beta()]))


def test_rejects_three_checks(tmp_path):
    checks = [{"question": f"q{i}", "looks_for": f"r{i}"} for i in range(3)]
    with pytest.raises(CardError, match="checks"):
        knowledge.load(write(tmp_path, [card(lesson=lesson(checks=checks)), beta()]))


def test_rejects_a_check_without_a_rubric(tmp_path):
    checks = [{"question": "q1", "looks_for": "r1"}, {"question": "q2"}]
    with pytest.raises(CardError, match="looks_for"):
        knowledge.load(write(tmp_path, [card(lesson=lesson(checks=checks)), beta()]))


def test_lesson_steps_draw_on_the_lesson_and_the_card(tmp_path):
    theory = knowledge.load(write(tmp_path, [card(), beta()]))["alpha"]
    assert knowledge.LESSON_STEPS == (
        "The idea",
        "The terms",
        "The case for it",
        "What it's up against",
    )
    assert "Alpha, in plain words." in knowledge.lesson_step(theory, 1)
    assert "Consciousness is alpha." in knowledge.lesson_step(theory, 1)
    assert "- alpha: the first thing" in knowledge.lesson_step(theory, 2)
    three = knowledge.lesson_step(theory, 3)
    assert "An example alpha handles well." in three and "- a1" in three and "Author 2000" in three
    four = knowledge.lesson_step(theory, 4)
    assert "- o1" in four and "People think alpha is beta." in four
    with pytest.raises(ValueError):
        knowledge.lesson_step(theory, 5)


def test_check_questions_start_with_own_words_then_the_cards_two(tmp_path):
    theory = knowledge.load(write(tmp_path, [card(), beta()]))["alpha"]
    checks = knowledge.check_questions(theory)
    assert knowledge.CHECKS == len(checks) == 3
    assert checks[0][0] == "Explain Alpha Theory to me in your own words."
    assert "Alpha, in plain words." in checks[0][1] and "alpha (the first thing)" in checks[0][1]
    assert checks[1] == ("What is alpha?", "the first thing")
    assert checks[2] == ("Why not beta?", "beta is the second thing")


def test_client_cards_never_leak_the_lesson():
    for card_ in knowledge.client_cards():
        assert "lesson" not in card_
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd server && uv run pytest tests/test_knowledge.py -q`
Expected: the new tests fail (`AttributeError: ... has no attribute 'Term'` and friends). Note that the real cards will now also fail to load once the schema requires a lesson, so `test_real_cards_load_and_lookup_is_case_insensitive` and the whole suite will be red until Task 2 lands. That is expected; Task 2 follows immediately.

- [ ] **Step 3: Implement the schema and the step text**

In `server/knowledge.py`, after the `CardError` class, add:

```python
@dataclass(frozen=True)
class Term:
    term: str
    means: str


@dataclass(frozen=True)
class Check:
    question: str
    looks_for: str


@dataclass(frozen=True)
class Lesson:
    in_plain_words: str
    terms: tuple[Term, ...]
    example: str
    misreading: str
    checks: tuple[Check, ...]
```

Add `lesson: Lesson` as the last field of `Theory`. Add the parser after `Lesson`:

```python
_LESSON_TEXT_FIELDS = ("in_plain_words", "example", "misreading")


def _pairs(label: str, items, kind: str, keys: tuple[str, str]) -> list[tuple[str, str]]:
    out = []
    for item in items:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(k), str) and item[k].strip() for k in keys
        ):
            raise CardError(
                f"card {label}: each lesson {kind} needs a non-empty '{keys[0]}' and '{keys[1]}'"
            )
        out.append((item[keys[0]].strip(), item[keys[1]].strip()))
    return out


def _parse_lesson(label: str, raw) -> Lesson:
    if not isinstance(raw, dict):
        raise CardError(f"card {label}: 'lesson' must be a mapping")
    for field in _LESSON_TEXT_FIELDS:
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise CardError(f"card {label}: lesson '{field}' must be a non-empty string")
    terms = raw.get("terms")
    if not isinstance(terms, list) or not 3 <= len(terms) <= 4:
        raise CardError(f"card {label}: lesson 'terms' must have three or four entries")
    checks = raw.get("checks")
    if not isinstance(checks, list) or len(checks) != 2:
        raise CardError(f"card {label}: lesson 'checks' must have exactly two entries")
    return Lesson(
        in_plain_words=raw["in_plain_words"].strip(),
        terms=tuple(Term(*t) for t in _pairs(label, terms, "term", ("term", "means"))),
        example=raw["example"].strip(),
        misreading=raw["misreading"].strip(),
        checks=tuple(
            Check(*c) for c in _pairs(label, checks, "check", ("question", "looks_for"))
        ),
    )
```

In `_parse`, build the lesson and pass it to `Theory`:

```python
    return Theory(
        **{f: raw[f].strip() for f in _TEXT_FIELDS},
        **{f: tuple(raw[f]) for f in _LIST_FIELDS if f != "moves"},
        moves=tuple(moves),
        lesson=_parse_lesson(label, raw.get("lesson")),
    )
```

After `brief()`, add the lesson's prompt text:

```python
# The four steps of a lesson, in order. Steps one and two are the lesson's own
# material; three and four add the card's arguments and objections to it.
LESSON_STEPS = ("The idea", "The terms", "The case for it", "What it's up against")
# The check: "in your own words", then the card's two questions.
CHECKS = 3


def _bullets(items) -> str:
    return "\n".join(f"- {item}" for item in items)


def lesson_step(theory: Theory, step: int) -> str:
    """The material the tutor teaches in lesson step ``step`` (1 to 4), as prompt text."""
    lesson = theory.lesson
    if step == 1:
        return (
            f"The idea, in plain words: {lesson.in_plain_words}\n"
            f"The claim as the card states it: {theory.claim}"
        )
    if step == 2:
        return "The terms:\n" + "\n".join(f"- {t.term}: {t.means}" for t in lesson.terms)
    if step == 3:
        return (
            f"An example the theory handles well: {lesson.example}\n"
            f"The arguments for it:\n{_bullets(theory.arguments)}\n"
            f"Papers you may cite:\n{_bullets(theory.citations)}"
        )
    if step == 4:
        return (
            f"Known objections:\n{_bullets(theory.objections)}\n"
            f"A common misreading, and the correction: {lesson.misreading}"
        )
    raise ValueError(f"no lesson step {step}")


def check_questions(theory: Theory) -> list[tuple[str, str]]:
    """The exam: ``(question, rubric)`` for each of the three checks, in order."""
    lesson = theory.lesson
    own_words = (
        f"Explain {theory.name} to me in your own words.",
        lesson.in_plain_words
        + " Key terms: "
        + "; ".join(f"{t.term} ({t.means})" for t in lesson.terms),
    )
    return [own_words, *((c.question, c.looks_for) for c in lesson.checks)]
```

`client_cards()` needs no change: it names its keys explicitly, so the lesson never leaves the server.

- [ ] **Step 4: Run the knowledge tests**

Run: `cd server && uv run pytest tests/test_knowledge.py -q -k "not real_cards and not bundled_deck and not contract and not seven_key"`
Expected: PASS for every schema test. The tests that load the real deck stay red until Task 2.

- [ ] **Step 5: Commit**

```bash
git add server/knowledge.py server/tests/test_knowledge.py
git commit -m "feat(knowledge): a lesson on every card — terms, example, misreading, two checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Author the twelve lessons, fact-checked

**Files:**
- Modify: `server/cards/theories.yaml`
- Test: `server/tests/test_cards_complete.py`

**Interfaces:**
- Consumes: the `lesson` schema from Task 1.
- Produces: every card loads; `knowledge.THEORIES[id].lesson` is real material.

- [ ] **Step 1: Write the completeness tests**

Append to `server/tests/test_cards_complete.py`:

```python
LESSON_WORD_CAPS = {
    "in_plain_words": 90,
    "example": 130,
    "misreading": 90,
}


def test_lesson_text_is_speakable_and_short():
    for theory in knowledge.THEORIES.values():
        lesson = theory.lesson
        texts = {
            "in_plain_words": lesson.in_plain_words,
            "example": lesson.example,
            "misreading": lesson.misreading,
        }
        for field, text in texts.items():
            assert not any(ch in text for ch in "*#_`[];"), (theory.id, field)
            assert len(text.split()) <= LESSON_WORD_CAPS[field], (theory.id, field)
        for term in lesson.terms:
            assert not any(ch in term.means for ch in "*#_`[];"), (theory.id, term.term)
            assert len(term.means.split()) <= 45, (theory.id, term.term)
        for check in lesson.checks:
            assert check.question.rstrip().endswith("?"), (theory.id, check.question)
            assert len(check.question.split()) <= 45, (theory.id, check.question)
            assert len(check.looks_for.split()) <= 60, (theory.id, check.question)


def test_the_two_checks_on_a_card_are_different_questions():
    for theory in knowledge.THEORIES.values():
        first, second = theory.lesson.checks
        assert first.question != second.question, theory.id
```

- [ ] **Step 2: Run them to see the deck fail to load**

Run: `cd server && uv run pytest tests/test_cards_complete.py -q`
Expected: errors at import (`CardError: card gwt: 'lesson' must be a mapping`).

- [ ] **Step 3: Write the Global Workspace lesson, as the model for the rest**

Add this `lesson:` block to the `gwt` card in `server/cards/theories.yaml`, after `citations:`:

```yaml
  lesson:
    in_plain_words: >-
      Your brain does a huge amount of work in parallel, and almost all of it
      stays private to the module that did it. A content becomes conscious at
      the moment it wins a competition for a small shared stage and is
      broadcast to everything at once: memory, language, planning, action.
      Being conscious of something just is its being broadcast like this.
    terms:
      - term: global workspace
        means: the small shared stage. Whatever wins a place on it is sent to the whole brain at once, and it holds only one or a few contents at a time.
      - term: broadcast
        means: the sending-everywhere. A content that is broadcast can be reported, remembered, and acted on by any system; one that is not stays local.
      - term: ignition
        means: the sudden, brain-wide, self-sustaining burst of activity, especially in prefrontal and parietal cortex, that the theory says is the broadcast happening.
      - term: access
        means: being available to the rest of the brain for report, memory, and action. On this theory, access is what consciousness is.
    example: >-
      Flash a word on a screen for a few tens of milliseconds and then cover it
      with a mask, and people say they saw nothing, yet the word still primes
      their responses, so the brain processed it. Flash it a little longer and
      they see it, and now the recording shows the same early visual activity
      followed by a sudden, brain-wide ignition. The theory says that ignition
      is the word winning the workspace: same input, same early processing, and
      the only difference between unseen and seen is whether it was broadcast.
    misreading: >-
      People hear "workspace" and picture a store, a desk where the brain keeps
      what it is thinking about. It is not a store. It is a broadcast: one
      content wins, is sent everywhere at once, and the next one has to knock
      it off. That is why the theory says consciousness is serial and limited,
      not a big memory.
    checks:
      - question: What does the theory say happens in the brain at the moment something becomes conscious, and how is that different from when it stays unconscious?
        looks_for: a sudden brain-wide ignition, especially prefrontal and parietal, which is the content being broadcast; unconscious processing of the same input stays local to the module that did it
      - question: The brain does an enormous amount in parallel. Why, on this theory, can you only be conscious of one or a few things at a time?
        looks_for: the workspace has limited capacity, contents compete for it and one wins at a time, so consciousness is serial even though processing is parallel
```

- [ ] **Step 4: Write the other eleven**

For each remaining card (`iit`, `hot`, `rpt`, `predictive_processing`, `ast`, `illusionism`, `biological_naturalism`, `orch_or`, `panpsychism`, `property_dualism`, `analytic_idealism`), read the card's claim, arguments, objections, and citations, then write a `lesson:` block to the same shape and rules:

- `in_plain_words`: the claim with no jargon, two or three sentences, as if to a curious friend. Under 90 words.
- `terms`: three or four words a newcomer trips on, each defined in one or two sentences *in the theory's own sense* (e.g. for `iit`: phi, integration, cause-effect structure, the exclusion postulate; for `hot`: first-order state, higher-order thought, blindsight; for `illusionism`: phenomenal consciousness, quasi-phenomenal, introspection).
- `example`: one concrete case or thought experiment the theory handles well, drawn from or consistent with its own papers (e.g. `iit`: the cerebellum; `hot`: blindsight; `ast`: the brain's model of attention being simplified like the body schema; `orch_or`: anaesthetics acting on microtubules; `panpsychism`: the combination problem *posed as the thing it must answer*, not an advantage). Under 130 words.
- `misreading`: the way people commonly get it wrong, and the correction (e.g. `iit`: "it says computers are conscious"; it says only integrated systems are, and a feed-forward computer is not; `illusionism`: "it says we are not conscious"; it says experience exists but not as it seems; `panpsychism`: "it says rocks think"; it says the fundamental constituents have some experience, not that aggregates do). Under 90 words.
- `checks`: two questions whose answers are on the card, with a `looks_for` the judge can grade against. Not the same as "in your own words", and not the same as each other. Each ends with `?`.

Speakable text throughout: no `*`, `#`, `_`, backticks, `[`, `]`, `;`.

- [ ] **Step 5: Run the whole server suite**

Run: `cd server && uv run pytest -q`
Expected: PASS, every test (the deck loads again; the two new completeness tests pass).

- [ ] **Step 6: Fact-check by a second agent**

Dispatch a fresh subagent (general-purpose, with web access) with this brief, and apply its findings before committing:

> Read `server/cards/theories.yaml`. For each of the twelve cards, check every factual claim in the `lesson` block (`terms`, `example`, `misreading`) against the papers listed in that card's `citations` and, where needed, their primary sources (Crossref, the publisher, PhilPapers). The `in_plain_words` must say the same thing as `claim`. For each card report: CONFIRMED, or the exact sentence that is wrong or unsupported and what the source actually says. Do not rewrite the YAML; report only. Flag any example that is attributed to a paper that does not contain it.

Fix every flagged sentence in the YAML. Re-run `uv run pytest -q`.

- [ ] **Step 7: Commit and push (milestone: Part 1)**

```bash
git add server/cards/theories.yaml server/tests/test_cards_complete.py
git commit -m "feat(cards): a lesson on each of the twelve theories, fact-checked

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```

---

# Part 2 — The flow, the judge, the scorer, the state

### Task 3: `DebateState` learns the lesson, and the fixtures follow

**Files:**
- Modify: `server/debate_state.py`
- Modify: `server/make_fixtures.py`
- Modify: `docs/design/*-fixtures.json` (regenerated), copied to `client/src/arcade/fixtures/`
- Modify: `server/tests/test_client_fixtures.py`
- Test: `server/tests/test_debate_state.py`

**Interfaces:**
- Produces: `MODES` includes `"learn"`; `STAGES` includes `"lesson"`, `"check"`; `TUTOR = "The Tutor"`; `GOT_IT_AT = 70`; `set_solo(user_id, user_name, bot_name=EXAMINER)`; `set_lesson(step, of, title)`; snapshot key `lesson`; `winner()` in learn mode.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_debate_state.py`:

```python
async def test_a_fresh_state_has_no_lesson():
    assert DebateState().snapshot()["lesson"] is None


async def test_the_tutor_takes_the_examiners_seat_under_its_own_name():
    state = DebateState()
    await state.set_mode("learn")
    await state.set_solo("gwt", "Global Workspace Theory", "The Tutor")
    snapshot = state.snapshot()
    assert snapshot["user"]["theory_id"] == "gwt"
    assert snapshot["bot"] == {"theory_id": None, "theory_name": "The Tutor", "health": 100}
    # The default is still the examiner, so sparring is untouched.
    await state.set_solo("gwt", "Global Workspace Theory")
    assert state.snapshot()["bot"]["theory_name"] == "The Examiner"


async def test_the_lesson_step_is_emitted_and_cleared_when_the_stage_moves_on():
    seen = []

    async def on_change(snapshot):
        seen.append(snapshot["lesson"])

    state = DebateState(on_change=on_change)
    await state.set_mode("learn")
    await state.set_stage("lesson")
    await state.set_lesson(2, 4, "The terms")
    await state.set_stage("check")

    assert seen[-2:] == [{"step": 2, "of": 4, "title": "The terms"}, None]


async def test_got_it_at_seventy_in_learn_mode_only():
    state = DebateState()
    await state.set_mode("learn")
    await state.set_solo("gwt", "Global Workspace Theory", "The Tutor")
    await state.apply_answer(25, 0, "r")
    await state.apply_answer(5, 0, "r")
    assert state.health["user"] == 70 and state.winner() == "user"
    await state.apply_answer(1, 0, "r")
    assert state.health["user"] == 69 and state.winner() == "bot"

    # Sparring still holds at fifty.
    spar = DebateState()
    await spar.set_mode("sparring")
    await spar.set_solo("gwt", "Global Workspace Theory")
    await spar.apply_answer(25, 0, "r")
    await spar.apply_answer(25, 0, "r")
    assert spar.health["user"] == 50 and spar.winner() == "user"
```

Add `"learn"` to the modes test that rejects unknown ones if it enumerates them (it does not; `test_unknown_mode_is_rejected` uses `"karaoke"`, leave it).

- [ ] **Step 2: Run to see them fail**

Run: `cd server && uv run pytest tests/test_debate_state.py -q`
Expected: the four new tests fail (`KeyError: 'lesson'`, `TypeError: set_solo() takes 3 positional arguments`, …).

- [ ] **Step 3: Implement**

In `server/debate_state.py`:

```python
# "mode" is the front door. Sparring reuses "setup" and "verdict" for its first
# and last nodes and has one stage of its own; the explorer has one stage; the
# tutor reuses "setup" and "verdict" too, and has "lesson" and "check".
STAGES = ("mode", "setup", *DEBATE_ROUNDS, "verdict", "sparring", "explore", "lesson", "check")
MODES = ("debate", "sparring", "explore", "learn")
EXAMINER = "The Examiner"
TUTOR = "The Tutor"
# Sparring: at 50 or more the view has held.
HOLDS_AT = 50
# Learning: at 70 or more the learner has got it.
GOT_IT_AT = 70
```

In `_reset_scores`, add `self._lesson: dict | None = None`. In `set_stage`, after the `if stage in ("mode", "setup")` block:

```python
        if stage != "lesson":
            self._lesson = None
```

Change `set_solo`:

```python
    async def set_solo(self, user_id: str, user_name: str, bot_name: str = EXAMINER) -> None:
        """Sparring or a lesson: a player with a theory, and an examiner or tutor with none."""
        self._theories = {
            "user": {"theory_id": user_id, "theory_name": user_name},
            "bot": {"theory_id": None, "theory_name": bot_name},
        }
        self._reset_scores()
        await self._changed()
```

Add after `set_question`:

```python
    async def set_lesson(self, step: int, of: int, title: str) -> None:
        """The tutor: which step of the lesson this is."""
        self._lesson = {"step": step, "of": of, "title": title}
        await self._changed()
```

In `winner()`:

```python
        if self.mode == "learn":
            return "user" if self.health["user"] >= GOT_IT_AT else "bot"
```

before the sparring line. In `snapshot()`, add `"lesson": dict(self._lesson) if self._lesson else None,` after `"question"`.

- [ ] **Step 4: Add the learn fixture to the generator**

In `server/make_fixtures.py`, add after `explore()`:

```python
async def learn() -> list[dict]:
    r = Recorder()
    s = r.state
    await s.set_stage("mode")
    r.keep()
    await s.set_mode("learn")
    await s.set_stage("setup")
    r.keep()
    await s.set_solo(*GWT, "The Tutor")
    r.keep()
    await s.set_stage("lesson")
    for step, title in enumerate(
        ("The idea", "The terms", "The case for it", "What it's up against"), start=1
    ):
        await s.set_lesson(step, 4, title)
        r.keep()
    await s.set_stage("check")

    # (raw damage, raw recovery, reason) for the answer to each of three questions.
    answers = [
        (
            4,
            0,
            "Asked for the theory in their own words, gave broadcast and the small stage, missed why it is serial.",
        ),
        (16, 0, "Asked what ignition is, described a local response rather than a brain-wide one."),
        (
            2,
            10,
            "Asked why only a few things at once, answered from the limited workspace and repaired the ignition slip.",
        ),
    ]
    for number, (damage, recovery, reason) in enumerate(answers, start=1):
        await s.set_question(number, len(answers))
        r.keep()
        await s.apply_answer(damage, recovery, reason)
        r.keep()

    await s.set_stage("verdict")
    await s.set_verdict(
        "You have the broadcast and the limited stage, and you can say why consciousness is serial. "
        "Go back over The terms: ignition is brain-wide, not a local response."
    )
    r.keep()
    return r.frames
```

Register it: `"learn-state-fixtures.json": learn,` in `FIXTURES`. Add the pair to `server/tests/test_client_fixtures.py`:

```python
    ("docs/design/learn-state-fixtures.json", "client/src/arcade/fixtures/learn-state.json"),
```

- [ ] **Step 5: Regenerate and copy**

```bash
cd server && uv run python make_fixtures.py
cp ../docs/design/debate-state-fixtures.json ../client/src/arcade/fixtures/debate-state.json
cp ../docs/design/sparring-state-fixtures.json ../client/src/arcade/fixtures/sparring-state.json
cp ../docs/design/explore-state-fixtures.json ../client/src/arcade/fixtures/explore-state.json
cp ../docs/design/learn-state-fixtures.json ../client/src/arcade/fixtures/learn-state.json
```

Check the learn fixture's last frame: `user.health` must be 83 (100 − 4 − 16, then +5 healed − 2) and `verdict.winner` `"user"`.

- [ ] **Step 6: Run the server suite and the client tests**

Run: `cd server && uv run pytest -q` then `cd ../client && npm test`
Expected: both PASS. The client's `isDebateSnapshot` ignores unknown keys, so the extra `lesson` field is accepted; the learn fixture is not yet imported anywhere in the client.

- [ ] **Step 7: Commit**

```bash
git add server/debate_state.py server/make_fixtures.py server/tests docs/design/*-fixtures.json client/src/arcade/fixtures
git commit -m "feat(state): learn mode — the tutor's seat, the lesson step, got-it at seventy; learn fixture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The judge scores understanding and writes the report

**Files:**
- Modify: `server/judge.py`
- Test: `server/tests/test_judge.py`

**Interfaces:**
- Produces: `score_understanding(*, theory, question, rubric, history, answer, complete=None) -> TurnScore`; `write_report(*, theory, health, steps, hits, complete=None) -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_judge.py` (the file already has `scripted(...)` and imports `judge`, `JudgeError`, `TurnScore`):

```python
async def test_score_understanding_shows_the_judge_the_question_rubric_and_answer():
    complete = scripted('{"damage": 16, "recovery": 0, "reason": "Asked what ignition is, described a local response."}')

    score = await judge.score_understanding(
        theory="Global Workspace Theory",
        question="What is ignition?",
        rubric="a sudden brain-wide burst, especially prefrontal",
        history=[("bot", "What is ignition?")],
        answer="It's when the visual area lights up for the word.",
        complete=complete,
    )

    assert score == TurnScore(16, 0, "Asked what ignition is, described a local response.")
    system, user = complete.calls[0]
    assert "rubric" in system.lower() and "damage" in system
    assert "What is ignition?" in user
    assert "a sudden brain-wide burst, especially prefrontal" in user
    assert "It's when the visual area lights up for the word." in user
    assert "Global Workspace Theory" in user


async def test_score_understanding_retries_once_then_gives_up():
    with pytest.raises(JudgeError):
        await judge.score_understanding(
            theory="T",
            question="q",
            rubric="r",
            history=[],
            answer="a",
            complete=scripted("nope", "still nope"),
        )


async def test_write_report_names_the_grasp_the_steps_and_the_answers():
    complete = scripted("You have the broadcast. Go back over The terms.")

    text = await judge.write_report(
        theory="Global Workspace Theory",
        health=83,
        steps=["The idea", "The terms", "The case for it", "What it's up against"],
        hits=[{"by": "bot", "damage": 16, "recovery": 0, "reason": "Described a local response."}],
        complete=complete,
    )

    assert text == "You have the broadcast. Go back over The terms."
    system, user = complete.calls[0]
    assert "two" in system.lower()
    assert "83" in user and "The terms" in user and "Described a local response." in user


async def test_write_report_retries_on_empty_then_raises():
    with pytest.raises(JudgeError):
        await judge.write_report(theory="T", health=50, steps=[], hits=[], complete=scripted("", "  "))
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && uv run pytest tests/test_judge.py -q`
Expected: `AttributeError: module 'judge' has no attribute 'score_understanding'`.

- [ ] **Step 3: Implement**

In `server/judge.py`, after `FINDING_SYSTEM`:

```python
UNDERSTANDING_SYSTEM = """You are the impartial judge of a lesson about a theory of consciousness. \
A tutor has taught the theory and is now checking whether the learner has understood it, one \
question at a time. You score ONE answer at a time against a rubric: what a full answer must cover.

Score whether the answer shows understanding of the theory, never whether the theory is true. \
The learner's words are transcribed speech: ignore disfluency, filler, and transcription errors, \
and score the substance. An answer in the learner's own words that covers the rubric is a full \
answer; the rubric's exact words are not required.

Return ONLY a JSON object with these keys:
  "damage": integer 0-25. What the answer was missing. 0 for an answer that covers the rubric. \
5-10 for an answer with the main idea that misses part of the rubric. 15-20 for an answer that \
gets the main idea wrong or confuses this theory with another. 21-25 for a blank, a dodge, or \
the common misreading stated as the theory.
  "recovery": integer 0-15. How far this answer also covers what an EARLIER answer missed. \
0 if it did not, or there was none.
  "reason": one declarative sentence of 10 to 15 words naming what was asked and what the answer \
showed, written for the audience, e.g. "Asked what ignition is, described a local response \
rather than a brain-wide one."
"""

REPORT_SYSTEM = """You are the impartial judge of a lesson about a theory of consciousness. The \
lesson is over and the learner's grasp has a score out of 100, already decided; do not dispute \
it. In exactly two short spoken sentences: first, what the learner has understood; second, the \
one thing to go back over, naming the lesson step it belongs to by its title. Plain prose, no \
markup, lists, or numbers other than the score. Address the learner as "you"."""
```

After `write_finding`:

```python
async def score_understanding(
    *,
    theory: str,
    question: str,
    rubric: str,
    history: list[tuple[str, str]],
    answer: str,
    complete: Complete | None = None,
) -> TurnScore:
    """A lesson's check: score one answer against the card's rubric for that question."""
    complete = complete or _complete
    transcript = (
        "\n".join(f"{'LEARNER' if who == 'user' else 'TUTOR'}: {text}" for who, text in history)
        or "(nothing yet)"
    )
    prompt = (
        f"The theory being learned: {theory}\n\n"
        f"The check so far:\n{transcript}\n\n"
        f"The question: {question}\nA full answer covers: {rubric}\n\n"
        f"Score this answer by the LEARNER:\n{answer}"
    )

    async def attempt() -> TurnScore:
        return parse_score(await complete(UNDERSTANDING_SYSTEM, prompt))

    return await _twice(attempt, "scoring a check answer")


async def write_report(
    *,
    theory: str,
    health: int,
    steps: list[str],
    hits: list[dict],
    complete: Complete | None = None,
) -> str:
    """A lesson's report: what landed and what to go back over, in two spoken sentences."""
    complete = complete or _complete
    lines = (
        "\n".join(f"- lost {h['damage']}, won back {h['recovery']}: {h['reason']}" for h in hits)
        or "(no answers were scored)"
    )
    prompt = (
        f"The theory learned: {theory}\nGrasp at the end: {health} out of 100.\n"
        f"The lesson's steps, by title: {', '.join(steps) or '(none)'}\n\n"
        f"Each answer, in order:\n{lines}"
    )

    async def attempt() -> str:
        text = (await complete(REPORT_SYSTEM, prompt)).strip()
        if not text:
            raise ValueError("empty report")
        return text

    return await _twice(attempt, "writing the report")
```

- [ ] **Step 4: Run the judge tests**

Run: `cd server && uv run pytest tests/test_judge.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/judge.py server/tests/test_judge.py
git commit -m "feat(judge): score an answer against a rubric, and write the lesson's report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The scorer routes by node and carries the rubric

**Files:**
- Modify: `server/scorer.py`
- Test: `server/tests/test_scorer.py`
- Test: `server/tests/test_flow_config.py` (the `HEARD_NODES` pin)

**Interfaces:**
- Consumes: `judge.score_understanding` (Task 4).
- Produces: `ANSWER_NODES = {"sparring": "answer", "check": "understanding"}` replacing `SPARRING_NODE`; `HEARD_NODES` gains `"check"` and `"lesson"`; `UNSCORED_NODES` gains `"lesson"`; `TurnScorer(..., score_understanding=judge.score_understanding, rubric=lambda: "")`.

The spec says the lesson is not heard. It must be, so `step_done`'s barge-in guard can count the tutor's turns, exactly as sparring's does; nothing in it is scored, and Task 6's `emit_check` resets the scorer as the check begins, so the exam's transcript never contains the lesson. Update the spec's one sentence on this in Task 7, Step 6.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_scorer.py`:

```python
async def test_in_a_check_the_question_is_heard_and_the_answer_is_scored_against_the_rubric():
    checks = []

    async def score_understanding(**kwargs):
        checks.append(kwargs)
        return TurnScore(16, 0, "Described a local response.")

    rig = Rig()
    rig.scorer._score_understanding = score_understanding
    rubric = {"text": "a sudden brain-wide burst"}
    rig.scorer._rubric = lambda: rubric["text"]
    await rig.state.set_mode("learn")
    await rig.state.set_solo("gwt", "Global Workspace Theory", "The Tutor")
    rig.stage = "check"

    rig.scorer.submit("bot", "What is ignition?")
    rig.scorer.submit("user", "The visual area lights up.")
    # The handler moves on to the next question before the judge replies; the
    # rubric that was current when the answer was heard is the one it is scored by.
    rubric["text"] = "the rubric for question two"
    await rig.scorer.drain()

    assert rig.calls == []
    assert checks == [
        {
            "theory": "Global Workspace Theory",
            "question": "What is ignition?",
            "rubric": "a sudden brain-wide burst",
            "history": [("bot", "What is ignition?")],
            "answer": "The visual area lights up.",
        }
    ]
    assert rig.state.health == {"user": 84, "bot": 100}
    assert rig.scorer.heard("check", "bot") == 1


async def test_the_lesson_is_heard_but_nothing_in_it_is_scored():
    rig = Rig()
    rig.stage = "lesson"
    rig.scorer.submit("bot", "Here is the idea.")
    rig.scorer.submit("user", "What do you mean by broadcast?")
    await rig.scorer.drain()
    assert rig.calls == [] and rig.state.hits == []
    assert rig.scorer.heard("lesson", "bot") == 1
```

In `server/tests/test_flow_config.py`, replace `test_the_scorer_hears_every_debate_node_and_only_those` with:

```python
def test_the_scorer_hears_every_debate_node_and_only_those():
    debate_nodes = {"opening", "rebuttal", "crossexam_question", "crossexam_answer", "closing"}
    assert debate_nodes <= set(CONFIG.nodes)
    assert set(scorer.ANSWER_NODES) == {"sparring", "check"} <= set(CONFIG.nodes)
    assert set(scorer.HEARD_NODES) == debate_nodes | set(scorer.ANSWER_NODES) | {"lesson"}
    assert set(scorer.UNSCORED_NODES) == {"crossexam_question", "lesson"}
    assert set(scorer.UNSCORED_NODES) <= set(scorer.HEARD_NODES)
```

(`lesson` is not in the config until Task 7; this test goes red here and green there.)

- [ ] **Step 2: Run to see them fail**

Run: `cd server && uv run pytest tests/test_scorer.py -q`
Expected: the two new tests fail (`AttributeError: ... '_score_understanding'`).

- [ ] **Step 3: Implement**

In `server/scorer.py`, replace the node constants:

```python
# Flow nodes (not client stages) whose turns belong to the debate. Everything
# said in them goes into the transcript the judge reads.
HEARD_NODES = (
    "opening",
    "rebuttal",
    "crossexam_question",
    "crossexam_answer",
    "closing",
    "sparring",
    "lesson",
    "check",
)
# Nodes where the user's turns are answers to a question the bot just asked, and
# which judge call scores them. The bot's turns there are heard, not scored.
ANSWER_NODES = {"sparring": "answer", "check": "understanding"}
# ...and the ones where nothing said is an argument: the house's invitation and
# the user's question in cross-examination, and the whole lesson (heard, so the
# tutor's turns can be counted; the check resets the transcript before it starts).
UNSCORED_NODES = ("crossexam_question", "lesson")
```

Constructor: add `score_understanding=judge.score_understanding,` and `rubric: Callable[[], str] = lambda: "",` parameters; store them as `self._score_understanding` and `self._rubric`.

`submit`: replace the unscored check and the task creation:

```python
        kind = ANSWER_NODES.get(node)
        if node in UNSCORED_NODES or (kind and by == "bot"):
            logger.debug(f"scorer: heard an unscored {by} turn in {node}")
            return
        # The rubric is read now, not when the judge gets round to it: by then
        # the handler may have moved the check on to its next question.
        rubric = self._rubric() if kind == "understanding" else ""
        generation = self._generation
        logger.debug(
            f"scorer: accepted {by} turn in {self._current_stage()} ({len(text.split())} words)"
        )
        self._tail = asyncio.create_task(
            self._run(self._tail, by, text, history, generation, kind=kind, rubric=rubric)
        )
```

`_run`: change the signature's `answer: bool = False` to `kind: str | None = None, rubric: str = ""`, and the scoring branch to:

```python
            user_theory, bot_theory = self._theories()
            if kind == "answer":
                score = await self._score_answer(theory=user_theory, history=history, answer=text)
            elif kind == "understanding":
                question = next((t for who, t in reversed(history) if who == "bot"), "")
                score = await self._score_understanding(
                    theory=user_theory,
                    question=question,
                    rubric=rubric,
                    history=history,
                    answer=text,
                )
            else:
                score = await self._score(
                    speaker=by,
                    user_theory=user_theory,
                    bot_theory=bot_theory,
                    history=history,
                    turn=text,
                    was_hit=any(hit["by"] != by for hit in self._state.hits),
                )
```

and the apply branch's `if answer:` to `if kind:`.

- [ ] **Step 4: Run the scorer tests**

Run: `cd server && uv run pytest tests/test_scorer.py -q`
Expected: PASS, including the sparring test, which now goes through `kind == "answer"`.

- [ ] **Step 5: Commit**

```bash
git add server/scorer.py server/tests/test_scorer.py server/tests/test_flow_config.py
git commit -m "feat(scorer): route answers by node — sparring to the examiner's judge, the check to the rubric's

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The tutor's handlers

**Files:**
- Modify: `server/handlers.py`
- Test: `server/tests/test_handlers.py`

**Interfaces:**
- Consumes: `knowledge.LESSON_STEPS`, `knowledge.CHECKS`, `knowledge.lesson_step`, `knowledge.check_questions` (Task 1); `DebateState.set_solo(..., bot_name)`, `set_lesson`, `TUTOR` (Task 3); `judge.write_report` (Task 4).
- Produces: tools `choose_lesson(flow_manager, theory_id)`, `step_done(flow_manager)`, `check_answered(flow_manager)`, `spar_this(flow_manager)`, `debate_this(flow_manager)`; pre-actions `emit_step`, `emit_check`; flow-state keys `lesson_theory`, `lesson_step`, `lesson_title`, `lesson_material`, `check_q`, `check_question`, `check_rubric`, `report_text`; `fallback_report(hits)`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_handlers.py`:

```python
# --- the tutor ------------------------------------------------------------------


async def lesson_at(step: int, heard_by_tutor: int | None = None):
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("learn")
    await handlers.choose_lesson(fm, theory_id="gwt")
    fm.state["lesson_step"] = step
    fm.state["scorer"].heard_turns[("lesson", "bot")] = (
        step if heard_by_tutor is None else heard_by_tutor
    )
    fm.state["scorer"].log.clear()
    return fm


async def check_at(question: int, heard_by_tutor: int | None = None):
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("learn")
    await handlers.choose_lesson(fm, theory_id="gwt")
    fm.state["check_q"] = question
    fm.state["scorer"].heard_turns[("check", "bot")] = (
        question if heard_by_tutor is None else heard_by_tutor
    )
    fm.state["scorer"].log.clear()
    return fm


async def test_choose_mode_knows_learn():
    fm = FakeFlowManager()
    result, _ = await handlers.choose_mode(fm, mode="learn")
    assert result == {"status": "learn"}
    assert fm.state["debate"].snapshot()["mode"] == "learn"
    bad, _ = await handlers.choose_mode(fm, mode="karaoke")
    assert bad["valid_modes"] == ["debate", "sparring", "explore", "learn"]


async def test_choose_lesson_seats_the_tutor_and_opens_step_one():
    fm = FakeFlowManager()
    await fm.state["debate"].set_mode("learn")
    fm.state.update(check_q=3, report_task="stale")

    result, nxt = await handlers.choose_lesson(fm, theory_id="GWT")

    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "ok" and result["theory"] == "Global Workspace Theory"
    assert result["steps"] == ["The idea", "The terms", "The case for it", "What it's up against"]
    assert fm.state["scorer"].log == ["reset"]
    assert fm.state["lesson_theory"] == "gwt"
    assert (fm.state["lesson_step"], fm.state["check_q"]) == (1, 1)
    assert fm.state["lesson_title"] == "The idea"
    assert "in plain words" in fm.state["lesson_material"]
    assert fm.state["bot_theory_name"] == "The Tutor"
    assert "report_task" not in fm.state
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["user"]["theory_id"] == "gwt" and snapshot["bot"]["theory_name"] == "The Tutor"
    assert snapshot["user"]["health"] == 100


async def test_choose_lesson_reports_an_unknown_id():
    fm = FakeFlowManager()
    result, _ = await handlers.choose_lesson(fm, theory_id="nope")
    assert result["status"] == "unknown_theory" and "gwt" in result["valid_ids"]


async def test_emit_step_tells_the_client_where_the_lesson_is():
    fm = await lesson_at(2)
    fm.state["lesson_title"] = "The terms"
    await handlers.emit_step({"type": "emit_step"}, fm)
    assert fm.state["debate"].snapshot()["lesson"] == {"step": 2, "of": 4, "title": "The terms"}


async def test_step_done_moves_to_the_next_step_with_its_material():
    fm = await lesson_at(2)

    result, nxt = await handlers.step_done(fm)

    assert result == {"status": "more", "step": 3, "of": 4, "title": "The case for it"}
    assert nxt is TRANSITION_IN_YAML
    assert fm.state["lesson_step"] == 3
    assert "Arguments" in fm.state["lesson_material"] or "arguments" in fm.state["lesson_material"]


async def test_step_done_waits_until_the_tutor_has_taught():
    fm = await lesson_at(3, heard_by_tutor=2)
    result, _ = await handlers.step_done(fm)
    assert result["status"] == "teach_first"
    assert fm.state["lesson_step"] == 3


async def test_the_fourth_step_done_opens_the_check():
    fm = await lesson_at(4)
    fm.state["check_q"] = 2  # a stale value from an earlier lesson
    result, _ = await handlers.step_done(fm)
    assert result == {"status": "done"}
    assert fm.state["check_q"] == 1


async def test_emit_check_puts_the_question_and_rubric_in_state_and_resets_the_scorer_first():
    fm = await check_at(1)
    await handlers.emit_check({"type": "emit_check"}, fm)
    assert fm.state["scorer"].log == ["reset"]
    assert fm.state["check_question"] == "Explain Global Workspace Theory to me in your own words."
    assert "broadcast" in fm.state["check_rubric"]
    assert fm.state["debate"].snapshot()["question"] == {"number": 1, "of": 3}

    # The second and third questions come from the card, and do not reset.
    fm.state["check_q"] = 2
    fm.state["scorer"].log.clear()
    await handlers.emit_check({"type": "emit_check"}, fm)
    assert fm.state["scorer"].log == []
    assert fm.state["check_question"].endswith("?")
    assert fm.state["debate"].snapshot()["question"] == {"number": 2, "of": 3}


async def test_check_answered_moves_to_the_next_question():
    fm = await check_at(1)
    result, _ = await handlers.check_answered(fm)
    assert result == {"status": "more", "question": 2, "of": 3}
    assert fm.state["check_q"] == 2


async def test_check_answered_waits_until_the_tutor_has_asked():
    fm = await check_at(2, heard_by_tutor=1)
    result, _ = await handlers.check_answered(fm)
    assert result["status"] == "ask_first"
    assert fm.state["check_q"] == 2


async def test_the_third_answer_brings_the_report(monkeypatch):
    async def write_report(**kwargs):
        assert kwargs["theory"] == "Global Workspace Theory"
        assert kwargs["health"] == 84
        assert kwargs["steps"] == ["The idea", "The terms", "The case for it", "What it's up against"]
        return "You have the broadcast. Go back over The terms."

    monkeypatch.setattr(handlers, "write_report", write_report)
    fm = await check_at(3)
    await fm.state["debate"].apply_answer(16, 0, "Described a local response.")

    first, _ = await handlers.check_answered(fm)
    again, _ = await handlers.check_answered(fm)

    assert first == again == {"status": "done", "grasp": 84, "got_it": True}
    assert fm.state["scorer"].log == ["close", "drain"]
    assert len(fm.worker.frames) == 1 and isinstance(fm.worker.frames[0], TTSSpeakFrame)
    assert fm.state["debate"].snapshot()["verdict"] == {
        "winner": "user",
        "rationale": "You have the broadcast. Go back over The terms.",
    }
    assert "84" in fm.state["report_text"] and "got it" in fm.state["report_text"]


async def test_the_report_falls_back_to_the_question_with_the_biggest_gap(monkeypatch):
    async def write_report(**kwargs):
        raise handlers.JudgeError("down")

    monkeypatch.setattr(handlers, "write_report", write_report)
    fm = await check_at(3)
    await fm.state["debate"].apply_answer(4, 0, "A small slip.")
    await fm.state["debate"].apply_answer(21, 0, "Stated the misreading as the theory.")

    await handlers.check_answered(fm)

    assert "Stated the misreading as the theory." in fm.state["debate"].snapshot()["verdict"]["rationale"]


def test_fallback_report_with_no_hits():
    assert "could not score" in handlers.fallback_report([])


async def test_spar_this_switches_the_mode_and_seats_the_player_for_sparring():
    fm = await check_at(3)
    result, nxt = await handlers.spar_this(fm)
    assert nxt is TRANSITION_IN_YAML
    assert result == {"status": "ok", "user_theory": "Global Workspace Theory"}
    assert fm.state["spar_q"] == 1
    assert fm.state["bot_theory_name"] == "The Examiner"
    assert fm.state["scorer"].log == ["reset"]
    snapshot = fm.state["debate"].snapshot()
    assert snapshot["mode"] == "sparring"
    assert snapshot["user"]["theory_id"] == "gwt" and snapshot["bot"]["theory_name"] == "The Examiner"


async def test_debate_this_switches_the_mode_and_tells_the_llm_what_the_user_holds():
    fm = await check_at(3)
    result, nxt = await handlers.debate_this(fm)
    assert nxt is TRANSITION_IN_YAML
    assert result["status"] == "ok" and result["user_theory"] == "gwt"
    assert "set_positions" in result["instruction"] and "gwt" in result["instruction"]
    assert fm.state["debate"].snapshot()["mode"] == "debate"
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && uv run pytest tests/test_handlers.py -q`
Expected: the new tests fail with `AttributeError: module 'handlers' has no attribute 'choose_lesson'` and so on.

- [ ] **Step 3: Implement**

In `server/handlers.py`:

Imports: `from debate_state import EXAMINER, MODES, TUTOR` and `from judge import JudgeError, write_finding, write_rationale, write_report`.

Update `choose_mode`'s docstring `mode:` line to: `"debate" to argue a theory against you, "sparring" to have their own view examined with questions, "explore" to be shown round the theories, or "learn" to be taught one theory.`

Refactor `take_position` so the seating is shared:

```python
async def _seat_for_sparring(flow_manager: FlowManager, user: knowledge.Theory) -> dict:
    """Seat the player alone with their theory, facing the examiner, at question one."""
    state = flow_manager.state
    state.update(
        user_card=knowledge.brief(user),
        user_theory_name=user.name,
        bot_theory_name=EXAMINER,
        spar_q=1,
    )
    state.pop("finding_task", None)
    state["scorer"].reset()
    await state["debate"].set_solo(user.id, user.name)
    return {"status": "ok", "user_theory": user.name}


async def take_position(flow_manager: FlowManager, user_theory: str):
    """Record the theory whose defence you are about to examine.

    Call this once you know the user's view. Use an id from the theory index.

    Args:
        user_theory: The id of the theory closest to the view the user described.
    """
    user = knowledge.get(user_theory)
    if user is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML
    return await _seat_for_sparring(flow_manager, user), TRANSITION_IN_YAML
```

Then, after `show_theory`, the tutor:

```python
# --- the tutor -------------------------------------------------------------------

LESSON_STEPS = knowledge.LESSON_STEPS
CHECK_QUESTIONS = knowledge.CHECKS


def _lesson_theory(state: dict) -> knowledge.Theory:
    return knowledge.THEORIES[state["lesson_theory"]]


def _begin_step(state: dict) -> None:
    """Put the current step's title and material where the lesson prompt reads them."""
    step = state["lesson_step"]
    state["lesson_title"] = LESSON_STEPS[step - 1]
    state["lesson_material"] = knowledge.lesson_step(_lesson_theory(state), step)


async def choose_lesson(flow_manager: FlowManager, theory_id: str):
    """Record which theory the user wants to learn, and start its lesson.

    Call this once they have named a theory, or described one closely enough to
    match. Use an id from the theory index.

    Args:
        theory_id: The id of the theory to teach.
    """
    theory = knowledge.get(theory_id)
    if theory is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML

    state = flow_manager.state
    state.update(
        user_card=knowledge.brief(theory),
        user_theory_name=theory.name,
        bot_theory_name=TUTOR,
        lesson_theory=theory.id,
        lesson_step=1,
        check_q=1,
    )
    _begin_step(state)
    state.pop("report_task", None)
    state["scorer"].reset()
    await state["debate"].set_solo(theory.id, theory.name, TUTOR)
    return {"status": "ok", "theory": theory.name, "steps": list(LESSON_STEPS)}, TRANSITION_IN_YAML


async def emit_step(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action: tell the client which step of the lesson this is."""
    state = flow_manager.state
    await state["debate"].set_lesson(state["lesson_step"], len(LESSON_STEPS), state["lesson_title"])


async def step_done(flow_manager: FlowManager):
    """The user has understood this step of the lesson and is ready for the next.

    Call this when they say the step is clear or ask to go on, without replying first.
    """
    state = flow_manager.state
    # The same guard as sparring: this is visit number `lesson_step` to the node,
    # so the tutor must have finished that many turns in it. Otherwise the user
    # spoke over the tutor before the step was taught, and it must not be skipped.
    if state["scorer"].heard("lesson", "bot") < state["lesson_step"]:
        return {
            "status": "teach_first",
            "instruction": "You have not taught this step yet. Teach it now.",
        }, TRANSITION_IN_YAML
    if state["lesson_step"] < len(LESSON_STEPS):
        state["lesson_step"] += 1
        _begin_step(state)
        return {
            "status": "more",
            "step": state["lesson_step"],
            "of": len(LESSON_STEPS),
            "title": state["lesson_title"],
        }, TRANSITION_IN_YAML
    state["check_q"] = 1
    return {"status": "done"}, TRANSITION_IN_YAML


async def emit_check(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action: the check's current question for the prompt, its rubric for the
    scorer, and its number for the client."""
    state = flow_manager.state
    number = state["check_q"]
    if number == 1:
        # The lesson's turns were heard (so the tutor's could be counted) but they
        # are not the exam: the judge reads only the check's own transcript.
        state["scorer"].reset()
    question, rubric = knowledge.check_questions(_lesson_theory(state))[number - 1]
    state["check_question"], state["check_rubric"] = question, rubric
    await state["debate"].set_question(number, CHECK_QUESTIONS)


async def check_answered(flow_manager: FlowManager):
    """The user has answered the check question you just asked.

    Call this as soon as they have answered, without saying whether it was right.
    """
    state = flow_manager.state
    if state["scorer"].heard("check", "bot") < state["check_q"]:
        return {
            "status": "ask_first",
            "instruction": "You have not asked this question yet. Ask it now.",
        }, TRANSITION_IN_YAML
    if state["check_q"] < CHECK_QUESTIONS:
        state["check_q"] += 1
        return {
            "status": "more",
            "question": state["check_q"],
            "of": CHECK_QUESTIONS,
        }, TRANSITION_IN_YAML

    # The third answer. One decision, shared by any repeat; a failed one forgotten.
    if "report_task" not in state:
        state["report_task"] = asyncio.ensure_future(_report(flow_manager))
    try:
        return await state["report_task"], TRANSITION_IN_YAML
    except BaseException:
        state.pop("report_task", None)
        raise


def fallback_report(hits: list[dict]) -> str:
    """What to say when the judge cannot write the report."""
    if not hits:
        return "The judge could not score this check, so the bar stands alone."
    widest = max(hits, key=lambda hit: hit["damage"])
    return f"The question that showed the biggest gap was this. {widest['reason']}"


async def _report(flow_manager: FlowManager) -> dict:
    state = flow_manager.state
    debate, scorer = state["debate"], state["scorer"]

    scorer.close()
    await flow_manager.worker.queue_frames(
        [TTSSpeakFrame("Thank you. Let me see how much of it has landed.", append_to_context=False)]
    )
    await scorer.drain()

    grasp = debate.health["user"]
    try:
        report = await write_report(
            theory=state["user_theory_name"],
            health=grasp,
            steps=list(LESSON_STEPS),
            hits=list(debate.hits),
        )
    except JudgeError:
        report = fallback_report(debate.hits)
    await debate.set_verdict(report)

    got_it = debate.winner() == "user"
    state["report_text"] = (
        f"Grasp of {state['user_theory_name']}: {grasp} out of 100. "
        f"{'They have got it.' if got_it else 'Not yet.'} The report: {report}"
    )
    return {"status": "done", "grasp": grasp, "got_it": got_it}


async def spar_this(flow_manager: FlowManager):
    """Take the theory just learned into sparring: the examiner's five questions.

    Call only when the user asks to spar with, defend, or be questioned on this theory.
    """
    state = flow_manager.state
    theory = _lesson_theory(state)
    await state["debate"].set_mode("sparring")
    return await _seat_for_sparring(flow_manager, theory), TRANSITION_IN_YAML


async def debate_this(flow_manager: FlowManager):
    """Take the theory just learned into a debate against the house.

    Call only when the user asks to debate, fight, or argue with this theory.
    """
    state = flow_manager.state
    theory = _lesson_theory(state)
    await state["debate"].set_mode("debate")
    return {
        "status": "ok",
        "user_theory": theory.id,
        "instruction": (
            f"The user holds {theory.name} ({theory.id}). Do not ask what they think "
            f"consciousness is: call set_positions with user_theory '{theory.id}' and "
            "one of its rivals from the index."
        ),
    }, TRANSITION_IN_YAML
```

- [ ] **Step 4: Run the handler tests**

Run: `cd server && uv run pytest tests/test_handlers.py -q`
Expected: PASS. (`test_choose_mode_turns_down_anything_else_and_stays_put` asserts the old three-mode list; update its expected list to include `"learn"`.)

- [ ] **Step 5: Commit**

```bash
git add server/handlers.py server/tests/test_handlers.py
git commit -m "feat(handlers): the tutor — choose a lesson, step through it, check it, report, hand off

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The flow nodes and the bot's wiring

**Files:**
- Modify: `server/flow.yaml`
- Modify: `server/bot.py` (state seeds and the scorer's rubric; nothing in the pipeline)
- Modify: `docs/design/2026-10-13-learn-mode-design.md` (one sentence)
- Test: `server/tests/test_flow_config.py`

**Interfaces:**
- Consumes: every handler from Task 6.
- Produces: nodes `tutor_setup`, `lesson`, `check`, `lesson_report`; `mode_select` branches `learn → tutor_setup`; `sparring` carries the examiner's role message so `spar_this` lands in the right voice.

- [ ] **Step 1: Write the failing tests**

In `server/tests/test_flow_config.py`, update `test_a_debate_runs_setup_three_rounds_a_two_part_cross_examination_and_a_verdict`'s `mode_select` assertion to include `"learn": "tutor_setup"`, add `"lesson_report"` to the list in `test_every_mode_has_a_way_back_to_the_front_door`, and append:

```python
def transitions(node) -> dict[str, object]:
    """Each function's transition: a node name, or its branch table."""
    out = {}
    for function in node.functions or []:
        target = function.transition_to
        out[function.name] = target if isinstance(target, str) or target is None else target.cases
    return out


def test_a_lesson_is_a_pick_four_steps_three_checks_and_a_report():
    assert walk("tutor_setup")[:4] == ["tutor_setup", "lesson", "check", "lesson_report"]
    assert targets(CONFIG.nodes["lesson"]) == {"more": "lesson", "done": "check"}
    assert targets(CONFIG.nodes["check"]) == {"more": "check", "done": "lesson_report"}


def test_the_report_hands_off_to_sparring_and_the_debate_with_the_theory_in_hand():
    assert transitions(CONFIG.nodes["lesson_report"]) == {
        "spar_this": {"ok": "sparring"},
        "debate_this": {"ok": "setup"},
        "learn_again": "tutor_setup",
        "main_menu": "mode_select",
    }


def test_sparring_speaks_as_the_examiner_however_it_is_entered():
    # spar_this skips spar_setup, so the questions node must carry the role itself.
    assert CONFIG.nodes["sparring"].role_message == CONFIG.nodes["spar_setup"].role_message


def test_the_lesson_and_check_nodes_emit_their_stages():
    stages = {
        name: [
            a["stage"]
            for a in (node.model_dump().get("pre_actions") or [])
            if a.get("type") == "emit_stage"
        ]
        for name, node in CONFIG.nodes.items()
    }
    assert stages["tutor_setup"] == ["setup"]
    assert stages["lesson"] == ["lesson"]
    assert stages["check"] == ["check"]
    assert stages["lesson_report"] == ["verdict"]
```

If `FlowConfig`'s node model names the role field differently from `role_message`, check with `uv run python -c "from pipecat.flows import FlowConfig; print(FlowConfig.from_file('flow.yaml').nodes['spar_setup'].model_dump().keys())"` and use that name.

- [ ] **Step 2: Run to see them fail**

Run: `cd server && uv run pytest tests/test_flow_config.py -q`
Expected: failures (`KeyError: 'tutor_setup'`; the `Flow(...)` construction test may also fail once handlers name tools the config does not, which is fine).

- [ ] **Step 3: Edit `flow.yaml`**

In `mode_select`'s task message, change the choices sentence to offer four: *"to debate a theory of consciousness against you, to have their own view examined with questions, to be shown round the theories, or to be taught one theory step by step"*; the routing paragraph becomes:

```
          When they have chosen, call choose_mode with "debate", "sparring",
          "explore", or "learn", without replying first. "Argue", "fight", or
          "take you on" mean debate; "question me", "test my view", or "spar"
          mean sparring; "tell me about", "what is", "compare", or "look
          around" mean explore; "teach me", "learn", "lesson", or "tutor" mean
          learn, and if they name a theory with it, call choose_mode with
          "learn" and the tutor will take the name from there.
```

and the branch table gains `learn: tutor_setup`.

Give `spar_setup`'s role message a YAML anchor and reuse it on `sparring`:

```yaml
  spar_setup:
    role_message: &examiner_role >-
      You are the Examiner of the Armchair Debater: ...
```

```yaml
  sparring:
    role_message: *examiner_role
    pre_actions:
```

Then append the tutor's nodes at the end of the file:

```yaml
  # ----------------------------------------------------------------- the tutor
  tutor_setup:
    role_message: >-
      You are the Tutor of the Armchair Debater: a patient, plain-spoken
      teacher of the theories of consciousness. You teach one theory at a
      time, from its card and nothing else, in the theory's own best terms;
      you are neither its advocate nor its critic. You check that each step
      has landed before you move on, you welcome questions and answer them
      from the card, and in the check you never say whether an answer was
      right or wrong. You may cite the papers on the card as author and year;
      never cite a paper that is not on it, and if asked for a source you do
      not have, say so. Never mention scores, grasp, or the judge before the
      report. {{ voice_rules }}
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: setup
      - type: use_voice
        handler: use_voice
        who: house
    task_messages:
      - role: developer
        content: |
          In one sentence, ask which theory the user would like to learn —
          unless they have already named one, in which case do not ask. These
          are the twelve you can teach:

          {{ theory_index }}

          When they name one, or describe one closely enough to match, call
          choose_lesson with its id, without replying first. If they ask what
          there is, name three or four from different parts of the index in
          plain prose, one short clause each, and ask which. If choose_lesson
          reports unknown_theory, call it again with an id from the index.
    functions:
      - name: choose_lesson
        transition_to:
          field: status
          cases:
            ok: lesson

  # One node, entered once per step; step_done counts.
  lesson:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: lesson
      - type: emit_step
        handler: emit_step
    task_messages:
      - role: developer
        content: |
          You are teaching {{ user_theory_name }}. This is step {{ lesson_step }}
          of four: {{ lesson_title }}. In one turn of under seventy words,
          teach this step from the material below and nothing else, in plain
          spoken prose, then ask whether that is clear or whether they have a
          question. On step one only, first say in a few words what the four
          steps will be: the idea, the terms, the case for it, and what it is
          up against.

          The material for this step:
          {{ lesson_material }}

          If the user asks a question, or asks you to say it again, answer
          from the material and the card below in under seventy words, and ask
          again whether it is clear. Do not call step_done for a question.
          When the user says the step is clear, or asks to go on, call
          step_done immediately, without replying first. If step_done reports
          teach_first, you were interrupted before you taught this step: teach
          it now.

          The card, for questions:
          {{ user_card }}
    functions:
      - name: step_done
        transition_to:
          field: status
          cases:
            more: lesson
            done: check

  # One node, entered once per question; check_answered counts.
  check:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: check
      - type: emit_check
        handler: emit_check
    task_messages:
      - role: developer
        content: |
          The lesson on {{ user_theory_name }} is over; now you check that it
          has landed. This is check question {{ check_q }} of three. On the
          first only, say in one sentence that you will ask three questions.
          Then ask this question, and only this question, in your own words:

          {{ check_question }}

          Do not answer it, do not hint, and do not say whether their previous
          answer was right. When the user has answered, call check_answered
          immediately, without replying to the answer. If check_answered
          reports ask_first, you were interrupted before you asked: ask it
          now. If instead they ask what you meant, rephrase the question in
          one sentence and wait.
    functions:
      - name: check_answered
        transition_to:
          field: status
          cases:
            more: check
            done: lesson_report

  lesson_report:
    pre_actions:
      - type: emit_stage
        handler: emit_stage
        stage: verdict
    task_messages:
      - role: developer
        content: |
          The check is over and the judge has weighed the answers. Announce
          the report now, in one turn of three short sentences:

          {{ report_text }}

          First, say the grasp number out of one hundred and whether they
          have got it. Second, give the report in your own spoken words,
          encouraging and exact. Third, offer what comes next: to spar with
          this theory, to debate with it, to go through the lesson again, or
          the menu.

          The report must reach the user: if they speak before you have
          announced it, announce it first, and only then respond.
          Call spar_this only when they ask to spar, to be questioned, or to
          defend the theory; debate_this only when they ask to debate or
          argue with it; learn_again only when they ask for the lesson again;
          main_menu when they ask for the menu or for something else.
    functions:
      - name: spar_this
        transition_to:
          field: status
          cases:
            ok: sparring
      - name: debate_this
        transition_to:
          field: status
          cases:
            ok: setup
      - name: learn_again
        transition_only: true
        description: Call only when the user asks to go through the lesson again. Returns to the choice of theory.
        transition_to: tutor_setup
      - name: main_menu
        transition_only: true
        description: Call when the user asks for the menu, or to do something other than this theory.
        transition_to: mode_select
```

Also update the header comment's first line to name the four things behind the door.

- [ ] **Step 4: Seed the state and wire the rubric in `bot.py`**

In `flow_manager.state.update({...})`, add after `"finding_text": "",`:

```python
            "lesson_step": 1,
            "lesson_title": "",
            "lesson_material": "",
            "check_q": 1,
            "check_question": "",
            "check_rubric": "",
            "report_text": "",
```

In the `TurnScorer(...)` construction add:

```python
        rubric=lambda: flow_manager.state.get("check_rubric", ""),
```

Nothing else in `bot.py` changes.

- [ ] **Step 5: Run the whole server suite, and boot the flow**

Run: `cd server && uv run pytest -q`
Expected: PASS, every test, including `test_the_flow_constructs_with_every_handler_and_variable_it_names` (which is the smoke test that every `{{ key }}` and tool the YAML names exists).

- [ ] **Step 6: Record the one deviation in the spec**

In `docs/design/2026-10-13-learn-mode-design.md`, replace the sentence beginning "`lesson` is not a heard node" with: "`lesson` is heard but unscored, like the cross-examination's question node, so `step_done`'s guard can count the tutor's turns; `emit_check` resets the scorer as the first check question is put, so the exam's transcript never contains the lesson."

- [ ] **Step 7: Commit and push (milestone: Part 2)**

```bash
git add server/flow.yaml server/bot.py server/tests/test_flow_config.py docs/design/2026-10-13-learn-mode-design.md
git commit -m "feat(flow): the tutor's four nodes, learn at the front door, the examiner's voice on re-entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```

---

# Part 3 — The client

### Task 8: Types, store, screen rules, and the mode's words

**Files:**
- Modify: `client/src/arcade/types.ts`, `store.ts`, `screen.ts`, `modes.ts`, `mock.ts`
- Test: `client/src/arcade/__tests__/modes.test.ts`, `screen.test.ts`

**Interfaces:**
- Produces: `Mode` gains `'learn'`; `Stage` gains `'lesson' | 'check'`; `DebateSnapshot.lesson: { step; of; title } | null`; `Screen` gains `'lesson'`; `ROUND_LABELS.lesson/check`; `plateFor` for a lesson step and a check; `MODES` with LEARN first; `MODE_LINES.learn`; `teachLine(name)`, `SPAR_THIS_LINE`, `DEBATE_THIS_LINE`; `againLine('learn')`; `mockKind` accepts `learn`.

- [ ] **Step 1: Write the failing tests**

In `client/src/arcade/__tests__/modes.test.ts`, add `import learn from '../fixtures/learn-state.json';`, add `learn: learn as DebateSnapshot[]` to `frames`, import `teachLine, SPAR_THIS_LINE, DEBATE_THIS_LINE` from `../modes`, and append:

```ts
describe('learn mode', () => {
  it('accepts the learn fixture, with the lesson field present', () => {
    for (const frame of frames.learn) {
      expect(isDebateSnapshot(frame)).toBe(true);
      expect(frame).toHaveProperty('lesson');
    }
    expect(isDebateSnapshot({ ...frames.learn[0], lesson: { step: 'two', of: 4, title: 'x' } })).toBe(false);
  });

  it('fills lesson in as null for a server that predates it', () => {
    const old: Record<string, unknown> = { ...frames.debate.at(-1)! };
    delete old.lesson;
    const store = useArcadeStore.getState();
    store.clear();
    store.receive(old);
    expect(useArcadeStore.getState().snapshot?.lesson).toBeNull();
  });

  it('runs a lesson on the select, lesson, fight and decision screens', () => {
    const seen = frames.learn.map((f) => screenFor(true, f));
    expect([...new Set(seen)]).toEqual(['mode', 'select', 'lesson', 'fight', 'decision']);
    const seated = frames.learn.find((f) => f.stage === 'setup' && f.user.theory_id)!;
    expect(splashKey(seated)).toBeNull();
  });

  it('plates the lesson by step and the check by question', () => {
    const second = frames.learn.find((f) => f.lesson?.step === 2)!;
    expect(plateFor(second)).toEqual({ title: 'STEP 2', sub: 'THE TERMS', pips: 4, lit: 2 });
    const check = frames.learn.find((f) => f.question?.number === 3)!;
    expect(plateFor(check)).toEqual({ title: 'CHECK 3', sub: 'OF 3', pips: 3, lit: 3 });
    expect(ROUND_LABELS.lesson).toBe('THE LESSON');
    expect(ROUND_LABELS.check).toBe('THE CHECK');
  });

  it('puts LEARN first on the menu and says each line the way a person would', () => {
    expect(MODES[0].id).toBe('learn');
    expect(MODE_LINES.learn).toBe('Teach me a theory.');
    expect(teachLine('Illusionism')).toBe('Teach me Illusionism.');
    expect(againLine('learn')).toBe('Teach me that one again.');
    expect(SPAR_THIS_LINE).toBe("Let me spar with it: question me on this theory.");
    expect(DEBATE_THIS_LINE).toBe("Let me debate with it.");
  });
});
```

Update the existing `MODE_LINES` equality test to include `learn: 'Teach me a theory.'`, and the first describe's title and loops already cover every fixture in `frames`.

- [ ] **Step 2: Run to see them fail**

Run: `cd client && npm test`
Expected: the new tests fail (missing export `teachLine`, `plateFor` returning `QUESTION 3`, `screenFor` returning `fight` for a lesson frame).

- [ ] **Step 3: Implement**

`types.ts`: add `'lesson' | 'check'` to `Stage`, `'learn'` to `Mode`, `'learn'` to `MODE_NAMES`, `'lesson'` and `'check'` to `STAGES`; add to `DebateSnapshot`:

```ts
  /** The tutor: which step of the lesson this is. */
  lesson: { step: number; of: number; title: string } | null;
```

and to `isDebateSnapshot`'s return expression:

```ts
    (s.lesson == null ||
      (typeof s.lesson === 'object' &&
        typeof s.lesson.step === 'number' &&
        typeof s.lesson.of === 'number' &&
        typeof s.lesson.title === 'string'))
```

`store.ts`: `lesson: data.lesson ?? null` in the normalised snapshot.

`screen.ts`:

```ts
export type Screen = 'title' | 'mode' | 'select' | 'versus' | 'fight' | 'decision' | 'explore' | 'lesson';
```

In `screenFor`, after the explore line: `if (snapshot.stage === 'lesson') return 'lesson';`. `ROUND_LABELS` gains `lesson: 'THE LESSON'`, `check: 'THE CHECK'`; `roundNumber` gains `lesson: 0, check: 0`. `plateFor` becomes:

```ts
export const plateFor = (snapshot: DebateSnapshot): Plate => {
  if (snapshot.lesson) {
    const { step, of, title } = snapshot.lesson;
    return { title: `STEP ${step}`, sub: title.toUpperCase(), pips: of, lit: step };
  }
  if (snapshot.question) {
    const { number, of } = snapshot.question;
    const what = snapshot.mode === 'learn' ? 'CHECK' : 'QUESTION';
    return { title: `${what} ${number}`, sub: `OF ${of}`, pips: of, lit: number };
  }
  ...
```

`ANNOUNCER_SEQUENCE` gains `check: [['THE CHECK', 900], ['BEGIN!', 700]]`.

`modes.ts`: insert at the top of `MODES`:

```ts
  {
    id: 'learn',
    title: 'LEARN',
    blurb: 'Pick a theory. The tutor teaches it in four steps, then checks that it has landed.',
  },
```

add `learn: 'Teach me a theory.'` to `MODE_LINES`, and:

```ts
/** Asking for another go, in the mode's own terms. */
export const againLine = (mode: Mode | null): string =>
  mode === 'sparring'
    ? "I'd like another round of questions."
    : mode === 'learn'
      ? 'Teach me that one again.'
      : "I'd like a rematch.";

/** What clicking a card says to the tutor. */
export const teachLine = (theoryName: string): string => `Teach me ${theoryName}.`;

/** The report's two hand-offs: the next rungs of the ladder. */
export const SPAR_THIS_LINE = "Let me spar with it: question me on this theory.";
export const DEBATE_THIS_LINE = 'Let me debate with it.';
```

`mock.ts`: `import learn from './fixtures/learn-state.json';`, `learn: learn as DebateSnapshot[]` in `FIXTURES`, and `mockKind` returns `value` when it is `'sparring' || 'explore' || 'learn'`.

- [ ] **Step 4: Run the client tests, lint, and build**

Run: `cd client && npm test && npm run lint && npm run build`
Expected: all PASS. (`tsc` will flag `FIXTURES: Record<Mode, …>` until `learn` is added, which Step 3 did.)

- [ ] **Step 5: Commit**

```bash
git add client/src/arcade
git commit -m "feat(client): learn mode in the contract, the screen rules, and the menu's words

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The ladder

**Files:**
- Create: `client/src/arcade/ladder.ts`
- Modify: `client/src/arcade/store.ts`
- Test: `client/src/arcade/__tests__/ladder.test.ts`, `store.test.ts`

**Interfaces:**
- Produces: `type Rung = 'learn' | 'spar' | 'debate'`; `type Ladder = Record<string, Partial<Record<Rung, true>>>`; `LADDER_KEY = 'armchair.ladder'`; `rungFor(mode)`; `advance(ladder, snapshot)`; `loadLadder(storage)`; `saveLadder(storage, ladder)`; store field `ladder: Ladder`, updated on every snapshot and persisted.

- [ ] **Step 1: Write the failing tests**

Create `client/src/arcade/__tests__/ladder.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import debate from '../fixtures/debate-state.json';
import learn from '../fixtures/learn-state.json';
import sparring from '../fixtures/sparring-state.json';
import { LADDER_KEY, advance, loadLadder, rungFor, saveLadder } from '../ladder';
import { useArcadeStore } from '../store';
import type { DebateSnapshot } from '../types';

const last = (frames: unknown[]) => frames.at(-1) as DebateSnapshot;

describe('the ladder', () => {
  it('maps each scored mode to its rung, and the explorer to none', () => {
    expect(rungFor('learn')).toBe('learn');
    expect(rungFor('sparring')).toBe('spar');
    expect(rungFor('debate')).toBe('debate');
    expect(rungFor('explore')).toBeNull();
    expect(rungFor(null)).toBeNull();
  });

  it('lights a rung on a verdict the player won, for the theory they held', () => {
    const won = { ...last(learn), verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance({}, won)).toEqual({ gwt: { learn: true } });
    const spar = { ...last(sparring), verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance({ gwt: { learn: true } }, spar)).toEqual({ gwt: { learn: true, spar: true } });
  });

  it('lights nothing on a loss, a draw, a frame with no verdict, or no theory', () => {
    const base = last(debate);
    expect(advance({}, { ...base, verdict: { winner: 'bot', rationale: 'r' } })).toEqual({});
    expect(advance({}, { ...base, verdict: { winner: 'draw', rationale: 'r' } })).toEqual({});
    expect(advance({}, { ...base, verdict: null })).toEqual({});
    const won = { ...base, verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance({}, { ...won, user: { ...won.user, theory_id: null } })).toEqual({});
  });

  it('returns the same object when nothing changed, so the store can skip a save', () => {
    const ladder = { gwt: { learn: true as const } };
    const won = { ...last(learn), verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance(ladder, won)).toBe(ladder);
  });

  it('round-trips through storage, and reads garbage or no storage as empty', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    } as Storage;
    saveLadder(storage, { iit: { debate: true } });
    expect(JSON.parse(memory.get(LADDER_KEY)!)).toEqual({ iit: { debate: true } });
    expect(loadLadder(storage)).toEqual({ iit: { debate: true } });
    memory.set(LADDER_KEY, '{not json');
    expect(loadLadder(storage)).toEqual({});
    memory.set(LADDER_KEY, '[1,2]');
    expect(loadLadder(storage)).toEqual({});
    expect(loadLadder(null)).toEqual({});
    const throwing = { getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(loadLadder(throwing)).toEqual({});
  });
});

describe('the store keeps the ladder', () => {
  // vitest runs in the node environment here (vitest.config.ts), so there is
  // no localStorage unless the test provides one; the ladder reads
  // globalThis.localStorage at call time, never at import.
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    };
    useArcadeStore.setState({ ladder: {} });
    useArcadeStore.getState().clear();
  });

  it('advances it on a won verdict and persists it, and keeps it across clear()', () => {
    const store = useArcadeStore.getState();
    for (const frame of learn) store.receive(frame);
    expect(useArcadeStore.getState().ladder).toEqual({ gwt: { learn: true } });
    expect(JSON.parse(memory.get(LADDER_KEY)!)).toEqual({ gwt: { learn: true } });
    store.clear();
    expect(useArcadeStore.getState().ladder).toEqual({ gwt: { learn: true } });
  });
});
```

The learn fixture's last frame has `winner: "user"` (GRASP 83), so the store test lights the rung from the real contract. Do not switch vitest to jsdom for this; the stub is enough and keeps the other tests as they are.

- [ ] **Step 2: Run to see them fail**

Run: `cd client && npm test`
Expected: FAIL, `Cannot find module '../ladder'`.

- [ ] **Step 3: Implement**

Create `client/src/arcade/ladder.ts`:

```ts
/**
 * The ladder: three rungs per theory — LEARN, SPAR, DEBATE — lit when the
 * player has won in that mode with that theory. The server is stateless, so
 * the ladder lives here, in localStorage, and nothing is ever locked by it.
 */

import type { DebateSnapshot, Mode } from './types';

export type Rung = 'learn' | 'spar' | 'debate';
export type Ladder = Record<string, Partial<Record<Rung, true>>>;

export const LADDER_KEY = 'armchair.ladder';
export const RUNGS: Rung[] = ['learn', 'spar', 'debate'];

export const rungFor = (mode: Mode | null): Rung | null =>
  mode === 'learn' ? 'learn' : mode === 'sparring' ? 'spar' : mode === 'debate' ? 'debate' : null;

/**
 * The ladder after a snapshot. Only a verdict the player won lights a rung — a
 * draw lights nothing — and it is the SAME object back when nothing changed.
 */
export const advance = (ladder: Ladder, snapshot: DebateSnapshot): Ladder => {
  const rung = rungFor(snapshot.mode);
  const id = snapshot.user.theory_id;
  if (!rung || !id || snapshot.verdict?.winner !== 'user') return ladder;
  if (ladder[id]?.[rung]) return ladder;
  return { ...ladder, [id]: { ...ladder[id], [rung]: true } };
};

const isLadder = (value: unknown): value is Ladder =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whatever is stored, or an empty ladder when there is nothing, or garbage, or no storage. */
export const loadLadder = (storage: Storage | null): Ladder => {
  try {
    const raw = storage?.getItem(LADDER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isLadder(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const saveLadder = (storage: Storage | null, ladder: Ladder): void => {
  try {
    storage?.setItem(LADDER_KEY, JSON.stringify(ladder));
  } catch {
    // A full or blocked storage loses the save, not the game.
  }
};

const browserStorage = (): Storage | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

export const loadBrowserLadder = (): Ladder => loadLadder(browserStorage());
export const saveBrowserLadder = (ladder: Ladder): void => saveLadder(browserStorage(), ladder);
```

In `store.ts`: import `advance, loadBrowserLadder, saveBrowserLadder` and `type Ladder`; add `ladder: Ladder;` to the interface with the doc comment `/** The rungs cleared per theory; persisted, and kept across clear(). */`; initialise `ladder: loadBrowserLadder(),`; in `receive`, inside the `set((state) => ...)` for a snapshot, compute `const ladder = advance(state.ladder, snapshot); if (ladder !== state.ladder) saveBrowserLadder(ladder);` and return `ladder` alongside `snapshot` and `hitCount`. `clear` leaves `ladder` alone.

- [ ] **Step 4: Run the client tests**

Run: `cd client && npm test && npm run lint`
Expected: PASS. (vitest's default environment must provide `localStorage`; `vitest.config.ts` already uses jsdom if `store.test.ts` runs, which it does.)

- [ ] **Step 5: Commit**

```bash
git add client/src/arcade/ladder.ts client/src/arcade/store.ts client/src/arcade/__tests__/ladder.test.ts
git commit -m "feat(client): the ladder — a rung per mode per theory, lit on a win, kept in localStorage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The tutor in words: battle text, the fight HUD, the decision screen

**Files:**
- Modify: `client/src/arcade/battleText.ts`, `screens/FightScreen.tsx`, `screens/DecisionScreen.tsx`
- Test: `client/src/arcade/__tests__/modes.test.ts`

**Interfaces:**
- Produces: `battleLines(hit, 'learn')`, `feltDamage(hit, 'learn')`, `turnCue(hit, 'check')`, `decisionBanners` for learn; `FightScreen` learn labels; `DecisionScreen` props `onSpar?: () => void`, `onDebate?: () => void` and the learn buttons.

- [ ] **Step 1: Write the failing tests**

Append to the `learn mode` describe in `modes.test.ts`:

```ts
  it('reads a scored check answer as the tutor’s question, felt at double', () => {
    const answer = frames.learn.find((f) => f.last_hit && f.last_hit.recovery > 0)!.last_hit!;
    const lines = battleLines(answer, 'learn');
    expect(lines[0]).toBe(`THE TUTOR: "${answer.reason}"`);
    expect(lines.at(-1)).toBe(`YOU won some back!  +${answer.recovery}`);
    const at = (damage: number) => battleLines({ ...answer, damage, recovery: 0 }, 'learn')[1];
    expect(at(0)).toBe('Got it!');
    expect(at(5)).toBe('Nearly…  −5');
    expect(at(14)).toBe('A gap.  −14');
    expect(at(20)).toBe('Missed the point.  −20');
    expect(feltDamage({ ...answer, damage: 25 }, 'learn')).toBe(50);
    expect(turnCue(null, 'check')).toBe('ANSWER THE TUTOR');
    expect(turnCue(answer, 'check')).toBe('ANSWER THE TUTOR');
  });

  it('calls the report from the grasp bar alone', () => {
    const end = frames.learn.at(-1)!;
    const at = (health: number) => ({ ...end, user: { ...end.user, health } });
    expect(decisionBanners(at(70))).toEqual(["YOU'VE GOT IT"]);
    expect(decisionBanners(at(69))).toEqual(['NEARLY']);
    expect(decisionBanners(at(40))).toEqual(['NEARLY']);
    expect(decisionBanners(at(39))).toEqual(['NOT YET']);
    expect(decisionBanners(end)).toEqual(["YOU'VE GOT IT"]);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd client && npm test`
Expected: FAIL on `THE TUTOR`, `Got it!`, `ANSWER THE TUTOR`, `YOU'VE GOT IT`.

- [ ] **Step 3: Implement the words**

In `battleText.ts`:

```ts
/** The modes with one bar and a questioner on the other side. */
export const isSolo = (mode: Mode | null): boolean => mode === 'sparring' || mode === 'learn';

/** Who is on the other side of a solo bar. */
export const questionerName = (mode: Mode | null): string =>
  mode === 'learn' ? 'THE TUTOR' : 'THE EXAMINER';
```

`feltDamage`: `isSolo(mode) ? hit.damage * 2 : hit.damage`.

Add the learn wording beside `HELD`:

```ts
/** A check answer's damage, worded as what was missing. */
const GRASPED: Record<HitTier, (damage: number) => string> = {
  miss: () => 'Got it!',
  glancing: (damage) => `Nearly…  −${damage}`,
  solid: (damage) => `A gap.  −${damage}`,
  super: (damage) => `Missed the point.  −${damage}`,
};
```

In `battleLines`, generalise the sparring branch:

```ts
  if (isSolo(mode)) {
    const words = mode === 'learn' ? GRASPED : HELD;
    const lines = [`${questionerName(mode)}: "${hit.reason}"`, words[hitTier(feltDamage(hit, mode))](hit.damage)];
    if (hit.recovery > 0) lines.push(`YOU won some back!  +${hit.recovery}`);
    return lines;
  }
```

`turnCue`: `if (stage === 'sparring') return 'ANSWER THE EXAMINER'; if (stage === 'check') return 'ANSWER THE TUTOR';`.

`decisionBanners`, before the sparring branch:

```ts
  if (snapshot.mode === 'learn') {
    return [user.health >= 70 ? "YOU'VE GOT IT" : user.health >= 40 ? 'NEARLY' : 'NOT YET'];
  }
```

- [ ] **Step 4: The fight HUD and the decision screen**

`FightScreen.tsx`: import `isSolo, questionerName`; replace `const sparring = snapshot.mode === 'sparring';` with `const solo = isSolo(snapshot.mode);` and use `solo` where `sparring` was (the `healedSide` line and the `barless` prop). The bot bar becomes:

```tsx
        <HealthBar
          side="bot"
          label={solo ? questionerName(snapshot.mode) : 'CPU THE HOUSE'}
          theory={
            snapshot.mode === 'learn'
              ? 'checks your grasp'
              : solo
                ? 'asks the questions'
                : snapshot.bot.theory_name
          }
          health={snapshot.bot.health}
          barless={solo}
        />
```

and the user bar's label `snapshot.mode === 'learn' ? '1P GRASP' : '1P YOU'`.

`DecisionScreen.tsx`: add to the props

```ts
  /** Learn mode's two hand-offs: the next rungs. Absent outside learn mode. */
  onSpar?: () => void;
  onDebate?: () => void;
```

Replace `const sparring = snapshot.mode === 'sparring';` with

```ts
  const learn = snapshot.mode === 'learn';
  const solo = isSolo(snapshot.mode);
```

(import `isSolo` from `../battleText`). Use `solo` for the poses and the single number; the title becomes `learn ? 'THE REPORT' : solo ? 'THE FINDING' : 'JUDGE’S DECISION'`; the `asked` prompt becomes `learn ? 'ONCE MORE, FROM THE TOP…' : solo ? 'FIVE MORE QUESTIONS…' : 'HERE COMES A NEW CHALLENGER…'`; the primary button's label `learn ? 'AGAIN' : solo ? 'AGAIN' : 'REMATCH'`. Before the MENU button, add:

```tsx
            {learn && onSpar && (
              <PixelButton
                onClick={() => {
                  setAsked(true);
                  onSpar();
                }}
              >
                SPAR WITH IT
              </PixelButton>
            )}
            {learn && onDebate && (
              <PixelButton
                onClick={() => {
                  setAsked(true);
                  onDebate();
                }}
              >
                DEBATE WITH IT
              </PixelButton>
            )}
```

In `ArcadeApp.tsx`, pass them from the decision screen's render:

```tsx
            onSpar={() => say(SPAR_THIS_LINE)}
            onDebate={() => say(DEBATE_THIS_LINE)}
```

(import both from `./modes`). The `?mock` path's `say` ignores those lines, which is fine: the mock has no next rung to play.

- [ ] **Step 5: Run the client tests, lint, build; look at it**

Run: `cd client && npm test && npm run lint && npm run build`, then `npm run dev` and open `http://localhost:5173/?mock=learn`. The replay should reach a FIGHT screen with `1P GRASP` facing `THE TUTOR`, the plate `CHECK n OF 3`, then a decision titled `THE REPORT` with `YOU'VE GOT IT` and four buttons. (The lesson frames show the fight screen until Task 11 adds the lesson screen; that is expected here.)

- [ ] **Step 6: Commit**

```bash
git add client/src/arcade
git commit -m "feat(client): the tutor in words — grasp lines, the check cue, the report's banners and hand-offs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The mode tile, the pick, and the lesson screen

**Files:**
- Modify: `client/src/arcade/mode.css` (four tiles), `screens/SelectScreen.tsx` (a title prop), `ArcadeApp.tsx`
- Create: `client/src/arcade/screens/LessonScreen.tsx`, `client/src/arcade/lesson.css`
- Test: `client/src/arcade/__tests__/modes.test.ts` (already pins `MODES[0].id === 'learn'`); the rest is visual, checked in `?mock=learn`

**Interfaces:**
- Consumes: `plateFor` for a lesson (Task 8), `teachLine` (Task 8).
- Produces: `LessonScreen({ snapshot, cards })`; `SelectScreen` prop `title?: string`.

- [ ] **Step 1: Four tiles**

In `mode.css`, change `.mode__row`'s `grid-template-columns: repeat(3, minmax(0, 1fr))` to `repeat(4, minmax(0, 1fr))`, and if a media query stacks the tiles at narrow widths, leave it. Check the tile's `min-width`/padding still fits four across at 1280px; shrink the blurb's font a step if it wraps badly. Optionally add a `.mode__tile--learn` colour in the same place the other three tiles get theirs.

- [ ] **Step 2: The pick says "Teach me …"**

`SelectScreen.tsx`: add `title?: string` to the props (default `'Choose your theory'`) and use it in place of the literal in `{mine ? 'Choose the house’s theory' : 'Choose your theory'}`. In `ArcadeApp.tsx`, the select screen becomes:

```tsx
        {screen === 'select' && (
          <SelectScreen
            snapshot={snapshot}
            cards={cards}
            solo={snapshot?.mode === 'sparring' || snapshot?.mode === 'learn'}
            title={snapshot?.mode === 'learn' ? 'Choose a theory to learn' : undefined}
            onPick={(mine, house) =>
              say(snapshot?.mode === 'learn' ? teachLine(mine.name) : pickLine(mine, house))
            }
          />
        )}
```

- [ ] **Step 3: The lesson screen**

Create `client/src/arcade/screens/LessonScreen.tsx`:

```tsx
import { Armchair } from '../components/Armchair';
import { RoundPlate } from '../components/RoundPlate';
import { TheoryCardFace } from '../components/TheoryCardFace';
import '../fight.css';
import '../lesson.css';
import '../select.css';
import type { DebateSnapshot, TheoryCard } from '../types';

export interface LessonScreenProps {
  snapshot: DebateSnapshot;
  cards: TheoryCard[];
}

const STEPS = ['The idea', 'The terms', 'The case for it', "What it's up against"];

/**
 * THE LESSON: the theory's card beside the tutor's armchair, and a plate
 * saying which of the four steps this is. No bars — nothing is scored here.
 * Which step is showing comes from the server's `lesson` field alone.
 */
export const LessonScreen = ({ snapshot, cards }: LessonScreenProps) => {
  const card = cards.find((c) => c.id === snapshot.user.theory_id) ?? null;
  const step = snapshot.lesson?.step ?? 1;

  return (
    <div className="lesson">
      <header className="lesson__head">
        <h2 className="lesson__title pixel-text">The lesson</h2>
        <p className="lesson__sub">— {card?.name ?? snapshot.user.theory_name ?? 'a theory'} —</p>
      </header>

      <div className="lesson__plate">
        <RoundPlate snapshot={snapshot} />
      </div>

      <div className="lesson__body">
        <div className="lesson__card">
          {card && <TheoryCardFace card={card} cards={cards} locked />}
        </div>
        <div className="lesson__tutor">
          <Armchair
            side="bot"
            variant="champion"
            level={0}
            hurt={false}
            healed={false}
            health={100}
            theoryId={null}
          />
          <p className="lesson__name pixel-text">THE TUTOR</p>
        </div>
      </div>

      <ol className="lesson__steps" aria-label="Lesson steps">
        {STEPS.map((title, i) => (
          <li
            key={title}
            className={`lesson__step${i + 1 === step ? ' lesson__step--now' : ''}${i + 1 < step ? ' lesson__step--done' : ''}`}
            aria-current={i + 1 === step ? 'step' : undefined}
          >
            <span className="lesson__step-num pixel-text">{i + 1}</span>
            <span className="lesson__step-title">{title}</span>
          </li>
        ))}
      </ol>

      <p className="lesson__hint">
        Your mic is open: say “clear” or “go on” to move to the next step, or ask the tutor anything about this one.
      </p>
    </div>
  );
};
```

Check `Armchair`'s props against `components/Armchair.tsx` before relying on `variant="champion"` and `theoryId={null}`; match what `FightScreen` passes for the bot side.

Create `client/src/arcade/lesson.css` in the idiom of `mode.css` (same variables, same pixel borders):

```css
.lesson {
  display: grid;
  grid-template-rows: auto auto 1fr auto auto;
  gap: 1rem;
  height: 100%;
  padding: 1.25rem 2rem;
}
.lesson__head { text-align: center; }
.lesson__title { font-size: 1.4rem; }
.lesson__sub { opacity: 0.8; }
.lesson__plate { display: flex; justify-content: center; }
.lesson__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2rem;
  align-items: center;
  min-height: 0;
}
.lesson__card { min-height: 0; }
.lesson__tutor { display: grid; justify-items: center; gap: 0.5rem; }
.lesson__name { font-size: 0.7rem; }
.lesson__steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.lesson__step {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border: 3px solid var(--ink, #222);
  opacity: 0.55;
}
.lesson__step--done { opacity: 0.8; }
.lesson__step--now { opacity: 1; box-shadow: 0 0 0 3px var(--accent, #ffd400); }
.lesson__step-num { font-size: 0.7rem; }
.lesson__hint { text-align: center; opacity: 0.8; font-size: 1.1rem; }
```

Use the project's actual CSS variable names from `arcade.css` (`grep -n "^\s*--" client/src/arcade/arcade.css | head`) in place of `--ink` and `--accent`.

- [ ] **Step 4: Mount it**

In `ArcadeApp.tsx`: import `LessonScreen`; render `{screen === 'lesson' && snapshot && <LessonScreen snapshot={snapshot} cards={deck} />}`; make `Stage` dim on it like the other non-fight screens (it already dims when `screen !== 'fight'`). In `announce`, a lesson screen reads `ROUND_LABELS.lesson` plus the step: add before the `lines` assembly:

```ts
  if (screen === 'lesson' && snapshot.lesson) {
    return `${ROUND_LABELS.lesson}. Step ${snapshot.lesson.step} of ${snapshot.lesson.of}, ${snapshot.lesson.title}`;
  }
```

- [ ] **Step 5: Look at it, then test, lint, build**

`npm run dev`, open `http://localhost:5173/?mock=learn`: MODE SELECT shows four tiles with LEARN first; SELECT reads "Choose a theory to learn"; the lesson frames show THE LESSON with the card, the tutor's chair, `STEP n OF 4` with the step's title, and the four steps lighting in turn; then the check and the report as in Task 10. Then `npm test && npm run lint && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add client/src/arcade
git commit -m "feat(client): LEARN on the menu, a theory to learn, and THE LESSON screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Rung marks on every card

**Files:**
- Modify: `client/src/arcade/components/CardGrid.tsx`, `select.css`, `screens/SelectScreen.tsx`, `screens/DeckScreen.tsx`
- Test: visual in `?mock=learn` and THE DECK; the pure logic is already pinned in `ladder.test.ts`

**Interfaces:**
- Consumes: `Ladder`, `RUNGS` (Task 9); the store's `ladder`.
- Produces: `CardGrid` prop `ladder?: Ladder`.

- [ ] **Step 1: The marks**

`CardGrid.tsx`: import `RUNGS` and `type Ladder` from `../ladder`; add `ladder?: Ladder;` to the props (default `{}`); inside each slot button, after the name span:

```tsx
            {card && (
              <span className="slot__rungs" aria-label={rungsLabel(ladder[card.id])}>
                {RUNGS.map((rung) => (
                  <span
                    key={rung}
                    className={`slot__rung pixel-text${ladder[card.id]?.[rung] ? ' slot__rung--lit' : ''}`}
                    aria-hidden="true"
                  >
                    {rung[0].toUpperCase()}
                  </span>
                ))}
              </span>
            )}
```

with, above the component:

```ts
const rungsLabel = (rungs: Ladder[string] | undefined): string => {
  const lit = RUNGS.filter((r) => rungs?.[r]);
  return lit.length ? `Cleared: ${lit.join(', ')}` : 'No rungs cleared';
};
```

`select.css`: beside `.slot__name`:

```css
.slot__rungs { display: inline-flex; gap: 0.25rem; margin-left: auto; }
.slot__rung {
  font-size: 0.5rem;
  padding: 0.1rem 0.2rem;
  border: 2px solid currentColor;
  opacity: 0.35;
}
.slot__rung--lit { opacity: 1; background: currentColor; color: var(--type-ink); }
```

Check `.slot`'s layout is a flex row so `margin-left: auto` pushes the marks right; if it is not, place the marks with the existing cursor label's positioning.

- [ ] **Step 2: Feed it from the store**

In `SelectScreen.tsx` and `DeckScreen.tsx`: `const ladder = useArcadeStore((s) => s.ladder);` and pass `ladder={ladder}` to `CardGrid`. THE DECK is reachable before connecting, and the store loads the ladder from storage at init, so marks show there too.

- [ ] **Step 3: Look, test, lint, build, push (milestone: Part 3)**

In `?mock=learn`, after the replay's first report, THE DECK (reload, then THE DECK from the title) shows GWT's L mark lit. `npm test && npm run lint && npm run build`.

```bash
git add client/src/arcade
git commit -m "feat(client): three rung marks on every card, lit from the ladder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```

---

# Part 4 — Evals, docs, and the one spoken session

### Task 13: Text-mode evals for the lesson

**Files:**
- Create: `server/evals/learn_text.yaml`, `server/evals/learn_simulated.yaml`
- Modify: `server/evals/suite.yaml`

**Interfaces:**
- Consumes: the running bot (`uv run bot.py -t eval`), the local Ollama judge (`gemma4:12b`).

- [ ] **Step 1: The scripted lesson and hand-off**

Create `server/evals/learn_text.yaml`:

```yaml
name: learn_text

# Scripted, text mode: a lesson from the front door to the report, and the
# hand-off into sparring. Run from server/:
#
#   uv run pipecat eval suite evals/suite.yaml -k script
#
# `eval:` criteria are judged by local Ollama (`ollama pull gemma4:12b`).

scenarios:
  - name: a_lesson_in_four_steps_then_three_checks_then_the_report_then_sparring
    turns:
      - expect:
          - event: response
            eval: "the bot welcomes the user and offers them things to do, including being taught a theory"

      # A theory named at the door: no second question about which theory.
      - user: "Teach me global workspace theory."
        expect:
          - event: function_call
            calls:
              - name: choose_mode
                args: {mode: learn}
              - name: choose_lesson
                args: {theory_id: gwt}
          - event: response
            eval: "the bot teaches the first step of a lesson on global workspace theory: it describes a content becoming conscious by winning a place on a shared stage or workspace and being broadcast across the brain, and it asks whether that is clear or whether the user has a question. It does not ask which theory to learn."
            text_excludes: "*"

      # A question does not advance the step.
      - user: "What do you mean by broadcast exactly?"
        expect:
          - event: response
            eval: "the bot explains broadcast as the content being sent to or made available to the whole brain at once, for memory, language, and action, and asks again whether it is clear"

      - user: "Clear. Go on."
        expect:
          - event: function_call
            calls:
              - name: step_done
          - event: response
            eval: "the bot teaches the terms of global workspace theory: it defines at least two of workspace, broadcast, ignition, and access, and asks whether that is clear"
            text_excludes: "_"

      - user: "Yes, clear."
        expect:
          - event: function_call
            calls:
              - name: step_done
          - event: response
            eval: "the bot gives the case for the theory: an example or experiment such as masking, and an argument such as brain-wide ignition, serial capacity, or testable predictions, and asks whether that is clear"

      - user: "Got it, next."
        expect:
          - event: function_call
            calls:
              - name: step_done
          - event: response
            eval: "the bot says what the theory is up against: an objection such as broadcast not explaining why access feels like anything, the adversarial collaboration result, or reliance on report, and the misreading of the workspace as a store, and asks whether that is clear"
            text_excludes: "#"

      - user: "Clear."
        expect:
          - event: function_call
            calls:
              - name: step_done
          - event: response
            eval: "the bot says it will ask three questions and asks the user to explain global workspace theory in their own words; it does not answer for them"

      - user: "A thought becomes conscious when it wins a competition for a small shared stage and gets broadcast to the whole brain, so memory, speech and action can all use it. Being broadcast like that is what being conscious is."
        expect:
          - event: function_call
            calls:
              - name: check_answered
          - event: response
            eval: "the bot asks a second question about global workspace theory, without saying whether the previous answer was right"

      - user: "I think ignition is when the visual area lights up for the word."
        expect:
          - event: function_call
            calls:
              - name: check_answered
          - event: response
            eval: "the bot asks a third question about global workspace theory, without saying whether the previous answer was right"

      - user: "Because the workspace can only hold one or a few things at a time. Everything competes for it, one wins, and the rest wait, so even though the brain works in parallel, what you're conscious of comes one thing at a time."
        expect:
          - event: function_call
            calls:
              - name: check_answered
          - event: response
            eval: "the bot announces a report: it states a number out of one hundred for the user's grasp, says whether they have got it, says what to go back over, and offers to spar with the theory, debate with it, repeat the lesson, or return to the menu"
            text_excludes: "`"

      # The hand-off: straight into the examiner's first question, no "what do you think".
      - user: "Let me spar with it: question me on this theory."
        expect:
          - event: function_call
            calls:
              - name: spar_this
          - event: response
            eval: "the bot, now as an examiner, asks the user one question that puts pressure on global workspace theory; it does not ask what the user thinks consciousness is, and does not argue for a theory of its own"
```

- [ ] **Step 2: The simulated learner**

Create `server/evals/learn_simulated.yaml`:

```yaml
name: learn_simulated

# A learner played by the local model: understands most of the lesson, but
# holds the card's misreading. The report must name it.

scenarios:
  - name: a_learner_who_pictures_the_workspace_as_a_store
    simulator: {service: ollama, model: gemma4:12b, extra: {reasoning_effort: none}}
    persona: |
      Sam, curious, has read a little popular science. Wants to learn global
      workspace theory: at the start, says "Teach me global workspace theory."
      After each step of the lesson says it is clear and to go on, with at most
      one short question in the whole lesson. In the check, explains things
      mostly well, but believes the workspace is a storage area where the brain
      keeps everything it is currently thinking about, and says so when asked to
      explain the theory or why only a few things are conscious at once. After
      the report, asks to go back to the menu, then ends the call.
    goal: "Be taught global workspace theory, answer the three check questions, hear the report, then go back to the menu."
    success: "the bot taught the lesson in steps, asked three check questions (check_answered was called three times), and in the report named the gap: that the workspace is not a store, or that consciousness is serial because one content at a time is broadcast"
    metrics:
      - name: one_thing_at_a_time
        criterion: "the reply teaches or asks about one thing and is not a list; a reply that is a greeting, a question, or a report passes"
        min_score: 0.9
      - name: no_verdict_before_the_report
        criterion: "the reply does not say whether an answer was right or wrong, or mention a score, unless it is the report itself; a reply with no such remark passes"
        min_score: 1
      - measure: words
        max_value: 95
      - measure: function_calls
        calls:
          - name: choose_mode
            args: {mode: learn}
          - name: choose_lesson
            args: {theory_id: gwt}
    runs: 2
```

- [ ] **Step 3: Register and run**

In `server/evals/suite.yaml`, change the scenarios list to `[debate_text, modes_text, learn_text, debate_simulated, learn_simulated]`.

Run, from `server/`, with the bot's env in `.env` and Ollama running:

```bash
uv run pipecat eval suite evals/suite.yaml -k script --logs-dir eval-runs -v 2>&1 | tail -40
uv run pipecat eval suite evals/suite.yaml -k simulation --logs-dir eval-runs -v 2>&1 | tail -60
```

Expected: exit 0 for both. On a failure, read the printed conversation and the assertion, fix the prompt in `flow.yaml` (never the assertion, unless it is asking for something the spec does not), and re-run that scenario alone with `uv run pipecat eval run evals/learn_text.yaml -v -d` against `uv run bot.py -t eval`. Typical first-run fixes: the tutor answering a question *and* calling `step_done`; the tutor on question one of the check reading the answer back; the report not offering all four next steps.

- [ ] **Step 4: Commit**

```bash
git add server/evals
git commit -m "test(evals): a scripted lesson with its hand-off, and a learner who holds the misreading

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Docs, the one spoken session, review, and the push

**Files:**
- Modify: `README.md`
- Modify: `docs/design/2026-10-13-learn-mode-design.md` (status line)

- [ ] **Step 1: README**

In the "two other things to do in the study" list, make it three and add first:

```markdown
- **Learn** — the tutor teaches one theory in four steps (the idea, the terms,
  the case for it, what it's up against), takes questions as it goes, then asks
  three check questions. A judge grades each answer against the card's rubric
  into a GRASP bar; 70 or more and *you've got it*, which lights the LEARN rung
  on that card. Each card carries three rungs, LEARN → SPAR → DEBATE, kept in
  the browser; nothing is locked, the ladder just shows where you are with each
  of the twelve.
```

In "The knowledge base", after the sentence on what each card has, add: "Each card also carries a **lesson**: the claim in plain words, three or four terms, an example, the common misreading, and two check questions with a rubric for the judge, fact-checked the same way." In "Architecture", add `learn-state-fixtures.json` where the fixtures are mentioned, `tutor_setup → lesson → check → lesson_report` to the `flow.yaml` line, and `choose_lesson, step_done, check_answered, spar_this, debate_this` to the `handlers.py` line. Under "Arcade UI", the screen count becomes eight with **LESSON** described in one clause, MODE SELECT has four tiles, and `?mock=learn` joins the mock list. Under "Status", add the tutor and the ladder to "Working end to end".

Set the spec's `**Status:**` to `implemented 2026-10-… (this plan)` with the date.

- [ ] **Step 2: The one spoken session**

With `uv run bot.py` in `server/` and `npm run dev` in `client/`, open `http://localhost:5173/`, PRESS START, and by voice: choose LEARN on the tiles, pick a theory other than GWT on the roster, go through the four steps asking one question on the way, answer the three checks, hear the report, and say "let me spar with it". Listen for: the tutor's turns under ~20 seconds, no markdown spoken, the step plate advancing as the tutor moves on, the check questions put one at a time, the report read before anything else, and the examiner's first question arriving without the "what do you think consciousness is" question. Close the tab when done (the mic streams to STT while connected). Note anything off and fix it; re-run the scripted suite after any prompt change.

- [ ] **Step 3: Full verification**

```bash
cd server && uv run pytest -q && uv run python make_fixtures.py --check
cd ../client && npm test && npm run lint && npm run build
```

Expected: all PASS, fixtures current.

- [ ] **Step 4: Review**

Invoke `superpowers:requesting-code-review` for the whole branch since `d444c20` (the spec commit), and fix what it finds.

- [ ] **Step 5: Commit and push (milestone: done)**

```bash
git add README.md docs/design/2026-10-13-learn-mode-design.md
git commit -m "docs: learn mode and the ladder in the README; the spec's status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```
