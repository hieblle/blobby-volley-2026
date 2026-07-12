/** Small math helpers shared across modules. */

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exponential approach that is stable for any dt. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

export const len = (x: number, y: number): number => Math.hypot(x, y);

/**
 * Deterministic PRNG (mulberry32). The AI uses this for its controlled
 * prediction error so behavior is reproducible for a given seed.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately normal(0,1) from three uniform samples. */
export function gaussian(rng: () => number): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}
