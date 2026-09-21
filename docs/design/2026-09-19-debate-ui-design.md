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

No multi-frame sprite animation beyond the states below. See [TODOs](#todos).

## What the real data looks like

Measured in end-to-end runs; the design is built around these:

- A hit arrives as its own event, about 1.5 s after the turn that earned it ends.
  The house's hit lands just after it stops speaking; the player's hit lands while
  the house is already replying. Hits are therefore shown as discrete events with
  their own animation, never implied to be in sync with speech.
- `last_hit.reason` is a 10–15 word declarative sentence, e.g. "Argues GWT conflates
  reportability with experience itself."
- The sequence is fixed: four rounds, eight scored turns, a spoken "judge is
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
| `select` | connected, and no snapshot yet or `stage: "setup"` with nobody matched | both sides are matched to a theory |
| `versus` | `stage: "setup"` with both `theory_id`s set (the lock-in snapshot) | `stage` moves to a debate round and the 2.6 s hold below has run out |
| `fight` | `stage` is `opening`, `rebuttal`, `crossexam`, or `closing` | `stage: "verdict"` |
| `decision` | `stage: "verdict"` | a rematch puts `stage` back to `setup` → `select`; disconnect → `title` |

The `versus` splash is the one screen that also needs time. Live, the lock-in
snapshot and the `opening` one arrive milliseconds apart, so the view holds the
splash for 2.6 s from the moment a pairing appears (`splashKey`, `nextSplash` in
`screen.ts` — pure and unit-tested; the view only runs the timer). It fills air
that is otherwise dead — the bot is composing its opening — and it can only
delay `fight`, never any other screen. A snapshot that already carries a hit
(a page reloaded mid-fight) or a repeat of the same snapshot does not replay it;
a rematch, which passes through an unmatched `setup`, does.

Two URL switches: `?console` renders the scaffold's debugging console instead of
the arcade UI; `?mock` replays fixtures with no server (it implies "connected").

### TITLE

The game's name as a logo, a blinking PRESS START button (connects; the browser's
mic prompt follows), and a one-line instruction: "Say what you think consciousness
is. The house will disagree." Connection errors appear in the text box style used
elsewhere.

### SELECT — the character select, with trading cards

- **Roster.** The twelve theories in one vertical column on the left, each tile in
  its type colour with the theory's full name. One tile has the cursor; that
  card's full face fills the rest of the width.
- **Card face:** a trading card — layout in the Style guide below. Name and
  `HP 100`; the wingback portrait in the theory's type colour; the Kuhn category in
  words; the three moves (each card's `moves[i]` name over its `arguments[i]`
  text, shown in full at desktop width, and expandable on a click where a narrower
  card cuts one); `WEAK vs` listing its `rivals` by short name; the `claim` as
  flavour text, never clamped. Objections and citations are not shown — the player
  should not see their opponent's weaknesses here — and are not sent to the client.
- **Pick or speak.** Speaking works exactly as it does without the UI. Picking
  takes two steps, and nothing is sent until the second:
  1. **Your theory.** Enter or a click on a tile takes it (`1P` flag).
  2. **The house's theory.** The roster closes down to that theory's `rivals` —
     the same list the server chooses from, so a pick is always one it honours —
     under a `CPU` cursor; every other tile steps back. Pick one, or press
     **HOUSE'S CHOICE** to leave it to the bot, which is what speaking does.
     Escape or **BACK** returns to step one.

  The pick is sent as a typed line with `client.sendText()`: `My view is {name}.`
  or `My view is {name}, and I want you to defend {rival} against it.` Either way,
  when a snapshot arrives carrying `user.theory_id`, the versus splash takes over.
  A pick the bot does not confirm within 12 s reopens the roster.
- Arrow keys move the cursor and skip closed tiles; the roster is a single tab
  stop with roving focus.
- Prompt line: "CHOOSE YOUR THEORY — or just say what you think", then "CHOOSE THE
  HOUSE'S THEORY — or let the house pick".
- If the cards have not arrived yet, the roster shows twelve empty slots.

### THE DECK — the card browser

A view of the title screen, not a server state: **THE DECK** under PRESS START
opens the select screen's roster and card face with nothing at stake. A tile only
shows its card, the rival chips on a card are links to the cards they name, and
Escape or **BACK** returns to the title. It needs no connection — it reads the
cards the server sent if there are any, otherwise the copy bundled with the client,
which a server test pins to the real deck.

### VERSUS — the match-up

Two halves cut on a diagonal, each washed in its theory's type colour and sliding
in from its own side: `1P YOU` with the challenger's chair on the left, `CPU THE
HOUSE` with the champion's on the right — the same two chairs that are about to
fight — each over a plate with the theory's name and its family. `VS` slams onto
the seam once both have landed. It is the first time the player sees which theory
the house chose. Nothing is interactive; the live region reads "*X* versus *Y*".
Reduced motion: no slide and no slam, the finished picture simply appears.

### FIGHT — the HUD

- **Bars.** Two bars at the top, the player's on the left and the house's on the
  right, each draining toward the centre. The fill is yellow; behind it a red
  "ghost" holds the previous value for a beat after a hit, then shrinks to meet the
  fill. Below 30 the fill turns red and pulses. The number is shown. Each bar keeps
  `role="meter"` with `aria-valuenow`.
- **Names and round plate.** Theory names under the bars. Centre plate:
  `ROUND 1 · OPENING`, `ROUND 2 · REBUTTAL`, `ROUND 3 · CROSS-EXAMINATION`,
  `FINAL ROUND · CLOSING`, with four round pips. There is no countdown timer: the debate has no clock, and a fake one
  would mislead.
- **Fighters.** Two original pixel-art armchairs facing each other — the player's
  on the left, the house's on the right, mirrored. Each bobs with its side's live
  audio level (the local mic track and the bot's audio track). On a hit the target
  recoils and flashes white, the screen shakes, and a damage number (`−15`) floats
  up from it. A recovery shows a green `+10` rising from the healer and a brief glow.
- **Battle text box.** A bordered box at the bottom that types out each hit:

  ```
  YOU used "Pressed that phi cannot be computed for any real brain."
  It's super effective!  −30
  ```

  The speaker is `YOU` or `THE HOUSE`. The effectiveness line comes from `damage`
  (the applied value the server sends, 0–50): ≥ 30 "It's super effective!", 11–29
  no line, 1–10 "It's not very effective…", 0 "But it missed!". If `recovery > 0` a second line follows: "{SPEAKER} shook off
  the last hit!  +{recovery}". A button on the box opens a transcript drawer, closed
  by default. Before the first hit the box shows a prompt for whose turn it is.
- **Whose move.** The cue under the battle text follows `last_hit.by`: each hit
  hands the floor to the other side. Cross-examination opens with two unscored
  turns, so there the cue names what the round wants instead: `ASK THE HOUSE ONE
  QUESTION` while the last hit is still the player's rebuttal, then `ANSWER THE
  HOUSE` once the house's answer has been scored. (A user's hit usually lands a
  stage late — the round advances about a second after they stop talking and the
  judge takes a few — which is why the fixture shows the cross-examination answer
  scored under `closing`.)
- **Announcer.** A banner that slams in and out on each stage change: `ROUND 1`
  then `FIGHT!`; `ROUND 2`; `ROUND 3` then `CROSS-EXAMINE!`; `FINAL ROUND`.

### DECISION

`JUDGE'S DECISION` banner, the two final numbers counting up, then the result
banner — `YOU WIN`, `YOU LOSE`, `DRAW GAME`, or one of the flourishes (`PERFECT!`,
`K.O.!`, `DOUBLE K.O.`) chosen by the rule table in the Style guide. The final bars
stay on screen, frozen. `verdict.rationale` types
out in the text box. Then `CONTINUE?` with a 9-to-0 countdown and a REMATCH button;
clicking it sends `I'd like a rematch.`; saying so works too. At zero the countdown
is replaced by `GAME OVER — THANKS FOR PLAYING`; the session stays open for
conversation and a rematch can still be asked for by voice.

## Style guide

Decided with the user, one question at a time. Implementers build to this.

### The stage: the study at night

A wood-panelled study. Floor-to-ceiling bookshelves in deep browns and oxblood
fill the background; a pixel fireplace sits between the two chairs and its flicker
is the stage's idle animation; the floor is a Persian rug in place of an arena
floor; one window shows a night sky. The same stage backs the select and decision
screens (dimmed) so the game feels like one place. On a super-effective hit the
fire flares; at the decision the fire dims.

Palette, as CSS custom properties: near-black brown (`--bg`), panel brown
(`--bg-panel`), oxblood, brass (`--accent`), candle yellow (`--bar-fill`), hit red
(`--bar-ghost`, `--bar-danger`), heal green (`--heal`), cream text (`--ink`), dim
cream (`--ink-dim`). HUD yellow and cream must stay high-contrast against the dark
warm background (text contrast at least 4.5:1).

### The fighters: rival wingbacks with faces

Two tall wingback armchairs, anthropomorphised just enough to emote: the wings read
as shoulders, two button-tufts on the backrest are the eyes, the seat-cushion seam
is the mouth. One sprite drawn on a coarse grid as inline SVG rects, re-coloured by
CSS variables:

- **The challenger (the player, left):** worn green leather, a patch or two.
- **The champion (the house, right, mirrored):** immaculate oxblood leather with
  brass studs.
- **On a card portrait:** the same sprite upholstered in that theory's type colour.
- **The emblem.** Each theory has a 7×5 emblem stitched in pale thread on the
  headrest, above the eyes — a broadcast for GWT, phi for IIT, a frame within a
  frame for higher-order thought, an eye for attention schema, a question mark for
  illusionism, a microtubule lattice for Orch OR, and so on (`emblems.ts`; a test
  keeps one per card, all different). It is what tells the eight materialist
  chairs apart, and in a fight each chair wears the emblem of the theory it is
  defending. The house's sprite is mirrored, so its emblem is drawn flipped and
  reads the right way round.

States: *idle* — a breathing bob of one sprite pixel, the house half a cycle behind;
*talking* — bob follows that side's live audio level; *attack* — the chair that
landed the hit lunges at the other and settles back; *hit* — eyes squeeze to
`> <`, chair rocks back on its rear legs, white flash; *low health (< 30)* — a visible tear with stuffing poking out, and a slump;
*win* — a little hop; *lose* — slumped, stuffing out.

On screen the sides are labelled `1P YOU` and `CPU THE HOUSE`.

### Hit feel: scaled to the damage

Tiers, on the same thresholds as the battle text. `damage` is the applied value
the server sends (the judge's score doubled, 0–50):

| Tier | Damage | Feedback |
|---|---|---|
| Miss | 0 | a small "whiff" dust puff at the attacker; no target reaction |
| Glancing | 1–10 | target flinches; small grey number; no shake |
| Solid | 11–29 | target rocks back; white flash; yellow number; 2 px shake for 150 ms; a few stuffing puffs |
| Super effective | 30+ | ~4-frame hit-stop freeze; hard rock-back onto the rear legs; big red number that pops then floats; 6 px shake for 300 ms; a burst of stuffing; the fire flares; the text-box line slams in instead of typing |

Recovery, in any tier: a green `+N` rises from the healer with a brief glow.
Under `prefers-reduced-motion` every tier reduces to the number and the bar change.

### The card face: a trading card, played straight

Familiar anatomy, original layout. A thick frame in the theory's type colour. Top
row: name left, `HP 100` right. A framed portrait window with that theory's
wingback. A thin italic strip under the art giving the Kuhn category in words. Then
the three **moves**: each a short bold move name with its argument text beneath,
shown at a comfortable reading size (the product owner asked for larger text), up
to three lines. Any text that is cut off with an ellipsis must be readable on the
card itself: each move is a button (`aria-expanded`) that expands to its full
argument on click, tap, Enter or Space — accordion style, one open at a time, the
moves panel scrolling as a fallback — and clicking a move never picks the card.
Footer: `WEAK vs` with a chip per rival (short names). The `claim` as flavour text
at the very bottom, never clamped.

Move names are new card data — see Contract additions.

### Type and pixels

- **Press Start 2P** only where text is short and loud: logo, banners, bar labels,
  HP numbers, move names, grid slots, buttons, the round plate.
- **A readable pixel face** — VT323 or Pixelify Sans (both SIL OFL), chosen by the
  implementer for legibility at body sizes — for anything the player reads: argument
  text on cards, the battle text box, the judge's rationale, the transcript, the
  claim. Both fonts are bundled from `@fontsource` packages; no font CDN at runtime.
- Hard edges everywhere: `image-rendering: pixelated`, no border radius, 4 px
  borders, stepped shadows, `steps()` timing on sprite-like motion.
- Light CRT: faint scanlines and a soft vignette, on by default, with a toggle
  remembered in `localStorage` under `arcade.crt`. No curvature, no chromatic
  fringing.
- One type colour per top-level Kuhn category present in the cards (Materialism,
  Integrated Information Theory, Quantum Theories, Panpsychisms, Dualisms,
  Idealisms), plus a neutral fallback.

### The finish: judge's decision, with arcade flourishes

All four rounds always play. Then: the fire dims; `JUDGE'S DECISION` slams in; a
beat while the two final numbers count up side by side; then the result banner,
which the client chooses from the final state:

| Condition (checked in this order) | Banner |
|---|---|
| both bars at 0 | `DOUBLE K.O.` |
| `verdict.winner` is `draw` | `DRAW GAME` |
| the loser's bar is at 0 | `K.O.!` with `YOU WIN` / `YOU LOSE` beneath |
| the winner's bar is still 100 | `PERFECT!` with `YOU WIN` / `YOU LOSE` beneath |
| otherwise | `YOU WIN` / `YOU LOSE` |

The winner's chair hops; the loser's slumps with stuffing out. Then the rationale
types into the text box, then `CONTINUE?` 9 to 0.

### Sound: fifteen cues, no files

Synthesized in the browser with Web Audio — square, triangle and sawtooth
oscillators and a noise burst — so there is nothing to license or load. The cues:
cursor, pick, back, the versus slam, the round jingle, a miss and three tiers of
hit, the shake-off, win / lose / draw, the countdown tick, and game over. Each is a
recipe of tones in `sfx.ts` (pure data, unit-tested to stay short, quiet and in a
chiptune register); `sfxPlayer.ts` is the only part that touches audio.

They are cues under a conversation, not a soundtrack: the mic is open and the bot
speaks through the same speakers, so every tone is capped well below the voice,
and the longest effect is under a second and a half. **SFX ON/OFF** sits beside the
CRT toggle and is remembered the same way. Browsers keep audio suspended until the
page has had a click, so there is no sound before PRESS START, and none on `?mock`
until something is clicked. Reduced motion does not silence it — sound is not
motion — the toggle does.

### Accessibility and small screens

- `prefers-reduced-motion`: no screen shake, no bobbing, no hit-stop, no typing
  effect, no slamming banners, no count-up; state changes remain visible as instant
  changes.
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
   "claim": "…", "moves": ["First Principles", "Cerebellum Puzzle", "Complexity Index"],
   "arguments": ["…", "…", "…"], "rivals": ["gwt", "illusionism", "ast"]}
]}
```

`docs/design/theory-cards-fixture.json` is the example (the real twelve cards). A
server test asserts the message the bot builds has exactly these keys per card, and
the client's mock replays the same file. Messages of any other `type` are ignored.

**Move names.** Each card gains a `moves` field in `theories.yaml`: exactly three
short names, one per argument in the same order, each at most three words and 22
characters, title case, naming the argument the way a fighting game names a special
move ("Cerebellum Puzzle", "Global Ignition"). The loader validates them; they are
sent to the client in `theory_cards`. They are display-only: the bot does not speak
them and the judge never sees them.

**Balance.** Settled with the user on real numbers, and implemented on the server
(see the server spec, "Live judging > Model"): damage is doubled, and a rebuttal
heals at most half of the last hit taken. `last_hit.damage` and `last_hit.recovery`
are the applied values, so the floating numbers always match the bar movement. The
client needs no balance logic of its own.

## Testing

1. Unit tests (vitest) for `screenFor`, `battleText`, `theme`, and the store's
   `receive` (ignores unknown types, counts new hits, stores cards).
2. `?mock` walk-through of all four screens at desktop and phone widths, and once
   with reduced motion emulated.
3. `npm run lint` and `npm run build` clean.
4. One live debate in the integration step: pick a card by clicking; bars, text
   box, announcer, and decision all track the spoken debate.

## TODOs

Nothing open: the versus splash, the sound effects, the per-theory armchairs, the
deck, and choosing the house's theory have all been built. Phone layouts remain
out of scope.
