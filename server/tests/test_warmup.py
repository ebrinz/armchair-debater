import asyncio

import warmup


class FakeCompletions:
    def __init__(self, error=None, hang=False):
        self.calls = []
        self._error = error
        self._hang = hang

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._hang:
            await asyncio.Event().wait()  # never set: simulates a stuck request
        if self._error:
            raise self._error
        return object()


class FakeClient:
    def __init__(self, error=None, hang=False):
        self.chat = type("Chat", (), {"completions": FakeCompletions(error, hang)})()


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


async def test_warm_llm_returns_quietly_without_an_api_key(monkeypatch):
    monkeypatch.delenv("GENERAL_COMPUTE_API_KEY", raising=False)

    await warmup.warm_llm()  # default factory path; must not raise, no network


async def test_warm_llm_times_out_without_raising(monkeypatch):
    monkeypatch.setattr(warmup, "WARMUP_TIMEOUT_S", 0.05)
    client = FakeClient(hang=True)

    await asyncio.wait_for(warmup.warm_llm(client_factory=lambda: client), timeout=2)


async def test_start_warmup_task_is_tracked_while_running_and_removed_when_done():
    gate = asyncio.Event()

    class GatedCompletions:
        async def create(self, **kwargs):
            await gate.wait()
            return object()

    class GatedClient:
        chat = type("Chat", (), {"completions": GatedCompletions()})()

    task = warmup.start_warmup(client_factory=lambda: GatedClient())

    assert task in warmup._tasks
    assert not task.done()

    gate.set()
    await task

    assert task not in warmup._tasks


async def test_start_warmup_task_exception_does_not_propagate_and_is_removed():
    def bad_factory():
        raise RuntimeError("no client for you")

    task = warmup.start_warmup(client_factory=bad_factory)

    await task  # must not raise: warm_llm already swallows the error

    assert task not in warmup._tasks
