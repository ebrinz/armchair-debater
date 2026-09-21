<p align="center">
  <img src="docs/banner.png" alt="Armchair Debater — Arcade Edition: the game's pixel-art logo over a firelit study lined with bookshelves" width="100%">
</p>

# Armchair Debater

**A voice bot that argues with you about consciousness — and keeps score.**

Tell it what you think consciousness is, in your own words. It works out which
theory you're closest to, picks a rival theory, and debates you out loud through
four rounds — opening, rebuttal, cross-examination, closing. An independent judge scores every turn
as it lands, moving two fighting-game health bars. Whoever has more health after
the closings wins, and the bot reads you the judge's verdict.

Every paper the bot cites comes from a curated, fact-checked knowledge base — never
from the LLM's memory.

There are two other things to do in the study, chosen at the door by voice or on
an arcade MODE SELECT:

- **Sparring** — the bot takes no side. As *the examiner* it puts five escalating
  questions to your own view, drawn from the known objections to your theory, and
  the judge scores each answer against a single bar: how much of the position is
  still standing. It ends with a finding — *your view holds*, *shaken*, or *in
  tatters* — and the question that cost you most.
- **Explore** — a guide shows you round the twelve theories. Ask what one says,
  what is wrong with it, or how two differ; the screen turns to whichever card is
  being discussed.

Built on [Pipecat](https://github.com/pipecat-ai/pipecat) (1.11) with Pipecat Flows.

## How a debate works

| Stage | What happens |
|---|---|
| **Setup** | The bot asks what you think consciousness is. It matches your answer to one of twelve theory cards and chooses an opponent from that card's rivals. (Or click a card — typed input works too.) |
| **Opening, Rebuttal, Closing** (rounds 1, 2, 4) | One turn each per round. The bot argues only from its card, uses a different argument each round, keeps turns under ~70 words, concedes good points, and never folds. It may quote *your* theory's papers against you, but never a paper that is on neither card. |
| **Cross-examination** (round 3) | You put one question to the house and it has to answer it straight; then it puts one to you, aimed at the weakest thing you have said or a known objection to your theory. The questions are not scored. Both answers are, so a dodge earns nothing. |
| **Judging, live** | After each turn a separate LLM call — a fresh context with no memory of having argued a side — scores that turn: damage to the opponent, and how well it recovered from the last hit. Scoring runs off the voice path, so it never delays speech; bars move about a second after a turn ends. |
| **Verdict** | Bars decide it: higher health wins, within 5 is a draw. The judge writes a two-sentence rationale, which the bot reads out, then offers a rematch. Set `GRADIUM_JUDGE_VOICE_ID` and the judge reads it in a voice of their own. |

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
  flow.yaml         Pipecat Flows graph: a front door, then the debate (setup → opening → rebuttal →
                    cross-examination → closing → verdict), sparring, or the explorer
  handlers.py       Flow tools: choose_mode, set_positions, answer_given, judge_debate, take_position,
                    answer_heard, show_theory; emit_stage / emit_question / use_voice actions
  knowledge.py      Loads + validates the cards; client_cards() for the UI
  turns.py          TurnObserver — reads both sides' turns from pipeline frames
  scorer.py         Ordered background scoring; never blocks the voice path
  judge.py          The judge's LLM calls: score a turn or an answer; write the rationale or the finding
  debate_state.py   Mode, health, hits, verdict; emits a full snapshot on every change
  providers.py      LLM_PROVIDER / SPEECH_PROVIDER switches; the optional judge's voice
  quiet_llm.py      Drops whitespace-only LLM replies (they confuse anything counting turns)
  skip_tts_sync.py  Keeps text-mode evals from synthesizing speech nobody hears
  make_fixtures.py  Generates the JSON contract fixtures from DebateState
  cards/            The twelve theory cards
  evals/            Scripted + simulated behavioural evals (pipecat eval)
  tests/            Unit tests
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
cp .env.example .env     # GRADIUM_API_KEY, GENERAL_COMPUTE_API_KEY (+ optional voice/model, or OpenAI: see Swapping providers)
uv run bot.py            # serves SmallWebRTC on http://localhost:7860
```

### Client

```bash
cd client
npm install
npm run dev              # http://localhost:5173
```

- `http://localhost:5173/` — the arcade UI. **PRESS START** connects and asks for the mic.
- `http://localhost:5173/?mock` — replays a recorded debate through the UI with no server
  (`?mock=sparring` and `?mock=explore` replay the other two modes).
- `http://localhost:5173/?console` — the Pipecat debugging console.

### Arcade UI

Seven screens, chosen from the server's state: **TITLE** (PRESS START
connects and unlocks the mic), **MODE SELECT** (debate, sparring, or explore),
**SELECT** (a twelve-card roster of the theories,
trading-card style), **VERSUS** (your theory against the one the house picked),
**FIGHT** (two health bars draining toward the centre, with
hit-by-hit battle text — in sparring, one bar facing THE EXAMINER and a plate
counting the questions), **DECISION** (the judge's verdict, or the examiner's
finding, with a rematch and the way back to the menu), and **EXPLORE** (the deck,
turning to whichever card the guide is talking about). On SELECT you can just say what you think consciousness is, or pick
your theory and then the rival the house must defend (or leave that to the house).
**THE DECK**, on the title screen, browses all twelve cards with no connection. `?mock` replays a recorded debate
through the UI with no server; `?console` swaps in the Pipecat debugging console
(both above). `prefers-reduced-motion` drops every shake, flash, and slam to an
instant number and bar change. Two toggles in the bottom corner, both remembered
in `localStorage`: CRT for the light scanline overlay, and SFX for the fifteen
synthesized 8-bit sound cues (Web Audio, no audio files; kept quiet because the mic
is open).

All art is original pixel art, drawn in code as CSS and inline SVG — no
third-party game assets, names, logos, or sounds. It's an homage, not a copy. The
two fonts are bundled from `@fontsource` and both SIL Open Font License 1.1:
Press Start 2P (Copyright 2012 The Press Start 2P Project Authors) for the arcade
lettering, and VT323 (Copyright 2011 The VT323 Project Authors) for everything
meant to be read. Full spec:
[`docs/design/2026-09-19-debate-ui-design.md`](docs/design/2026-09-19-debate-ui-design.md).

### Tests and evals

```bash
cd server
uv run pytest -q                                   # unit tests
ollama pull gemma4:12b                              # local judge + simulated caller for evals
uv run pipecat eval suite evals/suite.yaml          # scripted + simulated debates, headless
```

```bash
cd client
npm test && npm run lint && npm run build
```

**What costs credits.** `?mock` costs nothing: it replays a fixture in the browser
and never connects. The text-mode evals call the LLM but not the speech services —
the harness asks the bot to skip speech, and `server/skip_tts_sync.py` makes that
stick (a Pipecat quirk otherwise switches speech back on after every tool call; one
scripted suite run went from 1,585 synthesized characters to 44). A live session
streams the mic to speech-to-text for as long as the tab is connected, so close it
when you are done. For a spoken smoke test that spares the Gradium allowance, run
the bot with `SPEECH_PROVIDER=openai`.

The evals drive the real bot end to end: a scripted full debate (rounds advance one
turn each, the right tools fire with the right arguments, no markdown reaches
speech, no unrequested rematch, citations stay on the cards), a non-workspace view
mapping onto the wider roster, and a simulated stubborn opponent played by a local
model.

## Status

**Working end to end:** the spoken (or typed) debate over all twelve theories, live
per-turn judging, the balance rules, the verdict and rematch, the evals, and the
server → client state contract.

**UI:** the full arcade treatment is in — the "study at night" stage and pixel theme;
a title screen; the trading-card theory select with move names, pick-or-speak; a
versus splash that reveals the house's theory; the fight, with wingback-armchair
fighters with faces, tiered hit effects and battle text; and the judge's decision
with its count-up, banners and CONTINUE? countdown. Specified in
[`docs/design/2026-09-19-debate-ui-design.md`](docs/design/2026-09-19-debate-ui-design.md).
It is an homage: all art is original CSS/SVG and the fonts are open-licensed
(Press Start 2P, VT323). Phone layouts are not done.

**Parked for later:** bot-vs-bot with you moderating, and retrieval over PhilPapers
for long-tail theories.

## Swapping providers

Nothing in the debate logic is tied to a provider. Speech runs on Gradium and the
LLM on General Compute by default, and two environment variables switch either
half to OpenAI:

```bash
# server/.env — both default to the first value, and they can be mixed
LLM_PROVIDER=general_compute | openai     # the debater, the judge, and the warm-up
SPEECH_PROVIDER=gradium | openai          # speech-to-text and text-to-speech
OPENAI_API_KEY=...                        # needed once either one says openai
OPENAI_MODEL=gpt-4.1                      # optional; also OPENAI_STT_MODEL, OPENAI_TTS_MODEL, OPENAI_TTS_VOICE
```

`server/providers.py` is the only file that knows provider names. The LLM leg was
always Pipecat's `OpenAILLMService` — General Compute is an OpenAI-compatible
endpoint — so switching it changes a URL, a key, and a model. For speech it builds
`OpenAIRealtimeSTTService` (streaming, with the pipeline's own VAD deciding when
you have stopped talking) and `OpenAITTSService`. A missing key is an error rather
than `None`: handed no key, the OpenAI client falls back to `OPENAI_API_KEY`, which
would send it to whichever endpoint was configured.

Things to know before relying on a different provider:

- **Re-tune, then trust.** The prompts in `server/flow.yaml` (70-word turns, no
  markdown, never assign a view the user did not give) and the judge's JSON reply
  were tuned against `deepseek-v3.2`. Another model will drift. Run the evals under
  the switch — `LLM_PROVIDER=openai uv run pipecat eval suite evals/suite.yaml` —
  and fix prompts from the failing assertions.
- **The evals are text-mode**, judged by a local Ollama model, so they exercise the
  LLM switch but not the speech one. `evals/starter_audio.yaml` and a spoken debate
  in the browser cover speech.
- **Pipecat Cloud** reads none of your local `.env`: add the new variables to the
  secret set.

### Adding another provider (notes for a coding agent)

Add a branch to `llm_config()` for any OpenAI-compatible endpoint, or to
`make_stt()` / `make_tts()` for any service Pipecat ships (`pipecat init
--list-options` lists them), and its name to `LLM_PROVIDERS` / `SPEECH_PROVIDERS`.
Leave `bot.py`'s pipeline alone — the order, the `TurnObserver`, the scorer, and
the Flows wiring are provider-agnostic. Verify class names, import paths, and
`Settings` fields against the installed Pipecat rather than from memory
(`pipecat context-hub search-api "<Service>"`, or read
`.venv/.../pipecat/services/`): model and voice go in
`settings=Service.Settings(...)`, and the bare `model=` / `voice=` arguments are
deprecated. Ask the user for model names and voice IDs; do not guess them. The
judge and warm-up call the endpoint with the plain `openai` client, so a provider
whose chat API names its limits differently needs a line in `LLMConfig.limits()`.
Add the extra to `server/pyproject.toml`, the file to the `Dockerfile`'s `COPY`
line if you create one, and tests beside `tests/test_providers.py`.

## Deploying to Pipecat Cloud

This project is configured for deployment to Pipecat Cloud. You can learn how to deploy to Pipecat Cloud in the [Pipecat Quickstart Guide](https://docs.pipecat.ai/getting-started/quickstart#step-2-deploy-to-production).

Refer to the [Pipecat Cloud Documentation](https://docs.pipecat.ai/deployment/pipecat-cloud/introduction) to learn more about configuring, deploying, and managing your agents in Pipecat Cloud.

A deployed bot sees none of your local `.env`, so its keys go up as a secret set.
One trap: `server/.env.example` refers to your shell's variables as `${GRADIUM_API_KEY}`,
which `python-dotenv` expands locally but `pipecat cloud secrets set --file` uploads
literally — the bot would boot and then fail every service call. Expand first:

```bash
cd server
uv run python -c "from dotenv import dotenv_values; print('\n'.join(f'{k}={v}' for k, v in dotenv_values('.env').items() if v))" > .env.deploy
pipecat cloud secrets set <secret_set from pcc-deploy.toml> --file .env.deploy --skip
rm .env.deploy            # holds real keys; .env.* is git-ignored
pipecat cloud deploy --yes
```

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