/*
 * The noise gate and silence detector, as a pure function of samples and
 * time so it can be tested without a microphone.
 *
 * Level is RMS through a gain and a curve, so speech fills the meter and the
 * room's hum does not. Nothing shows until the level first crosses the
 * activation threshold (the person started speaking); after that it never
 * drops below `minActiveLevel` while there is sound, so the meter reads as
 * alive. Silence is measured from the last sample above `silenceLevel`.
 */

export interface NoiseGateOptions {
  /** Level that counts as the person starting to speak. Default 0.25. */
  activationThreshold?: number;
  /** Floor for a level once speech has started. Default 0.06. */
  minActiveLevel?: number;
  /** Gain on the RMS before the curve. Default 8. */
  gain?: number;
  /** Curve exponent: under 1 lifts quiet speech. Default 0.6. */
  curveExponent?: number;
}

export interface SilenceOptions {
  /** Stop on its own after a pause. Default false. */
  enabled?: boolean;
  /** How long a pause stops it. Default 1200. */
  autoStopMs?: number;
  /** Speech needed before a pause can stop it. Default 300. */
  minSpeechMs?: number;
  /** Below this level counts as silence. Default `minActiveLevel`. */
  minLevel?: number;
}

export interface GateReading {
  /** 0–1, for a meter. */
  level: number;
  /** The person has started speaking. */
  activated: boolean;
  /** Silence auto-stop says stop now. */
  shouldStop: boolean;
}

export interface Gate {
  /** Feed one frame: its RMS (0–1) and the time in ms. */
  push(rms: number, nowMs: number): GateReading;
}

export function createGate(noise: NoiseGateOptions = {}, silence: SilenceOptions = {}): Gate {
  const threshold = noise.activationThreshold ?? 0.25;
  const floor = noise.minActiveLevel ?? 0.06;
  const gain = noise.gain ?? 8;
  const curve = noise.curveExponent ?? 0.6;
  const stopAfter = silence.enabled ? (silence.autoStopMs ?? 1200) : Infinity;
  const minSpeech = silence.minSpeechMs ?? 300;
  const silentBelow = silence.minLevel ?? floor;

  let activatedAt: number | null = null;
  let lastLoud = 0;

  return {
    push(rms, nowMs) {
      const raw = Math.min(1, Math.pow(Math.max(0, rms) * gain, curve));
      if (activatedAt === null && raw > threshold) {
        activatedAt = nowMs;
        lastLoud = nowMs;
      }
      if (activatedAt === null) return { level: 0, activated: false, shouldStop: false };
      if (raw > silentBelow) lastLoud = nowMs;
      const level = raw < floor * 0.5 ? 0 : Math.max(floor, raw);
      const shouldStop = nowMs - activatedAt >= minSpeech && nowMs - lastLoud >= stopAfter;
      return { level, activated: true, shouldStop };
    },
  };
}

/** RMS of 8-bit time-domain samples (an AnalyserNode's getByteTimeDomainData). */
export function rmsOf(samples: Uint8Array): number {
  let sum = 0;
  for (const sample of samples) {
    const v = (sample - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}
