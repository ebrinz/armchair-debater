"""Which providers the bot runs on, chosen by two environment variables.

``LLM_PROVIDER``     ``general_compute`` (default) or ``openai`` — the debater, the
                     judge, and the warm-up all follow it.
``SPEECH_PROVIDER``  ``gradium`` (default) or ``openai`` — speech-to-text and
                     text-to-speech.

They are separate so the two can be mixed: OpenAI's LLM with Gradium's speech,
say. No Pipecat imports at module level — ``judge.py`` and ``warmup.py`` read
``llm_config()`` and stay plain Python; the speech services are imported only
when asked for, so the unused provider's extra need not be installed.
"""

import os
from dataclasses import dataclass

LLM_PROVIDERS = ("general_compute", "openai")
SPEECH_PROVIDERS = ("gradium", "openai")


def _choice(variable: str, valid: tuple[str, ...]) -> str:
    value = os.getenv(variable, valid[0]).strip().lower()
    if value not in valid:
        raise ValueError(f"{variable}={value!r}: expected one of {', '.join(valid)}")
    return value


def _require(variable: str, why: str) -> str:
    """The key, or an error — never ``None``.

    Handed no key, the OpenAI client quietly falls back to ``OPENAI_API_KEY``,
    which would send that key to whichever endpoint it was pointed at.
    """
    value = os.getenv(variable)
    if not value:
        raise RuntimeError(f"{variable} is not set (needed for {why})")
    return value


@dataclass(frozen=True)
class LLMConfig:
    """An OpenAI-compatible chat endpoint: where it is, which model, which key."""

    provider: str
    base_url: str | None  # None is the OpenAI client's own default
    model: str
    key_variable: str

    def require_key(self) -> str:
        return _require(self.key_variable, f"LLM_PROVIDER={self.provider}")

    def limits(self, max_tokens: int, temperature: float | None = None) -> dict:
        """The chat-completion arguments whose names differ between providers."""
        if self.provider == "openai":
            # `max_tokens` is deprecated there, and newer models reject it along
            # with any temperature but their default.
            return {"max_completion_tokens": max_tokens}
        limits: dict = {"max_tokens": max_tokens}
        if temperature is not None:
            limits["temperature"] = temperature
        return limits


def llm_config() -> LLMConfig:
    provider = _choice("LLM_PROVIDER", LLM_PROVIDERS)
    if provider == "openai":
        return LLMConfig(
            provider=provider,
            base_url=None,
            # Pipecat's own OpenAILLMService default.
            model=os.getenv("OPENAI_MODEL", "gpt-4.1"),
            key_variable="OPENAI_API_KEY",
        )
    return LLMConfig(
        provider=provider,
        base_url="https://api.generalcompute.com/v1",
        model=os.getenv("GENERAL_COMPUTE_MODEL", "deepseek-v3.2"),
        key_variable="GENERAL_COMPUTE_API_KEY",
    )


def speech_provider() -> str:
    return _choice("SPEECH_PROVIDER", SPEECH_PROVIDERS)


def _set(**fields: str | None) -> dict:
    """Only the settings that were actually given; the rest keep the service's defaults."""
    return {name: value for name, value in fields.items() if value}


def make_stt():
    """The speech-to-text service for ``SPEECH_PROVIDER``."""
    provider = speech_provider()
    if provider == "openai":
        # The streaming service, not the transcribe-after-the-fact one. Its turn
        # detection is off by default, so the pipeline's local VAD still decides
        # when the speaker has stopped.
        from pipecat.services.openai.stt import OpenAIRealtimeSTTService

        return OpenAIRealtimeSTTService(
            api_key=_require("OPENAI_API_KEY", "SPEECH_PROVIDER=openai"),
            settings=OpenAIRealtimeSTTService.Settings(**_set(model=os.getenv("OPENAI_STT_MODEL"))),
        )
    from pipecat.services.gradium.stt import GradiumSTTService

    return GradiumSTTService(api_key=_require("GRADIUM_API_KEY", "SPEECH_PROVIDER=gradium"))


def make_tts():
    """The text-to-speech service for ``SPEECH_PROVIDER``."""
    provider = speech_provider()
    if provider == "openai":
        from pipecat.services.openai.tts import OpenAITTSService

        return OpenAITTSService(
            api_key=_require("OPENAI_API_KEY", "SPEECH_PROVIDER=openai"),
            settings=OpenAITTSService.Settings(
                **_set(model=os.getenv("OPENAI_TTS_MODEL"), voice=os.getenv("OPENAI_TTS_VOICE"))
            ),
        )
    from pipecat.services.gradium.tts import GradiumTTSService

    return GradiumTTSService(
        api_key=_require("GRADIUM_API_KEY", "SPEECH_PROVIDER=gradium"),
        settings=GradiumTTSService.Settings(
            voice=os.getenv("GRADIUM_VOICE_ID", "_6Aslh2DxfmnRLmP"),
        ),
    )
