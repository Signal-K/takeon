/**
 * Synthesised game audio — no asset files, no dependencies. Every sound is
 * generated with the Web Audio API on demand, so it ships inside the engine
 * bundle and stays crisp at any pitch.
 *
 * Browser-only and fully guarded: with no `AudioContext` (Node, tests) every
 * method is a no-op, honouring the engine's "works without a DOM" rule.
 * Autoplay policies require `unlock()` to be called from a user gesture.
 */

export interface GameAudioOptions {
  /** 0..1 master volume. */
  volume?: number;
  /** Start muted (still unlockable later). */
  enabled?: boolean;
}

type AudioCtor = typeof AudioContext;

/** Per-body ambient character: wind level + drone pitches. */
interface AmbientProfile {
  wind: number; // 0..1 filtered-noise bed
  drones: number[]; // low pad frequencies (Hz)
  bright: number; // filter cutoff scale
}

function ambientProfile(bodyId: string): AmbientProfile {
  switch (bodyId) {
    case 'mars':
      return { wind: 0.5, drones: [55, 82.5], bright: 1 };
    case 'io':
      return { wind: 0.35, drones: [49, 61.7, 98], bright: 0.8 };
    case 'europa':
      return { wind: 0.12, drones: [65.4, 98, 130.8], bright: 1.6 };
    case 'ceres':
      return { wind: 0.14, drones: [61.7, 92.5], bright: 1.5 };
    case 'bennu':
      return { wind: 0.08, drones: [43.7, 65.4], bright: 0.9 };
    case 'moon':
      return { wind: 0.04, drones: [48, 72], bright: 1.1 };
    default:
      return { wind: 0.3, drones: [55, 82.5], bright: 1 };
  }
}

export class GameAudio {
  enabled: boolean;
  private volume: number;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientNodes: AudioScheduledSourceNode[] = [];
  private noise: AudioBuffer | null = null;
  private ambientBody: string | null = null;
  private lastStep = 0;

  constructor(opts: GameAudioOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.volume = clamp01(opts.volume ?? 0.6);
  }

  get ready(): boolean {
    return this.ctx != null;
  }

  /** Create/resume the audio context. Call from a click/tap (autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: AudioCtor | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!AC) return; // no Web Audio here → stay silent
    try {
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = this.enabled ? this.volume : 0;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      const sfx = ctx.createGain();
      sfx.gain.value = 1;
      sfx.connect(master);
      const amb = ctx.createGain();
      amb.gain.value = 0;
      amb.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.sfxGain = sfx;
      this.ambientGain = amb;
      this.noise = makeNoise(ctx, 2);
      if (this.ambientBody) this.startAmbient(this.ambientBody);
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.03);
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.master && this.ctx && this.enabled) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  // ── Ambient bed ─────────────────────────────────────────────────────────

  /** Begin the per-body ambient drone + wind. Safe to call before unlock. */
  startAmbient(bodyId: string): void {
    this.ambientBody = bodyId;
    const ctx = this.ctx;
    const amb = this.ambientGain;
    if (!ctx || !amb || !this.noise) return;
    this.stopAmbientNodes();
    const prof = ambientProfile(bodyId);
    const t = ctx.currentTime;

    // Low detuned drone pads.
    for (const f of prof.drones) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const det = ctx.createOscillator();
      det.type = 'sine';
      det.frequency.value = f * 1.005;
      const g = ctx.createGain();
      g.gain.value = 0.09;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.06 + Math.random() * 0.05;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.03;
      lfo.connect(lfoGain).connect(g.gain);
      osc.connect(g);
      det.connect(g);
      g.connect(amb);
      osc.start(t);
      det.start(t);
      lfo.start(t);
      this.ambientNodes.push(osc, det, lfo);
    }

    // Filtered-noise wind bed.
    if (prof.wind > 0.02) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 480 * prof.bright;
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.05 * prof.wind;
      const swirl = ctx.createOscillator();
      swirl.type = 'sine';
      swirl.frequency.value = 0.08;
      const swirlGain = ctx.createGain();
      swirlGain.gain.value = 260 * prof.bright;
      swirl.connect(swirlGain).connect(bp.frequency);
      src.connect(bp).connect(g).connect(amb);
      src.start(t);
      swirl.start(t);
      this.ambientNodes.push(src, swirl);
    }

    amb.gain.setTargetAtTime(0.9, t, 2); // fade in
  }

  stopAmbient(): void {
    if (this.ctx && this.ambientGain) {
      this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
    this.stopAmbientNodes(0.6);
  }

  private stopAmbientNodes(after = 0): void {
    const ctx = this.ctx;
    const nodes = this.ambientNodes;
    this.ambientNodes = [];
    if (!ctx) return;
    for (const n of nodes) {
      try {
        n.stop(ctx.currentTime + after);
      } catch {
        /* already stopped */
      }
    }
  }

  // ── SFX ───────────────────────────────────────────────────────────────

  moveStep(): void {
    // Rate-limit footfalls so fast driving doesn't machine-gun.
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.currentTime - this.lastStep < 0.09) return;
    this.lastStep = ctx.currentTime;
    this.tone({ type: 'square', f0: 120, f1: 90, dur: 0.05, gain: 0.05 });
  }

  mine(): void {
    this.noiseBurst({ dur: 0.13, gain: 0.16, type: 'bandpass', f0: 1400, f1: 500 });
    this.tone({ type: 'triangle', f0: 190, f1: 90, dur: 0.12, gain: 0.06 });
  }

  build(): void {
    this.tone({ type: 'sine', f0: 440, f1: 660, dur: 0.14, gain: 0.14 });
    this.tone({ type: 'sine', f0: 660, f1: 880, dur: 0.16, gain: 0.1, delay: 0.09 });
  }

  place(): void {
    this.tone({ type: 'square', f0: 220, f1: 160, dur: 0.09, gain: 0.09 });
  }

  deposit(): void {
    this.tone({ type: 'sine', f0: 300, f1: 240, dur: 0.1, gain: 0.1 });
    this.tone({ type: 'sine', f0: 240, f1: 200, dur: 0.12, gain: 0.09, delay: 0.08 });
  }

  scan(): void {
    this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.5, gain: 0.1 });
    this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.5, gain: 0.05, delay: 0.16 });
  }

  photo(): void {
    this.noiseBurst({ dur: 0.03, gain: 0.14, type: 'highpass', f0: 2500, f1: 2500 });
    this.noiseBurst({ dur: 0.04, gain: 0.12, type: 'highpass', f0: 1800, f1: 1800, delay: 0.06 });
  }

  craft(): void {
    this.chord([392, 523.3], 0.18, 0.08);
  }

  discovery(): void {
    this.chord([523.3, 659.3, 784], 0.5, 0.12); // C-E-G
  }

  habitat(): void {
    this.chord([349.2, 440, 523.3], 0.6, 0.11); // F-A-C, warm
  }

  upgrade(): void {
    const notes = [440, 554.4, 659.3, 880];
    notes.forEach((f, i) => this.tone({ type: 'triangle', f0: f, f1: f, dur: 0.12, gain: 0.11, delay: i * 0.07 }));
  }

  launch(): void {
    // Low rumble + rising noise whoosh.
    this.tone({ type: 'sawtooth', f0: 70, f1: 40, dur: 1.2, gain: 0.14 });
    this.noiseBurst({ dur: 1.1, gain: 0.16, type: 'lowpass', f0: 300, f1: 2600 });
  }

  damage(): void {
    this.noiseBurst({ dur: 0.18, gain: 0.2, type: 'lowpass', f0: 900, f1: 200 });
    this.tone({ type: 'sawtooth', f0: 150, f1: 70, dur: 0.16, gain: 0.08 });
  }

  repair(): void {
    this.tone({ type: 'sine', f0: 520, f1: 720, dur: 0.16, gain: 0.1 });
  }

  weather(): void {
    this.tone({ type: 'sine', f0: 130, f1: 90, dur: 0.9, gain: 0.09 });
    this.noiseBurst({ dur: 0.9, gain: 0.06, type: 'bandpass', f0: 300, f1: 700 });
  }

  error(): void {
    this.tone({ type: 'sawtooth', f0: 160, f1: 120, dur: 0.14, gain: 0.08 });
  }

  lost(): void {
    this.tone({ type: 'sawtooth', f0: 320, f1: 70, dur: 1.1, gain: 0.16 });
  }

  // ── Synthesis primitives ────────────────────────────────────────────────

  private tone(o: { type: OscillatorType; f0: number; f1: number; dur: number; gain: number; delay?: number }): void {
    const ctx = this.ctx;
    const out = this.sfxGain;
    if (!ctx || !out || !this.enabled) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  private noiseBurst(o: { dur: number; gain: number; type: BiquadFilterType; f0: number; f1: number; delay?: number }): void {
    const ctx = this.ctx;
    const out = this.sfxGain;
    if (!ctx || !out || !this.noise || !this.enabled) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type;
    filt.frequency.setValueAtTime(o.f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filt).connect(g).connect(out);
    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  private chord(freqs: number[], dur: number, gain: number): void {
    for (const f of freqs) this.tone({ type: 'sine', f0: f, f1: f, dur, gain });
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
