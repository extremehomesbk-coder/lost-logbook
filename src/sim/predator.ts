/** Predator steal attempt: a quick-tap defense. Pure. */
import type { GameConfig } from '../data/schema';

export type PredatorConfig = GameConfig['predator'];

export interface PredatorState {
  taps: number;
  timeLeft: number;
  outcome: 'active' | 'won' | 'lost';
}

export function startPredator(cfg: PredatorConfig): PredatorState {
  return { taps: 0, timeLeft: cfg.seconds, outcome: 'active' };
}

export function predatorTap(s: PredatorState, cfg: PredatorConfig): PredatorState {
  if (s.outcome !== 'active') return s;
  s.taps += 1;
  if (s.taps >= cfg.taps) s.outcome = 'won';
  return s;
}

export function stepPredator(s: PredatorState, dt: number): PredatorState {
  if (s.outcome !== 'active') return s;
  s.timeLeft -= dt;
  if (s.timeLeft <= 0) s.outcome = 'lost';
  return s;
}

/** Should a predator show up in this fight? Rolled once when the fish is hooked. */
export function rollPredator(chance: number, isBoss: boolean, rng: () => number): boolean {
  if (isBoss) return false;
  return rng() < chance;
}
