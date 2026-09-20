"""Warm the LLM endpoint so the first real request doesn't pay a cold-start cost.

No Pipecat imports: a plain OpenAI-compatible chat call, built the same way as
judge.py's ``_complete`` (the endpoint ``providers.llm_config()`` names), so it is unit-testable
with an injected client factory and no network in tests.
"""

import asyncio
from collections.abc import Callable
from typing import Any

from loguru import logger

from providers import llm_config

ClientFactory = Callable[[], Any]

# The whole warm-up (connect + request) is bounded to this many seconds, so a
# slow or unresponsive provider can't hold a "quick warm-up" open for its
# default multi-minute read timeout.
WARMUP_TIMEOUT_S = 8

# Fire-and-forget tasks this module has started, held here (not by the caller)
# so they survive the caller returning, and discarded as each finishes.
_tasks: set[asyncio.Task] = set()


def _default_client_factory() -> Any:
    from openai import AsyncOpenAI

    config = llm_config()
    return AsyncOpenAI(
        api_key=config.require_key(), base_url=config.base_url, timeout=WARMUP_TIMEOUT_S
    )


async def warm_llm(*, client_factory: ClientFactory | None = None) -> None:
    """Fire a minimal chat completion against the LLM endpoint to warm it up.

    Never raises: any failure (missing key, network error, bad response, or
    the warm-up taking longer than ``WARMUP_TIMEOUT_S``) is logged at debug
    level and swallowed, since this is a best-effort warm-up, not a request
    anyone is waiting on.
    """
    try:
        client = (client_factory or _default_client_factory)()
        config = llm_config()
        await asyncio.wait_for(
            client.chat.completions.create(
                model=config.model,
                **config.limits(1),
                messages=[{"role": "user", "content": "hi"}],
                timeout=WARMUP_TIMEOUT_S,
            ),
            timeout=WARMUP_TIMEOUT_S,
        )
    except Exception as e:
        logger.debug(f"warmup: LLM warm-up failed ({e})")


def start_warmup(*, client_factory: ClientFactory | None = None) -> asyncio.Task:
    """Start ``warm_llm`` as a tracked fire-and-forget task and return it.

    The task is held in this module's own set (not by the caller), so it is
    not garbage-collected if the caller returns while it is still in flight
    (e.g. a fast client disconnect tearing down the session); the set's
    done-callback removes it as soon as it finishes, so it never grows
    without bound.
    """
    task = asyncio.create_task(warm_llm(client_factory=client_factory))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task
