# Debate UI v1 "Arcade Edition" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A purpose-built, fighting-game-styled debate screen — title, Pokémon-style theory card select, SF2-style fight HUD with armchair fighters and a battle text box, and a judge's-decision screen — driven entirely by the server's `debate_state` and `theory_cards` messages.

**Architecture:** A new `client/src/arcade/` tree. Pure TypeScript modules (`screen`, `battleText`, `theme`, the zustand store) decide what to show and carry the unit tests; React components render it; `ArcadeApp` reuses the scaffold's client lifecycle hook, provider, and audio output. One small server addition sends the card data on connect.

**Tech Stack:** React 19, Vite 8, TypeScript 6, Tailwind 4, zustand 5, `@pipecat-ai/client-js` / `client-react`, vitest (added). Server: Python 3.12, pipecat-ai 1.11.0, pytest.

**Spec:** `docs/design/2026-09-19-debate-ui-design.md` — read it first; it is the authority for behaviour and copy. Contract examples: `docs/design/debate-state-fixtures.json`, `docs/design/theory-cards-fixture.json`.

**Supersedes:** Tasks C.2 and C.3 of `docs/design/2026-09-19-debate-mode-plan.md`. Task C.1's types, store, and mock are absorbed into Task U.1 here.

## Global Constraints

- All client work happens in the git worktree `/Users/crashy/Development/armchair-debater-ui` (branch `debate-ui`), under `client/` only. The one server task (S.1) happens in the main checkout `/Users/crashy/Development/armchair-debater` (branch `debate-mode`).
- Homage, not copy: all art is original CSS or inline SVG. No Capcom or Nintendo sprites, logos, character names, or sounds. Fonts, both SIL OFL and bundled from `@fontsource` packages (no runtime request to a font CDN): Press Start 2P for short display text; a readable pixel face (VT323 or Pixelify Sans, the implementer's choice) for body text.
- The screen is a pure function of connection state and the latest snapshot (`screenFor`). Components never keep their own notion of "which screen".
- The `debate_state` contract does not change. Messages with an unknown `type` are ignored.
- Exact on-screen copy (banners, prompts, battle text templates, effectiveness thresholds) comes from the spec verbatim.
- The spec's **Style guide** section is binding for every visual decision it covers: the study-at-night stage and palette, the rival wingback armchairs with faces and their states, the three-tier hit feel, the trading-card face, the two-font rule, the light CRT, and the decision flourishes. Where the Style guide is silent, the implementer decides, in keeping with it.
- Accessibility: both health bars keep `role="meter"` with `aria-valuemin/max/now` and an `aria-label`; the card grid is one tab stop with roving focus and arrow-key navigation; every interactive element is a real `<button>`; hit and announcer text is exposed through one polite `aria-live` region; `prefers-reduced-motion` disables shake, bobbing, typing, and slamming banners.
- Works at 375 px wide in portrait.
- Do not modify anything under `client/src/components/pipecat/` or `client/src/components/ui/` (the scaffold's component library) — import from it.
- Commands run from `client/`: `npm run lint`, `npm run build`, `npm test`. All three must pass before every commit.
- Never commit `node_modules/`, `dist/`, or `.env*` files.

## Who runs what

| Task | Where | Depends on |
|---|---|---|
| S.1 server: `theory_cards` message | main checkout, after server Task B.7 lands (both edit `bot.py`) | — |
| U.1 foundations | UI worktree | — |
| U.2 shell, theme, title | UI worktree | U.1 |
| U.3 fight screen | UI worktree | U.2 |
| U.4 select screen | UI worktree | U.2 |
| U.5 decision screen | UI worktree | U.3 |
| U.6 responsive, a11y, polish | UI worktree | U.3–U.5 |

The UI never needs a running server: everything is built and demoed against `http://localhost:5173/?mock`.

**A note on code in this plan.** Logic and wiring are given as complete code. The visual components (Tasks U.3–U.5) are given as exact props, behaviour, copy, and acceptance criteria rather than finished CSS and SVG: the pixel art and motion are the creative deliverable, and the implementer should use the `frontend-design` skill for them.

---

### Task S.1: Move names on the cards, and send the cards to the client

**Files:**
- Modify: `server/knowledge.py`
- Modify: `server/bot.py`
- Modify: `server/tests/test_knowledge.py`

**Interfaces:**
- Prerequisite: the twelve cards are merged into `debate-mode` and every card has a `moves` field (three short move names, one per argument, written by the cards author — see the spec's "Move names"). This task adds the schema support and the message.
- Produces: `Theory.moves: tuple[str, ...]`; `knowledge.load` rejects a card whose `moves` is not exactly three non-empty strings of at most three words and 22 characters each (add `"moves"` to `_LIST_FIELDS` and a length/shape check beside the `arguments`/`objections` check; extend `tests/test_knowledge.py`'s `card()` helper with a valid `moves` list and add rejection tests for a missing `moves`, a wrong count, and an over-long name — test-first).
- Produces: `knowledge.client_cards() -> list[dict]` — one dict per card with exactly the keys `id`, `name`, `kuhn_category`, `claim`, `moves`, `arguments`, `rivals` (lists, not tuples; `claim` whitespace-normalised). Objections and citations are deliberately excluded.
- Also regenerate `docs/design/theory-cards-fixture.json` from the real cards so it carries `moves` (one-off script: load `knowledge.client_cards()`, wrap as `{"type": "theory_cards", "cards": [...]}`, write with `indent=2, ensure_ascii=False`), and commit it with this task.
- Produces: on client ready, the bot sends `{"type": "theory_cards", "cards": knowledge.client_cards()}` as an RTVI server message BEFORE initializing the flow.

- [ ] **Step 1: Write the failing tests**

Add `import json` to the imports at the top of `server/tests/test_knowledge.py`, then append:

```python
CARDS_FIXTURE = json.loads(
    (Path(__file__).parents[2] / "docs/design/theory-cards-fixture.json").read_text()
)


def test_client_cards_match_the_contract_fixture_shape():
    cards = knowledge.client_cards()
    assert [c["id"] for c in cards] == knowledge.ids()
    expected_keys = set(CARDS_FIXTURE["cards"][0])
    for card in cards:
        assert set(card) == expected_keys
        assert isinstance(card["arguments"], list) and len(card["arguments"]) == 3
        assert isinstance(card["moves"], list) and len(card["moves"]) == 3
        assert isinstance(card["rivals"], list) and card["rivals"]


def test_client_cards_never_leak_objections_or_citations():
    for card in knowledge.client_cards():
        assert "objections" not in card and "citations" not in card


def test_client_cards_are_json_serialisable_and_claims_are_single_line():
    cards = knowledge.client_cards()
    json.dumps(cards)
    assert all("\n" not in card["claim"] for card in cards)
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_knowledge.py -q`
Expected: 3 failures, `AttributeError: module 'knowledge' has no attribute 'client_cards'`.

- [ ] **Step 3: Implement**

Append to `server/knowledge.py`:

```python
def client_cards() -> list[dict]:
    """The cards as the client shows them on the select screen.

    Objections and citations stay on the server: the player should not see
    their opponent's weaknesses before the debate.
    """
    return [
        {
            "id": t.id,
            "name": t.name,
            "kuhn_category": t.kuhn_category,
            "claim": " ".join(t.claim.split()),
            "moves": list(t.moves),
            "arguments": list(t.arguments),
            "rivals": list(t.rivals),
        }
        for t in THEORIES.values()
    ]
```

In `server/bot.py`, change the `on_client_ready` handler to send the cards first:

```python
    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        # The select screen needs the cards before the first debate snapshot.
        await rtvi.send_server_message(
            {"type": "theory_cards", "cards": knowledge.client_cards()}
        )
        await flow_manager.initialize(flow.initial_node)
```

- [ ] **Step 4: Verify**

Run: `uv run pytest -q` — all pass, no warnings. Then smoke boot: `uv run bot.py -t eval --port 7872` in the background, confirm it serves with no traceback, stop it.

- [ ] **Step 5: Commit**

```bash
git add server/knowledge.py server/bot.py server/tests/test_knowledge.py docs/design/theory-cards-fixture.json
git commit -m "feat: move names on cards; send the theory cards to the client on connect" -- server/knowledge.py server/bot.py server/tests/test_knowledge.py docs/design/theory-cards-fixture.json
```

---

### Task U.1: Foundations — types, store, pure logic, mock, tests

**Files:**
- Modify: `client/package.json` (vitest, font)
- Create: `client/vitest.config.ts`
- Create: `client/src/arcade/types.ts`, `store.ts`, `screen.ts`, `battleText.ts`, `theme.ts`, `mock.ts`
- Create: `client/src/arcade/fixtures/debate-state.json`, `client/src/arcade/fixtures/theory-cards.json`
- Create: `client/src/arcade/__tests__/screen.test.ts`, `battleText.test.ts`, `theme.test.ts`, `store.test.ts`

**Interfaces:**
- Produces (all from `client/src/arcade/`):
  - `types.ts`: `Stage`, `Side`, `Debater`, `Hit`, `Verdict`, `DebateSnapshot`, `TheoryCard`, `TheoryCardsMessage`, `isDebateSnapshot(data)`, `isTheoryCardsMessage(data)`
  - `store.ts`: `useArcadeStore` — `{ snapshot: DebateSnapshot | null; cards: TheoryCard[]; hitCount: number; receive(data: unknown): void; clear(): void }`
  - `screen.ts`: `type Screen = 'title' | 'select' | 'fight' | 'decision'`; `screenFor(connected: boolean, snapshot: DebateSnapshot | null): Screen`; `ROUND_LABELS: Record<Stage, string>`; `roundNumber(stage): 0 | 1 | 2 | 3`
  - `battleText.ts`: `battleLines(hit: Hit): string[]`; `speakerName(side: Side): 'YOU' | 'THE HOUSE'`; `decisionBanner(winner): 'YOU WIN' | 'YOU LOSE' | 'DRAW GAME'`
  - `theme.ts`: `typeOf(card): { label: string; colorVar: string }`; `shortName(card | id): string`
  - `mock.ts`: `startMockReplay(): () => void`

- [ ] **Step 1: Install and configure**

```bash
cd /Users/crashy/Development/armchair-debater-ui
git merge --no-edit debate-mode        # pick up the spec, plan, and fixtures
cd client
npm install
npm install --save-dev vitest
npm install @fontsource/press-start-2p
mkdir -p src/arcade/fixtures src/arcade/__tests__
cp ../docs/design/debate-state-fixtures.json src/arcade/fixtures/debate-state.json
cp ../docs/design/theory-cards-fixture.json src/arcade/fixtures/theory-cards.json
```

Add to `client/package.json` `"scripts"`: `"test": "vitest run"`.

Create `client/vitest.config.ts`:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

If TypeScript rejects JSON imports, add `"resolveJsonModule": true` to `compilerOptions` in `client/tsconfig.app.json`.

- [ ] **Step 2: Write `types.ts`**

```ts
/**
 * The two server messages the arcade UI consumes. Contract and examples:
 * docs/design/2026-09-19-debate-ui-design.md and the fixtures beside this folder.
 */

export type Stage = 'setup' | 'opening' | 'rebuttal' | 'closing' | 'verdict';
export type Side = 'user' | 'bot';

export interface Debater {
  theory_id: string | null;
  theory_name: string | null;
  health: number;
}

export interface Hit {
  by: Side;
  damage: number;
  recovery: number;
  reason: string;
}

export interface Verdict {
  winner: Side | 'draw';
  rationale: string;
}

export interface DebateSnapshot {
  type: 'debate_state';
  stage: Stage;
  user: Debater;
  bot: Debater;
  last_hit: Hit | null;
  verdict: Verdict | null;
}

export interface TheoryCard {
  id: string;
  name: string;
  kuhn_category: string;
  claim: string;
  arguments: string[];
  rivals: string[];
}

export interface TheoryCardsMessage {
  type: 'theory_cards';
  cards: TheoryCard[];
}

const hasType = (data: unknown, type: string): boolean =>
  typeof data === 'object' && data !== null && (data as { type?: unknown }).type === type;

export const isDebateSnapshot = (data: unknown): data is DebateSnapshot =>
  hasType(data, 'debate_state');

export const isTheoryCardsMessage = (data: unknown): data is TheoryCardsMessage =>
  hasType(data, 'theory_cards') && Array.isArray((data as { cards?: unknown }).cards);
```

- [ ] **Step 3: Write the failing tests**

`client/src/arcade/__tests__/screen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import fixtures from '../fixtures/debate-state.json';
import { ROUND_LABELS, roundNumber, screenFor } from '../screen';
import type { DebateSnapshot } from '../types';

const snapshots = fixtures as DebateSnapshot[];
const at = (stage: string) => snapshots.find((s) => s.stage === stage)!;

describe('screenFor', () => {
  it('is the title screen whenever disconnected, whatever the snapshot', () => {
    expect(screenFor(false, null)).toBe('title');
    expect(screenFor(false, at('closing'))).toBe('title');
  });
  it('is select when connected with no snapshot yet, or in setup', () => {
    expect(screenFor(true, null)).toBe('select');
    expect(screenFor(true, at('setup'))).toBe('select');
  });
  it('is fight in every debate round', () => {
    for (const stage of ['opening', 'rebuttal', 'closing']) {
      expect(screenFor(true, at(stage))).toBe('fight');
    }
  });
  it('is decision at the verdict', () => {
    expect(screenFor(true, at('verdict'))).toBe('decision');
  });
});

describe('round labels', () => {
  it('uses the spec copy', () => {
    expect(ROUND_LABELS.opening).toBe('ROUND 1 · OPENING');
    expect(ROUND_LABELS.rebuttal).toBe('ROUND 2 · REBUTTAL');
    expect(ROUND_LABELS.closing).toBe('FINAL ROUND · CLOSING');
  });
  it('numbers the rounds', () => {
    expect([roundNumber('setup'), roundNumber('opening'), roundNumber('rebuttal'), roundNumber('closing'), roundNumber('verdict')]).toEqual([0, 1, 2, 3, 3]);
  });
});
```

`client/src/arcade/__tests__/battleText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { battleLines, decisionBanner, speakerName } from '../battleText';
import type { Hit } from '../types';

const hit = (over: Partial<Hit>): Hit => ({ by: 'user', damage: 10, recovery: 0, reason: 'Made a point.', ...over });

describe('battleLines', () => {
  it('names the speaker and quotes the reason', () => {
    expect(battleLines(hit({}))[0]).toBe('YOU used "Made a point."');
    expect(battleLines(hit({ by: 'bot' }))[0]).toBe('THE HOUSE used "Made a point."');
  });
  it('adds no effectiveness line for a middling hit', () => {
    expect(battleLines(hit({ damage: 10 }))).toEqual(['YOU used "Made a point."', '−10']);
  });
  it.each([
    [15, "It's super effective!  −15"],
    [25, "It's super effective!  −25"],
    [5, "It's not very effective…  −5"],
    [1, "It's not very effective…  −1"],
    [0, 'But it missed!'],
  ])('damage %i reads %s', (damage, line) => {
    expect(battleLines(hit({ damage }))[1]).toBe(line);
  });
  it('adds a recovery line naming the healer', () => {
    expect(battleLines(hit({ by: 'bot', recovery: 8 })).at(-1)).toBe('THE HOUSE shook off the last hit!  +8');
    expect(battleLines(hit({ recovery: 0 })).some((l) => l.includes('shook off'))).toBe(false);
  });
});

describe('names and banners', () => {
  it('maps sides and winners to the spec copy', () => {
    expect(speakerName('user')).toBe('YOU');
    expect(speakerName('bot')).toBe('THE HOUSE');
    expect(decisionBanner('user')).toBe('YOU WIN');
    expect(decisionBanner('bot')).toBe('YOU LOSE');
    expect(decisionBanner('draw')).toBe('DRAW GAME');
  });
});
```

`client/src/arcade/__tests__/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import cardsFixture from '../fixtures/theory-cards.json';
import { shortName, typeOf } from '../theme';
import type { TheoryCard } from '../types';

const cards = cardsFixture.cards as TheoryCard[];
const card = (id: string) => cards.find((c) => c.id === id)!;

describe('typeOf', () => {
  it('labels with the last category segment and colours by the first', () => {
    expect(typeOf(card('gwt'))).toEqual({ label: 'Global workspace', colorVar: '--type-materialism' });
    expect(typeOf(card('iit')).colorVar).toBe('--type-information');
    expect(typeOf(card('orch_or')).colorVar).toBe('--type-quantum');
    expect(typeOf(card('panpsychism')).colorVar).toBe('--type-panpsychism');
    expect(typeOf(card('property_dualism')).colorVar).toBe('--type-dualism');
    expect(typeOf(card('analytic_idealism')).colorVar).toBe('--type-idealism');
  });
  it('falls back to a neutral colour for an unknown category', () => {
    expect(typeOf({ ...card('gwt'), kuhn_category: 'Something New' }).colorVar).toBe('--type-neutral');
  });
  it('gives every real card a type', () => {
    for (const c of cards) expect(typeOf(c).label.length).toBeGreaterThan(0);
  });
});

describe('shortName', () => {
  it('has a short grid name of at most 6 characters for all twelve cards', () => {
    for (const c of cards) {
      expect(shortName(c.id).length).toBeLessThanOrEqual(6);
      expect(shortName(c.id)).toBe(shortName(c.id).toUpperCase());
    }
  });
  it('falls back to the upper-cased id for an unknown card', () => {
    expect(shortName('brand_new')).toBe('BRAND_');
  });
});
```

`client/src/arcade/__tests__/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import cardsFixture from '../fixtures/theory-cards.json';
import fixtures from '../fixtures/debate-state.json';
import { useArcadeStore } from '../store';

const store = () => useArcadeStore.getState();

describe('useArcadeStore.receive', () => {
  beforeEach(() => store().clear());

  it('stores cards and snapshots and ignores everything else', () => {
    store().receive({ type: 'something_else' });
    store().receive(null);
    store().receive('text');
    expect(store().snapshot).toBeNull();
    store().receive(cardsFixture);
    store().receive(fixtures[0]);
    expect(store().cards).toHaveLength(12);
    expect(store().snapshot?.stage).toBe('setup');
  });

  it('counts a hit once, however many snapshots repeat it', () => {
    for (const snapshot of fixtures) store().receive(snapshot);
    const distinctHits = new Set(fixtures.filter((f) => f.last_hit).map((f) => JSON.stringify(f.last_hit))).size;
    expect(store().hitCount).toBe(distinctHits);
  });

  it('clear() empties the snapshot and hit count but keeps the cards', () => {
    store().receive(cardsFixture);
    store().receive(fixtures[3]);
    store().clear();
    expect(store().snapshot).toBeNull();
    expect(store().hitCount).toBe(0);
    expect(store().cards).toHaveLength(12);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm test`
Expected: every suite fails to import its module (`screen`, `battleText`, `theme`, `store`).

- [ ] **Step 5: Implement the pure modules**

`client/src/arcade/screen.ts`:

```ts
import type { DebateSnapshot, Stage } from './types';

export type Screen = 'title' | 'select' | 'fight' | 'decision';

/** Which screen to show. A pure function of the server's state, so the UI cannot drift from it. */
export const screenFor = (connected: boolean, snapshot: DebateSnapshot | null): Screen => {
  if (!connected) return 'title';
  if (!snapshot || snapshot.stage === 'setup') return 'select';
  return snapshot.stage === 'verdict' ? 'decision' : 'fight';
};

export const ROUND_LABELS: Record<Stage, string> = {
  setup: 'CHOOSE YOUR THEORY',
  opening: 'ROUND 1 · OPENING',
  rebuttal: 'ROUND 2 · REBUTTAL',
  closing: 'FINAL ROUND · CLOSING',
  verdict: "JUDGE'S DECISION",
};

export const roundNumber = (stage: Stage): 0 | 1 | 2 | 3 =>
  ({ setup: 0, opening: 1, rebuttal: 2, closing: 3, verdict: 3 })[stage] as 0 | 1 | 2 | 3;
```

`client/src/arcade/battleText.ts`:

```ts
import type { Hit, Side, Verdict } from './types';

export const speakerName = (side: Side): 'YOU' | 'THE HOUSE' => (side === 'user' ? 'YOU' : 'THE HOUSE');

const effectiveness = (damage: number): string => {
  if (damage === 0) return 'But it missed!';
  if (damage >= 15) return `It's super effective!  −${damage}`;
  if (damage <= 5) return `It's not very effective…  −${damage}`;
  return `−${damage}`;
};

/** The lines the battle text box types out for one hit. */
export const battleLines = (hit: Hit): string[] => {
  const who = speakerName(hit.by);
  const lines = [`${who} used "${hit.reason}"`, effectiveness(hit.damage)];
  if (hit.recovery > 0) lines.push(`${who} shook off the last hit!  +${hit.recovery}`);
  return lines;
};

export const decisionBanner = (winner: Verdict['winner']): 'YOU WIN' | 'YOU LOSE' | 'DRAW GAME' =>
  winner === 'user' ? 'YOU WIN' : winner === 'bot' ? 'YOU LOSE' : 'DRAW GAME';
```

`client/src/arcade/theme.ts`:

```ts
import type { TheoryCard } from './types';

/** Top-level Kuhn category → CSS custom property holding that type's colour (defined in arcade.css). */
const TYPE_COLORS: Record<string, string> = {
  Materialism: '--type-materialism',
  'Integrated Information Theory': '--type-information',
  'Quantum Theories': '--type-quantum',
  Panpsychisms: '--type-panpsychism',
  Dualisms: '--type-dualism',
  Idealisms: '--type-idealism',
};

export const typeOf = (card: Pick<TheoryCard, 'kuhn_category'>): { label: string; colorVar: string } => {
  const segments = card.kuhn_category.split('>').map((s) => s.trim());
  return { label: segments.at(-1) ?? '', colorVar: TYPE_COLORS[segments[0]] ?? '--type-neutral' };
};

/** Grid-slot names, six characters at most, fighting-game style. */
const SHORT_NAMES: Record<string, string> = {
  gwt: 'GWT',
  iit: 'IIT',
  hot: 'HOT',
  rpt: 'RPT',
  predictive_processing: 'PREDIC',
  ast: 'AST',
  illusionism: 'ILLUSN',
  biological_naturalism: 'BIONAT',
  orch_or: 'ORCHOR',
  panpsychism: 'PANPSY',
  property_dualism: 'DUAL',
  analytic_idealism: 'IDEAL',
};

export const shortName = (id: string): string => SHORT_NAMES[id] ?? id.toUpperCase().slice(0, 6);
```

`client/src/arcade/store.ts`:

```ts
import { create } from 'zustand';

import { isDebateSnapshot, isTheoryCardsMessage } from './types';
import type { DebateSnapshot, TheoryCard } from './types';

interface ArcadeStore {
  snapshot: DebateSnapshot | null;
  cards: TheoryCard[];
  /** Increments once per distinct hit; key hit animations on it. */
  hitCount: number;
  /** Feed every RTVI server message here; unknown messages are ignored. */
  receive: (data: unknown) => void;
  /** Forget the debate (on disconnect). The cards are kept. */
  clear: () => void;
}

const sameHit = (a: DebateSnapshot['last_hit'], b: DebateSnapshot['last_hit']) =>
  JSON.stringify(a) === JSON.stringify(b);

export const useArcadeStore = create<ArcadeStore>((set) => ({
  snapshot: null,
  cards: [],
  hitCount: 0,
  receive: (data) => {
    if (isTheoryCardsMessage(data)) {
      set({ cards: data.cards });
      return;
    }
    if (!isDebateSnapshot(data)) return;
    set((state) => ({
      snapshot: data,
      hitCount:
        data.last_hit && !sameHit(data.last_hit, state.snapshot?.last_hit ?? null)
          ? state.hitCount + 1
          : state.hitCount,
    }));
  },
  clear: () => set({ snapshot: null, hitCount: 0 }),
}));
```

`client/src/arcade/mock.ts`:

```ts
import cards from './fixtures/theory-cards.json';
import snapshots from './fixtures/debate-state.json';
import { useArcadeStore } from './store';

const STEP_MS = 3000;
/** How long to sit on the select screen and the decision screen in the loop. */
const HOLD_STEPS = 3;

/** Replays the contract fixtures into the store, looping. Returns a stop function. */
export const startMockReplay = (): (() => void) => {
  const { receive, clear } = useArcadeStore.getState();
  const frames = [
    ...Array<unknown>(HOLD_STEPS).fill(snapshots[0]),
    ...snapshots.slice(1),
    ...Array<unknown>(HOLD_STEPS).fill(snapshots.at(-1)),
  ];
  let index = 0;
  receive(cards);
  const tick = () => {
    if (index === 0) clear();
    receive(frames[index]);
    index = (index + 1) % frames.length;
  };
  tick();
  const timer = window.setInterval(tick, STEP_MS);
  return () => window.clearInterval(timer);
};
```

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run lint && npm run build`
Expected: all tests pass; lint and build clean.

```bash
git add client/package.json client/package-lock.json client/vitest.config.ts client/tsconfig.app.json client/src/arcade
git commit -m "feat(client): arcade UI foundations — contract types, store, screen and battle-text logic, mock replay"
```

---

### Task U.2: App shell, theme, and the title screen

**Files:**
- Create: `client/src/arcade/arcade.css`
- Create: `client/src/arcade/ArcadeApp.tsx`
- Create: `client/src/arcade/components/PixelButton.tsx`, `CrtOverlay.tsx`, `LiveRegion.tsx`
- Create: `client/src/arcade/screens/TitleScreen.tsx`
- Create: placeholder `client/src/arcade/screens/SelectScreen.tsx`, `FightScreen.tsx`, `DecisionScreen.tsx` (each renders its name and the raw data it will use; later tasks replace them)
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `useArcadeStore`, `screenFor`, `startMockReplay` (U.1); from the scaffold: `usePipecatApp` (`@/hooks/use-pipecat-app`), `BotAudioOutput` (`@/components/pipecat/bot-audio`), `TRANSPORT_FACTORIES`, `TRANSPORT_PROPS`, `DEFAULT_TRANSPORT` (`./config`); from `@pipecat-ai/client-react`: `PipecatClientProvider`, `useRTVIClientEvent`, `usePipecatClientTransportState`; from `@pipecat-ai/client-js`: `RTVIEvent`. Before using any of these, open the file or the package's type definitions and confirm the export and its signature.
- Produces:
  - `<ArcadeApp />` — owns the client, the provider, the server-message subscription, and the screen switch.
  - `<PixelButton>` — a real `<button>` with the arcade border/shadow style; props: `children`, `onClick`, `disabled?`, `blink?: boolean`, `size?: 'md' | 'lg'`.
  - `<CrtOverlay />` — scanline overlay plus a small toggle button; remembers the choice in `localStorage` under `arcade.crt`; renders nothing when off.
  - `<LiveRegion text={string} />` — a visually hidden `aria-live="polite"` region; later screens push hit and announcer text into it.
  - CSS custom properties in `arcade.css` (names are fixed; values are the implementer's design): `--bg`, `--bg-panel`, `--ink`, `--ink-dim`, `--accent`, `--bar-fill`, `--bar-ghost`, `--bar-danger`, `--bar-track`, `--heal`, `--type-materialism`, `--type-information`, `--type-quantum`, `--type-panpsychism`, `--type-dualism`, `--type-idealism`, `--type-neutral`; utility classes `.pixel-border`, `.pixel-panel`, `.pixel-text`, and keyframes `blink`, `shake`, `slam`, `float-up`, `bob`.

- [ ] **Step 1: `main.tsx` — route between the console and the arcade**

Keep the existing `Main` component exactly as it is, renamed `ConsoleApp`. Render it only when the URL has `?console`; otherwise render `<ArcadeApp />`:

```tsx
const wantsConsole = new URLSearchParams(window.location.search).has('console');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{wantsConsole ? <ConsoleApp /> : <ArcadeApp />}</StrictMode>
);
```

- [ ] **Step 2: `ArcadeApp.tsx`**

Behaviour:
1. `const mock = new URLSearchParams(window.location.search).has('mock')`.
2. Build the client with `usePipecatApp({ transportType: DEFAULT_TRANSPORT, transportFactory: TRANSPORT_FACTORIES[DEFAULT_TRANSPORT], ...TRANSPORT_PROPS[DEFAULT_TRANSPORT], initDevicesOnMount: false })` — read `src/hooks/use-pipecat-app.ts` for the exact options. While `app.client` is null render the title screen in a loading state.
3. Inside `<PipecatClientProvider client={app.client}>`: a child component that (a) subscribes with `useRTVIClientEvent(RTVIEvent.ServerMessage, (data) => receive(data))` — check the callback's argument shape in the scaffold's `console.tsx` lines ~378–384 and unwrap if the payload is nested; (b) reads the transport state and derives `connected` (`'ready'`, plus whichever other states mean the bot is live — read how `connect-button.tsx` decides); (c) calls `clear()` when the state returns to disconnected.
4. In mock mode: call `startMockReplay()` in an effect (return its stop function), treat `connected` as true, and never call `app.connect()`.
5. `const screen = screenFor(connected, snapshot)`; render the matching screen inside a full-viewport `.arcade` root that imports `arcade.css` and both fonts (`import '@fontsource/press-start-2p'` plus the body pixel font you choose — `npm install @fontsource/vt323` or `@fontsource/pixelify-sans` — exposed as `--font-display` and `--font-body`). The root also renders the shared `<Stage dim? fire?: 'idle' | 'flare' | 'dim' />` background component (create `components/Stage.tsx`: the study at night from the Style guide — bookshelves, fireplace with a flickering idle animation, Persian-rug floor, night window — in CSS/inline SVG); title, select, and decision use it dimmed. Pass the screens what they need as props (`snapshot`, `cards`, `hitCount`, `onStart`, `error`) — screens do not read the transport themselves.
6. Always render `<BotAudioOutput />` (unless mock) and `<CrtOverlay />`.

- [ ] **Step 3: Title screen**

Props: `onStart: () => void`, `busy: boolean`, `error: string | null`.
Content, per the spec: the logo text `ARMCHAIR DEBATER` (large, stepped shadow) with the subtitle `ARCADE EDITION`; two small idle armchairs are welcome but not required here; a `PixelButton blink size="lg"` reading `PRESS START` (disabled and reading `CONNECTING…` while `busy`); the instruction line "Say what you think consciousness is. The house will disagree."; `error` in a `.pixel-panel` if present. `onStart` calls `app.connect()`.

- [ ] **Step 4: Verify in the browser**

`npm run dev`, then: `http://localhost:5173/` shows the title screen; `http://localhost:5173/?console` shows the original console unchanged; `http://localhost:5173/?mock` cycles through the three placeholder screens (select → fight → decision) as the replay advances, and the placeholders print live data (stage, healths, last hit, card count 12). The CRT toggle works and survives a reload.

- [ ] **Step 5: Lint, build, test, commit**

```bash
npm test && npm run lint && npm run build
git add client/src
git commit -m "feat(client): arcade shell, pixel theme, and title screen"
```

---

### Task U.3: The fight screen

**Files:**
- Create: `client/src/arcade/components/HealthBar.tsx`, `RoundPlate.tsx`, `Armchair.tsx`, `DamageNumber.tsx`, `BattleTextBox.tsx`, `Announcer.tsx`
- Create: `client/src/arcade/hooks/useAudioLevel.ts`, `useTypewriter.ts`, `usePrevious.ts`
- Replace: `client/src/arcade/screens/FightScreen.tsx`
- Create: `client/src/arcade/__tests__/useTypewriter.test.ts` only if the hook's stepping logic is extracted into a pure function (recommended: `typedPrefix(lines, elapsedMs, cps)`).

**Interfaces:**
- Consumes: `DebateSnapshot`, `hitCount`, `battleLines`, `speakerName`, `ROUND_LABELS`, `roundNumber`, CSS tokens and keyframes (U.1, U.2); `usePipecatClientMediaTrack` from `@pipecat-ai/client-react` and `createVisualizerAnalyser` from `@/lib/visualizer` for audio levels (confirm both signatures in source).
- Produces: `<FightScreen snapshot hitCount frozen? />`. `frozen` renders the HUD without hit effects or audio bobbing; Task U.5 reuses it behind the decision banner.

**Required behaviour (spec section "FIGHT — the HUD" is authoritative):**

`HealthBar` — props `{ side: 'user' | 'bot'; label: string; theory: string | null; health: number }`.
- Bars drain toward the centre plate, as in the genre: the fill stays attached to the CENTRE end of its track and the OUTER end empties first. The player's bar is on the left (so its fill is right-anchored); the house's is mirrored.
- Fill width is `health%` with a stepped transition. A red ghost element behind the fill shows the PREVIOUS health, holds for ~600 ms after a drop, then shrinks to match. On a heal the ghost snaps immediately (no ghost on the way up).
- `health < 30`: fill uses `--bar-danger` and pulses.
- `role="meter"`, `aria-label="{label} health"`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow={health}`. The number is visible text.

`RoundPlate` — centre plate with `ROUND_LABELS[stage]` and three pips, filled up to `roundNumber(stage)`. No timer.

`Armchair` — props `{ side; level: number /* 0..1 */; hurt: boolean; healed: boolean }`. An original pixel-art armchair as inline SVG built from rects on a coarse grid (crisp edges), facing the centre (mirror with `scaleX(-1)` for the house). `level` drives a vertical bob of at most 6 px using stepped motion; `hurt` plays a recoil away from centre plus a white flash for ~400 ms; `healed` plays a brief green glow. Give the two chairs different upholstery colours so the sides read at a glance.

`useAudioLevel(track: MediaStreamTrack | null): number` — an `AnalyserNode`-based RMS level smoothed and clamped to 0..1, sampled on `requestAnimationFrame`, cleaned up on unmount or track change, returning 0 when there is no track or when `prefers-reduced-motion` is set. The local track is the mic (`usePipecatClientMediaTrack('audio', 'local')`), the bot's is (`'audio', 'bot'`). In mock mode there are no tracks, so both levels are 0; that is fine.

`DamageNumber` — a number that floats up and fades (`float-up` keyframe), `−N` in the damage colour over the TARGET's chair, `+N` in `--heal` over the HEALER's chair. Keyed on `hitCount` so each new hit replays it.

`BattleTextBox` — a `.pixel-panel` at the bottom. When `hitCount` changes it types out `battleLines(last_hit)` line by line (about 40 characters per second; instantly under reduced motion). Before the first hit of the debate it shows a turn prompt: in `opening` with no hits yet, "THE HOUSE steps up…". It also pushes the full text to the shared `LiveRegion` once per hit (not per character). A `TRANSCRIPT` `PixelButton` toggles a drawer containing the scaffold's `<Conversation />` (from `@/components/pipecat/conversation`; confirm it renders inside the existing provider without extra props); closed by default; hidden in mock mode.

`Announcer` — on every `stage` change while on the fight screen, slam in a banner sequence and remove it: entering `opening` → `ROUND 1` (≈900 ms) then `FIGHT!` (≈700 ms); `rebuttal` → `ROUND 2`; `closing` → `FINAL ROUND`. Pointer-events none; under reduced motion show each for the same duration with no motion. Also sends the text to the `LiveRegion`.

Hit tiers — implement the Style guide's table exactly. Add a pure, unit-tested helper `hitTier(damage: number): 'miss' | 'glancing' | 'solid' | 'super'` in `client/src/arcade/battleText.ts` (0 → miss, 1–5 → glancing, 6–14 → solid, 15+ → super; test-first) and drive every effect from it: number size/colour, shake amplitude and duration (none / none / 2 px·150 ms / 6 px·300 ms), hit-stop (super only, ~4 frames: pause the target's animation and the shake start), stuffing-puff particle count, the fire flare (`<Stage fire="flare">` for ~500 ms on super), and the text box slamming the line in rather than typing (super only). A miss shows a whiff puff at the ATTACKER and no target reaction.

`Armchair` faces and states — per the Style guide: tufted-button eyes and a seam mouth; `hurt` squeezes the eyes to `> <`; `health < 30` shows a tear with stuffing and a slump; props become `{ side; variant: 'challenger' | 'champion' | { typeColorVar: string }; level; hurt; healed; health; pose?: 'idle' | 'win' | 'lose' }`. Side labels read `1P YOU` and `CPU THE HOUSE`.

`FightScreen` wiring: derive per-hit effect flags from `hitCount` and `snapshot.last_hit` using `usePrevious`: when `hitCount` increases, `targetSide = last_hit.by === 'user' ? 'bot' : 'user'` is `hurt` for 400 ms (only if `damage > 0`), `last_hit.by` is `healed` for 600 ms if `recovery > 0`, and the root gets the `shake` class for 300 ms if `damage >= 10` and motion is allowed. None of this state decides WHICH screen shows.

- [ ] **Step 1:** Use the `frontend-design` skill for the visual language, within the tokens and constraints above.
- [ ] **Step 2:** Build the components bottom-up, checking each against `http://localhost:5173/?mock`.
- [ ] **Step 3: Acceptance walk-through on `?mock`** — over one replay loop: both bars start full; the player's bar drops to 86 with a lingering red ghost and the house's chair does NOT recoil while the player's does; the text box types `THE HOUSE used "…"`; the next hit shows `It's super effective!  −18` and shakes the screen; a hit with recovery shows a green `+N` over the healer; the plate advances `ROUND 1 → ROUND 2 → FINAL ROUND` with pips filling and announcer banners on each change; emulating `prefers-reduced-motion` removes shake, bob, typing, and slams while every value still updates.
- [ ] **Step 4:** `npm test && npm run lint && npm run build`, then commit `feat(client): fight screen — health bars, armchairs, hit effects, battle text box`.

---

### Task U.4: The select screen

**Files:**
- Create: `client/src/arcade/components/CardGrid.tsx`, `TheoryCardFace.tsx`
- Replace: `client/src/arcade/screens/SelectScreen.tsx`
- Create: `client/src/arcade/__tests__/gridNav.test.ts` and `client/src/arcade/gridNav.ts`

**Interfaces:**
- Consumes: `TheoryCard`, `typeOf`, `shortName`, `Armchair`, `PixelButton`, tokens; `usePipecatClient()` from `@pipecat-ai/client-react` for `client.sendText(message)` (see `src/components/pipecat/text-input.tsx` line ~187 for the call the scaffold makes).
- Produces: `<SelectScreen cards snapshot onPick />` where `onPick(card)` is supplied by `ArcadeApp` and calls `client.sendText(`My view is ${card.name}.`)` (a no-op that logs in mock mode).
- Produces: `gridNav.ts` — `moveFocus(index: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End', count: number, columns: number): number` — pure, wraps within a row for left/right, clamps for up/down.

**Required behaviour (spec section "SELECT" is authoritative):**
- Test-first for `moveFocus`: right from the last column wraps to the row's first; down from the top row moves to the same column in the bottom row; down from the bottom row stays; `Home`/`End` go to first/last; works for `count = 12, columns = 6` and for a partial last row.
- `CardGrid`: twelve slots, two rows of six (a horizontally scrolling single row under 640 px). Each slot is a `<button>` showing `shortName(card.id)` on its type colour. Roving tabindex: exactly one slot has `tabIndex=0`; arrows move focus via `moveFocus`; Enter/Space/click picks. The focused slot has an unmistakable cursor (a blinking `1P` marker). While `cards` is empty, render twelve disabled blank slots.
- First, bring the contract up to date: add `moves: string[]` to `TheoryCard` in `types.ts`, and refresh `client/src/arcade/fixtures/theory-cards.json` from `docs/design/theory-cards-fixture.json` (merge `debate-mode` into the worktree first; if the fixture there has no `moves` yet, Task S.1 has not landed — stop and report NEEDS_CONTEXT).
- `TheoryCardFace` for the focused card, laid out as the Style guide's trading card: thick frame in the type colour; top row name left, `HP 100` right; framed portrait window with an `Armchair` upholstered in the type colour (`variant={{ typeColorVar }}`); an italic strip giving the Kuhn category in words (`typeOf(card).label`, plus the top-level category when it differs); three moves, each `moves[i]` in the display font over `arguments[i]` in the body font, clamped to two lines with the full text in a `title` attribute and readable on focus; footer `WEAK vs` with a chip per rival (`shortName`); the `claim` as small flavour text at the bottom.
- Header: `CHOOSE YOUR THEORY`; sub-line `— or just say what you think —`.
- After a pick, disable the grid and show `LOCKED IN…` until the stage changes.
- When a snapshot arrives with `snapshot.user.theory_id` set (whether the player clicked or spoke), move the cursor to that card and flash it as locked in.

- [ ] **Step 1:** tests for `moveFocus`, watch them fail, implement.
- [ ] **Step 2:** build `TheoryCardFace` and `CardGrid` with the `frontend-design` skill; check against `?mock` (the replay holds on the select screen for ~9 s, then the snapshot with `theory_id: "gwt"` arrives and the cursor must jump to GWT).
- [ ] **Step 3: Acceptance on `?mock`:** all twelve cards show with six distinct type colours; keyboard-only operation works end to end (Tab into the grid once, arrows move, Enter picks, focus is always visible); the card face never overflows at 375 px; picking logs the exact line `My view is {name}.`.
- [ ] **Step 4:** `npm test && npm run lint && npm run build`, then commit `feat(client): theory card select — grid, card face, pick or speak`.

---

### Task U.5: The decision screen

**Files:**
- Replace: `client/src/arcade/screens/DecisionScreen.tsx`
- Create: `client/src/arcade/hooks/useCountdown.ts`

**Interfaces:**
- Consumes: `FightScreen` with `frozen`, `decisionBanner`, `BattleTextBox`-style typing (reuse `useTypewriter`), `PixelButton`, `Announcer` styling, `client.sendText`.
- Produces: `<DecisionScreen snapshot onRematch />`; `onRematch` is supplied by `ArcadeApp` and sends `I'd like a rematch.`

**Required behaviour (spec sections "DECISION" and Style guide "The finish"):** add a pure, unit-tested `decisionBanners(snapshot): string[]` to `battleText.ts` implementing the Style guide's rule table in order (both bars 0 → `['DOUBLE K.O.']`; draw → `['DRAW GAME']`; loser at 0 → `['K.O.!', 'YOU WIN' | 'YOU LOSE']`; winner at 100 → `['PERFECT!', 'YOU WIN' | 'YOU LOSE']`; otherwise `['YOU WIN' | 'YOU LOSE']`) — test-first, one case per row plus the fixture's final snapshot (`['YOU WIN']`). Render the frozen fight HUD underneath with `<Stage fire="dim">`; slam `JUDGE'S DECISION`; count the two final numbers up side by side (instant under reduced motion); then the banners from `decisionBanners`, which stay; the winner's chair gets `pose="win"`, the loser's `pose="lose"`; final score line `{user.health} — {bot.health}`; type `verdict.rationale` into the text box; then show `CONTINUE?` with a 9-to-0 countdown (one step per second; `useCountdown(9)` returns the current number and stops at 0, pausing while the tab is hidden) and a `REMATCH` button. Clicking calls `onRematch` and shows `HERE COMES A NEW CHALLENGER…` until the stage changes. At zero, replace the prompt with `GAME OVER — THANKS FOR PLAYING`; the REMATCH button remains available. If `verdict` is null (should not happen) show the banner `JUDGE'S DECISION` only. Announce the banner and rationale through the `LiveRegion` once.

- [ ] **Step 1:** build it; check on `?mock` (the replay holds on the verdict snapshot for ~9 s: banner reads `YOU WIN`, score `74 — 61`, rationale types out, countdown runs).
- [ ] **Step 2:** `npm test && npm run lint && npm run build`, then commit `feat(client): judge's decision screen with continue countdown`.

---

### Task U.6: Responsive, accessibility, and polish pass

**Files:** anything under `client/src/arcade/`; `README.md` (one section).

- [ ] **Step 1: Phone layout.** At 375×667: title fits without scrolling; select shows the scrolling card row with the card face below, nothing clipped; fight shows bars (labels stacked), both armchairs, plate, and a text box of at least three lines; decision fits. Fix what does not.
- [ ] **Step 2: Accessibility sweep.** Keyboard-only run through all four screens on `?mock`; visible focus everywhere; both meters announce sensible values; the live region announces each hit once and each announcer banner once; colour is never the only signal (bars have numbers, types have labels); text contrast of `--ink` on `--bg` and `--bg-panel` is at least 4.5:1; reduced-motion run is calm.
- [ ] **Step 3: Robustness.** Cards arriving after the first snapshot; a snapshot with `theory_name: null` during fight (show `???`); `last_hit.reason` of 200 characters (wraps, no overflow); disconnect mid-fight returns to the title and clears the debate; reconnect works.
- [ ] **Step 4: README.** Add an "Arcade UI" section: what the screens are, `?mock`, `?console`, the homage/original-art note, and the font's licence.
- [ ] **Step 5:** `npm test && npm run lint && npm run build`, commit `feat(client): responsive layout, accessibility, and polish for the arcade UI`.
