/** Bite sequence and hook timing. Pure. Times are seconds after the bobber settles. */
import type { Fish, GameConfig, Spot, TimeOfDay, Zone } from '../data/schema';
import { between, betweenInt, weightedIndex, type Rng } from './rng';

export type BiteConfig = GameConfig['bite'];

export interface BitePlan {
  /** seconds until the first nibble (or the dip if no nibbles) */
  waitSeconds: number;
  /** absolute times of fake nibbles */
  nibbleTimes: number[];
  /** absolute time the bobber really dips */
  dipAt: number;
}

export function planBite(cfg: BiteConfig, spot: Spot, rng: Rng): BitePlan {
  const waitSeconds = between(rng, spot.biteDelay.min, spot.biteDelay.max);
  const n = betweenInt(rng, cfg.nibbles.min, cfg.nibbles.max);
  const nibbleTimes: number[] = [];
  let t = waitSeconds;
  for (let i = 0; i < n; i++) {
    nibbleTimes.push(t);
    t += between(rng, cfg.nibbleGap.min, cfg.nibbleGap.max);
  }
  return { waitSeconds, nibbleTimes, dipAt: t };
}

export type HookResult = 'early' | 'hooked' | 'late';

/** Where a tap at time t lands relative to the dip. */
export function hookResult(tapAt: number, dipAt: number, windowSeconds: number): HookResult {
  if (tapAt < dipAt) return 'early';
  if (tapAt > dipAt + windowSeconds) return 'late';
  return 'hooked';
}

/** 1 at the instant of the dip, falling to 0 at the end of the window. */
export function hookQuality(tapAt: number, dipAt: number, windowSeconds: number): number {
  if (hookResult(tapAt, dipAt, windowSeconds) !== 'hooked') return 0;
  return 1 - (tapAt - dipAt) / windowSeconds;
}

/** Fish that can bite here, now, on this bait or lure. `caught` excludes once-only fish already logged. */
export function candidates(
  fish: Fish[], spotId: string, zone: Zone, time: TimeOfDay, equipped: string, caught: Record<string, unknown> = {},
): Fish[] {
  return fish.filter(
    (f) =>
      !(f.once && f.id in caught) &&
      f.spots.includes(spotId) &&
      f.zones.includes(zone) &&
      f.times.includes(time) &&
      f.takes.includes(equipped) &&
      (f.requires === undefined || f.requires === equipped),
  );
}

export function pickFish(cands: Fish[], weights: GameConfig['rarityWeight'], rng: Rng): Fish | null {
  if (cands.length === 0) return null;
  const i = weightedIndex(rng, cands.map((f) => weights[f.rarity]));
  return i < 0 ? null : cands[i];
}

/** Cast power 0..1 to zone. */
export function zoneForPower(power: number, zones: GameConfig['cast']['zones']): Zone {
  if (power < zones.shallow) return 'shallow';
  if (power < zones.mid) return 'mid';
  return 'deep';
}

/** Metres of line out for a cast of this power at this spot. */
export function lineOutForPower(power: number, spot: Spot): number {
  return spot.castRange.min + (spot.castRange.max - spot.castRange.min) * Math.max(0, Math.min(1, power));
}
