# Learn Mode — Design

**Date:** 2026-10-13 · **Status:** implemented 2026-10-13 ([plan](2026-10-13-learn-mode-plan.md)); approved in conversation (approach: a lesson
loop built like sparring; mastery: explain it back, judged; hierarchy: a ladder
per theory, nothing locked) · **Builds on:**
[`modes-design`](2026-09-20-modes-design.md),
[`debate-mode-design`](2026-09-19-debate-mode-design.md),
[`debate-ui-design`](2026-09-19-debate-ui-design.md)

## Goal

A spoken tutor for one chosen theory of consciousness. The user picks a card,
the Tutor teaches it in four steps and takes questions until each step is
clear, then examines the user on it. A judge scores the understanding, and a
pass clears the first rung of a ladder every card now carries: LEARN, then
SPAR, then DEBATE. The ladder suggests the order and shows where the user is on
each of the twelve theories; it locks nothing. The purpose is that the user
ends up knowing all twelve, and the debate and sparring become the proof.

The voice path is untouched: nothing in `bot.py` (transport, STT, the LLM
service, TTS, the turn observer) changes. The work lives in the cards,
`flow.yaml`, the handlers, the judge, the scorer's routing, the state model,
and the client.

## The lesson on the card

Each of the twelve cards gains a `lesson` block. A card without one, or with a
malformed one, stops the bot at boot like any other schema break.

```yaml
lesson:
  in_plain_words: >-        # the claim again, no jargon, two or three sentences
  terms:                    # three or four: the words a newcomer trips on
    - term: global workspace
      means: a limited-capacity stage; whatever wins a place on it is broadcast to the whole brain
  example: >-               # one case or thought experiment the theory handles well
  misreading: >-            # the common wrong reading, and the correction
  checks:                   # exactly two; the exam
    - question: Why does the theory say the cerebellum contributes so little to consciousness?
      looks_for: modular wiring, little integration, so low phi despite more neurons
```

Validation (`knowledge.py`): `in_plain_words`, `example`, `misreading` are
non-empty strings; `terms` has three or four entries each with non-empty
`term` and `means`; `checks` has exactly two entries each with non-empty
`question` and `looks_for`.

- **Four steps map onto the card, nothing duplicated.** 1 *The idea*
  (`in_plain_words`). 2 *The terms* (`terms`). 3 *The case for it* (`example`
  plus the card's three `arguments`). 4 *What it's up against* (the card's
  three `objections` plus `misreading`). The lesson adds only what the debate
  never needed.
- **`looks_for` is the judge's rubric**, not the tutor's script. The tutor is
  not shown the checks until the exam, and they never go to the client
  (`client_cards()` sends no lesson), as objections do not today.
- **Fact-checked like the citations.** Every claim in `example`, `terms`, and
  `misreading` is checked against the card's own sources by an agent other
  than the one that wrote it. The tutor talks only from the card.

Authoring the twelve lessons is the largest single piece of work and is its
own step of the plan, before the flow, so the flow is built against real
material.

## The flow

Five nodes, built the way sparring is. The Tutor has its own `role_message`:
patient, plain-spoken, checks before moving on, never argues a side, speaks
only from the card; `{{ voice_rules }}` shared as in the other modes.

| Node | On entry the bot… | Leaves by |
|---|---|---|
| `tutor_setup` | asks which theory to learn (named, or picked on the card screen, which sends "Teach me {name}.") | `choose_lesson(theory_id)` → `lesson` on `ok` |
| `lesson` | teaches step *n* of four in under seventy words, then asks if that is clear or if they have a question; answers questions in place, from the card | `step_done()` → `lesson` while `more`, `check` on `done` |
| `check` | puts question *n* of three: first "explain it to me in your own words", then the card's two checks, one at a time; never says whether an answer was right | `check_answered()` → `check` while `more`, `lesson_report` on `done` |
| `lesson_report` | reads the judge's report, then offers the next rung | `spar_this` → `sparring`; `debate_this` → `setup`; `learn_again` → `tutor_setup`; `main_menu` → `mode_select` |

- **`lesson` and `check` are one node each, entered once per step**, like
  `sparring`. The handler counts (`lesson_step`, `check_q` in flow state); the
  prompt is templated with the step number, its title, and that step's
  material from the card, so the LLM always knows where it is and what to
  teach. The same barge-in guard as sparring: `step_done` refuses (`teach_first`)
  and `check_answered` refuses (`ask_first`) until the tutor has finished a
  turn in that visit to the node. An `emit_check` pre-action on `check`
  mirrors sparring's `emit_question`: it sets the snapshot's `question` for
  the plate. The question text and its rubric are put in flow state by the
  handler that leads into the node (`step_done` on the fourth step,
  `check_answered` on a `more`), because Flows renders a node's prompt from
  state as it enters, before its pre-actions run; for question one the rubric
  is `in_plain_words` plus the terms.
- **Going back is free.** "Say that again" or "what was that term" stays in
  the node; the tutor re-explains. There is no backwards transition.
- **The hand-offs carry the theory and switch the mode.** `spar_this` sets
  the mode to `sparring`, then does exactly what `take_position` does with the
  lesson's theory (the same code, not a copy: it seats the player, resets
  `spar_q` to 1 and the scorer), and transitions straight to the `sparring`
  node, skipping `spar_setup`'s question. `debate_this` sets the mode to
  `debate` and transitions to `setup` with a result telling the LLM the user
  holds this theory, so `setup`'s "unless they have already told you" rule
  fires and it calls `set_positions` without asking. Switching the mode first
  matters: the client's labels and `winner()`'s threshold both read it.
- **`choose_lesson`** mirrors `take_position`: unknown id → `unknown_theory`
  with the valid ids; otherwise sets `user_card`, `user_theory_name`,
  `bot_theory_name = "The Tutor"`, the lesson material, `lesson_step = 1`,
  and resets the scorer. `DebateState.set_solo` gains a `bot_name` argument
  (default `EXAMINER`) so the tutor can take the examiner's seat under its own
  name. An `emit_step` pre-action on `lesson` sets the snapshot's `lesson`
  field, as `emit_question` does for the check.
- **Mode select gains `learn`.** "Teach me", "learn", "lesson", "tutor" route
  there; "tell me about", "what is", "look around" stay with explore. Today
  "teach me" means explore; it moves.

## The judge and the score

- **`score_understanding`** (`judge.py`), a fresh context like the others. It
  gets the theory, the question, the rubric from the card, the answer, and the
  prior questions and answers, and returns the `TurnScore` shape: `damage`
  0–25 (what the answer was missing: 0 for a full answer, 25 for a blank, a
  dodge, or the misreading), `recovery` 0–15 (how far this answer covered what
  an earlier one missed), and a one-sentence `reason`. For the first question,
  "in your own words", the rubric is `in_plain_words` plus the terms.
- **One bar, GRASP, scored like sparring.** Each of the three answers is
  applied with `apply_answer` (scale 1, recovery heals the player). Three
  questions can take at most 75, so the floor is 25. Thresholds: 70 or more,
  *you've got it*; 40 to 69, *nearly*; under 40, *not yet*. `winner()` returns
  `user` at 70 or more in learn mode (`GOT_IT_AT = 70`); sparring keeps 50.
- **`write_report`**, two spoken sentences: what the user has got, and the one
  thing to go back over, naming the step it lives in. The prompt gets the
  lesson so it can point at a step. A `JudgeError` falls back to the costliest
  hit's reason, as the finding does.
- **The scorer gains a routing table.** Today it decides "score as an answer"
  by node name. It becomes a map of node to judge call: `sparring` →
  `score_answer`, `check` → `score_understanding`, every other heard node →
  `score_turn`; the bot's turns in `sparring` and `check` are heard but not
  scored. The `check` handler puts the current question's rubric in flow state
  on entering the node, and the scorer reads it through a callable, as it
  reads the stage. `lesson` is heard but unscored, like the cross-examination's question node,
  so `step_done`'s guard can count the tutor's turns; `emit_check` resets the
  scorer as the first check question is put, so the exam's transcript never
  contains the lesson.

## State contract

Every existing field keeps its meaning. Added to the snapshot:

```jsonc
{
  "mode": "debate" | "sparring" | "explore" | "learn" | null,
  "lesson": { "step": 2, "of": 4, "title": "The terms" } | null,   // the tutor: where we are
  "question": { "number": 1, "of": 3 } | null                      // reused by the check
}
```

`stage` gains `lesson` and `check`. The tutor reuses `setup` (pick a card) and
`verdict` (the report), told apart by `mode`, as sparring does. During a
lesson `bot.theory_name` is `"The Tutor"`, `bot.theory_id` is `null`, and
`user.theory_id` is the theory being learned. `lesson` is `null` outside the
lesson stage; `question` is `null` outside the check.

## The ladder

The server stays stateless. The client keeps the `localStorage` key
`armchair.ladder`, a map of theory id to `{ learn, spar, debate }`, and sets a
rung to true when a verdict snapshot arrives with `winner: "user"` in that
mode for `user.theory_id` (a draw clears nothing; the explorer has no rung).
Every card, on SELECT and THE DECK, shows three small rung marks, L S D, lit
when cleared. Nothing is locked.

## UI

| Screen | When |
|---|---|
| `mode` | four tiles, LEARN first, then DEBATE, SPARRING, EXPLORE |
| `select` | `stage: "setup"` in learn mode is one step, like sparring; a click sends "Teach me {name}." |
| `lesson` (new) | `stage: "lesson"`: the theory's card on the stage beside the tutor's armchair, a plate reading `STEP 2 OF 4 · THE TERMS`, four pips. No bars. |
| `fight` | `stage: "check"`: the sparring layout, one bar labelled GRASP facing THE TUTOR, plate `CHECK 1 OF 3`, battle text "THE TUTOR asked…" |
| `decision` | `stage: "verdict"` in learn mode: banner `YOU'VE GOT IT` / `NEARLY` / `NOT YET`, the report, and four choices: SPAR WITH IT, DEBATE WITH IT, AGAIN, MENU. Each sends a typed line, as everything else does. |

`?mock=learn` replays a recorded lesson. The versus splash stays debate-only.

## Testing

The voice path is not under test until the end: the feature does not touch
it, and it is already proven. Every eval here is text mode, which never
synthesizes speech. One spoken session in the browser at the very end checks
that the tutor's voice and the hand-offs feel right.

- **Unit:** lesson schema validation (a card missing a lesson, a check without
  `looks_for`, three checks, two terms: each stops the boot); `choose_lesson`,
  `step_done`, `check_answered` (count, guard, reset); `spar_this` and
  `debate_this` carrying the theory; the scorer's routing table and rubric
  pass-through; `score_understanding` parsing; `DebateState` lesson, `winner()`
  at the learn threshold; `test_flow_config` pins the learn path and that
  every node offers a way out.
- **Fixtures:** a `learn` fixture generated from `DebateState` like the
  others; the existing fixtures gain `lesson: null`.
- **Evals (text, scripted):** one lesson end to end: the right card, four
  steps advance one `step_done` each, a question mid-step is answered from the
  card without advancing, the three checks fire with the right questions,
  GRASP ends in the numbers, the report is two sentences, no markdown reaches
  speech. One hand-off: `spar_this` lands in `sparring` with the theory taken
  and no "what do you think" question. One simulated learner, played by the
  local model, who understands most of it and holds the card's misreading,
  judged on whether the report names it.
- **Client:** `screenFor` and `plateFor` for the new stages, the ladder store
  (set on win, not on draw, survives reload), the rung marks, `?mock=learn`.

## Order of work

1. The twelve lessons on the cards, with validation and the second-agent
   fact-check.
2. The flow, handlers, judge, scorer, and state, with the unit tests and
   fixtures.
3. The client: mode tile, lesson screen, check and decision variants, the
   ladder, the mock.
4. The evals, then the one spoken session.

Each step leaves the existing modes green.
