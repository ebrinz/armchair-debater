from pipecat.frames.frames import LLMContextFrame, TextFrame
from pipecat.observers.base_observer import FramePushed
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection

from user_turns import UserTurnObserver


def push(context=None, *, destination, speculation=False, frame=None):
    """Build a FramePushed carrying either an explicit frame or an LLMContextFrame."""
    if frame is None:
        frame = LLMContextFrame(context=context, speculation=speculation)
    return FramePushed(
        source=object(),
        destination=destination,
        frame=frame,
        direction=FrameDirection.DOWNSTREAM,
        timestamp=0,
    )


async def test_reports_a_user_turn():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(push(context, destination=llm))

    assert turns == ["hello there"]


async def test_ignores_a_developer_last_context():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(
        messages=[
            {"role": "user", "content": "hello there"},
            {"role": "developer", "content": "move to the next node"},
        ]
    )

    await observer.on_push_frame(push(context, destination=llm))

    assert turns == []


async def test_ignores_a_tool_last_context():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(
        messages=[
            {"role": "user", "content": "hello there"},
            {"role": "tool", "content": "ok"},
        ]
    )

    await observer.on_push_frame(push(context, destination=llm))

    assert turns == []


async def test_ignores_a_frame_headed_to_a_different_destination():
    llm = object()
    other = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(push(context, destination=other))

    assert turns == []


async def test_ignores_a_speculative_frame():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(push(context, destination=llm, speculation=True))

    assert turns == []


async def test_ignores_non_context_frames():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)

    await observer.on_push_frame(push(destination=llm, frame=TextFrame(text="hi")))

    assert turns == []


async def test_joins_list_of_parts_content():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
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

    await observer.on_push_frame(push(context, destination=llm))

    assert turns == ["hello there"]


async def test_ignores_blank_text():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(messages=[{"role": "user", "content": "   "}])

    await observer.on_push_frame(push(context, destination=llm))

    assert turns == []


async def test_does_not_report_the_same_turn_twice_but_reports_a_later_turn():
    llm = object()
    turns = []
    observer = UserTurnObserver(llm, turns.append)
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(push(context, destination=llm))
    await observer.on_push_frame(push(context, destination=llm))
    context.add_message({"role": "assistant", "content": "hi"})
    context.add_message({"role": "user", "content": "second turn"})
    await observer.on_push_frame(push(context, destination=llm))

    assert turns == ["hello there", "second turn"]


async def test_a_raising_callback_is_swallowed_and_logged():
    llm = object()

    def boom(text):
        raise RuntimeError("callback exploded")

    observer = UserTurnObserver(llm, boom)
    context = LLMContext(messages=[{"role": "user", "content": "hello there"}])

    await observer.on_push_frame(push(context, destination=llm))
