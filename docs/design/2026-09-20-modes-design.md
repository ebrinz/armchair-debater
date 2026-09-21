# Modes — Design

**Date:** 2026-09-20 · **Status:** approved in conversation (mode select: arcade
screen + voice; sparring: five questions, one bar; scope: sparring and explorer)
· **Builds on:** [`debate-mode-design`](2026-09-19-debate-mode-design.md),
[`debate-ui-design`](2026-09-19-debate-ui-design.md)

## Goal

Two more things to do in the study, beside the debate: have your own view
**examined** (Socratic sparring), and be **shown round** the theories (the
explorer). A mode is chosen at the door, by voice or on an arcade MODE SELECT
screen. The debate itself is untouched behind it.

Bot-vs-bot and retrieval stay parked.

## The front door

A new initial node, `mode_select`. The bot greets the user and asks whether they
want to **debate**, **spar**, or **explore**. One Python tool:

```
choose_mode(mode: "debate" | "sparring" | "explore") -> {"status": mode}
```

The config branches on `status`: `debate → setup`, `sparring → spar_setup`,
`explore → explore`. `setup` no longer greets — it just asks the question.
Every mode's last node offers `main_menu` (transition only → `mode_select`), so
nobody is stuck in a mode.

The UI's MODE SELECT sends a typed line, exactly as a theory pick does: "Let's
debate.", "I'd like to spar.", "I want to explore the theories." A voice-only
user just answers the question.

## Sparring: five questions, one bar

The bot takes no side. It is **the examiner**: it asks five probing questions,
one at a time, drawn from the known objections on the user's own theory card and
escalating, and the judge scores each **answer**.

| Node | On entry the bot… | Leaves by |
|---|---|---|
| `spar_setup` | asks what the user thinks consciousness is | `take_position(user_theory)` → `sparring` when `status: ok` |
| `sparring` | asks question *n* of five | `answer_heard()` → `sparring` again while `status: more`, `spar_verdict` on `done` |
| `spar_verdict` | reads the examiner's finding, offers another round or the main menu | `spar_again` → `spar_setup`; `main_menu` |

`sparring` is one node entered five times: `answer_heard` counts, and the prompt
is templated with the question number, so the LLM always knows where it is. The
same guard as cross-examination applies — `answer_heard` refuses (`ask_first`)
until the examiner has actually finished a turn in this visit to the node, so a
barge-in cannot burn a question.

**Scoring.** A new judge call, `score_answer`, reads the question, the answer and
what came before, and returns the same shape as a debate score: `damage` 0–25
(how much of the position the question took — 0 for a full answer, 25 for a dodge
or a conceded core claim), `recovery` 0–15 (how far this answer repaired an
earlier weak one), and a one-sentence `reason`. It is applied as a hit by the
examiner at **scale 1**, not the debate's 2 — five questions at the debate's
scale would floor every player — and the recovery heals the **player**, since
here a good answer is the only way to get integrity back. The examiner has no bar.

**The finding.** The bar is the verdict, as in the debate: 70 or more, *the view
holds*; 40–69, *shaken*; under 40, *in tatters*. The judge writes a two-sentence
finding naming the objection that did the most damage. `verdict.winner` is `user`
at 50 or more, else `bot`, so the contract's shape does not change.

## The explorer

One node, `explore`, no scoring, no rounds. The user asks about a theory, or to
compare two, or for the strongest objection to one, and the bot answers from the
cards — in the same seventy words a turn, with the same citation rule. One Python
tool:

```
show_theory(theory_id) -> the whole card: claim, arguments, objections, citations, rivals
```

It stays in the node (no case matches), puts `theory_id` in the snapshot's
`focus`, and hands the LLM the card to talk from. The explorer may speak a card's
objections aloud — nobody here is an opponent — but they still never go to the
client. `main_menu` leaves.

The UI's EXPLORE screen is THE DECK, following the bot: the roster's cursor goes
to `focus`. Clicking a tile sends "Tell me about {name}."

## State contract additions

Every existing field keeps its meaning. Added to the snapshot:

```jsonc
{
  "mode": "debate" | "sparring" | "explore" | null,   // null until chosen
  "focus": "iit" | null,                                // explorer: the card being discussed
  "question": { "number": 3, "of": 5 } | null           // sparring: where we are
}
```

`stage` gains `mode` (the front door), `sparring`, and `explore`. Sparring reuses
`setup` and `verdict` for its first and last nodes — the select screen and the
decision screen already do what those moments need — and the client tells them
apart by `mode`. In sparring `bot.theory_id` stays `null` and `bot.theory_name` is
`"The Examiner"`.

## UI

| Screen | When |
|---|---|
| `mode` | `stage: "mode"` — three big tiles, DEBATE / SPARRING / EXPLORE, arrow keys and Enter, in the select screen's idiom |
| `select` | `stage: "setup"`; in sparring it is one step — there is no house theory to choose |
| `fight` | debate rounds, and `stage: "sparring"`: the same HUD with the house's bar and name replaced by `THE EXAMINER`, the plate reading `QUESTION 3 OF 5`, battle text saying "THE EXAMINER asked…" |
| `decision` | `stage: "verdict"`; in sparring the banner is `YOUR VIEW HOLDS` / `SHAKEN` / `IN TATTERS` and there is one number |
| `explore` | `stage: "explore"` — THE DECK, cursor following `focus` |

The versus splash is debate-only (it needs two theories).

## Testing

- Unit: `choose_mode`, `take_position`, `answer_heard` (count, guard, reset),
  `show_theory`; `DebateState` mode/focus/question, scale-1 hits that heal the
  player; `score_answer` parsing; `test_flow_config` pins the three paths and
  that every node offers a way out.
- Fixtures: the debate fixture gains `mode`/`focus`/`question`; a sparring fixture
  and an explorer fixture are generated from `DebateState`, like the debate's.
- Evals (text, scripted): every debate scenario gains the mode turn; one sparring
  scenario (five questions, the finding, one bar in the numbers); one explorer
  scenario (`show_theory` with the right id, an objection from the card, no paper
  from off the card). The simulated debate gains the mode turn.
- Client: `screenFor`, labels, banners, and the mock gains `?mock=sparring` and
  `?mock=explore`.
