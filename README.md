# armchair-debater

A Pipecat AI voice agent built with a cascade pipeline (STT → LLM → TTS).

## Configuration

- **Bot Type**: Web
- **Transport(s)**: SmallWebRTC
- **Pipeline**: Cascade
  - **STT**: Deepgram
  - **LLM**: OpenAI
  - **TTS**: Cartesia

## Setup

### Server

1. **Navigate to server directory**:

   ```bash
   cd server
   ```

2. **Install dependencies**:

   ```bash
   uv sync
   ```

3. **Configure environment variables**:

   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

4. **Run the bot**:

   ```bash
   uv run bot.py
   ```

   The runner serves every transport; the caller selects which one (a web/mobile
   client picks its transport when it connects; a telephony provider connects to
   `/ws`).

## Testing with evals

This project includes behavioral evals: scripted conversations that drive the bot headless — no live call needed. Starter scenarios live in `server/evals/`; edit them as your bot takes shape and copy them to add more.

From `server/`, run the bot with the eval transport, then drive scenarios against it from a second terminal (the bot stays up across runs):

```bash
uv run bot.py -t eval
# In another terminal:
uv run pipecat eval run evals/starter_text.yaml -v    # fast text-mode check
uv run pipecat eval run evals/starter_audio.yaml -v   # full audio round trip (local models, no API keys)
```

`eval:` criteria are scored by a judge LLM — a local Ollama by default (`ollama pull gemma4:12b`). The comments in the scenario files cover the schema and how to use an OpenAI judge instead.

### Client

1. **Navigate to client directory**:

   ```bash
   cd client
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure environment variables**:

   ```bash
   cp env.example .env.local
   # Edit .env.local if needed (defaults to localhost:7860)
   ```

   > **Note:** Environment variables in Vite are bundled into the client and exposed in the browser. For production applications that require secret protection, consider implementing a backend proxy server to handle API requests and manage sensitive credentials securely.

   The client renders the [Pipecat UI](https://ui.pipecat.ai) console: the connect flow, transcript, metrics, device and session info, and a live event stream. Pipecat UI is a shadcn registry, so its components are installed as source under `src/components/pipecat`, `src/hooks` and `src/lib`, and they are yours to edit and style.

   The console is built from those same components. To build your own UI, replace it with a composition of your own; this is the minimal one:

   ```tsx
   import { PipecatClientProvider } from '@pipecat-ai/client-react';

   import { BotAudioOutput } from '@/components/pipecat/bot-audio';
   import { ConnectButton } from '@/components/pipecat/connect-button';
   import { Conversation } from '@/components/pipecat/conversation';
   import { UserAudioControl } from '@/components/pipecat/user-audio-control';
   import {
     DEFAULT_TRANSPORT,
     TRANSPORT_FACTORIES,
     TRANSPORT_PROPS,
   } from '@/config';
   import { usePipecatApp } from '@/hooks/use-pipecat-app';

   export const VoiceApp = () => {
     const { client, connect, disconnect } = usePipecatApp({
       transportType: DEFAULT_TRANSPORT,
       transportFactory: TRANSPORT_FACTORIES[DEFAULT_TRANSPORT],
       ...TRANSPORT_PROPS[DEFAULT_TRANSPORT],
     });
     if (!client) return null;
     return (
       <PipecatClientProvider client={client}>
         <Conversation />
         <UserAudioControl />
         <ConnectButton onConnect={connect} onDisconnect={disconnect} />
         <BotAudioOutput />
       </PipecatClientProvider>
     );
   };
   ```

   To add more components or pull in upstream changes, use the shadcn CLI; the `@pipecat` registry is already configured in `components.json`:

   ```bash
   npx shadcn@latest add @pipecat/audio-visualizer-wave
   npx shadcn@latest add @pipecat/conversation --diff
   ```

4. **Run development server**:

   ```bash
   npm run dev
   ```

5. **Open browser**:

   http://localhost:5173

## Project Structure

```
armchair-debater/
├── server/              # Python bot server
│   ├── bot.py           # Main bot implementation
│   ├── evals/           # Behavioral eval scenarios
│   ├── pyproject.toml   # Python dependencies
│   ├── env.example      # Environment variables template
│   ├── .env             # Your API keys (git-ignored)
│   ├── Dockerfile       # Container image for Pipecat Cloud
│   └── pcc-deploy.toml  # Pipecat Cloud deployment config
├── client/              # React application
│   ├── src/             # Client source code
│   ├── package.json     # Node dependencies
│   └── ...
├── .gitignore           # Git ignore patterns
└── README.md            # This file
```

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