"""Warm the LLM endpoint so the first real request doesn't pay a cold-start cost.

No Pipecat imports: a plain OpenAI-compatible chat call, built the same way as
judge.py's ``_complete`` (same base URL, same env vars), so it is unit-testable
with an injected client factory and no network in tests.
"""

import os
from collections.abc import Callable
from typing import Any

from loguru import logger

from judge import BASE_URL

ClientFactory = Callable[[], Any]


def _default_client_factory() -> Any:
    from openai import AsyncOpenAI

    return AsyncOpenAI(api_key=os.environ["GENERAL_COMPUTE_API_KEY"], base_url=BASE_URL)


async def warm_llm(*, client_factory: ClientFactory | None = None) -> None:
    """Fire a minimal chat completion against the LLM endpoint to warm it up.

    Never raises: any failure (missing key, network error, bad response) is
    logged at debug level and swallowed, since this is a best-effort warm-up,
    not a request anyone is waiting on.
    """
    try:
        client = (client_factory or _default_client_factory)()
        await client.chat.completions.create(
            model=os.getenv("GENERAL_COMPUTE_MODEL", "deepseek-v3.2"),
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
    except Exception as e:
        logger.debug(f"warmup: LLM warm-up failed ({e})")
