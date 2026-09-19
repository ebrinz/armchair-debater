# Debate UI v1 — "Arcade Edition" — Design

Date: 2026-09-19
Status: approved for planning
Companion to: `2026-09-19-debate-mode-design.md` (the server and the state contract)

## Goal

A purpose-built debate screen that makes the judged debate feel like a fight: a
16-bit fighting-game presentation of the two health bars, with the twelve theory
cards as a Pokémon-style character select. The user's original brief: "a strength
meter like a health gauge that draws down if the user's argument is good but goes
back up during the rebuttal."

It is an homage, not a copy. All art is original CSS or inline SVG; the font is
open-licensed (Press Start 2P, SIL OFL); no Capcom or Nintendo sprites, logos,
character names, or sounds are used.

## Non-goals (v1)

No VS splash screen. No sound effects. No per-theory armchair variants or
multi-frame sprite animation. No card-collection browser. See [TODOs](#todos).

## What the real data looks like

Measured in end-to-end runs; the design is built around these:

- A hit arrives as its own event, about 1.5 s after the turn that earned it ends.
  The house's hit lands just after it stops speaking; the player's hit lands while
  the house is already replying. Hits are therefore shown as discrete events with
  their own animation, never implied to be in sync with speech.
- `last_hit.reason` is a 10–15 word declarative sentence, e.g. "Argues GWT conflates
  reportability with experience itself."
- The sequence is fixed: three rounds, six scored turns, a spoken "judge is
  tallying" line, then a verdict with a two-sentence rationale.

## Screens

The screen is a pure function of connection state and the latest snapshot. The
client keeps no screen state of its own, so it cannot drift from the server.

```ts
screenFor(connected: boolean, snapshot: DebateSnapshot | null): Screen
```

| Screen | When | Leaves when |
|---|---|---|
| `title` | not connected | PRESS START connects and unlocks the mic |
| `select` | connected, and no snapshot yet or `stage: "setup"` | a snapshot arrives with `stage` in a debate round |
| `fight` | `stage` is `opening`, `rebuttal`, or `closing` | `stage: "verdict"` |
| `decision` | `stage: "verdict"` | a rematch puts `stage` back to `setup` → `select`; disconnect → `title` |

Two URL switches: `?console` renders the scaffold's debugging console instead of
the arcade UI; `?mock` replays fixtures with no server (it implies "connected").

### TITLE

The game's name as a logo, a blinking PRESS START button (connects; the browser's
mic prompt follows), and a one-line instruction: "Say what you think consciousness
is. The house will disagree." Connection errors appear in the text box style used
elsewhere.

### SELECT — the character select, with Pokémon-style cards

- A grid of the twelve theory cards, two rows of six, each slot showing the
  theory's short name and its type colour. One slot has focus; the focused card's
  full face is shown beside the grid (below it on a narrow screen).
- **Card face:** name and `HP 100`; a type badge (the last segment of
  `kuhn_category`, coloured by its top-level category); the armchair portrait; the
  `claim` as flavour text; the three `arguments` as its moves, each clamped to two
  lines with the full text available on focus/hover; `WEAK vs` listing its `rivals`
  by short name. Objections and citations are not shown — the player should not see
  their opponent's weaknesses on the select screen — and are not sent to the client.
- **Pick or speak.** Clicking a card (or Enter on the focused slot) sends the typed
  line `My view is {name}.` with `client.sendText()`. Speaking works exactly as it
  does without the UI. Either way, when a snapshot arrives carrying
  `user.theory_id`, the cursor jumps to that slot and it locks in with a flash; the
  house's pick is revealed when the stage changes.
- Arrow keys move the cursor; the grid is a single tab stop with roving focus.
- Prompt line: "CHOOSE YOUR THEORY — or just say what you think".
- If the cards have not arrived yet, the grid shows twelve empty slots.

### FIGHT — the HUD

- **Bars.** Two bars at the top, the player's on the left and the house's on the
  right, each draining toward the centre. The fill is yellow; behind it a red
  "ghost" holds the previous value for a beat after a hit, then shrinks to meet the
  fill. Below 30 the fill turns red and pulses. The number is shown. Each bar keeps
  `role="meter"` with `aria-valuenow`.
- **Names and round plate.** Theory names under the bars. Centre plate:
  `ROUND 1 · OPENING`, `ROUND 2 · REBUTTAL`, `FINAL ROUND · CLOSING`, with three
  round pips. There is no countdown timer: the debate has no clock, and a fake one
  would mislead.
- **Fighters.** Two original pixel-art armchairs facing each other — the player's
  on the left, the house's on the right, mirrored. Each bobs with its side's live
  audio level (the local mic track and the bot's audio track). On a hit the target
  recoils and flashes white, the screen shakes, and a damage number (`−15`) floats
  up from it. A recovery shows a green `+10` rising from the healer and a brief glow.
- **Battle text box.** A bordered box at the bottom that types out each hit:

  ```
  YOU used "Pressed that phi cannot be computed for any real brain."
  It's super effective!  −18
  ```

  The speaker is `YOU` or `THE HOUSE`. The effectiveness line comes from `damage`:
  ≥ 15 "It's super effective!", 6–14 no line, 1–5 "It's not very effective…",
  0 "But it missed!". If `recovery > 0` a second line follows: "{SPEAKER} shook off
  the last hit!  +{recovery}". A button on the box opens a transcript drawer, closed
  by default. Before the first hit the box shows a prompt for whose turn it is.
- **Announcer.** A banner that slams in and out on each stage change: `ROUND 1`
  then `FIGHT!`; `ROUND 2`; `FINAL ROUND`.

### DECISION

`JUDGE'S DECISION` banner, then `YOU WIN`, `YOU LOSE`, or `DRAW GAME` from
`verdict.winner`. The final bars stay on screen, frozen. `verdict.rationale` types
out in the text box. Then `CONTINUE?` with a 9-to-0 countdown and a REMATCH button;
clicking it sends `I'd like a rematch.`; saying so works too. At zero the countdown
is replaced by `GAME OVER — THANKS FOR PLAYING`; the session stays open for
conversation and a rematch can still be asked for by voice.

## Style

- Font: Press Start 2P for all display text; the long card and rationale text may
  use a readable pixel-compatible fallback size but the same family. Self-hosted or
  Google Fonts; OFL.
- Limited saturated palette defined as CSS custom properties; hard edges
  (`image-rendering: pixelated`, no border radius, 4 px borders, stepped shadows);
  stepped (`steps()`) timing on sprite-like motion.
- An optional CRT scanline overlay, on by default, with a toggle that is remembered
  in `localStorage`.
- One type colour per top-level Kuhn category present in the cards (Materialism,
  Integrated Information Theory, Quantum Theories, Panpsychisms, Dualisms,
  Idealisms), plus a neutral fallback for any other.
- `prefers-reduced-motion`: no screen shake, no bobbing, no typing effect, no
  slamming banners; state changes remain visible as instant changes.
- Works at phone width in portrait: the select grid becomes a horizontally
  scrolling row with the card face below it; the armchairs shrink; bars stack their
  labels.

## Architecture

```
client/src/
  main.tsx                    # ?console → scaffold Console; otherwise <ArcadeApp/>
  arcade/
    types.ts                  # DebateSnapshot, TheoryCard, server messages
    store.ts                  # zustand: snapshot, cards, hitCount; receive(msg)
    screen.ts                 # screenFor() — pure
    battleText.ts             # hit → lines for the text box — pure
    theme.ts                  # type colours, short names — pure
    mock.ts                   # replays fixtures into the store
    fixtures/                 # copies of the two contract fixture files
    ArcadeApp.tsx             # client lifecycle, provider, server-message hook, screen switch
    screens/ TitleScreen, SelectScreen, FightScreen, DecisionScreen
    components/ HealthBar, RoundPlate, Armchair, DamageNumber, BattleTextBox,
                Announcer, TheoryCardFace, CardGrid, PixelButton, CrtOverlay
    hooks/ useAudioLevel.ts   # 0..1 level from a MediaStreamTrack
    arcade.css                # tokens, pixel primitives, keyframes
```

`ArcadeApp` reuses the scaffold's `usePipecatApp` for the client lifecycle,
`PipecatClientProvider`, `BotAudioOutput`, and `useRTVIClientEvent(
RTVIEvent.ServerMessage, …)`; it does not reimplement connection handling. The pure
modules (`screen`, `battleText`, `theme`, the store's reducer logic) carry the unit
tests; components are verified against the `?mock` replay.

## Contract additions

The `debate_state` snapshot is unchanged. One new server message, sent once when
the client is ready, before the first snapshot:

```json
{"type": "theory_cards", "cards": [
  {"id": "iit", "name": "Integrated Information Theory",
   "kuhn_category": "Integrated Information Theory",
   "claim": "…", "arguments": ["…", "…", "…"], "rivals": ["gwt", "illusionism", "ast"]}
]}
```

`docs/design/theory-cards-fixture.json` is the example (the real twelve cards). A
server test asserts the message the bot builds has exactly these keys per card, and
the client's mock replays the same file. Messages of any other `type` are ignored.

**Damage scale.** With measured hits of 5–15 over six turns, a lost debate ends
near 65, which leaves the bars looking undramatic. After the turn-capture fixes
land and the numbers can be trusted, a single server-side multiplier on damage will
be tuned so that a clearly lost debate ends near 30. This is a server constant; the
client needs no change.

## Testing

1. Unit tests (vitest) for `screenFor`, `battleText`, `theme`, and the store's
   `receive` (ignores unknown types, counts new hits, stores cards).
2. `?mock` walk-through of all four screens at desktop and phone widths, and once
   with reduced motion emulated.
3. `npm run lint` and `npm run build` clean.
4. One live debate in the integration step: pick a card by clicking; bars, text
   box, announcer, and decision all track the spoken debate.

## TODOs

- VS splash between select and fight.
- Synthesized 8-bit sound effects with a mute toggle.
- A distinct armchair per theory; idle, attack, and hurt frames.
- Card-collection browser (the parked explorer mode, in miniature).
- Let the player choose the house's theory too.
