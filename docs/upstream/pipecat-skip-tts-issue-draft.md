Text-mode evals still synthesize speech after a tool call: RTVI's cached `skip_tts` undoes the eval transport's setting

### Summary

In a text-mode eval the harness connects with `?skip_tts=true` and `EvalTransport` configures the LLM to skip TTS. That holds for the greeting and for the LLM run that a `send-text` triggers directly. It does not hold for any LLM run that comes *after* that one without a new `send-text` — most commonly the follow-up run after a function call. Those replies are synthesized in full by the bot's real TTS service, so text-mode evals of a tool-using bot quietly spend TTS credits and time on audio nobody receives.

### Versions

- `pipecat-ai` 1.11.0 (also present on `main` as of 2026-09-20 — the lines below are unchanged)
- Python 3.12, macOS
- Seen with both `GradiumTTSService` and `OpenAITTSService`; the mechanism is independent of the TTS provider

### Cause

Two places hold the "skip TTS" state, and the eval transport only updates one of them.

1. `EvalTransport._on_client_connected` pushes the setting **from the transport input**:

   ```python
   # src/pipecat/evals/transport.py:143-145
   skip_tts = _query_flag(websocket, SKIP_TTS_QUERY_PARAM)
   logger.debug(f"{self}: configuring eval LLM output with {skip_tts=}")
   await self._input.push_frame(LLMConfigureOutputFrame(skip_tts=skip_tts))
   ```

   The frame travels downstream from `transport.input()` and reaches the LLM service, which stores it (`llm_service.py:707-708`). `RTVIProcessor` sits *above* the transport input, so it never sees this frame.

2. `RTVIProcessor` keeps its own copy, which is only updated by frames that pass through it:

   ```python
   # src/pipecat/processors/frameworks/rtvi/processor.py:87
   self._llm_skip_tts: bool = False  # Keep in sync with llm_service.py's configuration.
   # :248-249
   elif isinstance(frame, LLMConfigureOutputFrame):
       self._llm_skip_tts = frame.skip_tts
   ```

   So after the eval transport's configure frame, the LLM has `skip_tts=True` and RTVI still believes `False`.

3. Each scripted user turn arrives as an RTVI `send-text` with `audio_response=False` (`evals/client.py:861-865`). The handler toggles to the requested value and then **restores its cached one**:

   ```python
   # processor.py:481-494
   cur_llm_skip_tts = self._llm_skip_tts          # False — stale
   should_skip_tts = not opts.audio_response      # True
   toggle_skip_tts = cur_llm_skip_tts != should_skip_tts
   if toggle_skip_tts:
       await self.push_frame(LLMConfigureOutputFrame(skip_tts=should_skip_tts))
   await self.push_frame(LLMMessagesAppendFrame(..., run_llm=opts.run_immediately))
   if toggle_skip_tts:
       await self.push_frame(LLMConfigureOutputFrame(skip_tts=cur_llm_skip_tts))   # sets the LLM back to False
   ```

   The restore frame queues behind the LLM run that the append triggered, so that run is correctly silent. Once it finishes, the LLM is left at `skip_tts=False` — and the next run that is not started by a `send-text` (the run after a function-call result, which in a Pipecat Flows bot is nearly every substantive reply) is spoken.

This is different from #5722, which fixed the setting persisting *across* connections. Here the setting is undone *within* one connection.

### Evidence

Bot log from one text-mode scripted scenario (Pipecat Flows bot, first user turn leads to a `set_positions` tool call):

```
08:03:10.430 pipecat.evals.transport:_on_client_connected:144 - EvalTransport#0: configuring eval LLM output with skip_tts=True
08:03:10.507 OpenAILLMService#0: Generating chat from context …      <- greeting: no TTS (correct)
08:03:19.234 OpenAILLMService#0: Generating chat from context …      <- run started by send-text: no TTS (correct)
08:03:19.786 OpenAILLMService#0 Calling function [set_positions:…]
08:03:19.796 LLMAssistantAggregator#0 FunctionCallResultFrame: [set_positions:…]
08:03:19.800 OpenAILLMService#0: Generating chat from context …      <- follow-up run
08:03:20.412 OpenAITTSService#0: Generating TTS [Your view sounds closest to Global Workspace Theory, so I'll…]
08:03:22.125 OpenAITTSService#0: Generating TTS [IIT starts from the defining features of experience itself, …]
08:03:25.765 OpenAITTSService#0: Generating TTS [What's your opening argument for Global Workspace Theory?]
```

Across 69 text-mode eval bot runs of this project, every one logged `skip_tts=True` at connect, and together they logged 420 `usage characters` entries totalling ~48,000 synthesized characters. A scenario whose turns involve no tool calls synthesized 0 characters, which is what pointed at the follow-up run.

With the workaround below, the same five-scenario scripted suite went from 1,585 synthesized characters to 44 (a deliberate `TTSSpeakFrame`, which is not LLM output), still 5/5 passing.

### To reproduce

1. Any cascade bot with the `eval` transport, a TTS service, and at least one function the LLM calls in reply to the first user turn (`run_llm` after the result, the default).
2. A text-mode scripted scenario: wait for the greeting, then one `user:` turn that triggers the function.
3. `uv run bot.py -t eval`, then `uv run pipecat eval run scenario.yaml`.
4. In the bot's log: `configuring eval LLM output with skip_tts=True`, then `Generating TTS [...]` for the reply that follows the function call, plus a `usage characters` metric.

### Possible fixes

- Have `EvalTransport` deliver the configure frame so that `RTVIProcessor` sees it too (queue it from the top of the pipeline rather than from `self._input`), or
- make `_handle_send_text` stop restoring a cached value — e.g. only toggle when the client explicitly set `audio_response`, or restore what the LLM service actually holds rather than RTVI's mirror, or
- have `RTVIProcessor` learn the value from configure frames it did not originate (it is documented as "keep in sync with llm_service.py's configuration", but nothing syncs it for frames pushed below it).

The first seems smallest. Happy to open a PR with a regression test alongside `tests/test_evals_transport.py` if that direction is right.

### Workaround (application side, public APIs only)

An observer that replays any `LLMConfigureOutputFrame` RTVI has not seen from the top of the pipeline:

```python
class SkipTTSSync(BaseObserver):
    def __init__(self, rtvi, replay):
        super().__init__()
        self._rtvi, self._replay, self._judged = rtvi, replay, set()

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if not isinstance(frame, LLMConfigureOutputFrame) or frame.id in self._judged:
            return
        self._judged.add(frame.id)
        # Frames only travel down, so on its first hop a frame RTVI sends or is
        # about to receive is one RTVI knows about.
        if data.source is self._rtvi or data.destination is self._rtvi:
            return
        replay = LLMConfigureOutputFrame(skip_tts=frame.skip_tts)
        self._judged.add(replay.id)
        await self._replay(replay)

worker.add_observer(SkipTTSSync(worker.rtvi, worker.queue_frame))
```

### AI disclosure

Found, traced and written up with Claude Code while working on a Pipecat Flows bot. The mechanism was verified by reading the installed 1.11.0 source and `main`, and the before/after numbers come from real eval runs against live LLM and TTS providers, not from mocks.
