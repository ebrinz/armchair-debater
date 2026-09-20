import { useEffect, useState } from 'react';

import { createVisualizerAnalyser } from '@/lib/visualizer';

import { useReducedMotion } from './useReducedMotion';

/** Speech RMS is small; this maps a comfortable talking voice onto most of 0..1. */
const GAIN = 6;
/** Below this the chair must be perfectly still, or "you are being heard" means nothing. */
const NOISE_FLOOR = 0.012;
/** Rise fast enough to catch a syllable, fall slowly enough to read as a bob. */
const ATTACK = 0.55;
const RELEASE = 0.12;
/** Twelve steps is finer than any motion driven from this, and cuts re-renders ~5x. */
const STEPS = 12;

/**
 * An `AnalyserNode` RMS level for one audio track, smoothed, clamped to 0..1
 * and sampled on `requestAnimationFrame`. Returns 0 when there is no track and
 * under `prefers-reduced-motion`, and tears the analyser down on unmount or
 * when the track changes.
 *
 * The level is quantised to 1/12 before it reaches React: the chair moves in
 * whole sprite pixels anyway, and this keeps a 60 Hz signal from re-rendering
 * the HUD sixty times a second.
 *
 * `createVisualizerAnalyser` is the scaffold's own helper (src/lib/visualizer.ts:12):
 * one AudioContext per track, disposed by the returned `dispose`.
 */
export const useAudioLevel = (track: MediaStreamTrack | null): number => {
  const reduced = useReducedMotion();
  const [level, setLevel] = useState(0);
  const active = Boolean(track) && !reduced;

  useEffect(() => {
    if (!track || !active) return;

    const { analyser, dispose } = createVisualizerAnalyser(track);
    // An AudioContext created outside a user gesture can start suspended; the
    // analyser would then read pure silence for the whole session.
    void (analyser.context as AudioContext).resume?.().catch(() => {});

    const samples = new Float32Array(analyser.fftSize);
    let smoothed = 0;
    let frame = 0;

    const step = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const raw = rms < NOISE_FLOOR ? 0 : Math.min(1, rms * GAIN);
      smoothed += (raw - smoothed) * (raw > smoothed ? ATTACK : RELEASE);
      const stepped = Math.round(smoothed * STEPS) / STEPS;
      setLevel((current) => (current === stepped ? current : stepped));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      dispose();
    };
  }, [track, active]);

  // Masked rather than reset, so losing a track never needs a render of its own.
  return active ? level : 0;
};
