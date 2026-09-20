from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TextFrame,
)
from pipecat.observers.base_observer import FramePushed
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection

from turns import TurnObserver


def push(*, source=None, destination, frame, direction=FrameDirection.DOWNSTREAM):
    return FramePushed(
        source=source if source is not None else object(),
        destination=destination,
        frame=frame,
        direction=direction,
        timestamp=0,
    )


def context_push(context, *, destination, speculation=False):
    return push(
        destination=destination,
        frame=LLMContextFrame(context=context, speculation=speculation),
    )


# --- User-turn behaviour (unchanged from B.6) ---------------------------------


async def test_reports_a_user_turn():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == [("user", "hello there")]


async def test_ignores_a_developer_last_context():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(
        messages=[
            {"role": "user", "content": "hello there"},
            {"role": "developer", "content": "move to the next node"},
        ]
    )

    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == []


async def test_ignores_a_tool_last_context():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(
        messages=[
            {"role": "user", "content": "hello there"},
            {"role": "tool", "content": "ok"},
        ]
    )

    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == []


async def test_ignores_a_context_frame_headed_to_a_different_destination():
    llm = object()
    other = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(context_push(context, destination=other))

    assert turns == []


async def test_ignores_a_speculative_context_frame():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(context_push(context, destination=llm, speculation=True))

    assert turns == []


async def test_ignores_non_context_frames_for_the_user_path():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    await observer.on_push_frame(push(destination=llm, frame=TextFrame(text="hi")))

    assert turns == []


async def test_joins_list_of_parts_content():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "hello"},
                    {"type": "image_url", "image_url": {"url": "http://x"}},
                    {"type": "text", "text": "there"},
                ],
            }
        ]
    )

    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == [("user", "hello there")]


async def test_ignores_blank_user_text():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(messages=[{"role": "user", "content": "   "}])

    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == []


async def test_does_not_report_the_same_user_turn_twice_but_reports_a_later_turn():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(context_push(context, destination=llm))
    await observer.on_push_frame(context_push(context, destination=llm))
    context.add_message({"role": "assistant", "content": "hi"})
    context.add_message({"role": "user", "content": "second turn"})
    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == [("user", "hello there"), ("user", "second turn")]


# --- Bot-turn behaviour (new in B.7) -------------------------------------------


def bot_response(llm, text_chunks):
    """The frame sequence for one LLM response, all pushed FROM llm."""
    frames = [LLMFullResponseStartFrame()]
    frames += [LLMTextFrame(chunk) for chunk in text_chunks]
    frames.append(LLMFullResponseEndFrame())
    return [push(source=llm, destination=object(), frame=frame) for frame in frames]


async def test_bot_text_accumulates_across_chunks_and_reports_on_bot_stopped_speaking():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, ["Hello ", "there."]):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert turns == [("bot", "Hello there.")]


async def test_nothing_reported_for_a_response_with_no_text():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, []):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert turns == []


async def test_a_tool_call_response_followed_by_a_spoken_response_reports_one_turn():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, []):  # the tool-call turn: no text
        await observer.on_push_frame(event)
    for event in bot_response(llm, ["Here is my answer."]):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert turns == [("bot", "Here is my answer.")]


async def test_text_from_a_response_interrupted_before_its_end_is_not_lost():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    # First response is cut off by an interruption before its End frame.
    await observer.on_push_frame(
        push(source=llm, destination=object(), frame=LLMFullResponseStartFrame())
    )
    await observer.on_push_frame(
        push(source=llm, destination=object(), frame=LLMTextFrame("This is the interrupted "))
    )
    for event in bot_response(llm, ["This is response two."]):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert len(turns) == 1
    by, text = turns[0]
    assert by == "bot"
    assert "This is the interrupted" in text
    assert "This is response two." in text


async def test_interrupted_partial_text_is_flushed_by_the_failsafe_before_the_user_turn():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    await observer.on_push_frame(
        push(source=llm, destination=object(), frame=LLMFullResponseStartFrame())
    )
    await observer.on_push_frame(
        push(source=llm, destination=object(), frame=LLMTextFrame("partial"))
    )
    context = LLMContext(messages=[{"role": "user", "content": "my reply"}])
    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == [("bot", "partial"), ("user", "my reply")]


async def test_three_completed_responses_fold_into_one_bot_turn():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, ["First."]):
        await observer.on_push_frame(event)
    for event in bot_response(llm, ["Second."]):
        await observer.on_push_frame(event)
    for event in bot_response(llm, ["Third."]):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert turns == [("bot", "First. Second. Third.")]


async def test_failsafe_flushes_the_pending_bot_turn_before_the_user_turn():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, ["My argument."]):
        await observer.on_push_frame(event)
    # No BotStoppedSpeakingFrame arrives -- the user turn triggers the flush.
    context = LLMContext(messages=[{"role": "user", "content": "my reply"}])
    await observer.on_push_frame(context_push(context, destination=llm))

    assert turns == [("bot", "My argument."), ("user", "my reply")]


async def test_no_double_report_when_bot_stopped_speaking_arrives_after_the_failsafe():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, ["My argument."]):
        await observer.on_push_frame(event)
    context = LLMContext(messages=[{"role": "user", "content": "my reply"}])
    await observer.on_push_frame(context_push(context, destination=llm))
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert turns == [("bot", "My argument."), ("user", "my reply")]


async def test_bot_frames_from_a_different_source_are_ignored():
    llm = object()
    other = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(other, ["Not the bot's own LLM."]):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))

    assert turns == []


async def test_bot_stopped_speaking_is_only_handled_once_for_its_sibling_pair():
    llm = object()
    turns = []
    observer = TurnObserver(llm, lambda by, text: turns.append((by, text)))

    for event in bot_response(llm, ["Said once."]):
        await observer.on_push_frame(event)

    downstream = BotStoppedSpeakingFrame()
    upstream = BotStoppedSpeakingFrame()
    downstream.broadcast_sibling_id = upstream.id
    upstream.broadcast_sibling_id = downstream.id

    await observer.on_push_frame(
        push(destination=object(), frame=downstream, direction=FrameDirection.DOWNSTREAM)
    )
    await observer.on_push_frame(
        push(destination=object(), frame=upstream, direction=FrameDirection.UPSTREAM)
    )
    # A later hop of the same downstream instance relaying further along.
    await observer.on_push_frame(
        push(destination=object(), frame=downstream, direction=FrameDirection.DOWNSTREAM)
    )

    assert turns == [("bot", "Said once.")]


async def test_a_raising_bot_callback_is_swallowed_and_logged():
    llm = object()

    def boom(by, text):
        raise RuntimeError("callback exploded")

    observer = TurnObserver(llm, boom)

    for event in bot_response(llm, ["Said."]):
        await observer.on_push_frame(event)
    await observer.on_push_frame(push(destination=object(), frame=BotStoppedSpeakingFrame()))


async def test_a_raising_user_callback_is_swallowed_and_logged():
    llm = object()

    def boom(by, text):
        raise RuntimeError("callback exploded")

    observer = TurnObserver(llm, boom)
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(context_push(context, destination=llm))
