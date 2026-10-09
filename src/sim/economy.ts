/** Size rolls and coin values. Pure. */
import type { Fish, GameConfig } from '../data/schema';
import type { Rng } from './rng';

/** Triangular distribution with the mode at 35% of the range: most fish are smallish, big ones are rare. */
export function rollSizeCm(fish: Fish, rng: Rng, mode = 0.35): number {
  const u = rng();
  const t = u < mode ? Math.sqrt(u * mode) : 1 - Math.sqrt((1 - u) * (1 - mode));
  const cm = fish.sizeCm.min + (fish.sizeCm.max - fish.sizeCm.min) * t;
  return Math.round(cm * 10) / 10;
}

export function sizeFraction(fish: Fish, sizeCm: number): number {
  const span = fish.sizeCm.max - fish.sizeCm.min;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (sizeCm - fish.sizeCm.min) / span));
}

export function sellValue(fish: Fish, sizeCm: number, eco: GameConfig['economy']): number {
  const f = sizeFraction(fish, sizeCm);
  let v = fish.value * (eco.sellLowMult + (eco.sellHighMult - eco.sellLowMult) * f);
  if (f >= eco.bigFishBonusAt) v *= eco.bigFishBonusMult;
  return Math.max(1, Math.round(v));
}
