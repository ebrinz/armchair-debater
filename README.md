<p align="center">
  <img src="docs/banner.png" alt="Armchair Debater — Arcade Edition: the game's pixel-art logo over a firelit study lined with bookshelves" width="100%">
</p>

# Armchair Debater

**A voice bot that argues with you about consciousness — and keeps score.**

Tell it what you think consciousness is, in your own words. It works out which
theory you're closest to, picks a rival theory, and debates you out loud through
three rounds — opening, rebuttal, closing. An independent judge scores every turn
as it lands, moving two fighting-game health bars. Whoever has more health after
the closings wins, and the bot reads you the judge's verdict.

Every paper the bot cites comes from a curated, fact-checked knowledge base — never
from the LLM's memory.

Built on [Pipecat](https://github.com/pipecat-ai/pipecat) (1.11) with Pipecat Flows.

## How a debate works

| Stage | What happens |
|---|---|
| **Setup** | The bot asks what you think consciousness is. It matches your answer to one of twelve theory cards and chooses an opponent from that card's rivals. (Or click a card — typed input works too.) |
| **Opening → Rebuttal → Closing** | One turn each per round. The bot argues only from its card, uses a different argument each round, keeps turns under ~70 words, concedes good points, and never folds. It may quote *your* theory's papers against you, but never a paper that is on neither card. |
| **Judging, live** | After each turn a separate LLM call — a fresh context with no memory of having argued a side — scores that turn: damage to the opponent, and how well it recovered from the last hit. Scoring runs off the voice path, so it never delays speech; bars move about a second after a turn ends. |
| **Verdict** | Bars decide it: higher health wins, within 5 is a draw. The judge writes a two-sentence rationale, which the bot reads out, then offers a rematch. |

**Balance:** damage is doubled, and a rebuttal can heal at most half of the last
hit you took — so a good comeback blunts a hit but never erases it, close debates
end with both bars low, and one-sided ones can end in a knockout.

## The knowledge base

Twelve theory cards in [`server/cards/theories.yaml`](server/cards/theories.yaml),
organised by the taxonomy in Robert Lawrence Kuhn's *A Landscape of Consciousness*
(2024): Global Workspace, Integrated Information, Higher-Order Thought, Recurrent
Processing, Predictive Processing, Attention Schema, Illusionism, Biological
Naturalism, Orch OR, Panpsychism, Property Dualism, Analytic Idealism.

Each card has a claim, three arguments (each with a fighting-game "move name"),
three objections its real critics press, its rivals, and 2–4 citations. **Every
citation was checked against a primary source (Crossref / publisher) by an agent
other than the one that wrote it** — that second check caught two errors the
first pass had marked "confirmed". A card that breaks the schema stops the bot at
boot, not mid-debate.

## Architecture

```
server/
  bot.py            Pipecat cascade pipeline: Gradium STT → General Compute LLM → Gradium TTS
  flow.yaml         Pipecat Flows graph: setup → opening → rebuttal → closing → verdict
  handlers.py       Flow tools: set_positions, judge_debate; emit_stage action
  knowledge.py      Loads + validates the cards; client_cards() for the UI
  turns.py          TurnObserver — reads both sides' turns from pipeline frames
  scorer.py         Ordered background scoring; never blocks the voice path
  judge.py          The judge's two LLM calls (score a turn; write the rationale)
  debate_state.py   Health, hits, verdict; emits a full snapshot on every change
  cards/            The twelve theory cards
  evals/            Scripted + simulated behavioural evals (pipecat eval)
  tests/            100 unit tests
client/
  src/arcade/       The arcade UI: state → screen logic, stage, theme, screens
docs/design/        Specs, plans, and the JSON contract fixtures
```

Two things worth knowing about how it was built:

- **Turns are read from pipeline frames, not aggregator events.** Pipecat's
  user-turn events only fire on the speech path (typed input skips them), and the
  assistant-turn event races with interruptions and drops turns at random. A small
  frame observer (`turns.py`) sees every turn from either side, spoken or typed.
- **The UI is a pure function of server state.** The server pushes full
  `debate_state` snapshots (and the cards, once) as RTVI server messages; the
  client picks its screen with `screenFor(connected, snapshot)` and keeps no state
  that could drift.

## Run it

### Server

```bash
cd server
uv sync
cp .env.example .env     # GRADIUM_API_KEY, GENERAL_COMPUTE_API_KEY (+ optional voice/model)
uv run bot.py            # serves SmallWebRTC on http://localhost:7860
```

### Client

```bash
cd client
npm install
npm run dev              # http://localhost:5173
```

- `http://localhost:5173/` — the arcade UI. **PRESS START** connects and asks for the mic.
- `http://localhost:5173/?mock` — replays a recorded debate through the UI with no server.
- `http://localhost:5173/?console` — the Pipecat debugging console.

### Tests and evals

```bash
cd server
uv run pytest -q                                   # 100 unit tests
ollama pull gemma4:12b                              # local judge + simulated caller for evals
uv run pipecat eval suite evals/suite.yaml          # scripted + simulated debates, headless
```

```bash
cd client
npm test && npm run lint && npm run build
```

The evals drive the real bot end to end: a scripted full debate (rounds advance one
turn each, the right tools fire with the right arguments, no markdown reaches
speech, no unrequested rematch, citations stay on the cards), a non-workspace view
mapping onto the wider roster, and a simulated stubborn opponent played by a local
model.

## Status

**Working end to end:** the spoken (or typed) debate over all twelve theories, live
per-turn judging, the balance rules, the verdict and rematch, the evals, and the
server → client state contract.

**UI:** the shell, the "study at night" stage, the pixel theme, and the title screen
are done, and the select / fight / decision screens render live debate data on the
stage. The full arcade treatment — wingback-armchair fighters with faces, tiered hit
effects, the trading-card theory select with move names, judge's-decision
flourishes — is specified in
[`docs/design/2026-09-19-debate-ui-design.md`](docs/design/2026-09-19-debate-ui-design.md)
and in progress. It is an homage: all art is original CSS/SVG and the fonts are
open-licensed (Press Start 2P, VT323).

**Parked for later:** a Socratic sparring mode, a theory-explorer mode, a
cross-examination round, a distinct judge voice, bot-vs-bot, and retrieval over
PhilPapers for long-tail theories.

## Swapping providers (for example, an all-OpenAI pipeline)

Nothing in the debate logic is tied to a provider. Speech runs on Gradium and the
LLM on General Compute, but the LLM leg already goes through Pipecat's
`OpenAILLMService` — General Compute is simply an OpenAI-compatible endpoint — and
the `openai` extra is already installed. Moving to OpenAI is a change to three
service constructors and three lines of plain client code:

| Piece | Where | Today | For OpenAI |
|---|---|---|---|
| Debater LLM | `server/bot.py` | `OpenAILLMService(base_url="https://api.generalcompute.com/v1", …)` | drop `base_url`; `OPENAI_API_KEY`; a current chat model |
| Judge | `server/judge.py` (`BASE_URL`, `AsyncOpenAI(...)`) | same endpoint, same model | drop `base_url`, same key and model change |
| Warm-up | `server/warmup.py` | imports `BASE_URL` from `judge.py` | follows the judge |
| Speech-to-text | `server/bot.py` | `GradiumSTTService` | `OpenAISTTService` from `pipecat.services.openai.stt` |
| Text-to-speech | `server/bot.py` | `GradiumTTSService` | `OpenAITTSService` from `pipecat.services.openai.tts` |

Notes for whoever (or whichever agent) makes the change:

- **Verify, don't recall.** Confirm class names, import paths, and `Settings` fields
  against the installed Pipecat (`pipecat context-hub search-api "OpenAITTSService"`,
  or read `.venv/.../pipecat/services/openai/`). Model and voice go in
  `settings=Service.Settings(...)`; the bare `model=` / `voice=` keyword arguments
  are deprecated. Ask the user for model names and voices rather than guessing.
- **Leave the pipeline alone.** Only the three constructors change. The order
  (`stt → user aggregator → llm → tts → transport.output() → assistant aggregator`),
  the `TurnObserver`, the scorer, and the Flows wiring are provider-agnostic.
- **Speech-to-text latency.** `OpenAISTTService` transcribes a whole utterance after
  the speaker stops, so turns feel slower than Gradium's streaming recognition.
  `OpenAIRealtimeSTTService` in the same module streams; prefer it for a live demo.
- **Text-to-speech sample rate.** OpenAI voices come out at 24 kHz; leave
  `sample_rate` unset and the service says so if the pipeline disagrees.
- **Keys and config.** Rename the variables in `server/.env.example`, in any tests
  that set `GENERAL_COMPUTE_API_KEY`, and in the Pipecat Cloud secret set. If
  Gradium goes entirely, drop `gradium` from the extras in `server/pyproject.toml`
  and `uv sync`.
- **Re-tune, then trust.** The prompts in `server/flow.yaml` (70-word turns, no
  markdown, never assign a view the user did not give) and the judge's JSON reply
  were tuned against `deepseek-v3.2`. A different model will drift. Run
  `uv run pytest`, then the eval suite from "Tests and evals" above, and fix
  prompts from the failing assertions. The evals run in text mode with a local
  Ollama judge, so they exercise the new LLM but not the new speech services —
  finish with one spoken debate in the browser.

The same recipe works for any provider Pipecat ships a service for
(`pipecat init --list-options` lists them).

## Deploying to Pipecat Cloud

This project is configured for deployment to Pipecat Cloud. You can learn how to deploy to Pipecat Cloud in the [Pipecat Quickstart Guide](https://docs.pipecat.ai/getting-started/quickstart#step-2-deploy-to-production).

Refer to the [Pipecat Cloud Documentation](https://docs.pipecat.ai/deployment/pipecat-cloud/introduction) to learn more about configuring, deploying, and managing your agents in Pipecat Cloud.

## Building with an AI coding agent

Extending this bot with Claude Code, Codex, or another AI coding assistant? Give it live, accurate Pipecat context instead of stale training data with the **Pipecat Context Hub** — a local index of Pipecat docs, examples, and API source your agent queries over MCP:

```bash
# The Context Hub ships with the CLI
uv tool install "pipecat-ai[cli]"
pipecat context-hub install
```

`install` registers the MCP server with each coding agent it finds and builds the index — a few minutes and about 900 MB the first time. MCP servers load at session start, so do this before opening your coding session, and note the server won't start against an empty index. See the [Pipecat Context Hub docs](https://docs.pipecat.ai/api-reference/context-hub) for the full setup.

## Learn More

- [Pipecat Documentation](https://docs.pipecat.ai/)
- [Pipecat UI Documentation](https://ui.pipecat.ai)
- [Pipecat GitHub](https://github.com/pipecat-ai/pipecat)
- [Pipecat Examples](https://github.com/pipecat-ai/pipecat-examples)
- [Discord Community](https://discord.gg/pipecat)