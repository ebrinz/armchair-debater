"""An LLM service that does not pass on a response made of nothing but whitespace.

Some models — deepseek among them — send "\\n\\n" as content alongside a tool
call. It is harmless to a listener, but it is a "reply" to anything that counts
replies: the eval harness's simulated caller hears it, takes its turn before the
bot's real one, and can interrupt it. Whitespace is dropped only until a
response's first words, so nothing inside a sentence is ever touched.
"""

from pipecat.frames.frames import LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.openai.llm import OpenAILLMService


class DropsLeadingWhitespace:
    """Mix in ahead of an LLM service. Kept apart from it so the rule is testable alone."""

    _said_something = False

    async def push_frame(self, frame, direction: FrameDirection = FrameDirection.DOWNSTREAM):
        if isinstance(frame, LLMFullResponseStartFrame):
            self._said_something = False
        elif isinstance(frame, LLMTextFrame):
            if not self._said_something and not frame.text.strip():
                return
            self._said_something = True
        await super().push_frame(frame, direction)


class QuietOpenAILLMService(DropsLeadingWhitespace, OpenAILLMService):
    pass
