"""The player's lines as 48 kHz mono PCM, synthesized locally with Kokoro and cached.

Free: the model is the one Pipecat's Kokoro service downloads, in
~/.cache/pipecat/kokoro-onnx.
"""

import hashlib
from functools import cache
from pathlib import Path

import numpy as np

CACHE = Path(__file__).parent / ".cache"
PLAYER_VOICE = "af_heart"  # not the bot's voice, so the two are easy to tell apart
KOKORO_DIR = Path("~/.cache/pipecat/kokoro-onnx").expanduser()


def to_pcm48(samples: np.ndarray, rate: int) -> bytes:
    """Float audio at any rate as 48 kHz mono signed 16-bit PCM."""
    samples = np.asarray(samples, dtype=np.float32)
    length = int(round(len(samples) * 48000 / rate))
    resampled = np.interp(np.linspace(0, len(samples) - 1, length), np.arange(len(samples)), samples)
    return (np.clip(resampled, -1.0, 1.0) * 32767).astype(np.int16).tobytes()


def cache_key(text: str, voice: str) -> str:
    return hashlib.sha256(f"{voice}\n{text}".encode()).hexdigest()[:24]


@cache
def _kokoro():
    from kokoro_onnx import Kokoro

    model, voices = KOKORO_DIR / "kokoro-v1.0.onnx", KOKORO_DIR / "voices-v1.0.bin"
    if not model.exists():
        # Pipecat's service downloads it on first use; instantiate it once to fetch.
        from pipecat.services.kokoro.tts import KokoroTTSService

        KokoroTTSService()
    return Kokoro(str(model), str(voices))


def _synth(text: str, voice: str):
    return _kokoro().create(text, voice=voice, speed=1.0, lang="en-us")


def say(text: str, *, voice: str = PLAYER_VOICE, cache_dir: Path = CACHE, synth=None) -> bytes:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{cache_key(text, voice)}.pcm"
    if path.exists():
        return path.read_bytes()
    samples, rate = (synth or _synth)(text, voice)
    pcm = to_pcm48(samples, rate)
    path.write_bytes(pcm)
    return pcm
