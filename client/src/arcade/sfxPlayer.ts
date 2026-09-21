/**
 * Turns a recipe from `sfx.ts` into Web Audio. The one impure corner of the
 * sound effects: it owns the AudioContext, the master volume, and whether the
 * player has muted it (remembered, like the CRT toggle).
 *
 * It fails silent. Browsers keep an AudioContext suspended until the page has
 * had a click or a key press, so before PRESS START — and on `?mock`, until
 * something is clicked — there is simply no sound, and nothing here throws.
 */

import { RECIPES } from './sfx';
import type { SfxName, Tone } from './sfx';

const KEY = 'arcade.sfx';
/** Well under the bot's voice, which comes out of the same speakers. */
const MASTER = 0.5;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

const readMuted = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
};

let muted = typeof window === 'undefined' ? true : readMuted();

/** When each sound last started, to drop an echo of the same request. */
const lastPlayed = new Map<SfxName, number>();
const ECHO_MS = 45;

export const isMuted = (): boolean => muted;

export const setMuted = (value: boolean): void => {
  muted = value;
  try {
    window.localStorage.setItem(KEY, value ? 'off' : 'on');
  } catch {
    // Storage disabled: the toggle still works for this session.
  }
};

const ensure = (): AudioContext | null => {
  if (context) return context;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = MASTER;
  master.connect(context.destination);
  // One second of white noise, reused by every percussive burst.
  noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return context;
};

const schedule = (ctx: AudioContext, tone: Tone, start: number): void => {
  if (!master) return;
  const from = start + tone.at / 1000;
  const until = from + tone.ms / 1000;

  // A hard attack and a short release: square-wave cues, not swells.
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, from);
  envelope.gain.linearRampToValueAtTime(tone.gain, from + 0.004);
  envelope.gain.setValueAtTime(tone.gain, Math.max(from + 0.004, until - 0.02));
  envelope.gain.linearRampToValueAtTime(0, until);
  envelope.connect(master);

  if (tone.wave === 'noise') {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.connect(envelope);
    source.start(from);
    source.stop(until);
    return;
  }
  const oscillator = ctx.createOscillator();
  oscillator.type = tone.wave;
  oscillator.frequency.setValueAtTime(tone.from, from);
  if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, until);
  oscillator.connect(envelope);
  oscillator.start(from);
  oscillator.stop(until);
};

export const playSfx = (name: SfxName): void => {
  if (muted) return;
  try {
    const ctx = ensure();
    if (!ctx) return;
    const go = () => {
      if (ctx.state !== 'running') return;
      // Asked for twice in one breath — React's development double-mount, or two
      // components answering one event — it plays once.
      const now = performance.now();
      if (now - (lastPlayed.get(name) ?? -Infinity) < ECHO_MS) return;
      lastPlayed.set(name, now);
      const start = ctx.currentTime + 0.01;
      for (const tone of RECIPES[name]) schedule(ctx, tone, start);
    };
    if (ctx.state === 'running') return go();
    // Suspended until the page has had a gesture. Inside one — the click that
    // asked for this very sound — resuming is allowed but asynchronous, so the
    // sound waits for it. Outside one the request is dropped rather than queued:
    // a backlog would all fire at once on the first click.
    if (navigator.userActivation?.isActive) void ctx.resume().then(go);
  } catch {
    // Sound is decoration: a browser that refuses it changes nothing else.
  }
};
