# Playtest Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch gameplay hiccups before a person does: screen behaviour tests on the replay mode, a flight recorder in the bot with a rules checker over its timeline, and scripted voice playthroughs over real WebRTC.

**Architecture:** Three layers. The client's replay mode gains a pinned-frame and a fake-voice option so Playwright can assert on exact screens. The bot gains an opt-in recorder (`ARMCHAIR_RECORD`) that writes one JSON line per event; a Pipecat-free checker reads it against eleven rules, with the flow graph read from `flow.yaml`. A driver (`python -m playtest run`) starts a bot, plays synthesized speech through an `aiortc` client as its microphone, and checks the recorded timeline.

**Tech Stack:** Python 3.12, pipecat-ai 1.11, aiortc (already installed with pipecat's webrtc extra), PyYAML, pytest; React 19, Vite, vitest, `@playwright/test` 1.56 (matches the cached `chromium-1194`).

**Spec:** `docs/design/2026-10-14-playtest-harness-design.md`. Read it first.

## Global Constraints

- The voice pipeline in `bot.py` (transport, STT, LLM, TTS, aggregators, their order) does not change. The recorder is an observer and two callback wrappers, and is off unless `ARMCHAIR_RECORD` is set.
- `server/playtest/check.py` imports nothing from Pipecat.
- Recorder files hold transcripts: they stay on the machine. `./armchair` writes to `~/.armchair/sessions/` and keeps the latest 50.
- Speech cache: `server/playtest/.cache/`, git-ignored. Playthrough runs: `server/playtest/runs/`, git-ignored.
- **Credit budget (the user's instruction: "be careful not to burn too many voice pipeline tokens").** Playthroughs run with `SPEECH_PROVIDER=local` (Moonshine transcribes, Kokoro speaks, both on this Mac) and the player's lines are synthesized locally with Kokoro: zero Gradium credits. Only General Compute text tokens are spent (the bot's replies and the judge). `--real-speech` uses `server/.env`'s speech provider and prints Gradium's `remaining_credits` before and after; it is run at most once, for `learn_happy`, and only if the user asks. Re-run only the scenario that failed, never the whole directory, after a fix. No `silence` step longer than 15 s. At the start of Part 3, the Gradium balance was 58,525 of 145,000 credits.
- Nothing runs playthroughs automatically.
- `uv run` for Python from `server/`; `npm` from `client/`.
- Commit messages end with the attribution line the session's system reminder gives. Push `debate-mode` and fast-forward `master` at each Part's end.

## Review Focus

1. **A recording directory that does not exist, or a home path with `~`.** The recorder must create it and expand `~`. Task 5 pins this.
2. **A session that ends mid-turn** (the user closes the tab right after speaking). `answered` must not fire for a user turn within 12 s of the timeline's end. Task 4 pins this.
3. **A node re-entered under the same name** (`lesson` → `lesson`). The recorder notes only changes of name, so `legal-path` must not demand a node event per step. Task 4 pins this.
4. **A sample-rate mismatch between Kokoro (24 kHz float) and the microphone track (48 kHz s16).** Played unconverted, the player's lines arrive at double speed and garbled, and every scenario fails for a reason that is not the bot's. Task 7 pins the conversion.
5. **`?frame=` past the end of a fixture, or not a number.** The replay must fall back to the normal loop, not show a blank screen. Task 1 pins this.

---

# Part 1 — Screen behaviour tests (no server, no credits)

### Task 1: The replay mode can pin a frame and fake a voice

**Files:**
- Modify: `client/src/arcade/mock.ts`
- Modify: `client/src/arcade/ArcadeApp.tsx`
- Test: `client/src/arcade/__tests__/mock.test.ts` (create)

**Interfaces:**
- Produces: `mockFrame(search: string, length: number): number | null`; `mockTalk(search: string): 'bot' | 'user' | null`; `mockLevel(ms: number): number` (always in 0.2..0.9); `startMockReplay(kind: Mode, frame?: number | null)`.

- [ ] **Step 1: Write the failing tests**

Create `client/src/arcade/__tests__/mock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mockFrame, mockLevel, mockTalk } from '../mock';

describe('pinning a replay frame', () => {
  it('reads a frame index that exists', () => {
    expect(mockFrame('?mock=learn&frame=3', 10)).toBe(3);
    expect(mockFrame('?mock=learn&frame=0', 10)).toBe(0);
  });

  it('ignores a frame that is missing, past the end, or not a number', () => {
    expect(mockFrame('?mock=learn', 10)).toBeNull();
    expect(mockFrame('?mock=learn&frame=10', 10)).toBeNull();
    expect(mockFrame('?mock=learn&frame=-1', 10)).toBeNull();
    expect(mockFrame('?mock=learn&frame=two', 10)).toBeNull();
  });
});

describe('a fake voice', () => {
  it('names the side that talks', () => {
    expect(mockTalk('?mock&talk=bot')).toBe('bot');
    expect(mockTalk('?mock&talk=user')).toBe('user');
    expect(mockTalk('?mock&talk=nobody')).toBeNull();
    expect(mockTalk('?mock')).toBeNull();
  });

  it('never falls silent, so a mouth that should move always can', () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const level = mockLevel(ms);
      expect(level).toBeGreaterThanOrEqual(0.2);
      expect(level).toBeLessThanOrEqual(0.9);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd client && npx vitest run src/arcade/__tests__/mock.test.ts`
Expected: FAIL, `mockFrame` is not exported.

- [ ] **Step 3: Implement**

In `client/src/arcade/mock.ts`, add after `mockKind`:

```ts
/** `?frame=n` pins fixture frame n, for tests that must land on one exact screen. */
export const mockFrame = (search: string, length: number): number | null => {
  const raw = new URLSearchParams(search).get('frame');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const frame = Number(raw);
  return frame < length ? frame : null;
};

/** `?talk=bot` or `?talk=user` feeds that side a fake voice, so its mouth moves. */
export const mockTalk = (search: string): 'bot' | 'user' | null => {
  const value = new URLSearchParams(search).get('talk');
  return value === 'bot' || value === 'user' ? value : null;
};

/** The fake voice's level at a moment: a slow wobble that never reaches silence. */
export const mockLevel = (ms: number): number => 0.55 + 0.35 * Math.sin(ms / 180);

/** How many frames a mode's replay has, for validating `?frame=`. */
export const mockLength = (kind: Mode): number => FIXTURES[kind].length;
```

Change `startMockReplay`'s signature and add the pinned branch at its top:

```ts
export const startMockReplay = (kind: Mode = 'debate', frame: number | null = null): (() => void) => {
  const { receive, clear } = useArcadeStore.getState();
  const snapshots = FIXTURES[kind];
  if (frame !== null) {
    clear();
    receive(cards);
    receive(snapshots[frame]);
    return () => {};
  }
```

(the rest of the function is unchanged).

In `client/src/arcade/ArcadeApp.tsx`, import `mockFrame, mockLength, mockLevel, mockTalk` alongside `mockKind, startMockReplay`. In `ArcadeApp`, after the `kind` memo:

```tsx
  const frame = useMemo(
    () => mockFrame(window.location.search, mockLength(kind)),
    [kind]
  );
  const talk = useMemo(() => mockTalk(window.location.search), []);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!mock || !talk) return;
    const timer = window.setInterval(() => setNow(performance.now()), 50);
    return () => window.clearInterval(timer);
  }, [mock, talk]);
  const fakeLevel = mock && talk ? mockLevel(now) : 0;
```

Change the replay effect to pass the frame (`return startMockReplay(kind, frame);`, with `frame` in its dependency list), and in the `if (mock)` branch pass the levels to `ArcadeView`:

```tsx
        userLevel={talk === 'user' ? fakeLevel : 0}
        botLevel={talk === 'bot' ? fakeLevel : 0}
```

- [ ] **Step 4: Run the client checks**

Run: `cd client && npm test --silent && npm run lint && npm run build`
Expected: all pass; 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/arcade/mock.ts client/src/arcade/ArcadeApp.tsx client/src/arcade/__tests__/mock.test.ts
git commit -m "feat(client): the replay can pin a frame and give either side a fake voice"
```

---

### Task 2: Playwright, and the speaking chair's mouth on every screen

**Files:**
- Modify: `client/package.json` (dev dependency, `e2e` script)
- Create: `client/playwright.config.ts`
- Create: `client/e2e/frames.ts`, `client/e2e/mouths.spec.ts`
- Modify: `client/src/arcade/screens/LessonScreen.tsx`, `client/src/arcade/screens/FightScreen.tsx`, `client/src/arcade/screens/DecisionScreen.tsx`, `client/src/arcade/ArcadeApp.tsx`
- Modify: `client/eslint.config.js` only if lint rejects `e2e/`

**Interfaces:**
- Consumes: `?mock=<mode>&frame=<n>&talk=<side>` from Task 1.
- Produces: `frameIndex(mode, predicate)` in `client/e2e/frames.ts`; `LessonScreen` prop `botLevel?: number`; `DecisionScreen` props `userLevel?`, `botLevel?`.

- [ ] **Step 1: Install Playwright's test runner**

```bash
cd client && npm i -D @playwright/test@1.56 && npx playwright --version
```

Expected: `Version 1.56.x`. The browsers are already cached (`chromium-1194`); do not run `playwright install`.

Add to `package.json` scripts: `"e2e": "playwright test"`.

Create `client/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

// Screen behaviour tests against the replay mode: no bot, no credits.
export default defineConfig({
  testDir: 'e2e',
  timeout: 20_000,
  use: { baseURL: 'http://127.0.0.1:5199', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
  },
});
```

- [ ] **Step 2: Write the frame finder and the failing mouth tests**

Create `client/e2e/frames.ts`:

```ts
import debate from '../src/arcade/fixtures/debate-state.json';
import learn from '../src/arcade/fixtures/learn-state.json';
import sparring from '../src/arcade/fixtures/sparring-state.json';

type Frame = (typeof learn)[number] & Record<string, unknown>;
const FIXTURES = { debate, learn, sparring } as unknown as Record<string, Frame[]>;

/** The index of the first fixture frame in `mode` that satisfies `pick`. */
export const frameIndex = (mode: 'debate' | 'learn' | 'sparring', pick: (f: Frame) => boolean): number => {
  const index = FIXTURES[mode].findIndex(pick);
  if (index < 0) throw new Error(`no ${mode} frame matches`);
  return index;
};
```

Create `client/e2e/mouths.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { frameIndex } from './frames';

// Every screen where a character speaks must move that character's mouth.
const SPEAKING_SCREENS = [
  { name: 'the lesson tutor', mode: 'learn', pick: (f) => f.stage === 'lesson' },
  { name: 'the check', mode: 'learn', pick: (f) => f.stage === 'check' },
  { name: 'the learn report', mode: 'learn', pick: (f) => f.stage === 'verdict' },
  { name: 'a debate round', mode: 'debate', pick: (f) => f.stage === 'rebuttal' },
  { name: 'the debate verdict', mode: 'debate', pick: (f) => f.stage === 'verdict' },
  { name: 'the sparring finding', mode: 'sparring', pick: (f) => f.stage === 'verdict' },
] as const;

for (const screen of SPEAKING_SCREENS) {
  test(`the bot's mouth moves on ${screen.name}`, async ({ page }) => {
    const frame = frameIndex(screen.mode, screen.pick as never);
    await page.goto(`/?mock=${screen.mode}&frame=${frame}&talk=bot`);
    await expect(page.locator('.armchair--bot.armchair--talking')).toBeVisible();
  });

  test(`the bot is silent on ${screen.name} when nobody talks`, async ({ page }) => {
    const frame = frameIndex(screen.mode, screen.pick as never);
    await page.goto(`/?mock=${screen.mode}&frame=${frame}`);
    await expect(page.locator('.armchair--bot')).toBeVisible();
    await expect(page.locator('.armchair--talking')).toHaveCount(0);
  });
}

test("the player's mouth moves in a debate round", async ({ page }) => {
  const frame = frameIndex('debate', (f) => f.stage === 'rebuttal');
  await page.goto(`/?mock=debate&frame=${frame}&talk=user`);
  await expect(page.locator('.armchair--user.armchair--talking')).toBeVisible();
});
```

- [ ] **Step 3: Run them to see the lesson and verdict cases fail**

Run: `cd client && npm run e2e`
Expected: the lesson tutor, learn report, debate verdict, and sparring finding "mouth moves" tests FAIL (the lesson screen passes no level; the decision screen's frozen HUD zeroes it). The rest PASS.

- [ ] **Step 4: Pass the bot's level to every speaking screen**

`LessonScreen.tsx`: add `botLevel?: number` to `LessonScreenProps`, destructure it with default `0`, and change the tutor's `level={0}` to `level={botLevel}`.

`FightScreen.tsx`: change

```ts
  const level = { user: frozen ? 0 : userLevel, bot: frozen ? 0 : botLevel };
```

to

```ts
  // The decision screen freezes the fight, but the verdict, finding and report
  // are read aloud, so the speaker's mouth still follows the voice.
  const level = { user: userLevel, bot: botLevel };
```

`DecisionScreen.tsx`: add `userLevel?: number; botLevel?: number;` to its props (default `0`), and pass `userLevel={userLevel} botLevel={botLevel}` to its `<FightScreen ... frozen ...>`.

`ArcadeApp.tsx`: pass `botLevel={botLevel}` to `<LessonScreen>` and `userLevel={userLevel} botLevel={botLevel}` to `<DecisionScreen>`.

- [ ] **Step 5: Run every client check**

Run: `cd client && npm run e2e && npm test --silent && npm run lint && npm run build`
Expected: all 13 e2e tests pass; unit, lint, build pass.

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/playwright.config.ts client/e2e client/src/arcade
git commit -m "fix(client): the tutor's mouth moves in the lesson, and every speaker's on the decision screen; Playwright pins it"
```

---

### Task 3: Plates and the learn report's hand-off buttons

**Files:**
- Create: `client/e2e/screens.spec.ts`

**Interfaces:**
- Consumes: `frameIndex` (Task 2).

- [ ] **Step 1: Write the tests**

Create `client/e2e/screens.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { frameIndex } from './frames';

const PLATES = [
  { mode: 'learn', pick: (f) => (f.lesson as { step: number } | null)?.step === 2, title: 'STEP 2', sub: 'THE TERMS' },
  { mode: 'learn', pick: (f) => (f.question as { number: number } | null)?.number === 3, title: 'CHECK 3', sub: 'OF 3' },
  { mode: 'sparring', pick: (f) => (f.question as { number: number } | null)?.number === 2, title: 'QUESTION 2', sub: 'OF 5' },
  { mode: 'debate', pick: (f) => f.stage === 'crossexam', title: 'ROUND 3', sub: 'CROSS-EXAMINATION' },
] as const;

for (const plate of PLATES) {
  test(`the plate reads ${plate.title} ${plate.sub}`, async ({ page }) => {
    await page.goto(`/?mock=${plate.mode}&frame=${frameIndex(plate.mode, plate.pick as never)}`);
    await expect(page.locator('.round-plate__title')).toHaveText(plate.title);
    await expect(page.locator('.round-plate__stage')).toHaveText(plate.sub);
  });
}

test('the learn report offers the next rungs, and a click only asks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the whole finish at once
  const said: string[] = [];
  page.on('console', (m) => m.type() === 'info' && said.push(m.text()));
  await page.goto(`/?mock=learn&frame=${frameIndex('learn', (f) => f.stage === 'verdict')}`);

  await expect(page.getByText("YOU'VE GOT IT")).toBeVisible();
  await page.getByRole('button', { name: 'SPAR WITH IT' }).click();
  expect(said).toContain('Let me spar with it: question me on this theory.');
  // The screen is the server's to change; a click alone leaves the report up.
  await expect(page.getByText('THE REPORT')).toBeVisible();

  await page.getByRole('button', { name: 'DEBATE WITH IT' }).click();
  expect(said).toContain('Let me debate with it.');
});
```

- [ ] **Step 2: Run them**

Run: `cd client && npm run e2e`
Expected: all pass. If a plate test fails, the failure is a real bug in `plateFor` or the fixture: fix it, do not loosen the test.

- [ ] **Step 3: Commit and push (milestone: Part 1)**

```bash
git add client/e2e/screens.spec.ts
git commit -m "test(client): plates for each mode's rounds, and the learn report's hand-offs"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```

---

# Part 2 — The flight recorder and the rules checker

### Task 4: The rules checker

**Files:**
- Create: `server/playtest/__init__.py` (empty), `server/playtest/check.py`
- Test: `server/tests/test_playtest_check.py`

**Interfaces:**
- Produces: `Violation(rule: str, severity: str, t: float, message: str)`; `load(path) -> list[dict]`; `flow_graph(path=FLOW_PATH) -> Graph` with `.edges: dict[str, set[str]]`, `.stages: dict[str, str]`, `.initial: str`; `check(events: list[dict], graph: Graph | None = None) -> list[Violation]`; `errors(violations) -> list[Violation]`.
- Timeline event kinds: `header`, `node`, `snapshot`, `user_started`, `user_stopped`, `user_text`, `bot_started`, `bot_stopped`, `bot_text`, `tool`, `error`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_playtest_check.py`:

```python
from playtest import check
from playtest.check import Violation

G = check.flow_graph()


def snap(t, stage, mode=None, *, lesson=None, question=None, verdict=None):
    state = {"stage": stage, "mode": mode, "lesson": lesson, "question": question, "verdict": verdict}
    return {"t": t, "kind": "snapshot", "state": state}


def ev(t, kind, **fields):
    return {"t": t, "kind": kind, **fields}


def rules(events):
    return {v.rule for v in check.check(events, G)}


def test_the_graph_is_read_from_flow_yaml():
    assert G.initial == "mode_select"
    assert "tutor_setup" in G.edges["mode_select"]
    assert G.edges["lesson"] >= {"lesson", "check"}
    assert G.stages["lesson"] == "lesson" and G.stages["lesson_report"] == "verdict"
    assert "crossexam_answer" not in G.stages


def test_a_clean_lesson_passes():
    events = [
        ev(0, "node", name="mode_select"), snap(0.1, "mode"),
        ev(1, "bot_started"), ev(1.1, "bot_text", text="Welcome."), ev(3, "bot_stopped"),
        ev(4, "user_started"), ev(5, "user_stopped"), ev(5.1, "user_text", text="Teach me GWT."),
        ev(6, "tool", name="choose_mode", args={"mode": "learn"}, status="learn"),
        ev(6.1, "node", name="tutor_setup"), snap(6.2, "setup", "learn"),
        ev(7, "tool", name="choose_lesson", args={"theory_id": "gwt"}, status="ok"),
        ev(7.1, "node", name="lesson"), snap(7.2, "lesson", "learn", lesson={"step": 1, "of": 4, "title": "The idea"}),
        ev(8, "bot_started"), ev(8.1, "bot_text", text="The idea is..."), ev(12, "bot_stopped"),
        ev(13, "user_started"), ev(14, "user_stopped"), ev(14.1, "user_text", text="Go on."),
        ev(15, "tool", name="step_done", args={}, status="more"),
        snap(15.1, "lesson", "learn", lesson={"step": 2, "of": 4, "title": "The terms"}),
        ev(16, "bot_started"), ev(16.1, "bot_text", text="The terms..."), ev(20, "bot_stopped"),
    ]
    assert check.check(events, G) == []


def test_an_illegal_jump_between_nodes():
    events = [ev(0, "node", name="mode_select"), ev(1, "node", name="closing")]
    assert "legal-path" in rules(events)


def test_the_first_node_must_be_the_front_door():
    assert "legal-path" in rules([ev(0, "node", name="lesson")])


def test_a_node_reentered_under_its_own_name_is_not_a_jump():
    events = [ev(0, "node", name="mode_select"), ev(1, "node", name="tutor_setup"),
              ev(2, "node", name="lesson"), snap(2.1, "lesson", "learn")]
    assert "legal-path" not in rules(events)


def test_a_node_whose_stage_never_reaches_the_screen():
    events = [ev(0, "node", name="mode_select"), snap(0.1, "mode"), ev(1, "node", name="tutor_setup")]
    assert "stage-follows-node" in rules(events)


def test_a_skipped_lesson_step_and_a_skipped_question():
    events = [snap(1, "lesson", lesson={"step": 1}), snap(2, "lesson", lesson={"step": 3})]
    assert "steps-in-order" in rules(events)
    events = [snap(1, "check", question={"number": 1}), snap(2, "check", question={"number": 3})]
    assert "steps-in-order" in rules(events)


def test_a_repeat_or_a_new_lesson_is_in_order():
    events = [snap(1, "lesson", lesson={"step": 2}), snap(2, "lesson", lesson={"step": 2}),
              snap(3, "lesson", lesson={"step": 1})]
    assert "steps-in-order" not in rules(events)


def test_a_user_turn_left_unanswered():
    # A reply that comes 20 s later is too late; the user speaking again first is not a miss.
    assert "answered" in rules([ev(0, "user_text", text="Hello?"), ev(20, "bot_started")])
    assert "answered" in rules([ev(0, "user_text", text="Hello?"), ev(20, "snapshot", state={})])
    assert "answered" not in rules([ev(0, "user_text", text="Hello?"), ev(20, "user_started")])


def test_a_turn_at_the_very_end_of_a_session_is_not_counted_as_unanswered():
    assert "answered" not in rules([ev(0, "bot_text", text="Hi."), ev(5, "user_text", text="Bye.")])


def test_two_replies_to_one_turn():
    events = [ev(0, "user_text", text="Hi."), ev(1, "bot_text", text="One."), ev(2, "bot_text", text="Two.")]
    found = [v for v in check.check(events, G) if v.rule == "no-double-reply"]
    assert found and found[0].severity == "warn"


def test_the_bot_keeps_talking_over_a_barge_in():
    events = [ev(0, "bot_started"), ev(2, "user_started"), ev(5, "bot_stopped")]
    assert "barge-in" in rules(events)
    events = [ev(0, "bot_started"), ev(2, "user_started"), ev(2.8, "bot_stopped")]
    assert "barge-in" not in rules(events)


def test_a_score_spoken_before_the_verdict():
    events = [snap(0, "lesson"), ev(1, "bot_text", text="Your grasp is seventy out of one hundred.")]
    assert "no-early-score" in rules(events)
    events = [snap(0, "verdict"), ev(1, "bot_text", text="Your grasp is seventy out of one hundred.")]
    assert "no-early-score" not in rules(events)
    events = [snap(0, "lesson"), ev(1, "bot_text", text="Grasp of this idea comes with practice.")]
    assert "no-early-score" not in rules(events)


def test_a_won_verdict_carried_into_another_mode():
    won = {"winner": "user", "rationale": "r"}
    events = [snap(0, "verdict", "learn", verdict=won), snap(1, "verdict", "sparring", verdict=won)]
    assert "earned-rung" in rules(events)
    assert "earned-rung" in rules([snap(0, "lesson", "learn", verdict=won)])
    assert "earned-rung" not in rules([snap(0, "verdict", "learn", verdict=won)])


def test_guards_errors_and_silence_are_warnings():
    events = [ev(0, "tool", name="step_done", args={}, status="teach_first"),
              ev(1, "error", message="boom"), ev(2, "user_text", text="a"),
              ev(2.5, "bot_text", text="b"), ev(40, "user_text", text="c"), ev(41, "bot_text", text="d")]
    found = {v.rule: v.severity for v in check.check(events, G)}
    assert found["guard-fired"] == found["errors"] == found["long-silence"] == "warn"
    assert check.errors(check.check(events, G)) == []


def test_violations_come_back_in_time_order():
    events = [ev(0, "node", name="lesson"), ev(5, "error", message="x")]
    times = [v.t for v in check.check(events, G)]
    assert times == sorted(times)


def test_load_skips_blank_lines_and_keeps_the_header(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text('{"t": 0, "kind": "header", "session": "abc"}\n\n{"t": 1, "kind": "bot_started"}\n')
    events = check.load(path)
    assert [e["kind"] for e in events] == ["header", "bot_started"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && uv run pytest tests/test_playtest_check.py -q`
Expected: collection error, `No module named 'playtest'`.

- [ ] **Step 3: Implement**

Create `server/playtest/__init__.py` empty. Create `server/playtest/check.py`:

```python
"""Rules for a recorded session timeline (see recorder.py and the playtest spec).

A timeline is a list of events, one per line of a recorder file, each with a
time ``t`` in seconds and a ``kind``. ``check`` returns every rule the timeline
breaks. No Pipecat imports: this reads JSON and flow.yaml, nothing else.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

FLOW_PATH = Path(__file__).parents[1] / "flow.yaml"

ANSWER_WITHIN = 12.0
BARGE_IN_WITHIN = 1.5
STAGE_WITHIN = 1.0
SILENCE_WARN = 30.0
GUARDS = {"teach_first", "ask_first", "answer_first"}

_NUMBER_WORDS = (
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|"
    "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred"
)
SCORE_TALK = re.compile(
    rf"\bout of (?:one )?(?:hundred|100)\b"
    rf"|\b(?:score|health|grasp|integrity)\b[^.]{{0,25}}\b(?:\d+|{_NUMBER_WORDS})\b",
    re.IGNORECASE,
)
ACTIVITY = {"user_started", "user_text", "bot_started", "bot_text"}


@dataclass(frozen=True)
class Violation:
    rule: str
    severity: str  # "error" or "warn"
    t: float
    message: str


@dataclass(frozen=True)
class Graph:
    edges: dict[str, set[str]] = field(default_factory=dict)
    stages: dict[str, str] = field(default_factory=dict)
    initial: str = ""


def load(path) -> list[dict]:
    """A recorder file as a list of events."""
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def flow_graph(path: Path = FLOW_PATH) -> Graph:
    """Where each node can lead, and the stage each node shows, from flow.yaml."""
    config = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    edges: dict[str, set[str]] = {}
    stages: dict[str, str] = {}
    for name, node in config["nodes"].items():
        targets: set[str] = set()
        for function in node.get("functions") or []:
            target = function.get("transition_to")
            if isinstance(target, str):
                targets.add(target)
            elif isinstance(target, dict):
                targets.update(target.get("cases", {}).values())
        edges[name] = targets
        for action in node.get("pre_actions") or []:
            if action.get("type") == "emit_stage":
                stages[name] = action["stage"]
    return Graph(edges=edges, stages=stages, initial=config["initial_node"])


def errors(violations: list[Violation]) -> list[Violation]:
    return [v for v in violations if v.severity == "error"]


def _of(events, kind):
    return [e for e in events if e["kind"] == kind]


def _legal_path(events, graph):
    out, previous = [], None
    for e in _of(events, "node"):
        name = e["name"]
        if name not in graph.edges:
            out.append(Violation("legal-path", "error", e["t"], f"unknown node {name!r}"))
        elif previous is None and name != graph.initial:
            out.append(Violation("legal-path", "error", e["t"], f"began at {name!r}, not {graph.initial!r}"))
        elif previous is not None and name != previous and name not in graph.edges.get(previous, set()):
            out.append(Violation("legal-path", "error", e["t"], f"{previous!r} has no way to {name!r}"))
        previous = name
    return out


def _stage_follows_node(events, graph):
    out = []
    snapshots = _of(events, "snapshot")
    for e in _of(events, "node"):
        stage = graph.stages.get(e["name"])
        if stage is None:
            continue
        if not any(s["state"].get("stage") == stage and abs(s["t"] - e["t"]) <= STAGE_WITHIN for s in snapshots):
            out.append(Violation("stage-follows-node", "error", e["t"],
                                 f"entered {e['name']!r} but the screen never showed stage {stage!r}"))
    return out


def _steps_in_order(events):
    out = []
    for key, counter in (("lesson", "step"), ("question", "number")):
        previous = None
        for s in _of(events, "snapshot"):
            value = (s["state"].get(key) or {}).get(counter)
            if value is None:
                continue
            if previous is not None and value not in (previous, previous + 1, 1):
                out.append(Violation("steps-in-order", "error", s["t"], f"{key} {counter} went {previous} → {value}"))
            previous = value
    return out


def _answered(events):
    out = []
    end = events[-1]["t"] if events else 0.0
    for i, e in enumerate(events):
        if e["kind"] != "user_text" or end - e["t"] < ANSWER_WITHIN:
            continue
        for later in events[i + 1:]:
            if later["kind"] in ("bot_started", "bot_text", "user_started", "user_text"):
                if later["kind"] in ("bot_started", "bot_text") and later["t"] - e["t"] > ANSWER_WITHIN:
                    out.append(Violation("answered", "error", e["t"], f"no reply to {e['text']!r} for {later['t'] - e['t']:.0f} s"))
                break
        else:
            out.append(Violation("answered", "error", e["t"], f"no reply to {e['text']!r}"))
    return out


def _no_double_reply(events):
    out, replies = [], 0
    for e in events:
        if e["kind"] == "user_text":
            replies = 0
        elif e["kind"] == "bot_text":
            replies += 1
            if replies == 2:
                out.append(Violation("no-double-reply", "warn", e["t"], "a second reply before the user spoke again"))
    return out


def _barge_in(events):
    out, speaking = [], False
    for i, e in enumerate(events):
        if e["kind"] == "bot_started":
            speaking = True
        elif e["kind"] == "bot_stopped":
            speaking = False
        elif e["kind"] == "user_started" and speaking:
            stopped = next((x for x in events[i + 1:] if x["kind"] == "bot_stopped"), None)
            if stopped is None or stopped["t"] - e["t"] > BARGE_IN_WITHIN:
                out.append(Violation("barge-in", "error", e["t"], "the bot kept talking over the user"))
    return out


def _no_early_score(events):
    out, stage = [], None
    for e in events:
        if e["kind"] == "snapshot":
            stage = e["state"].get("stage")
        elif e["kind"] == "bot_text" and stage != "verdict" and SCORE_TALK.search(e["text"] or ""):
            out.append(Violation("no-early-score", "error", e["t"], f"a score before the verdict: {e['text'][:80]!r}"))
    return out


def _earned_rung(events):
    out, previous = [], None
    for s in _of(events, "snapshot"):
        state = s["state"]
        if (state.get("verdict") or {}).get("winner") == "user":
            if state.get("stage") != "verdict":
                out.append(Violation("earned-rung", "error", s["t"], f"a won verdict at stage {state.get('stage')!r}"))
            elif previous is not None and previous.get("mode") != state.get("mode"):
                out.append(Violation("earned-rung", "error", s["t"],
                                     f"a won verdict carried from {previous.get('mode')!r} into {state.get('mode')!r}"))
        previous = state
    return out


def _warnings(events):
    out = []
    for e in events:
        if e["kind"] == "tool" and e.get("status") in GUARDS:
            out.append(Violation("guard-fired", "warn", e["t"], f"{e['name']} answered {e['status']}"))
        elif e["kind"] == "error":
            out.append(Violation("errors", "warn", e["t"], e.get("message", "")[:120]))
    active = [e for e in events if e["kind"] in ACTIVITY]
    for a, b in zip(active, active[1:]):
        if b["t"] - a["t"] > SILENCE_WARN:
            out.append(Violation("long-silence", "warn", a["t"], f"nobody spoke for {b['t'] - a['t']:.0f} s"))
    return out


def check(events: list[dict], graph: Graph | None = None) -> list[Violation]:
    graph = graph or flow_graph()
    events = [e for e in events if e.get("kind") != "header"]
    found = [
        *_legal_path(events, graph),
        *_stage_follows_node(events, graph),
        *_steps_in_order(events),
        *_answered(events),
        *_no_double_reply(events),
        *_barge_in(events),
        *_no_early_score(events),
        *_earned_rung(events),
        *_warnings(events),
    ]
    return sorted(found, key=lambda v: v.t)
```

- [ ] **Step 4: Run the tests**

Run: `cd server && uv run pytest tests/test_playtest_check.py -q`
Expected: PASS. If `test_a_clean_lesson_passes` reports a violation, the rule is wrong for a clean session: fix the rule.

- [ ] **Step 5: Commit**

```bash
git add server/playtest/__init__.py server/playtest/check.py server/tests/test_playtest_check.py
git commit -m "feat(playtest): a rules checker for recorded session timelines"
```

---

### Task 5: The flight recorder, wired into the bot

**Files:**
- Create: `server/recorder.py`
- Modify: `server/bot.py`
- Test: `server/tests/test_recorder.py`

**Interfaces:**
- Consumes: the event kinds in Task 4.
- Produces: `Recorder(directory: Path, *, header: dict, keep: int = 50, clock=time.monotonic)` with `.path`, `.event(kind, **fields)`, `.snapshot(state)`, `.turn(by, text)`, `.close()`; `RecorderObserver(recorder, current_node: Callable[[], str | None])`; `bot._open_recorder(runner_args) -> Recorder | None`. Env: `ARMCHAIR_RECORD` (directory), `ARMCHAIR_RECORD_KEEP` (default 50).

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_recorder.py`:

```python
import json
from types import SimpleNamespace

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    FunctionCallResultFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)

from pathlib import Path

import bot
from recorder import Recorder, RecorderObserver


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_the_recorder_writes_a_header_and_timed_events(tmp_path):
    clock = Clock()
    rec = Recorder(tmp_path / "sessions", header={"session": "abc123"}, clock=clock)
    clock.now = 101.5
    rec.snapshot({"stage": "mode"})
    rec.turn("user", "Hello.")
    rec.turn("bot", "Hi.")
    rec.close()

    events = lines(rec.path)
    assert events[0]["kind"] == "header" and events[0]["session"] == "abc123" and events[0]["t"] == 0
    assert events[1] == {"t": 1.5, "kind": "snapshot", "state": {"stage": "mode"}}
    assert [e["kind"] for e in events[2:]] == ["user_text", "bot_text"]


def test_the_recorder_creates_and_expands_its_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    rec = Recorder(Path("~/deep/sessions"), header={})
    assert rec.path.parent == tmp_path / "deep" / "sessions" and rec.path.exists()


def test_the_recorder_keeps_only_the_latest_sessions(tmp_path):
    for i in range(5):
        (tmp_path / f"2026010{i}-000000-x.jsonl").write_text("{}\n")
    Recorder(tmp_path, header={"session": "new"}, keep=3)
    assert len(list(tmp_path.glob("*.jsonl"))) == 3


async def push(observer, frame):
    await observer.on_push_frame(SimpleNamespace(frame=frame))


async def test_the_observer_records_speech_tools_errors_and_node_changes(tmp_path):
    rec = Recorder(tmp_path, header={})
    node = {"name": "mode_select"}
    observer = RecorderObserver(rec, current_node=lambda: node["name"])

    started = UserStartedSpeakingFrame()
    await push(observer, started)
    await push(observer, started)  # the same frame passing the next processor
    await push(observer, UserStoppedSpeakingFrame())
    node["name"] = "tutor_setup"
    await push(observer, BotStartedSpeakingFrame())
    await push(observer, BotStoppedSpeakingFrame())
    await push(observer, FunctionCallResultFrame(
        function_name="step_done", tool_call_id="1", arguments={}, result={"status": "more"}))
    await push(observer, ErrorFrame(error="boom"))
    rec.close()

    kinds = [(e["kind"], e.get("name") or e.get("status") or e.get("message")) for e in lines(rec.path)[1:]]
    assert kinds == [
        ("node", "mode_select"),
        ("user_started", None),
        ("user_stopped", None),
        ("node", "tutor_setup"),
        ("bot_started", None),
        ("bot_stopped", None),
        ("tool", "step_done"),
        ("error", "boom"),
    ]
    tool = [e for e in lines(rec.path) if e["kind"] == "tool"][0]
    assert tool["status"] == "more" and tool["args"] == {}


def test_the_bot_records_nothing_unless_asked(monkeypatch, tmp_path):
    monkeypatch.delenv("ARMCHAIR_RECORD", raising=False)
    assert bot._open_recorder(SimpleNamespace(session_id="s")) is None

    monkeypatch.setenv("ARMCHAIR_RECORD", str(tmp_path / "rec"))
    rec = bot._open_recorder(SimpleNamespace(session_id="s1"))
    rec.close()
    header = lines(rec.path)[0]
    assert header["session"] == "s1" and "commit" in header and "llm" in header
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && uv run pytest tests/test_recorder.py -q`
Expected: collection error, `No module named 'recorder'`.

- [ ] **Step 3: Implement the recorder**

Create `server/recorder.py`:

```python
"""The flight recorder: one JSON line per session event, for playtest/check.py.

Off unless ARMCHAIR_RECORD names a directory (bot.py decides). Files hold
transcripts of what the player said, so they stay on this machine.
"""

import json
import time
from collections.abc import Callable
from pathlib import Path

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    FunctionCallResultFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed

_SPEECH = {
    UserStartedSpeakingFrame: "user_started",
    UserStoppedSpeakingFrame: "user_stopped",
    BotStartedSpeakingFrame: "bot_started",
    BotStoppedSpeakingFrame: "bot_stopped",
}


def _prune(directory: Path, keep: int) -> None:
    files = sorted(directory.glob("*.jsonl"))
    for old in files[: max(0, len(files) - keep)]:
        old.unlink(missing_ok=True)


class Recorder:
    def __init__(self, directory: Path, *, header: dict, keep: int = 50, clock=time.monotonic):
        directory = Path(directory).expanduser()
        directory.mkdir(parents=True, exist_ok=True)
        if keep > 0:
            _prune(directory, keep - 1)
        session = str(header.get("session") or "session")[:8]
        self.path = directory / f"{time.strftime('%Y%m%d-%H%M%S')}-{session}.jsonl"
        self._file = self.path.open("a", encoding="utf-8")
        self._clock = clock
        self._t0 = clock()
        self._write({"t": 0, "kind": "header", "started": time.strftime("%Y-%m-%dT%H:%M:%S"), **header})

    def _write(self, record: dict) -> None:
        if self._file.closed:
            return
        self._file.write(json.dumps(record, default=str) + "\n")
        self._file.flush()

    def event(self, kind: str, **fields) -> None:
        self._write({"t": round(self._clock() - self._t0, 3), "kind": kind, **fields})

    def snapshot(self, state: dict) -> None:
        self.event("snapshot", state=state)

    def turn(self, by: str, text: str) -> None:
        self.event("user_text" if by == "user" else "bot_text", text=text)

    def close(self) -> None:
        self._file.close()


class RecorderObserver(BaseObserver):
    """Speech starts and stops, tool results, errors, and changes of flow node."""

    def __init__(self, recorder: Recorder, current_node: Callable[[], str | None]):
        super().__init__()
        self._recorder = recorder
        self._current_node = current_node
        self._node: str | None = None
        self._seen: set[int] = set()

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if frame.id in self._seen:
            return
        self._seen.add(frame.id)

        node = self._current_node()
        if node and node != self._node:
            self._node = node
            self._recorder.event("node", name=node)

        kind = _SPEECH.get(type(frame))
        if kind:
            self._recorder.event(kind)
        elif isinstance(frame, FunctionCallResultFrame):
            result = frame.result if isinstance(frame.result, dict) else {}
            self._recorder.event("tool", name=frame.function_name, args=frame.arguments, status=result.get("status"))
        elif isinstance(frame, ErrorFrame):
            self._recorder.event("error", message=str(frame.error))
```

- [ ] **Step 4: Wire it into `bot.py`**

Add `import os` and `import subprocess` to the top-level imports. Add above `run_bot`:

```python
def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).parent, capture_output=True, text=True, timeout=5,
        ).stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _open_recorder(runner_args: RunnerArguments):
    """The flight recorder, when ARMCHAIR_RECORD names a directory; else None."""
    directory = os.environ.get("ARMCHAIR_RECORD")
    if not directory:
        return None
    from recorder import Recorder

    llm = providers.llm_config()
    return Recorder(
        Path(directory),
        header={
            "session": str(getattr(runner_args, "session_id", "") or ""),
            "commit": _git_commit(),
            "llm": f"{llm.provider}/{llm.model}",
            "speech": providers.speech_provider(),
        },
        keep=int(os.environ.get("ARMCHAIR_RECORD_KEEP", "50")),
    )
```

In `run_bot`, replace `debate = DebateState(on_change=worker.rtvi.send_server_message)` with:

```python
    recorder = _open_recorder(runner_args)

    async def on_change(snapshot: dict) -> None:
        if recorder:
            recorder.snapshot(snapshot)
        await worker.rtvi.send_server_message(snapshot)

    debate = DebateState(on_change=on_change)
```

Replace `worker.add_observer(TurnObserver(llm, scorer.submit))` with:

```python
    def on_turn(by: str, text: str) -> None:
        if recorder:
            recorder.turn(by, text)
        scorer.submit(by, text)

    worker.add_observer(TurnObserver(llm, on_turn))
    if recorder:
        from recorder import RecorderObserver

        worker.add_observer(RecorderObserver(recorder, lambda: flow_manager.current_node))
```

In `on_client_disconnected`, after `scorer.abandon()`, add `if recorder: recorder.close()`.

- [ ] **Step 5: Run the server suite**

Run: `cd server && uv run pytest -q`
Expected: all pass, including the five new recorder tests and the existing idle-frames test (which parses `bot.py` for the one `PipelineWorker` call).

- [ ] **Step 6: Commit**

```bash
git add server/recorder.py server/bot.py server/tests/test_recorder.py
git commit -m "feat: a flight recorder in the bot, on only when ARMCHAIR_RECORD names a directory"
```

---

### Task 6: `./armchair` records your sessions, and `--last` checks one

**Files:**
- Modify: `armchair`
- Create: `server/playtest/__main__.py`
- Test: `server/tests/test_playtest_cli.py`

**Interfaces:**
- Consumes: `check.load`, `check.check`, `check.errors` (Task 4).
- Produces: `python -m playtest check <file-or-dir>` (a directory means its newest `.jsonl`), exit 1 on any error-level violation; `python -m playtest run ...` added in Task 8.

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_playtest_cli.py`:

```python
import json
import subprocess
import sys
from pathlib import Path

SERVER = Path(__file__).parents[1]


def run(*args):
    return subprocess.run([sys.executable, "-m", "playtest", *args], cwd=SERVER, capture_output=True, text=True)


def write(path, events):
    path.write_text("".join(json.dumps(e) + "\n" for e in events))


def test_check_passes_a_clean_timeline_and_fails_a_broken_one(tmp_path):
    write(tmp_path / "20260101-000000-a.jsonl", [
        {"t": 0, "kind": "header"},
        {"t": 1, "kind": "node", "name": "mode_select"},
        {"t": 1.1, "kind": "snapshot", "state": {"stage": "mode"}},
    ])
    clean = run("check", str(tmp_path / "20260101-000000-a.jsonl"))
    assert clean.returncode == 0 and "no violations" in clean.stdout

    write(tmp_path / "20260102-000000-b.jsonl", [{"t": 0, "kind": "header"}, {"t": 1, "kind": "node", "name": "closing"}])
    broken = run("check", str(tmp_path))  # a directory: its newest session
    assert broken.returncode == 1 and "legal-path" in broken.stdout and "20260102" in broken.stdout
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && uv run pytest tests/test_playtest_cli.py -q`
Expected: FAIL (`No module named playtest.__main__`).

- [ ] **Step 3: Implement the CLI**

Create `server/playtest/__main__.py`:

```python
"""python -m playtest check <timeline-or-dir> | run <scenario-or-dir>"""

import sys
from pathlib import Path

from playtest import check


def _newest(path: Path) -> Path:
    if path.is_dir():
        files = sorted(path.glob("*.jsonl"))
        if not files:
            sys.exit(f"no sessions in {path}")
        return files[-1]
    return path


def cmd_check(target: str) -> int:
    path = _newest(Path(target).expanduser())
    violations = check.check(check.load(path))
    print(f"{path.name}:")
    if not violations:
        print("  no violations")
    for v in violations:
        print(f"  {v.t:8.1f}s  {v.severity:<5}  {v.rule:<20} {v.message}")
    return 1 if check.errors(violations) else 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "check":
        return cmd_check(argv[1])
    if argv and argv[0] == "run":
        from playtest import driver

        return driver.main(argv[1:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Turn recording on in the launcher, and add `--last`**

In `armchair`, before `needs_build`, add:

```bash
SESSIONS="${ARMCHAIR_SESSIONS:-$HOME/.armchair/sessions}"

if [[ "${1:-}" == "--last" ]]; then
  cd "$SERVER" && exec uv run python -m playtest check "$SESSIONS"
fi
```

and change the final `exec` line's environment to:

```bash
ARMCHAIR_LOCAL=1 ARMCHAIR_ORIGIN="$ORIGIN" ARMCHAIR_RECORD="$SESSIONS" ARMCHAIR_RECORD_KEEP=50 exec uv run bot.py \
```

Update the script's header comment with `./armchair --last   check your most recent session against the playtest rules`, and one line saying sessions are recorded to `~/.armchair/sessions/` (latest 50, never uploaded).

- [ ] **Step 5: Run the tests and a syntax check**

Run: `cd server && uv run pytest -q && bash -n ../armchair`
Expected: all pass.

- [ ] **Step 6: Commit and push (milestone: Part 2)**

```bash
git add armchair server/playtest/__main__.py server/tests/test_playtest_cli.py
git commit -m "feat: ./armchair records your sessions locally, and ./armchair --last checks the latest"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```

---

# Part 3 — Voice playthroughs

### Task 7: Local speech for the bot, the player's lines, and a scripted microphone

**Files:**
- Modify: `server/providers.py` (a `local` speech provider)
- Create: `server/playtest/speech.py`, `server/playtest/mic.py`
- Modify: `.gitignore` (add `server/playtest/.cache/` and `server/playtest/runs/`)
- Test: `server/tests/test_providers.py`, `server/tests/test_playtest_speech.py`

**Interfaces:**
- Produces: `SPEECH_PROVIDER=local` → `make_stt()` returns `MoonshineSTTService()`, `make_tts()` returns `KokoroTTSService` with voice `LOCAL_HOUSE_VOICE = "bm_george"`, `voices()` returns `None`; `speech.to_pcm48(samples, rate) -> bytes` (48 kHz mono s16); `speech.cache_key(text, voice) -> str`; `speech.say(text, *, voice=PLAYER_VOICE, cache_dir=CACHE, synth=None) -> bytes`; `mic.ScriptedMic()` with `.queue(pcm)`, `.speaking`, `.idle()`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_providers.py`:

```python
def test_local_speech_runs_on_this_machine(monkeypatch):
    monkeypatch.setenv("SPEECH_PROVIDER", "local")
    monkeypatch.delenv("GRADIUM_API_KEY", raising=False)  # no key needed, so none is spent
    from pipecat.services.kokoro.tts import KokoroTTSService
    from pipecat.services.moonshine.stt import MoonshineSTTService

    assert isinstance(providers.make_stt(), MoonshineSTTService)
    tts = providers.make_tts()
    assert isinstance(tts, KokoroTTSService)
    assert tts._settings.voice == providers.LOCAL_HOUSE_VOICE == "bm_george"
    assert providers.voices() is None
```

Create `server/tests/test_playtest_speech.py`:

```python
import numpy as np

from playtest import mic, speech


def test_kokoro_float_audio_becomes_48k_s16_pcm():
    one_second_24k = np.linspace(-1.0, 1.0, 24000, dtype=np.float32)
    pcm = speech.to_pcm48(one_second_24k, 24000)
    samples = np.frombuffer(pcm, dtype=np.int16)
    assert len(samples) == 48000
    assert samples[0] == -32767 and samples[-1] == 32767


def test_a_line_is_synthesized_once_and_then_read_from_the_cache(tmp_path):
    calls = []

    def synth(text, voice):
        calls.append((text, voice))
        return np.zeros(2400, dtype=np.float32), 24000

    first = speech.say("Hello.", cache_dir=tmp_path, synth=synth)
    second = speech.say("Hello.", cache_dir=tmp_path, synth=synth)
    assert first == second and len(first) == 4800 * 2 and len(calls) == 1
    assert speech.cache_key("Hello.", "a") != speech.cache_key("Hello.", "b")


async def test_the_mic_plays_silence_then_a_queued_line_then_silence_again():
    track = mic.ScriptedMic()
    silent = await track.recv()
    assert silent.samples == 960 and silent.sample_rate == 48000
    assert bytes(silent.planes[0])[: 960 * 2] == b"\x00" * 1920 and not track.speaking

    track.queue(b"\x01\x00" * 1500)  # one full 20 ms frame and part of another
    assert track.speaking
    first = await track.recv()
    assert bytes(first.planes[0])[:4] == b"\x01\x00\x01\x00"
    second = await track.recv()
    assert bytes(second.planes[0])[: 540 * 2] == b"\x01\x00" * 540
    assert bytes(second.planes[0])[540 * 2: 960 * 2] == b"\x00" * (420 * 2)
    assert not track.speaking
    await track.idle()
    track.stop()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && uv run pytest tests/test_providers.py tests/test_playtest_speech.py -q`
Expected: the provider test fails (`SPEECH_PROVIDER='local': expected one of gradium, openai`); the speech tests fail to import `mic`.

- [ ] **Step 3: The `local` provider**

In `server/providers.py`: change `SPEECH_PROVIDERS = ("gradium", "openai")` to `("gradium", "openai", "local")`, add near `GRADIUM_HOUSE_VOICE`:

```python
# SPEECH_PROVIDER=local: Moonshine and Kokoro, on this machine, no key and no
# credits. For playtests, not for people: a stock voice, and Moonshine waits for
# the end of a phrase rather than streaming.
LOCAL_HOUSE_VOICE = "bm_george"
```

In `make_stt()`, before the Gradium fallback:

```python
    if provider == "local":
        from pipecat.services.moonshine.stt import MoonshineSTTService

        return MoonshineSTTService()
```

In `make_tts()`, before the Gradium fallback:

```python
    if provider == "local":
        from pipecat.services.kokoro.tts import KokoroTTSService

        return KokoroTTSService(settings=KokoroTTSService.Settings(voice=LOCAL_HOUSE_VOICE))
```

In `voices()`, first line of the body: `if speech_provider() == "local": return None`.

Also list `local` in the README's "Swapping providers" block (`SPEECH_PROVIDER=gradium | openai | local`, with "local: Moonshine and Kokoro on this machine, for playtests").

- [ ] **Step 4: The player's lines, and the microphone**

Create `server/playtest/speech.py`:

```python
"""The player's lines as 48 kHz mono PCM, synthesized locally with Kokoro and cached.

Free: the model is the one Pipecat's Kokoro service downloads, in
~/.cache/pipecat/kokoro-onnx.
"""

import hashlib
from functools import cache
from pathlib import Path

import numpy as np

CACHE = Path(__file__).parent / ".cache"
PLAYER_VOICE = "af_heart"  # not the bot's voice, so the two are easy to tell apart
KOKORO_DIR = Path("~/.cache/pipecat/kokoro-onnx").expanduser()


def to_pcm48(samples: np.ndarray, rate: int) -> bytes:
    """Float audio at any rate as 48 kHz mono signed 16-bit PCM."""
    samples = np.asarray(samples, dtype=np.float32)
    length = int(round(len(samples) * 48000 / rate))
    resampled = np.interp(np.linspace(0, len(samples) - 1, length), np.arange(len(samples)), samples)
    return (np.clip(resampled, -1.0, 1.0) * 32767).astype(np.int16).tobytes()


def cache_key(text: str, voice: str) -> str:
    return hashlib.sha256(f"{voice}\n{text}".encode()).hexdigest()[:24]


@cache
def _kokoro():
    from kokoro_onnx import Kokoro

    model, voices = KOKORO_DIR / "kokoro-v1.0.onnx", KOKORO_DIR / "voices-v1.0.bin"
    if not model.exists():
        # Pipecat's service downloads it on first use; instantiate it once to fetch.
        from pipecat.services.kokoro.tts import KokoroTTSService

        KokoroTTSService()
    return Kokoro(str(model), str(voices))


def _synth(text: str, voice: str):
    return _kokoro().create(text, voice=voice, speed=1.0, lang="en-us")


def say(text: str, *, voice: str = PLAYER_VOICE, cache_dir: Path = CACHE, synth=None) -> bytes:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{cache_key(text, voice)}.pcm"
    if path.exists():
        return path.read_bytes()
    samples, rate = (synth or _synth)(text, voice)
    pcm = to_pcm48(samples, rate)
    path.write_bytes(pcm)
    return pcm
```

Create `server/playtest/mic.py`:

```python
"""An aiortc audio track that plays silence until a line is queued, then the line."""

import asyncio
import fractions
import time

from aiortc.mediastreams import MediaStreamError, MediaStreamTrack
from av import AudioFrame

RATE = 48000
SAMPLES = 960  # 20 ms
BYTES = SAMPLES * 2


class ScriptedMic(MediaStreamTrack):
    kind = "audio"

    def __init__(self):
        super().__init__()
        self._buffer = bytearray()
        self._start: float | None = None
        self._pts = 0
        self._drained = asyncio.Event()
        self._drained.set()

    @property
    def speaking(self) -> bool:
        return bool(self._buffer)

    def queue(self, pcm: bytes) -> None:
        self._buffer.extend(pcm)
        self._drained.clear()

    async def idle(self) -> None:
        """Wait until everything queued has been sent."""
        await self._drained.wait()

    async def recv(self) -> AudioFrame:
        if self.readyState != "live":
            raise MediaStreamError
        if self._start is None:
            self._start = time.time()
        else:
            self._pts += SAMPLES
            await asyncio.sleep(max(0.0, self._start + self._pts / RATE - time.time()))

        chunk = bytes(self._buffer[:BYTES])
        del self._buffer[:BYTES]
        if not self._buffer:
            self._drained.set()

        frame = AudioFrame(format="s16", layout="mono", samples=SAMPLES)
        plane = frame.planes[0]  # its buffer may be padded past BYTES
        plane.update(chunk + b"\x00" * (plane.buffer_size - len(chunk)))
        frame.pts = self._pts
        frame.sample_rate = RATE
        frame.time_base = fractions.Fraction(1, RATE)
        return frame
```

Add to `.gitignore`:

```
server/playtest/.cache/
server/playtest/runs/
```

- [ ] **Step 5: Run the tests, then hear one line**

Run: `cd server && uv run pytest -q`
Expected: all pass.

Then: `cd server && uv run python -c "from playtest import speech; print(len(speech.say('Teach me global workspace theory.')) // 96000, 's')"`
Expected: about 2 s, and a `.pcm` file in `playtest/.cache/`. No network call.

- [ ] **Step 6: Commit**

```bash
git add server/providers.py server/tests/test_providers.py server/playtest/speech.py server/playtest/mic.py server/tests/test_playtest_speech.py .gitignore README.md
git commit -m "feat(playtest): local speech for the bot (Moonshine, Kokoro), the player's lines from Kokoro, and a scripted microphone"
```

---

### Task 8: The driver, scenarios, and `learn_happy`

**Files:**
- Create: `server/playtest/scenario.py`, `server/playtest/driver.py`, `server/playtest/scenarios/learn_happy.yaml`
- Test: `server/tests/test_playtest_scenario.py`

**Interfaces:**
- Consumes: `speech.say`, `mic.ScriptedMic` (Task 7); `check.*` (Task 4); the recorder env (Task 5).
- Produces: `scenario.load(path) -> Scenario(name, steps: list[dict], expect: dict)`; step forms `{wait: {bot_started|bot_stopped: n | quiet: seconds | stage: s | mode: m | step: n | question: n, timeout?: s}}` (`quiet: 3` = the bot has said nothing for 3 s; use it after a verdict, where a "thank you, the judge is weighing it" line comes before the result), `{say: text}`, `{say_after: {seconds, text}}`, `{silence: seconds}`; `scenario.expectation_failures(expect, events, violations) -> list[str]`; `driver.main(argv) -> int`.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_playtest_scenario.py`:

```python
import pytest

from playtest import scenario
from playtest.check import Violation


def test_a_scenario_loads_and_validates_its_steps(tmp_path):
    path = tmp_path / "s.yaml"
    path.write_text(
        "name: s\nsteps:\n"
        "  - wait: {bot_stopped: 1}\n  - say: Hello.\n"
        "  - say_after: {seconds: 1.5, text: Wait.}\n  - silence: 3\n"
        "  - wait: {stage: lesson, timeout: 60}\n  - wait: {quiet: 3}\n"
        "expect: {final_stage: verdict}\n"
    )
    s = scenario.load(path)
    assert s.name == "s" and len(s.steps) == 6 and s.expect == {"final_stage": "verdict"}


@pytest.mark.parametrize("step", ["  - dance: 1\n", "  - wait: {colour: red}\n", "  - say_after: {text: x}\n"])
def test_an_unknown_step_is_refused(tmp_path, step):
    path = tmp_path / "s.yaml"
    path.write_text("name: s\nsteps:\n" + step)
    with pytest.raises(ValueError):
        scenario.load(path)


def test_expectations_are_checked_against_the_timeline():
    events = [
        {"t": 1, "kind": "tool", "name": "choose_lesson", "status": "ok"},
        {"t": 2, "kind": "snapshot", "state": {"stage": "verdict", "mode": "learn"}},
    ]
    violations = [Violation("guard-fired", "warn", 1, "x"), Violation("barge-in", "error", 1, "y")]
    expect = {"final_stage": "verdict", "final_mode": "learn", "tools_include": ["choose_lesson", "step_done"],
              "rules_allow": ["guard-fired"]}
    failures = scenario.expectation_failures(expect, events, violations)
    assert any("step_done" in f for f in failures)
    assert any("barge-in" in f for f in failures)
    assert not any("guard-fired" in f for f in failures)
    assert not any("final_stage" in f for f in failures)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && uv run pytest tests/test_playtest_scenario.py -q`
Expected: collection error.

- [ ] **Step 3: Implement the scenario format**

Create `server/playtest/scenario.py`:

```python
"""A playthrough script: steps to play against the bot, and what must be true after."""

from dataclasses import dataclass
from pathlib import Path

import yaml

WAIT_KEYS = {"bot_started", "bot_stopped", "quiet", "stage", "mode", "step", "question", "timeout"}
DEFAULT_TIMEOUT = 45.0


@dataclass(frozen=True)
class Scenario:
    name: str
    steps: list[dict]
    expect: dict


def _validate(step: dict) -> None:
    if not isinstance(step, dict) or len(step) != 1:
        raise ValueError(f"a step is one key: {step!r}")
    (kind, value), = step.items()
    if kind == "wait":
        if not isinstance(value, dict) or not set(value) <= WAIT_KEYS or not set(value) - {"timeout"}:
            raise ValueError(f"wait takes one of {sorted(WAIT_KEYS - {'timeout'})}: {value!r}")
    elif kind == "say":
        if not isinstance(value, str) or not value.strip():
            raise ValueError("say takes a line of text")
    elif kind == "say_after":
        if not isinstance(value, dict) or set(value) != {"seconds", "text"}:
            raise ValueError("say_after takes seconds and text")
    elif kind == "silence":
        if not isinstance(value, (int, float)) or value <= 0:
            raise ValueError("silence takes a number of seconds")
    else:
        raise ValueError(f"unknown step {kind!r}")


def load(path) -> Scenario:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    steps = raw.get("steps") or []
    for step in steps:
        _validate(step)
    return Scenario(name=raw["name"], steps=steps, expect=raw.get("expect") or {})


def expectation_failures(expect: dict, events: list[dict], violations) -> list[str]:
    failures = []
    snapshots = [e["state"] for e in events if e.get("kind") == "snapshot"]
    final = snapshots[-1] if snapshots else {}
    for key, field in (("final_stage", "stage"), ("final_mode", "mode")):
        if key in expect and final.get(field) != expect[key]:
            failures.append(f"{key}: wanted {expect[key]!r}, ended at {final.get(field)!r}")
    called = {e["name"] for e in events if e.get("kind") == "tool"}
    for tool in expect.get("tools_include", []):
        if tool not in called:
            failures.append(f"tools_include: {tool!r} was never called")
    allowed = set(expect.get("rules_allow", []))
    for v in violations:
        if v.rule not in allowed and (v.severity == "error" or v.rule in expect.get("rules_forbid", [])):
            failures.append(f"rule {v.rule} at {v.t:.1f}s: {v.message}")
    return failures
```

- [ ] **Step 4: Implement the driver**

Create `server/playtest/driver.py`:

```python
"""Play scenarios against a real local bot over WebRTC, then check the timeline.

    uv run python -m playtest run playtest/scenarios/learn_happy.yaml
    uv run python -m playtest run playtest/scenarios/
    uv run python -m playtest run --real-speech playtest/scenarios/learn_happy.yaml

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


def _start_bot(port: int, record_dir: Path, real_speech: bool) -> subprocess.Popen:
    env = {**os.environ, "ARMCHAIR_RECORD": str(record_dir), "ARMCHAIR_RECORD_KEEP": "0"}
    if not real_speech:
        env["SPEECH_PROVIDER"] = "local"  # no Gradium credits: Moonshine and Kokoro on this Mac
    log = (record_dir / "bot.log").open("w")
    process = subprocess.Popen(
        ["uv", "run", "bot.py", "--host", "127.0.0.1", "--port", str(port)],
        cwd=SERVER, env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"http://127.0.0.1:{port}/status", timeout=1).status_code == 200:
                return process
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    process.terminate()
    raise RuntimeError("the bot did not start; see bot.log")


def run_one(path: Path, real_speech: bool = False) -> bool:
    s = scenario.load(path)
    run_dir = RUNS / time.strftime("%Y%m%d-%H%M%S") / s.name
    run_dir.mkdir(parents=True, exist_ok=True)
    port = _free_port()
    started = time.monotonic()
    print(f"▶ {s.name}  (port {port}, {run_dir})", flush=True)
    bot = _start_bot(port, run_dir, real_speech)
    failures: list[str] = []
    try:
        asyncio.run(play(s, f"http://127.0.0.1:{port}"))
    except Exception as e:  # a wait that timed out, or a connection that failed
        failures.append(f"play: {e}")
    finally:
        bot.terminate()
        bot.wait(timeout=20)

    timelines = sorted(run_dir.glob("*.jsonl"))
    if not timelines:
        failures.append("no timeline was recorded")
        events, violations = [], []
    else:
        events = check.load(timelines[-1])
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
    if not argv:
        print(__doc__)
        return 2
    paths: list[Path] = []
    for arg in argv:
        p = Path(arg)
        paths += sorted(p.glob("*.yaml")) if p.is_dir() else [p]
    before = gradium_credits() if real_speech else None
    results = [run_one(p, real_speech) for p in paths]
    print(f"\n{sum(results)}/{len(results)} passed")
    if real_speech:
        after = gradium_credits()
        if before is not None and after is not None:
            print(f"Gradium credits used: {before - after:,} ({after:,} left)")
    return 0 if all(results) else 1
```

- [ ] **Step 5: Write `learn_happy`**

Create `server/playtest/scenarios/learn_happy.yaml`:

```yaml
name: learn_happy
steps:
  - wait: {bot_stopped: 1, timeout: 60}     # the greeting
  - say: "Teach me global workspace theory."
  - wait: {stage: lesson, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}     # step one taught
  - say: "Clear, go on."
  - wait: {step: 2}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Clear, go on."
  - wait: {step: 3}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Got it, next."
  - wait: {step: 4}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Clear."
  - wait: {stage: check, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "A thought becomes conscious when it wins a competition for a small shared stage and is broadcast to the whole brain at once."
  - wait: {question: 2, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "There is a sudden brain-wide burst of activity called ignition. Unconscious processing stays local."
  - wait: {question: 3, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Because the workspace is small. Contents compete and one wins at a time, so experience is serial."
  - wait: {stage: verdict, timeout: 120}
  - wait: {bot_stopped: 1, timeout: 90}
  - wait: {quiet: 3, timeout: 90}           # the report, after the "let me see" line
  - say: "Let me spar with it."
  - wait: {stage: sparring, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}     # the examiner's first question
expect:
  final_stage: sparring
  final_mode: sparring
  tools_include: [choose_mode, choose_lesson, step_done, check_answered, spar_this]
  rules_allow: [guard-fired, no-double-reply]
```

- [ ] **Step 6: Run the unit tests, then the acceptance playthrough**

Run: `cd server && uv run pytest -q`
Expected: all pass.

Then (local speech, so no Gradium credits; a few minutes and some LLM text tokens):

Run: `cd server && uv run python -m playtest run playtest/scenarios/learn_happy.yaml`
Expected: `✓ learn_happy` and `1/1 passed`. If it fails, read the printed violations and timeline tail, and the run's `bot.log`. A wait that times out on a step that did advance means the driver's state reading is wrong (fix the driver); a rule that fires on a session that sounds right means the rule is wrong (fix the rule and add its case to Task 4's tests); a real misbehaviour is a finding for Task 9.

- [ ] **Step 7: Commit**

```bash
git add server/playtest/scenario.py server/playtest/driver.py server/playtest/scenarios/learn_happy.yaml server/tests/test_playtest_scenario.py
git commit -m "feat(playtest): a driver that plays scripted voice sessions over WebRTC, and learn_happy"
```

---

### Task 9: The rest of the scenarios, and what they find

**Files:**
- Create: `server/playtest/scenarios/{learn_interruptions,learn_ask_to_skip,debate_happy,debate_interruptions,sparring_happy,menu_from_anywhere,debate_from_lesson}.yaml`
- Modify: whatever the findings require, each with its own test

- [ ] **Step 1: Write the scenarios**

`learn_interruptions.yaml`:

```yaml
name: learn_interruptions
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Teach me integrated information theory."
  - wait: {stage: lesson, timeout: 60}
  - wait: {bot_started: 1, timeout: 60}
  - say_after: {seconds: 2, text: "Sorry, what was that?"}   # talk over step one
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Can you say that again?"
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "What do you mean by integration?"                  # a question mid-step
  - wait: {bot_stopped: 1, timeout: 60}
  - silence: 15                                              # a long pause
  - say: "Okay, go on."
  - wait: {step: 2, timeout: 60}
  - wait: {bot_started: 1, timeout: 60}
  - say_after: {seconds: 1, text: "Go on."}                  # skip ahead while it is still teaching
  - wait: {bot_stopped: 1, timeout: 60}
expect:
  final_mode: learn
  tools_include: [choose_lesson, step_done]
  rules_allow: [guard-fired, no-double-reply]
```

`learn_ask_to_skip.yaml`:

```yaml
name: learn_ask_to_skip
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Teach me illusionism."
  - wait: {stage: lesson, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Just test me."
  - wait: {step: 2, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Skip ahead, give me the report."
  - wait: {step: 3, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
expect:
  final_stage: lesson
  final_mode: learn
  tools_include: [step_done]
  rules_allow: [no-double-reply]
```

`debate_happy.yaml`:

```yaml
name: debate_happy
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Let's debate."
  - wait: {stage: setup, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "I think consciousness is information being broadcast across the brain so every system can use it."
  - wait: {stage: opening, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Global availability is what experience is. When a content is broadcast, memory, speech and action can all use it, and that is all there is to being conscious of it."
  - wait: {stage: rebuttal, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Phi cannot even be computed for a real brain, so your theory makes no testable predictions about one."
  - wait: {stage: crossexam, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "How would anyone ever measure phi in a living human brain?"
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Late prefrontal ignition is measurable, and masking experiments test it directly."
  - wait: {stage: closing, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Workspace theory makes predictions that can fail, and that is what a scientific theory of consciousness owes us."
  - wait: {stage: verdict, timeout: 120}
  - wait: {bot_stopped: 1, timeout: 90}
  - wait: {quiet: 3, timeout: 90}
expect:
  final_stage: verdict
  final_mode: debate
  tools_include: [choose_mode, set_positions, opening_done, rebuttal_done, question_asked, answer_given, judge_debate]
  rules_allow: [guard-fired, no-double-reply]
```

`debate_interruptions.yaml`:

```yaml
name: debate_interruptions
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Let's debate. I think consciousness is information being broadcast across the brain."
  - wait: {stage: opening, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Broadcast is what experience is."
  - wait: {stage: rebuttal, timeout: 60}
  - wait: {bot_started: 1, timeout: 60}
  - say_after: {seconds: 2, text: "No, that's wrong, phi can't be measured."}   # barge in on the rebuttal
  - wait: {stage: crossexam, timeout: 60}
  - wait: {bot_started: 1, timeout: 60}
  - say_after: {seconds: 1, text: "How would you measure phi?"}   # ask before the invitation is finished
  - wait: {bot_stopped: 1, timeout: 60}
  - wait: {bot_started: 1, timeout: 60}
  - say_after: {seconds: 2, text: "Ignition is measurable."}      # answer before its question is finished
  - wait: {stage: closing, timeout: 90}
  - wait: {bot_stopped: 1, timeout: 60}
expect:
  final_stage: closing
  final_mode: debate
  rules_allow: [guard-fired, no-double-reply]
```

`sparring_happy.yaml`:

```yaml
name: sparring_happy
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Test my view with questions."
  - wait: {stage: setup, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Consciousness is information broadcast across the brain."
  - wait: {question: 1, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Being globally available for report and action is what we mean by experience."
  - wait: {question: 2, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "A computer that broadcast information that way might be conscious, yes."
  - wait: {question: 3, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "It would be refuted if conscious perception happened with no late brain-wide ignition."
  - wait: {question: 4, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "One missing prefrontal signal does not sink thirty years of evidence."
  - wait: {question: 5, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "The workspace is long-range neurons linking prefrontal and parietal cortex."
  - wait: {stage: verdict, timeout: 120}
  - wait: {bot_stopped: 1, timeout: 90}
  - wait: {quiet: 3, timeout: 90}
expect:
  final_stage: verdict
  final_mode: sparring
  tools_include: [take_position, answer_heard]
  rules_allow: [guard-fired, no-double-reply]
```

`menu_from_anywhere.yaml`:

```yaml
name: menu_from_anywhere
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Teach me panpsychism."
  - wait: {stage: lesson, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Actually, take me back to the menu."
  - wait: {stage: mode, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "I'd like to look around the theories."
  - wait: {stage: explore, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Take me back to the menu."
  - wait: {stage: mode, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
expect:
  final_stage: mode
  rules_allow: [no-double-reply]
```

`menu_from_anywhere` will likely find that `lesson` has no `main_menu` (only `lesson_report` does). That is a finding, handled in Step 3.

`debate_from_lesson.yaml`:

```yaml
name: debate_from_lesson
steps:
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Teach me global workspace theory."
  - wait: {stage: lesson, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Clear, go on."
  - wait: {step: 2}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Clear, go on."
  - wait: {step: 3}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Got it, next."
  - wait: {step: 4}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Clear."
  - wait: {stage: check, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "A thought becomes conscious when it wins a competition for a small shared stage and is broadcast to the whole brain at once."
  - wait: {question: 2, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "There is a sudden brain-wide burst of activity called ignition. Unconscious processing stays local."
  - wait: {question: 3, timeout: 60}
  - wait: {bot_stopped: 1, timeout: 60}
  - say: "Because the workspace is small. Contents compete and one wins at a time, so experience is serial."
  - wait: {stage: verdict, timeout: 120}
  - wait: {bot_stopped: 1, timeout: 90}
  - wait: {quiet: 3, timeout: 90}
  - say: "Let me debate with it."
  - wait: {stage: opening, timeout: 90}      # straight through setup, without asking the player's view
  - wait: {bot_stopped: 1, timeout: 60}
expect:
  final_stage: opening
  final_mode: debate
  tools_include: [debate_this, set_positions]
  rules_allow: [guard-fired, no-double-reply]
```

- [ ] **Step 2: Run them, once each**

Run: `cd server && uv run python -m playtest run playtest/scenarios/`
Expected: a pass/fail line per scenario. Keep the output in the ledger. Local speech, so no Gradium credits.

- [ ] **Step 3: Fix what they find, one at a time, test first**

For each failing scenario, decide which it is, in this order:
- **A driver or rule bug** (the session sounded right): fix it, add the case to Tasks 4/7/8's tests.
- **A flow or prompt bug** (the bot misbehaved): write the smallest test that pins it (a `test_flow_config.py` assertion for a missing edge such as `lesson → main_menu`; a `test_handlers.py` case for a handler), fix `flow.yaml` or the handler, re-run that scenario.
- **Expected behaviour the scenario got wrong**: fix the scenario, and say why in the commit.

Each fix is its own commit. After a fix, re-run only that scenario. Stop after two attempts per scenario; list anything still failing in the final report with what it showed. Do not run `--real-speech` unless the user asks.

- [ ] **Step 4: Commit the scenarios**

```bash
git add server/playtest/scenarios
git commit -m "test(playtest): scenarios for interruptions, skipping ahead, debate, sparring, the menu, and both hand-offs"
```

---

### Task 10: Docs, the full check, and the push

**Files:**
- Modify: `README.md`
- Modify: `docs/design/2026-10-14-playtest-harness-design.md` (status; the `no-double-reply` and `earned-rung` wording as built)

- [ ] **Step 1: README**

Under "Tests and evals", add a **Playtests** subsection:

```markdown
### Playtests

Three layers, from free to real:

    cd client && npm run e2e                                          # screen behaviour, replay mode, no server
    ./armchair --last                                                 # check your latest real session
    cd server && uv run python -m playtest run playtest/scenarios/    # scripted voice sessions over WebRTC

`./armchair` records every session to `~/.armchair/sessions/` (the latest 50,
never uploaded). The checker's rules and the scenarios are described in
[`docs/design/2026-10-14-playtest-harness-design.md`](docs/design/2026-10-14-playtest-harness-design.md).
Scripted sessions cost real speech and LLM credit and take a few minutes each;
the player's lines are synthesized once and cached.
```

Add `recorder.py` and `playtest/` to the Architecture listing.

- [ ] **Step 2: The spec as built**

Set the spec's status to `implemented 2026-10-14 ([plan](2026-10-14-playtest-harness-plan.md))`. Change the `no-double-reply` row to: "More than one bot reply between two user turns | warn". Change the `earned-rung` row to: "A snapshot with `verdict.winner == "user"` appears only at stage `verdict`, and never right after a snapshot in a different mode | error". Remove `"typed": false` from the timeline example (the turn observer does not know). Add `quiet: <seconds>` to the scenario's wait forms (the bot has said nothing for that long), used after every verdict.

- [ ] **Step 3: Full verification**

```bash
cd server && uv run pytest -q && uv run python make_fixtures.py --check
cd ../client && npm test --silent && npm run lint && npm run build && npm run e2e
```

Expected: all pass.

- [ ] **Step 4: Commit and push (milestone: done)**

```bash
git add README.md docs/design/2026-10-14-playtest-harness-design.md
git commit -m "docs: playtests in the README; the harness spec as built"
git push origin debate-mode
git merge-base --is-ancestor origin/master debate-mode && git branch -f master debate-mode && git push origin master
```
