/** A simple "competent human" fight policy, used by tests and the playthrough simulation. Not used by the game UI. */
import { createFight, stepFight, type FightParams, type FightState } from './fight';

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
}

export function autoFight(params: FightParams, opts: BotFightOptions = {}): FightState {
  const releaseAt = opts.releaseAt ?? 0.75;
  const resumeAt = opts.resumeAt ?? 0.5;
  const reaction = opts.reaction ?? 0.25;
  const dt = opts.dt ?? 1 / 60;
  const maxSeconds = opts.maxSeconds ?? 300;
  const s = createFight(params);
  let reeling = true;
  let sinceDecision = reaction;
  while (s.outcome === 'fighting' && s.elapsed < maxSeconds) {
    sinceDecision += dt;
    if (sinceDecision >= reaction) {
      sinceDecision = 0;
      const frac = s.tension / params.lineCap;
      if (s.running) reeling = false;
      else if (frac >= releaseAt) reeling = false;
      else if (frac <= resumeAt) reeling = true;
      // never let it go slack
      if (!s.running && s.tension < params.cfg.slackBelow + 6) reeling = true;
    }
    stepFight(s, params, dt, reeling);
  }
  return s;
}
