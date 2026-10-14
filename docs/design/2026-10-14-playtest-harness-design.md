# Playtest Harness — Design

**Date:** 2026-10-14 · **Status:** approved in conversation (three layers: voice
playthroughs, a rules checker over a recorded timeline, screen behaviour tests)
· **Builds on:** [`learn-mode-design`](2026-10-13-learn-mode-design.md),
[`modes-design`](2026-09-20-modes-design.md)

## Goal

Find gameplay hiccups before a person does, and when a person does find one,
show exactly what happened. Today the evals drive the bot in text, through a
transport that is not the one the browser uses, and they never see what the
screen was told. Hiccups live in the gaps: turn-taking over real audio, a step
that skips or sticks, the screen out of step with the voice, and screen
behaviour like a chair's mouth not moving. The first one found this way: the
lesson screen draws the tutor with its audio level fixed at zero, so its mouth
never moves.

Three layers, each usable on its own:

1. **Voice playthroughs.** A driver plays scripted sessions against a real local
   bot over WebRTC, with synthesized speech as the microphone.
2. **A flight recorder and a rules checker.** The bot writes a timeline of every
   session; a checker lists every rule the timeline breaks. The same recorder
   runs in your real `./armchair` sessions.
3. **Screen behaviour tests.** Playwright drives the arcade's replay mode and
   checks what is drawn, starting with the speaking chair's mouth.

Out of scope: CI, phones, load, and the eval suite, which stays as it is.

## Layer 2 first: the timeline

The bot records. It already sees everything firsthand, so the recorder is a
Pipecat observer plus a hook on `DebateState`'s `on_change`, writing one JSON
object per line to a session file.

```jsonc
{"t": 12.41, "kind": "node",       "name": "lesson"}
{"t": 12.42, "kind": "snapshot",   "state": { /* the full debate_state */ }}
{"t": 14.03, "kind": "user_started"}
{"t": 15.60, "kind": "user_stopped"}
{"t": 15.61, "kind": "user_text",  "text": "What do you mean by broadcast?", "typed": false}
{"t": 16.90, "kind": "tool",       "name": "step_done", "args": {}, "status": "more"}
{"t": 17.05, "kind": "bot_started"}
{"t": 17.06, "kind": "bot_text",   "text": "The key terms are ..."}
{"t": 22.30, "kind": "bot_stopped"}
{"t": 30.00, "kind": "error",      "message": "..."}
```

- `t` is seconds since the session began. The first line is a header with the
  session id, start time, git commit, and providers.
- Sources: `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame`,
  `BotStartedSpeakingFrame` / `BotStoppedSpeakingFrame`, `ErrorFrame`; the
  existing `TurnObserver` callback for `user_text` and `bot_text`; the handlers'
  results for `tool` (one wrapper, not a change to each handler); Flows' node
  changes for `node`; `on_change` for `snapshot`.
- **Where:** `ARMCHAIR_RECORD=<dir>` turns it on. `./armchair` sets it to
  `~/.armchair/sessions/`; the playthrough driver sets it to its run directory.
  Off by default, so dev runs, evals, and Pipecat Cloud are untouched.
- **Privacy:** it holds transcripts of what you said, so it stays on the
  machine, is never uploaded, and `./armchair` keeps only the latest 50.

## The rules checker

A pure function, `check(timeline) -> list[Violation]`, where a violation has a
rule id, a severity (`error` or `warn`), the time, and a one-line message. It is
a module with no Pipecat imports, so it is unit-tested with hand-written
timelines: each rule gets a clean case and a breaking one.

| Rule | Checks | Severity |
|---|---|---|
| `legal-path` | Every node change follows an edge in `flow.yaml` (read from the config, not copied) | error |
| `stage-follows-node` | Every node entry that emits a stage is followed by a snapshot with that stage within 1 s | error |
| `steps-in-order` | `lesson.step` and `question.number` only move up by one, and reset only on a new lesson or examination | error |
| `answered` | After a final user turn, the bot starts speaking within 12 s, unless the user spoke again first | error |
| `no-double-reply` | The bot never starts a second reply while one is still being spoken | error |
| `barge-in` | When the user starts speaking while the bot is speaking, the bot stops within 1.5 s | error |
| `no-early-score` | No bot text mentions a score, a grasp or integrity number, health, or "out of one hundred" before the stage is `verdict` | error |
| `earned-rung` | A snapshot with `verdict.winner == "user"` appears only at stage `verdict`, and only after that mode's last scored turn | error |
| `guard-fired` | A tool returned `teach_first`, `ask_first`, or `answer_first` (a barge-in the guards caught) | warn |
| `errors` | Any `error` line | warn |
| `long-silence` | Nobody spoke for more than 30 s while connected | warn |

`uv run python -m playtest check <timeline>` prints the violations and exits
non-zero on any `error`. `./armchair --last` checks your most recent session.

## Layer 1: voice playthroughs

A package, `server/playtest/`, driven from the command line:

```bash
uv run python -m playtest run playtest/scenarios/learn_happy.yaml
uv run python -m playtest run playtest/scenarios/          # all of them
```

For each scenario it starts a bot in local mode on a free port with the
recorder pointed at the run directory, connects the stand-in WebRTC client,
plays the script, closes, runs the checker over the bot's timeline, and checks
the scenario's own expectations.

**The client** is the `aiortc` stand-in proven on 2026-10-14: it sends an audio
track and reads the RTVI data channel. The track plays silence until the
script queues an utterance, so timing is under the script's control.

**Speech** is synthesized once per distinct line with Gradium's REST
text-to-speech and cached by a hash of the text and voice under
`server/playtest/.cache/` (git-ignored). A re-run costs nothing for speech
already synthesized.

**A scenario** is a list of steps:

```yaml
name: learn_with_interruptions
steps:
  - wait: {bot_stopped: 1}             # the greeting has finished
  - say: "Teach me global workspace theory."
  - wait: {stage: lesson}
  - wait: {bot_started: 1}
  - say_after: {seconds: 1.5, text: "Sorry, what was that?"}   # barge in mid-sentence
  - wait: {bot_stopped: 1}
  - say: "Clear, go on."
  - silence: 25                        # say nothing for a while
  - say: "Go on."
  - wait: {step: 3}
  # ...
expect:
  final_stage: verdict
  final_mode: learn
  tools_include: [choose_lesson, step_done, check_answered]
  rules_allow: [guard-fired]           # warnings this scenario expects
```

Every `wait` has a timeout (default 45 s) and fails the run with the last ten
timeline lines when it runs out.

**The scenarios, first set:**

| Scenario | Covers |
|---|---|
| `learn_happy` | Front door to report and the SPAR hand-off, no surprises |
| `learn_interruptions` | Barge-in mid-step, "say that again", a question mid-step, a long silence |
| `learn_ask_to_skip` | "Just test me" and "give me the report" during the lesson |
| `debate_happy` | Front door to verdict |
| `debate_interruptions` | Barge-in during a rebuttal, answering before the cross-examination question is finished |
| `sparring_happy` | Five questions and the finding |
| `menu_from_anywhere` | "Take me back to the menu" from inside each mode |
| `debate_from_lesson` | The DEBATE hand-off picks a rival without re-asking the player's view |

**Cost and time:** each run is a real session: a few minutes, and some Gradium
and General Compute credit. These are for before a release or after a change
to the flow, not every edit. The driver prints the run's duration and the
characters of speech it synthesized.

## Layer 3: screen behaviour tests

Playwright tests in `client/e2e/`, run with `npm run e2e` against the replay
mode, with no server and no credits.

Two small additions to the replay mode make it testable:

- `?mock=<mode>&frame=<n>` shows fixture frame `n` and holds it, instead of
  looping on a timer, so a test lands on an exact screen.
- `?talk=bot` (or `user`) feeds an oscillating fake audio level to that side, so
  a test can see a mouth move without a voice.

**The first tests:**

- **Mouths:** on every screen where a character speaks, its chair gets the
  `armchair--talking` class while its level is above zero: the fight screen
  (both sides), the check, THE LESSON's tutor, and the decision screen (the
  verdict, finding, and report are read aloud). The lesson case fails today and
  is fixed by passing the bot's level to `LessonScreen`.
- **Plates and banners** for one frame of each stage in each mode, against the
  labels the unit tests already pin, so a screen cannot show the wrong round.
- **The hand-off buttons** on the learn report: clicking SPAR WITH IT sends the
  line and does not change the screen by itself.

## Testing the harness itself

- The checker: unit tests per rule, as above.
- The recorder: a unit test that feeds frames and state changes to it and
  compares the file; and `bot.py` with `ARMCHAIR_RECORD` unset writes nothing.
- The driver: `learn_happy` run once end to end as the acceptance test.
- Layer 3: the mouth test is written first and fails on the lesson screen
  before the fix.

## Order of work

1. Layer 3 and the lesson-screen lips, since they are fast and cost nothing.
2. The recorder and the checker, with their unit tests; `./armchair` turns the
   recorder on, so your own sessions start producing timelines at once.
3. The driver and `learn_happy`; then the rest of the scenarios, fixing what
   they find.
