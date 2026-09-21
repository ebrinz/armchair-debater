from pipecat.frames.frames import LLMConfigureOutputFrame, TextFrame
from pipecat.observers.base_observer import FramePushed
from pipecat.processors.frame_processor import FrameDirection

from skip_tts_sync import SkipTTSSync


def push(frame, *, source=None, destination=None):
    return FramePushed(
        source=source if source is not None else object(),
        destination=destination if destination is not None else object(),
        frame=frame,
        direction=FrameDirection.DOWNSTREAM,
        timestamp=0,
    )


class Rig:
    def __init__(self):
        self.rtvi = object()
        self.replayed = []
        self.sync = SkipTTSSync(self.rtvi, self.replay)

    async def replay(self, frame):
        self.replayed.append(frame)


async def test_a_setting_pushed_below_rtvi_is_replayed_from_the_top_once():
    rig = Rig()
    frame = LLMConfigureOutputFrame(skip_tts=True)

    # The eval transport pushes it from the transport input; the observer then
    # sees the same frame again at every hop on its way down the pipeline.
    for _ in range(4):
        await rig.sync.on_push_frame(push(frame))

    assert [f.skip_tts for f in rig.replayed] == [True]
    assert rig.replayed[0] is not frame


async def test_its_own_replay_is_never_replayed_again():
    rig = Rig()
    await rig.sync.on_push_frame(push(LLMConfigureOutputFrame(skip_tts=True)))
    (replay,) = rig.replayed

    # Whatever stands between the top of the pipeline and RTVI.
    await rig.sync.on_push_frame(push(replay))
    await rig.sync.on_push_frame(push(replay, destination=rig.rtvi))
    await rig.sync.on_push_frame(push(replay, source=rig.rtvi))

    assert rig.replayed == [replay]


async def test_a_setting_rtvi_has_seen_or_sent_is_left_alone():
    rig = Rig()

    await rig.sync.on_push_frame(push(LLMConfigureOutputFrame(skip_tts=False), source=rig.rtvi))
    await rig.sync.on_push_frame(push(LLMConfigureOutputFrame(skip_tts=True), destination=rig.rtvi))

    assert rig.replayed == []


async def test_other_frames_are_ignored():
    rig = Rig()

    await rig.sync.on_push_frame(push(TextFrame("hello")))

    assert rig.replayed == []
