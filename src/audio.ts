/**
 * Tiny procedural sound bank.
 *
 * Everything is synthesised from oscillators and a single noise buffer, so the
 * game still ships with zero audio assets. The AudioContext is borrowed from
 * Phaser's sound manager, which already handles the browser unlock gesture.
 */

const MUTE_KEY = "fruitblaster:muted:v1";

export type SfxName =
  | "launch"
  | "paddle"
  | "wall"
  | "tick"
  | "crack"
  | "shatter"
  | "power"
  | "explode"
  | "multiball"
  | "levelup"
  | "egg"
  | "lose"
  | "gameover";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private lastPlayed = new Map<SfxName, number>();

  constructor(ctx: AudioContext | null | undefined) {
    this.muted = readMuted();
    if (!ctx) return;

    try {
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);
      this.noise = makeNoise(ctx);
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  get isMuted() {
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // Non-fatal: the preference simply will not persist.
    }
    return this.muted;
  }

  /** Browsers start suspended until a gesture; call this from input handlers. */
  resume() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(name: SfxName, detune = 0) {
    if (!this.ctx || !this.master || this.muted) return;

    // Explosions can break a dozen bricks in one frame. Throttling per sound
    // keeps those bursts from turning into a wall of clipping.
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.028) return;
    this.lastPlayed.set(name, now);

    const t = now + 0.001;
    const r = 2 ** (detune / 12);

    switch (name) {
      case "launch":
        this.tone(t, "triangle", 240 * r, 700 * r, 0.16, 0.18);
        break;
      case "paddle":
        this.tone(t, "triangle", 380 * r, 190 * r, 0.09, 0.3);
        this.burst(t, 0.03, 2400, 0.06);
        break;
      case "wall":
        this.tone(t, "square", 620 * r, 520 * r, 0.04, 0.07);
        break;
      case "tick":
        this.tone(t, "triangle", 1180 * r, 860 * r, 0.05, 0.14);
        this.burst(t, 0.035, 5200, 0.05);
        break;
      case "crack":
        this.tone(t, "square", 300 * r, 150 * r, 0.09, 0.14);
        this.burst(t, 0.06, 1400, 0.09);
        break;
      case "shatter":
        this.tone(t, "triangle", 1500 * r, 640 * r, 0.1, 0.13);
        this.burst(t, 0.16, 6400, 0.14, 3200);
        break;
      case "power":
        [0, 4, 7, 12].forEach((step, i) => {
          this.tone(t + i * 0.055, "triangle", 440 * 2 ** (step / 12), 0, 0.16, 0.16);
        });
        break;
      case "multiball":
        [0, 7, 12].forEach((step, i) => {
          this.tone(t + i * 0.04, "square", 520 * 2 ** (step / 12), 0, 0.1, 0.1);
        });
        break;
      case "explode":
        this.tone(t, "sine", 190, 44, 0.34, 0.34);
        this.burst(t, 0.3, 1100, 0.26);
        break;
      case "levelup":
        [0, 4, 7, 12, 16].forEach((step, i) => {
          this.tone(t + i * 0.085, "triangle", 392 * 2 ** (step / 12), 0, 0.3, 0.16);
        });
        break;
      case "egg":
        [0, 5, 9].forEach((step, i) => {
          this.tone(t + i * 0.1, "sine", 660 * 2 ** (step / 12), 0, 0.34, 0.13);
        });
        break;
      case "lose":
        this.tone(t, "sawtooth", 300, 90, 0.42, 0.16);
        break;
      case "gameover":
        [0, -3, -7, -12].forEach((step, i) => {
          this.tone(t + i * 0.15, "sawtooth", 330 * 2 ** (step / 12), 0, 0.42, 0.14);
        });
        break;
    }
  }

  private tone(
    at: number,
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
  ) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);

    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private burst(at: number, duration: number, cutoff: number, gain: number, endCutoff?: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(cutoff, at);
    if (endCutoff) filter.frequency.exponentialRampToValueAtTime(endCutoff, at + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(at);
    src.stop(at + duration + 0.02);
  }
}

function makeNoise(ctx: AudioContext) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
