import pytest

import warmup


class FakeCompletions:
    def __init__(self, error=None):
        self.calls = []
        self._error = error

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return object()


class FakeClient:
    def __init__(self, error=None):
        self.chat = type("Chat", (), {"completions": FakeCompletions(error)})()


async def test_warm_llm_sends_max_tokens_1_to_configured_model(monkeypatch):
    monkeypatch.setenv("GENERAL_COMPUTE_MODEL", "some-model")
    client = FakeClient()

    await warmup.warm_llm(client_factory=lambda: client)

    assert len(client.chat.completions.calls) == 1
    call = client.chat.completions.calls[0]
    assert call["max_tokens"] == 1
    assert call["model"] == "some-model"


async def test_warm_llm_swallows_completion_errors():
    client = FakeClient(error=RuntimeError("boom"))

    await warmup.warm_llm(client_factory=lambda: client)  # must not raise


async def test_warm_llm_swallows_factory_errors():
    def bad_factory():
        raise RuntimeError("no client for you")

    await warmup.warm_llm(client_factory=bad_factory)  # must not raise


async def test_warm_llm_defaults_model_when_env_unset(monkeypatch):
    monkeypatch.delenv("GENERAL_COMPUTE_MODEL", raising=False)
    client = FakeClient()

    await warmup.warm_llm(client_factory=lambda: client)

    assert client.chat.completions.calls[0]["model"] == "deepseek-v3.2"
