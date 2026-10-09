/** Seeded RNG (mulberry32) so simulations and tests are reproducible. Returns [0, 1). */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomRng: Rng = () => Math.random();

export function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function betweenInt(rng: Rng, min: number, max: number): number {
  return Math.floor(between(rng, min, max + 1));
}

/** Pick by weight. Returns -1 for an empty list. */
export function weightedIndex(rng: Rng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
