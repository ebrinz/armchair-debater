import pytest

import providers

PROVIDER_VARS = [
    "LLM_PROVIDER",
    "SPEECH_PROVIDER",
    "GENERAL_COMPUTE_API_KEY",
    "GENERAL_COMPUTE_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_STT_MODEL",
    "OPENAI_TTS_MODEL",
    "OPENAI_TTS_VOICE",
    "GRADIUM_API_KEY",
    "GRADIUM_VOICE_ID",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Start every test from an empty provider environment, whatever the shell exports."""
    for name in PROVIDER_VARS:
        monkeypatch.delenv(name, raising=False)


def test_llm_defaults_to_general_compute(monkeypatch):
    monkeypatch.setenv("GENERAL_COMPUTE_API_KEY", "gc-key")

    config = providers.llm_config()

    assert config.provider == "general_compute"
    assert config.base_url == "https://api.generalcompute.com/v1"
    assert config.model == "deepseek-v3.2"
    assert config.require_key() == "gc-key"


def test_general_compute_model_comes_from_its_env_var(monkeypatch):
    monkeypatch.setenv("GENERAL_COMPUTE_MODEL", "some-model")

    assert providers.llm_config().model == "some-model"


def test_openai_llm_uses_openais_own_endpoint_key_and_model(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "oa-key")

    config = providers.llm_config()

    assert config.provider == "openai"
    assert config.base_url is None  # the client's default: api.openai.com
    assert config.model == "gpt-4.1"
    assert config.require_key() == "oa-key"


def test_openai_model_comes_from_its_env_var(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "another-model")
    monkeypatch.setenv("GENERAL_COMPUTE_MODEL", "not-this-one")

    assert providers.llm_config().model == "another-model"


def test_provider_name_is_forgiving_about_case_and_spaces(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", " OpenAI ")

    assert providers.llm_config().provider == "openai"


def test_unknown_llm_provider_names_the_valid_ones(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "clippy")

    with pytest.raises(ValueError, match="general_compute.*openai"):
        providers.llm_config()


def test_a_missing_key_is_an_error_not_a_fallback_to_another_providers_key(monkeypatch):
    # The OpenAI client falls back to OPENAI_API_KEY when handed no key, which
    # would send that key to General Compute's endpoint.
    monkeypatch.setenv("OPENAI_API_KEY", "oa-key")

    with pytest.raises(RuntimeError, match="GENERAL_COMPUTE_API_KEY"):
        providers.llm_config().require_key()


def test_general_compute_chat_limits_keep_todays_parameters():
    assert providers.llm_config().limits(400, temperature=0.1) == {
        "max_tokens": 400,
        "temperature": 0.1,
    }
    assert providers.llm_config().limits(1) == {"max_tokens": 1}


def test_openai_chat_limits_use_the_current_parameter_and_no_temperature(monkeypatch):
    # `max_tokens` is deprecated there and newer models reject it, along with
    # any non-default temperature.
    monkeypatch.setenv("LLM_PROVIDER", "openai")

    assert providers.llm_config().limits(400, temperature=0.1) == {"max_completion_tokens": 400}


def test_speech_defaults_to_gradium(monkeypatch):
    from pipecat.services.gradium.stt import GradiumSTTService
    from pipecat.services.gradium.tts import GradiumTTSService

    monkeypatch.setenv("GRADIUM_API_KEY", "gr-key")

    assert isinstance(providers.make_stt(), GradiumSTTService)
    assert isinstance(providers.make_tts(), GradiumTTSService)


def test_openai_speech(monkeypatch):
    from pipecat.services.openai.stt import OpenAIRealtimeSTTService
    from pipecat.services.openai.tts import OpenAITTSService

    monkeypatch.setenv("SPEECH_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "oa-key")
    monkeypatch.setenv("OPENAI_TTS_VOICE", "some-voice")

    assert isinstance(providers.make_stt(), OpenAIRealtimeSTTService)
    tts = providers.make_tts()
    assert isinstance(tts, OpenAITTSService)
    assert tts._settings.voice == "some-voice"


def test_speech_without_its_key_is_an_error(monkeypatch):
    monkeypatch.setenv("SPEECH_PROVIDER", "openai")

    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        providers.make_stt()
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        providers.make_tts()


def test_unknown_speech_provider_names_the_valid_ones(monkeypatch):
    monkeypatch.setenv("SPEECH_PROVIDER", "gramophone")

    with pytest.raises(ValueError, match="gradium.*openai"):
        providers.make_stt()
