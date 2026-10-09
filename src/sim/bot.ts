/** A simple "competent human" fight policy, used by tests and the playthrough simulation. Not used by the game UI. */
import { createFight, stepFight, type FightParams, type FightState, type Steer } from './fight';

export interface BotFightOptions {
  /** release above this fraction of the line cap */
  releaseAt?: number;
  /** resume reeling below this fraction */
  resumeAt?: number;
  /** how often the bot re-decides, seconds (human reaction) */
  reaction?: number;
  /** simulation step, seconds */
  dt?: number;
  /** give up after this many seconds */
  maxSeconds?: number;
  /** every Nth run the bot misreads the tell and does not steer (a person misses some); 0 = steers every run */
  missSteerEvery?: number;
}

/**
 * Reads the fight like a player: lets go when the fish telegraphs a run (or is running), steers against the run
 * (but misreads every second run and leaves the rod centred),
 * resumes when it ends, holds through the surface finale, and keeps a resting fish tight enough for head-shakes.
 */
export function autoFight(params: FightParams, opts: BotFightOptions = {}): FightState {
  const releaseAt = opts.releaseAt ?? 0.7;
  const resumeAt = opts.resumeAt ?? 0.45;
  const reaction = opts.reaction ?? 0.3;
  const dt = opts.dt ?? 1 / 60;
  const maxSeconds = opts.maxSeconds ?? 300;
  const missSteerEvery = opts.missSteerEvery ?? 2;
  const cfg = params.cfg;
  const s = createFight(params);
  let reeling = true;
  let steer: Steer = 0;
  let sinceDecision = reaction;
  let runs = 0;
  let wasActive = false;
  while (s.outcome === 'fighting' && s.elapsed < maxSeconds) {
    sinceDecision += dt;
    if (sinceDecision >= reaction) {
      sinceDecision = 0;
      const frac = s.tension / s.effectiveCap;
      if (s.finale) {
        reeling = true; // holding through the thrash is safe
        steer = 0;
      } else if (s.telling || s.running) {
        reeling = false;
        const misread = missSteerEvery > 0 && runs % missSteerEvery === 0;
        steer = misread ? 0 : s.side === 1 ? -1 : 1;
      } else {
        steer = 0;
        if (frac >= releaseAt) reeling = false;
        else if (frac <= resumeAt) reeling = true;
        // never let a resting fish go slack enough to shake the hook
        if (s.tension < cfg.headShakeSlackBelow + 8) reeling = true;
      }
    }
    stepFight(s, params, dt, reeling, steer);
    const active = s.telling || s.running;
    if (active && !wasActive) runs++;
    wasActive = active;
  }
  return s;
}
