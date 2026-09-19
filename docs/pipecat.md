# Pipecat Reference (build context)

Condensed from the official docs (fetched 2026-09-19) for use throughout the armchair-debater build.
Source of truth is always the live docs; every page is available as raw markdown by appending `.md`:

- Index of all pages: https://docs.pipecat.ai/llms.txt
- Full docs in one file: https://docs.pipecat.ai/llms-full.txt
- Examples: https://github.com/pipecat-ai/pipecat-examples

> Pipecat is ~1.0 and APIs have moved recently. Prefer the patterns below over older blog posts / training data:
> `PipelineWorker` + `WorkerRunner` (not `PipelineTask` / `PipelineRunner`, now deprecated aliases),
> `settings=Service.Settings(...)` (not `model=` / `params=InputParams`, deprecated since v0.0.105),
> `system_instruction` in LLM settings (not a system message in the context).

---

## Project setup (CLI)

Install (Python 3.11+):

```bash
uv tool install "pipecat-ai[cli]"            # gives `pipecat` (alias `pc`): init, eval, context-hub
uv tool install "pipecat-ai[cli]" --with pipecatcloud   # add `pipecat cloud` deploy commands
```

`pipecat init [TARGET_DIR]` scaffolds **in place** inside `TARGET_DIR` and produces:

```
TARGET_DIR/
├── AGENTS.md / CLAUDE.md   # coding-agent guide (CLAUDE.md just @-imports AGENTS.md)
├── server/                 # Python bot: bot.py, pyproject.toml, .env.example, evals/, Dockerfile, pcc-deploy.toml
├── client/                 # optional web client (react+vite / react+nextjs / vanilla)
├── .gitignore
└── README.md
```

- `pipecat init .` → scaffold into the current dir (our repo root). `pipecat init foo` → `./foo/server`, `./foo/client`.
- Existing `AGENTS.md` / `CLAUDE.md` / `GETTING_STARTED.md` are never overwritten (use `--overwrite-guide`).
- Non-interactive: pass flags, e.g.
  ```bash
  pipecat init . --transport smallwebrtc --mode cascade \
    --stt deepgram_stt --llm openai_llm --tts cartesia_tts \
    --client-framework react --client-server vite --eval
  ```
- `pipecat init --list-options` prints valid transports/services as JSON; `--dry-run` prints the resolved config without writing.
- Key flags: `--transport` (`daily`, `smallwebrtc`, telephony ones), `--mode cascade|realtime`, `--stt`, `--llm`, `--tts`,
  `--client-framework react|vanilla|none`, `--client-server vite|nextjs`, `--eval`, `--no-deploy-to-cloud`.
- **Context Hub**: `pipecat context-hub refresh` builds a local index (~900 MB, 3+ min) of docs/examples/API source
  and registers it as an MCP server for Claude Code. Build it *before* starting a coding session.

---

## Core concepts

| Concept | What it is |
|---|---|
| **Frame** | Data packet flowing through the app: audio, transcription text, LLM text, images, control/system signals. |
| **FrameProcessor** | A building block that receives frames, does one job (STT, LLM, TTS, …), pushes new frames on, and passes through frames it doesn't handle. |
| **Pipeline** | Ordered list of processors; frames flow downstream (mostly) or upstream. |
| **Worker / Agent** | A worker runs a pipeline. A standalone bot = one `PipelineWorker`. Multiple workers can coordinate over a shared bus. |
| **WorkerRunner** | Entry point: creates the bus, starts workers, manages lifecycle and shutdown. |
| **Transport** | Moves media between user and bot; provides `transport.input()` / `transport.output()`. |

Voice flow (all streaming, in parallel — early sentences get spoken while the LLM is still generating; typical 500–800 ms round trip):

```
audio in → STT → user context aggregator → LLM → TTS → audio out → assistant context aggregator
```

### Frame types
- **SystemFrames** — high-priority queue, not discarded by interruptions (interruptions, user input, `CancelFrame`).
- **DataFrames / ControlFrames** — queued in order (audio output, text, images, `EndFrame`).
- Order is guaranteed within each lane. Custom processors must implement `process_frame()` and call `push_frame()` to pass frames along (forgetting to push is a common bug).

### Worker types
`BaseWorker` → `PipelineWorker` (runs a pipeline) → `LLMWorker` (own LLM + `@tool` registration) → `LLMContextWorker` (built-in context) → `UIWorker` (drives a client GUI over RTVI).

---

## Canonical single-agent bot

```python
import os

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams

transport_params = {
    "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
}


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)

    stt = DeepgramSTTService(api_key=os.environ["DEEPGRAM_API_KEY"])
    llm = OpenAILLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        settings=OpenAILLMService.Settings(
            system_instruction="You are a helpful voice assistant. Keep responses brief.",
        ),
    )
    tts = CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        settings=CartesiaTTSService.Settings(voice="86e30c1d-714b-4074-a1f2-1cb6b552fb49"),
    )

    context = LLMContext()
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline([
        transport.input(),
        stt,
        aggregators.user(),
        llm,
        tts,
        transport.output(),
        aggregators.assistant(),   # after output: records what was actually spoken
    ])

    agent = PipelineWorker(
        pipeline,
        name="assistant",
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
    )

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await runner.cancel()

    await runner.add_workers(agent)
    await runner.run()


async def bot(runner_args: RunnerArguments):
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main
    main()
```

`runner.run()` blocks until the agent ends (`EndFrame`), a signal arrives, `runner.cancel()` is called, or an unhandled error occurs.

---

## LLM service & OpenAI-compatible providers (General Compute)

`OpenAILLMService` accepts any OpenAI-compatible endpoint via `base_url`:

```python
from pipecat.services.openai.llm import OpenAILLMService

llm = OpenAILLMService(
    api_key=os.environ["PROVIDER_API_KEY"],
    base_url=os.environ["PROVIDER_BASE_URL"],   # e.g. https://<provider>/v1
    settings=OpenAILLMService.Settings(
        model="<provider-model-id>",
        system_instruction="...",
        temperature=0.7,
        max_completion_tokens=300,
    ),
)
```

- Constructor args: `api_key`, `base_url`, `default_headers`, `settings`, `retry_on_timeout`, `retry_timeout_secs`.
- Settings: `model` (default `gpt-4.1`), `system_instruction`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `top_k`, `frequency_penalty`, `presence_penalty`, `seed`. Unset values are omitted from the request.
- Change settings mid-conversation:
  ```python
  from pipecat.frames.frames import LLMUpdateSettingsFrame
  from pipecat.services.openai.base_llm import OpenAILLMSettings
  await worker.queue_frame(LLMUpdateSettingsFrame(delta=OpenAILLMSettings(temperature=0.3)))
  ```
- If both `system_instruction` and a system message in the context are set, `system_instruction` wins (warning logged).
- Events: `on_completion_timeout`, `on_function_calls_started`.
- General Compute has no dedicated Pipecat service → `OpenAILLMService` with `base_url="https://api.generalcompute.com/v1"`
  and `GENERAL_COMPUTE_API_KEY`. Models on our account (2026-09-19): `deepseek-v3.1`, `deepseek-v3.2` (default, ~1.2s),
  `gemma-4-31B-it`, `gpt-oss-120b` (~4s, reasoning), `minimax-m2.7`. Streaming/tool-calling support not yet verified.
- **Gradium** (https://gradium.ai) is speech, not an LLM: Pipecat has `GradiumSTTService` and `GradiumTTSService`
  (`pipecat.services.gradium.{stt,tts}`, extra `pipecat-ai[gradium]`, env `GRADIUM_API_KEY`, WebSocket API,
  TTS outputs fixed 48 kHz). Docs: /api-reference/server/services/stt/gradium.md and /tts/gradium.md.

---

## Context management

- `LLMContext` holds `messages`, `tools`, `tool_choice` in OpenAI format; adapters translate for other providers.
- `LLMContextAggregatorPair(context)` → `.user()` goes after STT, `.assistant()` goes after `transport.output()`.
- Bot persona → `system_instruction` (survives context replacement/summarization, can differ per LLM when sharing one context).
  Task-specific rules → `developer` role messages in the context.
- Manual control (queue on the worker):
  - `LLMMessagesAppendFrame([msg], run_llm=True|False)` — append (optionally trigger a response)
  - `LLMMessagesUpdateFrame(messages)` — replace the whole context
  - `LLMMessagesTransformFrame(fn)` — edit in place
  - `run_llm` defaults to silent (no response).
- Long sessions: see Context Summarization (`/pipecat/fundamentals/context-summarization`).

## Function calling

Preferred: a **direct function** — one async function is both schema and handler (derived from signature + Google-style docstring):

```python
from pipecat.services.llm_service import FunctionCallParams

async def get_current_weather(params: FunctionCallParams, location: str, format: str):
    """Get the current weather.

    Args:
        location: The city and state, e.g. "San Francisco, CA".
        format: Must be either "celsius" or "fahrenheit".
    """
    await params.result_callback({"conditions": "sunny", "temperature": "75"})

context = LLMContext(tools=[get_current_weather])
```

- `Literal` types are not mapped to JSON-schema `enum`; describe constraints in the docstring, or use `FunctionSchema` for strict enums.
- `@tool_options(cancel_on_interruption=..., timeout_secs=..., cancellable_by_llm=...)` per tool. `cancel_on_interruption=False` makes the call async (conversation isn't held).
- Swap tools mid-conversation with `LLMSetToolsFrame`. Results are stored in context automatically.
- Share resources with handlers via `app_resources` on the worker.

---

## Speech input & turn detection

- Silero VAD runs locally (150–200 ms faster than remote VAD). Default: Smart Turn detection + VAD with `stop_secs=0.2`.
- VAD detects speech; turn detection decides when the user is *done* talking. Interruptions stop in-flight LLM/TTS output.
- Related fundamentals: Interruptions, User Input Muting, Detecting Idle Users, STT Latency Tuning.

## Transports

- **SmallWebRTC** — P2P WebRTC, no cloud infra; good for local dev. **Daily** — hosted WebRTC for production.
- **WebSocket / FastAPI WebSocket** — server-to-server & telephony (TCP; less resilient to jitter).
- WebRTC recommended for client apps (echo cancellation, noise reduction, reconnection, timestamps).
- Transports are swappable without changing bot logic; `create_transport(runner_args, transport_params)` picks one at runtime.

## Termination

| Frame | Effect | How |
|---|---|---|
| `EndFrame` | Graceful: drains pending frames | `worker.queue_frame(EndFrame())` from outside |
| `CancelFrame` | Immediate: discards pending | `worker.cancel()` |
| `EndWorkerFrame` / `CancelWorkerFrame` | Same, from inside the pipeline | `push_frame(..., FrameDirection.DOWNSTREAM)` |

Idle detection and max call duration provide automatic safety-net shutdown.

---

## Client side (TypeScript frontend)

- Client SDKs: JavaScript, React, React Native, iOS, Android, C++. They speak the **RTVI** protocol to the bot.
- `pipecat init --client-framework react --client-server vite|nextjs` generates a client using **Pipecat UI**
  (shadcn registry `@pipecat`, e.g. `npx shadcn@latest add @pipecat/conversation`).
- `UIWorker` lets the bot read/drive the client GUI over RTVI; custom messages flow both ways (Client → Guides → Custom Messaging).

---

## Relevant docs for this project (debate agent)

| Topic | Raw markdown URL |
|---|---|
| Learn path start | https://docs.pipecat.ai/pipecat/learn/overview.md |
| Multiple LLM agents (e.g. debater vs. moderator) | https://docs.pipecat.ai/pipecat/learn/multiple-llm-agents.md |
| Agent handoff | https://docs.pipecat.ai/pipecat/learn/agent-handoff.md |
| Controlling the UI | https://docs.pipecat.ai/pipecat/learn/ui-worker.md |
| Pipecat Flows (structured conversation stages) | https://docs.pipecat.ai/pipecat/flows/introduction.md |
| Interruptions | https://docs.pipecat.ai/pipecat/fundamentals/interruptions.md |
| Context summarization | https://docs.pipecat.ai/pipecat/fundamentals/context-summarization.md |
| Saving transcripts | https://docs.pipecat.ai/pipecat/fundamentals/saving-transcripts.md |
| Evals quickstart | https://docs.pipecat.ai/pipecat/evals/quickstart.md |
| OpenAI LLM service | https://docs.pipecat.ai/api-reference/server/services/llm/openai.md |
| `pipecat init` reference | https://docs.pipecat.ai/api-reference/cli/init.md |
| Client quickstart | https://docs.pipecat.ai/client/get-started/quickstart.md |
| RTVI standard | https://docs.pipecat.ai/client/rtvi-standard.md |
| Running bots locally | https://docs.pipecat.ai/pipecat/deployment/running-bots-locally.md |
