/**
 * Procedural audio — every sound is synthesized with the Web Audio API.
 * No samples ship with the game. Intensity scales with collision speed.
 * The AudioContext is created lazily on the first user gesture.
 */

import { FX } from '../config';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicOn = false;

  masterVolume = 0.8;
  sfxVolume = 0.9;
  musicVolume = 0.5;
  muted = false;

  /** Must be called from a user-gesture handler at least once. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    // Shared noise source for impacts.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.muted ? 0 : this.masterVolume;
    this.sfxBus.gain.value = this.sfxVolume;
    this.musicBus.gain.value = this.musicVolume * 0.5;
  }

  private tone(
    freq: number,
    duration: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      slideTo?: number;
      attack?: number;
      bus?: GainNode | null;
    } = {},
  ): void {
    const ctx = this.ctx;
    const bus = opts.bus ?? this.sfxBus;
    if (!ctx || !bus || this.muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + duration);
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private thump(cutoff: number, duration: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.25), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // --- game events -------------------------------------------------------

  jump(): void {
    this.tone(240, 0.14, { type: 'sine', slideTo: 460, gain: 0.1 });
  }

  land(impact: number): void {
    const k = Math.min(1, impact / 14);
    this.thump(320 + 300 * k, 0.1, 0.12 * k + 0.03);
  }

  ballHit(speed: number): void {
    const power = Math.min(1, speed / FX.powerHitSpeed);
    // Body "boing" + airy thump; pitch rises slightly with power.
    this.tone(150 + power * 110, 0.16 + power * 0.1, {
      type: 'triangle',
      slideTo: 90,
      gain: 0.16 + power * 0.2,
    });
    this.thump(900 + power * 1800, 0.08 + power * 0.06, 0.1 + power * 0.22);
    if (power > 0.85) this.tone(520, 0.1, { type: 'square', slideTo: 300, gain: 0.06 });
  }

  netHit(speed: number): void {
    const k = Math.min(1, speed / 14);
    this.thump(1400, 0.09, 0.08 + 0.12 * k);
    this.tone(310, 0.1, { type: 'sine', slideTo: 180, gain: 0.06 + 0.08 * k });
  }

  wallHit(speed: number): void {
    const k = Math.min(1, speed / 16);
    this.thump(500, 0.12, 0.09 + 0.14 * k);
  }

  groundHit(speed: number): void {
    const k = Math.min(1, speed / 16);
    this.thump(240, 0.18, 0.14 + 0.2 * k);
    this.tone(90, 0.2, { type: 'sine', slideTo: 50, gain: 0.12 + 0.1 * k });
  }

  point(): void {
    this.tone(523, 0.12, { type: 'triangle', gain: 0.14 });
    setTimeout(() => this.tone(659, 0.14, { type: 'triangle', gain: 0.14 }), 90);
    setTimeout(() => this.tone(784, 0.22, { type: 'triangle', gain: 0.16 }), 180);
  }

  matchWin(): void {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((n, i) =>
      setTimeout(() => this.tone(n, 0.22, { type: 'triangle', gain: 0.16 }), i * 130),
    );
  }

  menuSelect(): void {
    this.tone(660, 0.07, { type: 'sine', gain: 0.08 });
  }

  menuMove(): void {
    this.tone(440, 0.05, { type: 'sine', gain: 0.05 });
  }

  countdownTick(final: boolean): void {
    this.tone(final ? 880 : 550, final ? 0.18 : 0.08, { type: 'sine', gain: 0.1 });
  }

  // --- ambient music -----------------------------------------------------

  /** Gentle generative chord pad, advanced from the render loop. */
  setMusic(on: boolean): void {
    this.musicOn = on;
  }

  update(dt: number): void {
    if (!this.ctx || !this.musicOn || this.muted || this.musicVolume <= 0.01) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 2.4;
    const chords = [
      [261.6, 329.6, 392.0],
      [220.0, 261.6, 329.6],
      [174.6, 220.0, 261.6],
      [196.0, 246.9, 293.7],
    ];
    const chord = chords[this.musicStep % chords.length];
    this.musicStep++;
    for (const f of chord) {
      this.tone(f, 2.2, { type: 'sine', gain: 0.045, attack: 0.4, bus: this.musicBus });
      this.tone(f * 2, 2.0, { type: 'sine', gain: 0.012, attack: 0.5, bus: this.musicBus });
    }
  }
}
