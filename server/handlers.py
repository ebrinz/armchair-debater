"""Tools and actions for the debate flow defined in flow.yaml.

Each tool is a Flows direct function: its name, description, and parameters come
from the signature and docstring. None chooses the next node; they return
``(result, TRANSITION_IN_YAML)`` and flow.yaml decides where each one leads.

bot.py puts the session's DebateState and TurnScorer in ``flow_manager.state``
under "debate" and "scorer".
"""

import asyncio

from pipecat.flows import TRANSITION_IN_YAML, FlowManager
from pipecat.frames.frames import TTSSpeakFrame, TTSUpdateSettingsFrame
from pipecat.services.settings import TTSSettings

import knowledge
import providers
from debate_state import EXAMINER, MODES
from judge import JudgeError, write_finding, write_rationale

_WINNER_TEXT = {
    "user": "The user wins.",
    "bot": "You win.",
    "draw": "It is a draw.",
}


async def emit_stage(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action on every node: record the stage, which pushes a snapshot to the client."""
    await flow_manager.state["debate"].set_stage(action["stage"])


# Prepended to the verdict prompt when the judge has a voice of their own.
JUDGE_PERSONA = (
    "From this turn on you speak as the JUDGE, in the judge's own voice, and no "
    "longer as the debater: say 'the house' where you would have said 'I', take "
    "no side, and do not reopen the argument. "
)


async def choose_mode(flow_manager: FlowManager, mode: str):
    """Record what the user wants to do.

    Args:
        mode: "debate" to argue a theory against you, "sparring" to have their own
            view examined with questions, or "explore" to be shown round the theories.
    """
    if mode not in MODES:
        return {"status": "unknown_mode", "valid_modes": list(MODES)}, TRANSITION_IN_YAML
    await flow_manager.state["debate"].set_mode(mode)
    return {"status": mode}, TRANSITION_IN_YAML


async def emit_question(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action: tell the client which sparring question this is."""
    state = flow_manager.state
    await state["debate"].set_question(state["spar_q"], SPAR_QUESTIONS)


async def use_voice(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action: from here on, speak as ``action["who"]`` — "judge" or "house".

    A frame rather than a call on the TTS service, so the switch takes its place
    in line: whatever was already on its way to be spoken keeps the voice it was
    written for. Does nothing unless a judge's voice has been configured.
    """
    voices = providers.voices()
    if voices is None:
        return
    await flow_manager.worker.queue_frames(
        [TTSUpdateSettingsFrame(delta=TTSSettings(voice=voices[action["who"]]))]
    )


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


async def answer_given(flow_manager: FlowManager):
    """The user has answered your cross-examination question.

    Call this as soon as the user has answered the question you put to them.
    """
    # The flow only moves on once the house has had its turn here. A barge-in
    # while it was answering leaves it with no finished turn in this node, and
    # whatever the user said then is not an answer to a question they were
    # never asked. No match in the config's branch table means: stay.
    if flow_manager.state["scorer"].heard("crossexam_answer", "bot") == 0:
        return {
            "status": "answer_first",
            "instruction": (
                "You have not yet answered the user's question or asked your own. "
                "Do both now, as this round's instructions describe."
            ),
        }, TRANSITION_IN_YAML
    return {"status": "ok"}, TRANSITION_IN_YAML


SPAR_QUESTIONS = 5


async def take_position(flow_manager: FlowManager, user_theory: str):
    """Record the theory whose defence you are about to examine.

    Call this once you know the user's view. Use an id from the theory index.

    Args:
        user_theory: The id of the theory closest to the view the user described.
    """
    user = knowledge.get(user_theory)
    if user is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML

    state = flow_manager.state
    state.update(
        user_card=knowledge.brief(user),
        user_theory_name=user.name,
        bot_theory_name=EXAMINER,
        spar_q=1,
    )
    state.pop("finding_task", None)
    state["scorer"].reset()
    await state["debate"].set_solo(user.id, user.name)
    return {"status": "ok", "user_theory": user.name}, TRANSITION_IN_YAML


async def answer_heard(flow_manager: FlowManager):
    """The user has answered the question you just asked.

    Call this as soon as they have answered, without replying to the answer.
    """
    state = flow_manager.state
    asked = state["scorer"].heard("sparring", "bot")
    # The same guard as cross-examination: this is visit number `spar_q` to the
    # node, so the examiner must have finished that many turns in it. Otherwise
    # what the user said was a barge-in, not an answer, and it burns no question.
    if asked < state["spar_q"]:
        return {
            "status": "ask_first",
            "instruction": "You have not asked this question yet. Ask it now.",
        }, TRANSITION_IN_YAML
    if state["spar_q"] < SPAR_QUESTIONS:
        state["spar_q"] += 1
        return {
            "status": "more",
            "question": state["spar_q"],
            "of": SPAR_QUESTIONS,
        }, TRANSITION_IN_YAML

    # The fifth answer. As with the debate's verdict, a repeat or a parallel call
    # shares one decision, and a failed one is not remembered.
    if "finding_task" not in state:
        state["finding_task"] = asyncio.ensure_future(_find(flow_manager))
    try:
        return await state["finding_task"], TRANSITION_IN_YAML
    except BaseException:
        state.pop("finding_task", None)
        raise


def fallback_finding(hits: list[dict]) -> str:
    """What to say when the judge cannot write the finding."""
    if not hits:
        return "The judge could not score this examination, so the bar stands alone."
    costliest = max(hits, key=lambda hit: hit["damage"])
    return f"The question that cost the most was this. {costliest['reason']}"


async def _find(flow_manager: FlowManager) -> dict:
    state = flow_manager.state
    debate, scorer = state["debate"], state["scorer"]

    scorer.close()
    await flow_manager.worker.queue_frames(
        [TTSSpeakFrame("Thank you. Let me weigh your answers.", append_to_context=False)]
    )
    await scorer.drain()

    integrity = debate.health["user"]
    try:
        finding = await write_finding(
            theory=state["user_theory_name"], health=integrity, hits=list(debate.hits)
        )
    except JudgeError:
        finding = fallback_finding(debate.hits)
    await debate.set_verdict(finding)

    holds = debate.winner() == "user"
    state["finding_text"] = (
        f"Integrity of the user's position: {integrity} out of 100. "
        f"{'The view held.' if holds else 'The view did not hold.'} The finding: {finding}"
    )
    return {"status": "done", "integrity": integrity, "holds": holds}


async def show_theory(flow_manager: FlowManager, theory_id: str):
    """Turn to a theory's card, to talk about it.

    Call this whenever the conversation turns to a theory, before you describe it:
    it shows the user that card and gives you what is on it.

    Args:
        theory_id: The id of the theory, from the theory index.
    """
    theory = knowledge.get(theory_id)
    if theory is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML
    await flow_manager.state["debate"].set_focus(theory.id)
    return {
        "status": "shown",
        "card": knowledge.brief(theory),
        "rivals": [knowledge.THEORIES[rival].name for rival in theory.rivals],
    }, TRANSITION_IN_YAML


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
    try:
        return await state["verdict_task"], TRANSITION_IN_YAML
    except BaseException:
        # A failed or cancelled decision is not remembered: the next call tries again.
        state.pop("verdict_task", None)
        raise


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
