"""Keep text-mode evals from paying for speech nobody hears.

In text mode the eval harness asks the bot to skip TTS: the eval transport pushes
``LLMConfigureOutputFrame(skip_tts=True)`` when the harness connects. It pushes it
from the transport input, which is *below* the RTVI processor, so RTVI never sees
it and goes on believing speech is on. Every scripted user turn then arrives as
an RTVI ``send-text``, whose handler sets the value it was asked for and afterwards
"restores" the one it believes in — switching speech back on. The next LLM run,
which in a Flows app is the reply after every tool call, is synthesized in full.

This observer replays any such setting from the top of the pipeline, so it
passes through RTVI and the belief matches. Live sessions never send the frame.
"""

from collections.abc import Awaitable, Callable

from pipecat.frames.frames import Frame, LLMConfigureOutputFrame
from pipecat.observers.base_observer import BaseObserver, FramePushed


class SkipTTSSync(BaseObserver):
    def __init__(self, rtvi, replay: Callable[[Frame], Awaitable[None]]):
        super().__init__()
        self._rtvi = rtvi
        self._replay = replay
        # An observer meets the same frame at every hop; each is judged once.
        self._judged: set[int] = set()

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if not isinstance(frame, LLMConfigureOutputFrame) or frame.id in self._judged:
            return
        self._judged.add(frame.id)
        # Frames only travel down, so on its first hop a frame that RTVI sends,
        # or is about to receive, is one RTVI knows about.
        if data.source is self._rtvi or data.destination is self._rtvi:
            return
        replay = LLMConfigureOutputFrame(skip_tts=frame.skip_tts)
        self._judged.add(replay.id)
        await self._replay(replay)
