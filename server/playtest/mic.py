"""An aiortc audio track that plays silence until a line is queued, then the line."""

import asyncio
import fractions
import time

from aiortc.mediastreams import MediaStreamError, MediaStreamTrack
from av import AudioFrame

RATE = 48000
SAMPLES = 960  # 20 ms
BYTES = SAMPLES * 2


class ScriptedMic(MediaStreamTrack):
    kind = "audio"

    def __init__(self):
        super().__init__()
        self._buffer = bytearray()
        self._start: float | None = None
        self._pts = 0
        self._drained = asyncio.Event()
        self._drained.set()

    @property
    def speaking(self) -> bool:
        return bool(self._buffer)

    def queue(self, pcm: bytes) -> None:
        self._buffer.extend(pcm)
        self._drained.clear()

    async def idle(self) -> None:
        """Wait until everything queued has been sent."""
        await self._drained.wait()

    async def recv(self) -> AudioFrame:
        if self.readyState != "live":
            raise MediaStreamError
        if self._start is None:
            self._start = time.time()
        else:
            self._pts += SAMPLES
            await asyncio.sleep(max(0.0, self._start + self._pts / RATE - time.time()))

        chunk = bytes(self._buffer[:BYTES])
        del self._buffer[:BYTES]
        if not self._buffer:
            self._drained.set()

        frame = AudioFrame(format="s16", layout="mono", samples=SAMPLES)
        plane = frame.planes[0]  # its buffer may be padded past BYTES
        plane.update(chunk + b"\x00" * (plane.buffer_size - len(chunk)))
        frame.pts = self._pts
        frame.sample_rate = RATE
        frame.time_base = fractions.Fraction(1, RATE)
        return frame
