"""Tools and actions for the debate flow defined in flow.yaml.

Each tool is a Flows direct function: its name, description, and parameters come
from the signature and docstring. None chooses the next node; they return
``(result, TRANSITION_IN_YAML)`` and flow.yaml decides where each one leads.

bot.py puts the session's DebateState and TurnScorer in ``flow_manager.state``
under "debate" and "scorer".
"""

import asyncio

from pipecat.flows import TRANSITION_IN_YAML, FlowManager
from pipecat.frames.frames import TTSSpeakFrame

import knowledge
from judge import JudgeError, write_rationale

_WINNER_TEXT = {
    "user": "The user wins.",
    "bot": "You win.",
    "draw": "It is a draw.",
}


async def emit_stage(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action on every node: record the stage, which pushes a snapshot to the client."""
    await flow_manager.state["debate"].set_stage(action["stage"])


async def set_positions(flow_manager: FlowManager, user_theory: str, bot_theory: str):
    """Record which theory the user holds and which rival theory you will defend.

    Call this once you know the user's view. Use ids from the theory index.

    Args:
        user_theory: The id of the theory closest to the view the user described.
        bot_theory: The id of the rival theory you will defend. Pick one of the
            rivals listed for the user's theory.
    """
    user, bot = knowledge.get(user_theory), knowledge.get(bot_theory)
    if user is None or bot is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML
    if bot.id not in user.rivals:
        bot = knowledge.THEORIES[user.rivals[0]]

    state = flow_manager.state
    state.update(
        user_card=knowledge.brief(user),
        bot_card=knowledge.brief(bot),
        user_theory_name=user.name,
        bot_theory_name=bot.name,
    )
    state["scorer"].reset()
    state.pop("verdict_task", None)
    await state["debate"].set_positions(user.id, user.name, bot.id, bot.name)
    return {"status": "ok", "user_theory": user.name, "bot_theory": bot.name}, TRANSITION_IN_YAML


def fallback_rationale(hits: list[dict]) -> str:
    """What to say when the judge cannot write a rationale."""
    if not hits:
        return "The judge could not score this debate, so the result stands on the bars alone."
    biggest = max(hits, key=lambda hit: hit["damage"])
    return f"The point that mattered most was this. {biggest['reason']}"


async def judge_debate(flow_manager: FlowManager):
    """Hand the finished debate to the judge.

    Call this exactly once, as soon as the user has given their closing
    statement. Do not reply to the closing statement first.
    """
    # "Exactly once" is the LLM's promise, not a guarantee: a second call in the
    # same response, or a repeat, gets the first call's decision rather than a
    # second announcement, a second judge call, and a second verdict snapshot.
    state = flow_manager.state
    if "verdict_task" not in state:
        state["verdict_task"] = asyncio.ensure_future(_decide(flow_manager))
    return await state["verdict_task"], TRANSITION_IN_YAML


async def _decide(flow_manager: FlowManager) -> dict:
    state = flow_manager.state
    debate, scorer = state["debate"], state["scorer"]

    scorer.close()
    await flow_manager.worker.queue_frames(
        [TTSSpeakFrame("Thank you. The judge is tallying the scores.", append_to_context=False)]
    )
    await scorer.drain()

    winner = debate.winner()
    try:
        rationale = await write_rationale(
            user_theory=state["user_theory_name"],
            bot_theory=state["bot_theory_name"],
            health=dict(debate.health),
            winner=winner,
            hits=list(debate.hits),
        )
    except JudgeError:
        rationale = fallback_rationale(debate.hits)
    await debate.set_verdict(rationale)

    state["verdict_text"] = (
        f"Final health: the user {debate.health['user']}, you {debate.health['bot']}. "
        f"{_WINNER_TEXT[winner]} The judge's rationale: {rationale}"
    )
    return {
        "status": "ok",
        "winner": winner,
        "user_health": debate.health["user"],
        "bot_health": debate.health["bot"],
    }
