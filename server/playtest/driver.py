"""Play scenarios against a real local bot over WebRTC, then check the timeline.

    ./armchair --playtest                       # every scenario, from the repo root
    ./armchair --playtest learn_happy           # one, by name
    uv run python -m playtest run [names or paths] [--real-speech]

The bot is started exactly as ./armchair starts it (loopback only, the origin
guard, the built arcade, the recorder), so a playtest tests what a player runs.

By default the bot hears with Moonshine and speaks with Kokoro, on this Mac, so a
run spends no Gradium credits; only the LLM's text tokens. --real-speech uses
server/.env's provider and prints the Gradium credits it cost.
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from aiortc import RTCPeerConnection, RTCSessionDescription

from dotenv import dotenv_values

from playtest import check, scenario, speech
from playtest.mic import ScriptedMic

SERVER = Path(__file__).parents[1]
RUNS = Path(__file__).parent / "runs"
SCENARIOS = Path(__file__).parent / "scenarios"
CLIENT_DIST = SERVER.parent / "client" / "dist"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Session:
    """The stand-in browser: a mic track out, the RTVI data channel in."""

    def __init__(self, base: str):
        self.base = base
        self.pc = RTCPeerConnection()
        self.mic = ScriptedMic()
        self.counts = {"bot_started": 0, "bot_stopped": 0}
        self.speaking = False
        self.last_change = time.monotonic()
        self.state: dict = {}
        self.changed = asyncio.Event()

    def _on_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        kind, data = msg.get("type"), msg.get("data") or {}
        if kind == "bot-started-speaking":
            self.counts["bot_started"] += 1
            self.speaking, self.last_change = True, time.monotonic()
        elif kind == "bot-stopped-speaking":
            self.counts["bot_stopped"] += 1
            self.speaking, self.last_change = False, time.monotonic()
        elif kind == "server-message" and data.get("type") == "debate_state":
            self.state = data
        self.changed.set()

    async def connect(self) -> None:
        # The shape proven against this bot on 2026-10-14: our audio out (the
        # transceiver also receives the bot's voice), and a receive-only video slot.
        self.pc.addTrack(self.mic)
        self.pc.addTransceiver("video", direction="recvonly")
        channel = self.pc.createDataChannel("rtvi")
        channel.on("message", self._on_message)
        channel.on("open", lambda: channel.send(json.dumps(
            {"label": "rtvi-ai", "type": "client-ready", "id": "1", "data": {"version": "1.0.0", "about": {"library": "playtest"}}})))

        @self.pc.on("track")
        def _(track):
            async def drain():
                while True:
                    try:
                        await track.recv()
                    except Exception:
                        return
            asyncio.ensure_future(drain())

        await self.pc.setLocalDescription(await self.pc.createOffer())
        async with httpx.AsyncClient() as http:
            r = await http.post(f"{self.base}/api/offer", json={"sdp": self.pc.localDescription.sdp, "type": "offer"}, timeout=30)
            r.raise_for_status()
            answer = r.json()
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))

    def _matches(self, want: dict, marks: dict) -> bool:
        for key, value in want.items():
            if key == "timeout":
                continue
            if key in ("bot_started", "bot_stopped"):
                if self.counts[key] - marks[key] < value:
                    return False
            elif key == "quiet":
                if self.speaking or time.monotonic() - self.last_change < value:
                    return False
            elif key in ("stage", "mode"):
                if self.state.get(key) != value:
                    return False
            elif key == "step":
                if (self.state.get("lesson") or {}).get("step") != value:
                    return False
            elif key == "question":
                if (self.state.get("question") or {}).get("number") != value:
                    return False
        return True

    async def wait(self, want: dict) -> None:
        marks = dict(self.counts)
        deadline = time.monotonic() + float(want.get("timeout", scenario.DEFAULT_TIMEOUT))
        while not self._matches(want, marks):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"timed out waiting for {want} (state: stage={self.state.get('stage')}, mode={self.state.get('mode')})")
            self.changed.clear()
            try:
                await asyncio.wait_for(self.changed.wait(), timeout=min(remaining, 1.0))
            except TimeoutError:
                pass

    async def say(self, text: str) -> None:
        self.mic.queue(speech.say(text))
        await self.mic.idle()

    async def close(self) -> None:
        await self.pc.close()


async def play(s: scenario.Scenario, base: str) -> None:
    session = Session(base)
    await session.connect()
    try:
        for step in s.steps:
            (kind, value), = step.items()
            print(f"    {kind}: {value}", flush=True)
            if kind == "wait":
                await session.wait(value)
            elif kind == "say":
                await session.say(value)
            elif kind == "say_after":
                await asyncio.sleep(float(value["seconds"]))
                await session.say(value["text"])
            elif kind == "silence":
                await asyncio.sleep(float(value))
        await asyncio.sleep(3)  # let the last reply land in the timeline
    finally:
        await session.close()


def gradium_credits() -> int | None:
    """Gradium's remaining credits, or None when there is no key or no answer."""
    key = os.environ.get("GRADIUM_API_KEY") or dotenv_values(SERVER / ".env").get("GRADIUM_API_KEY")
    if not key:
        return None
    try:
        r = httpx.get("https://api.gradium.ai/api/usages/credits", headers={"x-api-key": key}, timeout=10)
        return int(r.json()["remaining_credits"])
    except Exception:
        return None


def bot_command(port: int) -> list[str]:
    """The bot, started exactly as ./armchair starts it: loopback only, with the
    origin guard, serving the built arcade."""
    origin = f"http://127.0.0.1:{port}"
    return [
        "uv", "run", "bot.py", "--host", "127.0.0.1", "--port", str(port),
        "--allowed-origins", origin, f"http://localhost:{port}",
    ]


def bot_env(port: int, record_dir: Path, *, real_speech: bool, base: dict | None = None) -> dict:
    env = {
        **(os.environ if base is None else base),
        "ARMCHAIR_LOCAL": "1",
        "ARMCHAIR_ORIGIN": f"http://127.0.0.1:{port}",
        "ARMCHAIR_RECORD": str(record_dir),
        "ARMCHAIR_RECORD_KEEP": "0",
    }
    if not real_speech:
        # No credits: Moonshine and Kokoro on this Mac. ARMCHAIR_SPEECH_PROVIDER
        # is the one .env cannot override (bot.py loads .env with override=True).
        env["SPEECH_PROVIDER"] = "local"
        env["ARMCHAIR_SPEECH_PROVIDER"] = "local"
    return env


def speech_mismatch(header: dict, *, real_speech: bool) -> str | None:
    """A backstop: a session that did not run on local speech, unasked."""
    if real_speech or header.get("speech") == "local":
        return None
    return f"the bot ran on {header.get('speech')!r} speech, not local: credits may have been spent"


def stop_bot(process) -> None:
    """Stop a bot, and kill it if it ignores the request."""
    process.terminate()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    log = getattr(process, "armchair_log", None)
    if log:
        log.close()


def require_build() -> None:
    """Local mode serves the built arcade, so a run needs one."""
    if not (CLIENT_DIST / "index.html").is_file():
        sys.exit("no built arcade in client/dist: run ./armchair --playtest, which builds it, or npm run build")


def resolve(names: list[str]) -> list[Path]:
    """Scenario paths from names or paths; none given means every scenario."""
    if not names:
        return sorted(SCENARIOS.glob("*.yaml"))
    paths = []
    for name in names:
        p = Path(name)
        if p.is_dir():
            paths += sorted(p.glob("*.yaml"))
        elif p.suffix == ".yaml":
            paths.append(p)
        else:
            paths.append(SCENARIOS / f"{name}.yaml")
    return paths


def _start_bot(port: int, record_dir: Path, real_speech: bool) -> subprocess.Popen:
    log = (record_dir / "bot.log").open("w")
    process = subprocess.Popen(
        bot_command(port), cwd=SERVER, env=bot_env(port, record_dir, real_speech=real_speech),
        stdout=log, stderr=subprocess.STDOUT,
    )
    process.armchair_log = log
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"http://127.0.0.1:{port}/arcade/", timeout=1).status_code == 200:
                return process
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    stop_bot(process)
    raise RuntimeError("the bot did not start; see bot.log")


def run_one(path: Path, real_speech: bool = False) -> bool:
    s = scenario.load(path)
    run_dir = RUNS / time.strftime("%Y%m%d-%H%M%S") / s.name
    run_dir.mkdir(parents=True, exist_ok=True)
    port = _free_port()
    started = time.monotonic()
    print(f"▶ {s.name}  (port {port}, {run_dir})", flush=True)
    failures: list[str] = []
    bot = None
    try:
        bot = _start_bot(port, run_dir, real_speech)
        asyncio.run(play(s, f"http://127.0.0.1:{port}"))
    except Exception as e:  # a bot that did not start, a wait that timed out, a failed connection
        failures.append(f"play: {e}")
    finally:
        if bot is not None:
            stop_bot(bot)

    timelines = sorted(run_dir.glob("*.jsonl"))
    if not timelines:
        failures.append("no timeline was recorded")
        events, violations = [], []
    else:
        events = check.load(timelines[-1])
        header = next((e for e in events if e.get("kind") == "header"), {})
        mismatch = speech_mismatch(header, real_speech=real_speech)
        if mismatch:
            failures.append(mismatch)
        violations = check.check(events)
        failures += scenario.expectation_failures(s.expect, events, violations)
        for v in violations:
            print(f"    {v.t:7.1f}s  {v.severity:<5} {v.rule:<20} {v.message}")
    took = time.monotonic() - started
    if failures:
        print(f"✗ {s.name}  ({took:.0f} s)")
        for f in failures:
            print(f"    • {f}")
        tail = [e for e in events if e.get("kind") != "snapshot"][-10:]
        for e in tail:
            print(f"      {e.get('t', 0):7.1f}s {e.get('kind'):<12} {str(e.get('text') or e.get('name') or '')[:70]}")
    else:
        print(f"✓ {s.name}  ({took:.0f} s)")
    return not failures


def main(argv: list[str]) -> int:
    real_speech = "--real-speech" in argv
    argv = [a for a in argv if a != "--real-speech"]
    require_build()
    paths = resolve(argv)
    before = gradium_credits() if real_speech else None
    results = [run_one(p, real_speech) for p in paths]
    print(f"\n{sum(results)}/{len(results)} passed")
    if real_speech:
        after = gradium_credits()
        if before is not None and after is not None:
            print(f"Gradium credits used: {before - after:,} ({after:,} left)")
    return 0 if all(results) else 1
