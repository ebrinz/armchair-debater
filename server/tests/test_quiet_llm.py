from pipecat.frames.frames import (
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection

from quiet_llm import DropsLeadingWhitespace


class Recorder:
    def __init__(self):
        self.pushed = []

    async def push_frame(self, frame, direction=FrameDirection.DOWNSTREAM):
        self.pushed.append(frame)


class Probe(DropsLeadingWhitespace, Recorder):
    pass


async def push_all(probe, *frames):
    for frame in frames:
        await probe.push_frame(frame)
    return [f.text if isinstance(f, LLMTextFrame) else type(f).__name__ for f in probe.pushed]


async def test_a_response_that_is_only_whitespace_says_nothing():
    # What deepseek sends alongside a tool call.
    assert await push_all(
        Probe(), LLMFullResponseStartFrame(), LLMTextFrame("\n\n"), LLMFullResponseEndFrame()
    ) == ["LLMFullResponseStartFrame", "LLMFullResponseEndFrame"]


async def test_whitespace_is_only_dropped_before_the_first_words():
    assert await push_all(
        Probe(),
        LLMFullResponseStartFrame(),
        LLMTextFrame("\n"),
        LLMTextFrame(" Broadcast"),
        LLMTextFrame(" "),
        LLMTextFrame("explains access."),
        LLMFullResponseEndFrame(),
    ) == [
        "LLMFullResponseStartFrame",
        " Broadcast",
        " ",
        "explains access.",
        "LLMFullResponseEndFrame",
    ]


async def test_each_response_starts_afresh():
    probe = Probe()
    await push_all(
        probe, LLMFullResponseStartFrame(), LLMTextFrame("Words."), LLMFullResponseEndFrame()
    )
    assert (await push_all(probe, LLMFullResponseStartFrame(), LLMTextFrame("\n\n")))[-1] == (
        "LLMFullResponseStartFrame"
    )


async def test_everything_else_passes_untouched():
    assert await push_all(Probe(), TTSSpeakFrame("The judge is tallying.")) == ["TTSSpeakFrame"]
