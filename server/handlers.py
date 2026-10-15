"""Tools and actions for the debate flow defined in flow.yaml.

Each tool is a Flows direct function: its name, description, and parameters come
from the signature and docstring. None chooses the next node; they return
``(result, TRANSITION_IN_YAML)`` and flow.yaml decides where each one leads.

bot.py puts the session's DebateState and TurnScorer in ``flow_manager.state``
under "debate" and "scorer".
"""

import asyncio
import os

from pipecat.flows import TRANSITION_IN_YAML, FlowManager
from pipecat.frames.frames import TTSSpeakFrame, TTSUpdateSettingsFrame
from pipecat.services.settings import TTSSettings

import knowledge
import providers
from debate_state import EXAMINER, MODES, TUTOR
from judge import JudgeError, write_finding, write_rationale, write_report

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
            view examined with questions, "explore" to be shown round the theories,
            or "learn" to be taught one theory.
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


async def opening_done(flow_manager: FlowManager):
    """The user has finished their opening statement. Moves the debate to the rebuttal round."""
    flow_manager.state["scorer"].round_complete("opening")
    return {"status": "ok"}, TRANSITION_IN_YAML


async def rebuttal_done(flow_manager: FlowManager):
    """The user has finished their rebuttal. Moves the debate to cross-examination."""
    flow_manager.state["scorer"].round_complete("rebuttal")
    return {"status": "ok"}, TRANSITION_IN_YAML


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
    flow_manager.state["scorer"].round_complete("crossexam_answer")
    return {"status": "ok"}, TRANSITION_IN_YAML


SPAR_QUESTIONS = 5


async def _seat_for_sparring(flow_manager: FlowManager, user: knowledge.Theory) -> dict:
    """Seat the player alone with their theory, facing the examiner, at question one."""
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
    return {"status": "ok", "user_theory": user.name}


async def take_position(flow_manager: FlowManager, user_theory: str):
    """Record the theory whose defence you are about to examine.

    Call this once you know the user's view. Use an id from the theory index.

    Args:
        user_theory: The id of the theory closest to the view the user described.
    """
    user = knowledge.get(user_theory)
    if user is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML
    return await _seat_for_sparring(flow_manager, user), TRANSITION_IN_YAML


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
    state["scorer"].answer_complete("sparring")
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


# --- the tutor -------------------------------------------------------------------

LESSON_STEPS = knowledge.LESSON_STEPS
CHECK_QUESTIONS = knowledge.CHECKS


def _lesson_theory(state: dict) -> knowledge.Theory:
    return knowledge.THEORIES[state["lesson_theory"]]


# Each lesson step's instructions stay in the conversation, so the full card is
# given once, on step one, and later steps point back to it: a copy per step grew
# the prompt to ~25k characters and slowed every reply (playtest, 2026-10-14).
# ARMCHAIR_LESSON_CARD_EVERY_STEP=1 puts the full card back on every step.
LESSON_CARD_POINTER = (
    "The theory's full card was given at step one, earlier in this conversation; "
    "answer questions from it and from this step's material."
)


def _card_every_step() -> bool:
    return os.getenv("ARMCHAIR_LESSON_CARD_EVERY_STEP") == "1"


def _begin_step(state: dict) -> None:
    """Put the current step's title, material, and card where the lesson prompt reads them."""
    step = state["lesson_step"]
    state["lesson_title"] = LESSON_STEPS[step - 1]
    state["lesson_material"] = knowledge.lesson_step(_lesson_theory(state), step)
    state["lesson_card"] = (
        f"The card, for questions:\n{state['user_card']}"
        if step == 1 or _card_every_step()
        else LESSON_CARD_POINTER
    )


def _begin_check(state: dict) -> None:
    """Put the current check question, and its rubric for the scorer, in state.

    Called by the handler that leads INTO the check node, not by the node's
    pre-action: Flows renders a node's prompt from state as it enters, before
    the pre-actions run, so a question set there would arrive one visit late.
    """
    question, rubric = knowledge.check_questions(_lesson_theory(state))[state["check_q"] - 1]
    state["check_question"], state["check_rubric"] = question, rubric


async def choose_lesson(flow_manager: FlowManager, theory_id: str):
    """Record which theory the user wants to learn, and start its lesson.

    Call this once they have named a theory, or described one closely enough to
    match. Use an id from the theory index.

    Args:
        theory_id: The id of the theory to teach.
    """
    theory = knowledge.get(theory_id)
    if theory is None:
        return {"status": "unknown_theory", "valid_ids": knowledge.ids()}, TRANSITION_IN_YAML

    state = flow_manager.state
    state.update(
        user_card=knowledge.brief(theory),
        user_theory_name=theory.name,
        bot_theory_name=TUTOR,
        lesson_theory=theory.id,
        lesson_step=1,
        check_q=1,
    )
    _begin_step(state)
    _begin_check(state)
    state.pop("report_task", None)
    state["scorer"].reset()
    await state["debate"].set_solo(theory.id, theory.name, TUTOR)
    return {"status": "ok", "theory": theory.name, "steps": list(LESSON_STEPS)}, TRANSITION_IN_YAML


async def emit_step(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action: tell the client which step of the lesson this is."""
    state = flow_manager.state
    await state["debate"].set_lesson(state["lesson_step"], len(LESSON_STEPS), state["lesson_title"])


async def step_done(flow_manager: FlowManager):
    """The user has understood this step of the lesson and is ready for the next.

    Call this when they say the step is clear or ask to go on, without replying first.
    """
    state = flow_manager.state
    # The same guard as sparring: this is visit number `lesson_step` to the node,
    # so the tutor must have finished that many turns in it. Otherwise the user
    # spoke over the tutor before the step was taught, and it must not be skipped.
    if state["scorer"].heard("lesson", "bot") < state["lesson_step"]:
        return {
            "status": "teach_first",
            "instruction": "You have not taught this step yet. Teach it now.",
        }, TRANSITION_IN_YAML
    if state["lesson_step"] < len(LESSON_STEPS):
        state["lesson_step"] += 1
        _begin_step(state)
        return {
            "status": "more",
            "step": state["lesson_step"],
            "of": len(LESSON_STEPS),
            "title": state["lesson_title"],
        }, TRANSITION_IN_YAML
    state["check_q"] = 1
    _begin_check(state)
    return {"status": "done"}, TRANSITION_IN_YAML


async def emit_check(action: dict, flow_manager: FlowManager) -> None:
    """Pre-action: which check question this is, for the client; and on the first,
    a clean transcript for the judge. The question itself is already in state
    (see ``_begin_check``)."""
    state = flow_manager.state
    number = state["check_q"]
    if number == 1:
        # The lesson's turns were heard (so the tutor's could be counted) but they
        # are not the exam: the judge reads only the check's own transcript.
        state["scorer"].reset()
    await state["debate"].set_question(number, CHECK_QUESTIONS)


async def check_answered(flow_manager: FlowManager):
    """The user has answered the check question you just asked.

    Call this as soon as they have answered, without saying whether it was right.
    """
    state = flow_manager.state
    if state["scorer"].heard("check", "bot") < state["check_q"]:
        return {
            "status": "ask_first",
            "instruction": "You have not asked this question yet. Ask it now.",
        }, TRANSITION_IN_YAML
    state["scorer"].answer_complete("check", question=state["check_question"])
    if state["check_q"] < CHECK_QUESTIONS:
        state["check_q"] += 1
        _begin_check(state)
        return {
            "status": "more",
            "question": state["check_q"],
            "of": CHECK_QUESTIONS,
        }, TRANSITION_IN_YAML

    # The third answer. One decision, shared by any repeat; a failed one forgotten.
    if "report_task" not in state:
        state["report_task"] = asyncio.ensure_future(_report(flow_manager))
    try:
        return await state["report_task"], TRANSITION_IN_YAML
    except BaseException:
        state.pop("report_task", None)
        raise


def fallback_report(hits: list[dict]) -> str:
    """What to say when the judge cannot write the report."""
    if not hits:
        return "The judge could not score this check, so the bar stands alone."
    widest = max(hits, key=lambda hit: hit["damage"])
    return f"The question that showed the biggest gap was this. {widest['reason']}"


async def _report(flow_manager: FlowManager) -> dict:
    state = flow_manager.state
    debate, scorer = state["debate"], state["scorer"]

    scorer.close()
    await flow_manager.worker.queue_frames(
        [TTSSpeakFrame("Thank you. Let me see how much of it has landed.", append_to_context=False)]
    )
    await scorer.drain()

    grasp = debate.health["user"]
    try:
        report = await write_report(
            theory=state["user_theory_name"],
            health=grasp,
            steps=list(LESSON_STEPS),
            hits=list(debate.hits),
        )
    except JudgeError:
        report = fallback_report(debate.hits)
    await debate.set_verdict(report)

    got_it = debate.winner() == "user"
    state["report_text"] = (
        f"Grasp of {state['user_theory_name']}: {grasp} out of 100. "
        f"{'They have got it.' if got_it else 'Not yet.'} The report: {report}"
    )
    return {"status": "done", "grasp": grasp, "got_it": got_it}


async def spar_this(flow_manager: FlowManager):
    """Take the theory just learned into sparring: the examiner's five questions.

    Call only when the user asks to spar with, defend, or be questioned on this theory.
    """
    state = flow_manager.state
    theory = _lesson_theory(state)
    await state["debate"].set_mode("sparring")
    return await _seat_for_sparring(flow_manager, theory), TRANSITION_IN_YAML


async def debate_this(flow_manager: FlowManager):
    """Take the theory just learned into a debate against the house.

    Call only when the user asks to debate, fight, or argue with this theory.
    """
    state = flow_manager.state
    theory = _lesson_theory(state)
    debate = state["debate"]
    await debate.set_mode("debate")
    # The same moment a normal debate has, setup then the lock-in, so the client
    # shows the versus splash. The positions are set here rather than left to the
    # setup node's LLM, which asked the player's view again instead (playtest).
    await debate.set_stage("setup")
    result, _ = await set_positions(flow_manager, user_theory=theory.id, bot_theory=theory.rivals[0])
    return result, TRANSITION_IN_YAML


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
    state = flow_manager.state
    # The same guard as the other rounds: a "we won" before the house's closing
    # brought the verdict with neither closing scored (recorded session).
    scorer = state["scorer"]
    if scorer.heard("closing", "bot") == 0:
        return {
            "status": "closing_first",
            "instruction": (
                "You have not given your closing statement yet. Give it now and "
                "invite the user's, as this round's instructions describe."
            ),
        }, TRANSITION_IN_YAML
    if scorer.heard("closing", "user") == 0:
        return {
            "status": "closing_first",
            "instruction": (
                "The user has not given their closing statement yet. Invite it and wait."
            ),
        }, TRANSITION_IN_YAML
    # "Exactly once" is the LLM's promise, not a guarantee: a second call in the
    # same response, or a repeat, gets the first call's decision rather than a
    # second announcement, a second judge call, and a second verdict snapshot.
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

    scorer.round_complete("closing")
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
