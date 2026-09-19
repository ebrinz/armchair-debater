# Debate Mode v1 — Design

Date: 2026-09-19
Status: approved for planning

## Goal

A voice bot that debates the user on theories of consciousness. The user says what
they think consciousness is; the bot takes a rival theory and argues it through a
formal debate — opening, rebuttal, closing. An independent judge scores every turn
as it lands, driving two live health bars in the UI; whoever has more health after
the closings wins. Every paper the bot cites comes from a curated knowledge file,
never from the LLM's memory.

Time budget: roughly three hours of build across two sessions plus a background
agent. That constraint drives the scope below.

## Non-goals (v1)

No RAG, embeddings, or vector store. No bot-vs-bot. No second voice. No
cross-examination round. See [TODOs](#todos).

## Starting point

`server/bot.py` is the Pipecat CLI scaffold (pipecat 1.11.0): a cascade pipeline —
Gradium STT → General Compute `deepseek-v3.2` (OpenAI-compatible) → Gradium TTS —
over SmallWebRTC, with the `eval` transport wired. It has a generic prompt and no
tools. `client/` is the scaffolded React + Vite console, which already exposes an
`onServerMessage` prop. The pipeline, transports, and service constructors stay.

## Architecture

```
server/
  cards/theories.yaml   # 12 theory cards
  knowledge.py              # load + validate cards; look up by id or alias
  debate_state.py           # DebateState: stage, positions, health, verdict; snapshot()
  judge.py                  # score_turn() and write_rationale(); no Pipecat imports
  scorer.py                 # TurnScorer: ordered background scoring of finished turns
  flow.yaml                 # FlowConfig: setup → opening → rebuttal → closing → verdict
  handlers.py               # Flows tools + action: set_positions, judge_debate, emit_stage
  bot.py                    # wires Flow, FlowManager, DebateState, TurnScorer
  tests/                    # pytest
  evals/                    # scripted + simulated scenarios
client/src/debate/          # debate UI: types, store, mock, health bars, verdict
docs/design/debate-state-fixtures.json   # the state contract as example snapshots
```

| Unit | Does | Depends on |
|---|---|---|
| `knowledge.py` | Loads and validates cards once; `get`, `index`, `brief` | `theories.yaml` |
| `debate_state.py` | Holds debate state; applies hits; computes the winner; emits a snapshot on every change | nothing |
| `judge.py` | Two LLM calls: score one turn; write the closing rationale | an OpenAI-compatible client |
| `scorer.py` | Queues finished turns, scores them in order off the voice path, applies results | `judge`, `debate_state` |
| `handlers.py` | Thin Flows tools and one action handler | `knowledge`, `debate_state`, `scorer`, `judge` |
| `flow.yaml` | Which node comes next; each node's instructions and tools | handler names |
| `bot.py` | Wires it into the existing pipeline | all of the above |
| `client/src/debate/` | Renders the latest snapshot | the state contract only |

`flow.yaml` owns transitions; tools never choose nodes. `knowledge.py`,
`debate_state.py`, `judge.py`, and `scorer.py` import nothing from Pipecat, so they
are unit-tested without a pipeline.

## Knowledge base

Backbone: the taxonomy in Kuhn, "A Landscape of Consciousness" (2024). Depth and
citations drawn from the Stanford Encyclopedia of Philosophy, Seth & Bayne (2022),
Butlin et al. (2023), and the ConTraSt database; PhilPapers for locating primary
papers.

Twelve cards, with fixed ids:

| Kuhn category | Theories (id) |
|---|---|
| Materialist / neuroscientific | Global Workspace (`gwt`), Integrated Information Theory (`iit`), Higher-Order Thought (`hot`), Recurrent Processing (`rpt`), Predictive Processing (`predictive_processing`), Attention Schema (`ast`), Illusionism (`illusionism`), Biological Naturalism (`biological_naturalism`) |
| Quantum | Orch OR (`orch_or`) |
| Non-materialist | Panpsychism (`panpsychism`), Property Dualism (`property_dualism`), Analytic Idealism (`analytic_idealism`) |

Card schema:

```yaml
- id: iit
  name: Integrated Information Theory
  aliases: [IIT, phi, integrated information]
  kuhn_category: Materialism > Integrated information
  claim: One or two sentences, speakable.
  arguments: [exactly three, each one spoken sentence]
  objections: [exactly three, each one spoken sentence]
  rivals: [gwt, illusionism]        # one or more card ids; must resolve; not itself
  citations:                        # two to four
    - "Tononi 2004, BMC Neuroscience, An information integration theory of consciousness"
```

Rules:

- **Every citation is verified by web search when the card is written.** A citation
  that cannot be confirmed is left off.
- `rivals` makes "pick a strong opponent" a lookup rather than a model guess.
- `knowledge.py` fails at import if a card breaks the schema, so a bad card stops
  the bot at boot, not mid-debate.

## Conversation flow

Five nodes. The bot speaks on entering each node; each user round is one turn,
which gives the LLM an unambiguous rule for when to call the transition. Every
node has an `emit_stage` pre-action that records the stage and pushes a snapshot.

| Node | On entry the bot… | Tool that leaves the node |
|---|---|---|
| `setup` | greets, asks what the user thinks consciousness is | `set_positions(user_theory, bot_theory)` → `opening` when `status: ok` |
| `opening` | states which theory it defends, gives its opening, invites the user's | `opening_done` (transition only) |
| `rebuttal` | rebuts the user's opening, invites their rebuttal | `rebuttal_done` (transition only) |
| `closing` | gives its closing, invites the user's | `judge_debate()` → `verdict` |
| `verdict` | announces the final health, the winner, and the judge's rationale; offers a rematch | `rematch` (transition only → `setup`) |

`set_positions` receives theory ids the LLM chose from the index in the `setup`
prompt (the index lists each card's rivals). It validates both; if the bot's theory
is not one of the user's theory's `rivals`, it substitutes the first rival. It
stores both card briefs in flow state — later node prompts include them as
`{{ user_card }}` and `{{ bot_card }}` — resets both health bars to 100, and
returns `status: ok`. An unknown id returns `status: unknown_theory` with the valid
ids; the branch table has no case for it, so the flow stays in `setup` and the
model retries.

If the user's view matches no card, the LLM picks the nearest one and says so
aloud ("that sounds closest to…"); the user can correct it before the opening.

### Role message (durable, set on `setup`, persists across nodes)

- Identity: a sharp, good-humored debater on theories of consciousness.
- The scaffold's voice guard, verbatim: responses are spoken aloud; no emojis,
  bullet points, or formatting that can't be spoken.
- Two to four spoken sentences per turn; one argument at a time.
- Cite only what is on the loaded cards, spoken as author and year. Never invent a
  paper. If asked for a source the card lacks, say so.
- Concede a genuinely good point, then continue; do not fold to be agreeable.
- Never mention health, scores, or the judge before the verdict.

The scaffold's `system_instruction` is removed from `bot.py`; Flows sends the role
message as the LLM's system instruction. Per-stage instructions live in each node's
task messages.

## Live judging

### Model

Two health bars, each starting at 100. After every argument turn in `opening`,
`rebuttal`, or `closing`, the judge scores that one turn:

- `damage` (0–25): how hard the turn hits the opponent's position.
- `recovery` (0–15): how well the turn answers the last hit the speaker took.
  Zero when the speaker has not been hit yet.
- `reason`: one short sentence, shown in the UI.

Then `opponent.health -= damage` (floor 0) and `speaker.health += recovery`
(cap 100). A bar at 0 does not end the debate; all three rounds always run.

The judge prompt defines damage by four criteria — argument strength,
responsiveness to the opponent, use of evidence, clarity — and tells the judge to
score the argument made, not which theory it finds more plausible, and to disregard
disfluency in transcribed speech. Low temperature; a fresh context per call holding
only the two theory names, the transcript so far, and the turn to score.

### Off the voice path

`TurnScorer` listens to the context aggregators' `on_user_turn_stopped` and
`on_assistant_turn_stopped` events. A turn with non-empty text, finished while the
flow's current node is a debate round, is submitted for scoring. Submissions run as
a chain of background asyncio tasks — each awaits the one before — so scores apply
in turn order and never delay the bot's reply. Bars move a second or two after a
turn ends.

A failed or unparseable scoring call is retried once, then skipped: that turn moves
no bars, and the miss is logged.

### Verdict

`judge_debate` first awaits `TurnScorer.drain()` so the user's closing is scored,
then reads the winner from `DebateState`: higher health wins; within 5 points is a
draw. It then calls `judge.write_rationale()` — a second, short LLM call given the
final health and the list of hits — for two spoken sentences. If that call fails,
the rationale falls back to a sentence built from the single largest hit. The
verdict therefore never depends on a second opinion that could contradict the bars.

Because there is a silence while the last turn is scored, `judge_debate` first
queues a `TTSSpeakFrame` — "Thank you. The judge is tallying the scores." — kept
out of the LLM context.

### State contract

The server sends the full snapshot to the client as an RTVI server message
(`worker.rtvi.send_server_message`) on every change. The client renders the latest
one; there are no diffs to apply.

```json
{
  "type": "debate_state",
  "stage": "setup",
  "user": {"theory_id": null, "theory_name": null, "health": 100},
  "bot":  {"theory_id": null, "theory_name": null, "health": 100},
  "last_hit": null,
  "verdict": null
}
```

- `stage`: `setup` | `opening` | `rebuttal` | `closing` | `verdict`.
- `last_hit`: `{"by": "user" | "bot", "damage": int, "recovery": int, "reason": str}`
  — the most recent scored turn, or `null`.
- `verdict`: `{"winner": "user" | "bot" | "draw", "rationale": str}` or `null`.
- Messages whose `type` is not `debate_state` are ignored by the debate UI.

`docs/design/debate-state-fixtures.json` holds an ordered list of example snapshots
covering a whole debate. It is the contract: a server test asserts `snapshot()`
produces exactly these keys, and the client's mock replays the same file.

## Client UI

A debate view in `client/src/debate/`, mounted above the scaffold console's
conversation panel: both theory names, two health bars that animate between
snapshots, the current stage, a caption that flashes `last_hit.reason` with the
damage number, and a verdict card. Visual design is the UI session's call; the
contract above is its only dependency. A `?mock` query parameter replays the
fixtures on a timer so the UI is built and demoed with no server.

## Testing

1. **pytest** — `knowledge.py` (schema violations rejected, alias lookup, unknown
   id); `debate_state.py` (hit arithmetic, floor and cap, winner and draw margin,
   snapshot keys match the fixtures, change callback fires); `judge.py` (parses
   good output, rejects malformed, retry then failure; LLM call injected);
   `scorer.py` (order preserved, non-debate stages and empty turns ignored, a
   failed score is skipped, `drain` waits); `handlers.py` with a stub flow manager.
2. **Smoke boot** — `uv run bot.py -t eval`. Constructing `Flow(config, handlers=…)`
   checks every tool and handler the YAML names and reports all misses at once.
3. **Scripted text evals** — greeting asks for the user's view; a stated physicalist
   view produces a `set_positions` call and a reply naming the bot's position; asked
   for a source, the reply names a citation on the card; rounds advance in order;
   the verdict reply names a winner.
4. **Simulated text eval** — persona: a stubborn workspace theorist with prepared
   arguments. `success:` the debate reached a verdict and `judge_debate` was called.
   Metrics: `words` ≤ 90 per reply; judged — "the reply rebuts or concedes a
   specific point the user made; a reply that merely agrees fails".
5. **Eval judge and simulator** — the harness default, local Ollama `gemma4:12b`.
   It keeps eval traffic off General Compute, which the bot and the live judge are
   using during a run. The live judge stays on General Compute: measured 1.45 s per
   turn there, against 5–9 s (15 s cold) for `gemma4:12b` on this machine.
6. **UI** — `npm run build` and `npm run lint` clean; the `?mock` replay shows bars
   moving, the hit caption, and the verdict card.
7. **End to end** — one live browser debate: bars move during the debate and the
   spoken verdict matches the final bars.

## Build order and parallel work

The card schema and the state contract are the two interfaces everything else
depends on, so they land first, in one short foundation step. After that, three
streams run at once with disjoint file ownership:

| Stream | Who | Owns |
|---|---|---|
| Server | Session 1 | `server/*.py` except `knowledge.py`, `server/flow.yaml`, `server/evals/`, `server/tests/` except the two knowledge tests, `server/Dockerfile` |
| UI | Session 2 | `client/` |
| Cards | background agent dispatched by Session 1 | `server/cards/theories.yaml`, `server/tests/test_cards_complete.py` |

The server stream develops against two seed cards (`gwt`, `iit`). The streams meet
at the end-to-end check.

## Risks

- **Stage timing** — the LLM may advance a round early (mid-thought pause) or late.
  Mitigation: one user turn per round, stated plainly in each node; a scripted eval
  covers round order.
- **Judge bias** toward the bot's polished phrasing over a rambling spoken user.
  Mitigation: the prompt scores substance and disregards disfluency. If play-testing
  shows the bot always wins, scale the bot's damage down in `DebateState` — one
  constant.
- **Scoring latency** — a slow judge call delays bar movement, not speech. The
  verdict waits for it, covered by the spoken tallying line.
- **Card accuracy** — mitigated by verify-or-omit on citations.

## TODOs

- Socratic sparring mode; theory-explorer mode (the original 4 → 3 → 1 progression).
- Cross-examination round.
- Distinct voice for the judge.
- Bot vs. bot with the user moderating.
- RAG over PhilPapers / ConTraSt for long-tail theories.
- README lists Deepgram / OpenAI / Cartesia; `bot.py` uses Gradium + General Compute.
