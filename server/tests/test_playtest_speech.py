import numpy as np

from playtest import mic, speech


def test_kokoro_float_audio_becomes_48k_s16_pcm():
    one_second_24k = np.linspace(-1.0, 1.0, 24000, dtype=np.float32)
    pcm = speech.to_pcm48(one_second_24k, 24000)
    samples = np.frombuffer(pcm, dtype=np.int16)
    assert len(samples) == 48000
    assert samples[0] == -32767 and samples[-1] == 32767


def test_a_line_is_synthesized_once_and_then_read_from_the_cache(tmp_path):
    calls = []

    def synth(text, voice):
        calls.append((text, voice))
        return np.zeros(2400, dtype=np.float32), 24000

    first = speech.say("Hello.", cache_dir=tmp_path, synth=synth)
    second = speech.say("Hello.", cache_dir=tmp_path, synth=synth)
    assert first == second and len(first) == 4800 * 2 and len(calls) == 1
    assert speech.cache_key("Hello.", "a") != speech.cache_key("Hello.", "b")


async def test_the_mic_plays_silence_then_a_queued_line_then_silence_again():
    track = mic.ScriptedMic()
    silent = await track.recv()
    assert silent.samples == 960 and silent.sample_rate == 48000
    assert bytes(silent.planes[0])[: 960 * 2] == b"\x00" * 1920 and not track.speaking

    track.queue(b"\x01\x00" * 1500)  # one full 20 ms frame and part of another
    assert track.speaking
    first = await track.recv()
    assert bytes(first.planes[0])[:4] == b"\x01\x00\x01\x00"
    second = await track.recv()
    assert bytes(second.planes[0])[: 540 * 2] == b"\x01\x00" * 540
    assert bytes(second.planes[0])[540 * 2: 960 * 2] == b"\x00" * (420 * 2)
    assert not track.speaking
    await track.idle()
    track.stop()
