/**
 * Fight model: pure math, no rendering. The scene calls stepFight every frame with the pointer state.
 *
 * Tension is in "line units"; the line snaps at lineCap. Line-out is metres between angler and fish; the
 * fish is landed at 0. Stamina is 0..1 and drains while the fish runs or hangs on a tight line.
 */
import type { BossPhase, FightProfile, GameConfig } from '../data/schema';
import type { Rng } from './rng';

export type FightConfig = GameConfig['fight'];

export interface FightParams {
  fish: FightProfile;
  bossPhases?: BossPhase[];
  rodStrength: number;
  lineCap: number;
  lineOut: number;
  cfg: FightConfig;
  rng: Rng;
}

export type FightOutcome = 'fighting' | 'landed' | 'snapped' | 'escaped';

export type FightEvent =
  | { type: 'run' }
  | { type: 'runEnd' }
  | { type: 'phase'; index: number; label: string }
  | { type: 'tired' }
  | { type: 'resist' };

export interface FightState {
  tension: number;
  lineOut: number;
  startLineOut: number;
  stamina: number;
  running: boolean;
  runLeft: number;
  nextRun: number;
  slackTime: number;
  elapsed: number;
  phase: number;
  tired: boolean;
  /** seconds the player has reeled continuously while the fish rests; past resistAfter it fights back */
  reelHeld: number;
  outcome: FightOutcome;
  events: FightEvent[];
}

export function createFight(p: FightParams): FightState {
  return {
    tension: p.cfg.startTension,
    lineOut: p.lineOut,
    startLineOut: p.lineOut,
    stamina: 1,
    running: false,
    runLeft: 0,
    nextRun: p.cfg.firstRunDelay + p.fish.runEvery * p.rng() * 0.5,
    slackTime: 0,
    elapsed: 0,
    phase: -1,
    tired: false,
    reelHeld: 0,
    outcome: 'fighting',
    events: [],
  };
}

/** Index of the current boss phase (-1 = none) given stamina. Phases are checked deepest first. */
export function bossPhaseIndex(stamina: number, phases: BossPhase[] | undefined): number {
  if (!phases || phases.length === 0) return -1;
  for (let i = phases.length - 1; i >= 0; i--) {
    if (stamina < phases[i].staminaBelow) return i;
  }
  return -1;
}

/** Effective pull of the fish right now, in fish strength units. */
export function effectiveStrength(p: FightParams, s: FightState): number {
  const phase = s.phase >= 0 && p.bossPhases ? p.bossPhases[s.phase] : undefined;
  const mult = phase ? phase.strengthMult : 1;
  const fatigue = p.cfg.weakPull + (1 - p.cfg.weakPull) * s.stamina;
  return p.fish.strength * mult * fatigue;
}

/** Tension gained per second from the fish pulling against this rod. */
export function pullRate(cfg: FightConfig, strength: number, rodStrength: number): number {
  const ratio = strength / Math.max(0.1, rodStrength);
  return cfg.pullRise * Math.pow(ratio, cfg.pullExponent);
}

/**
 * Metres per second gained while reeling a non-running fish on a tight line.
 * Negative when the fish out-pulls the rod: it takes line even while you reel.
 */
export function reelGain(cfg: FightConfig, strength: number, rodStrength: number): number {
  const q = strength / Math.max(0.1, rodStrength);
  const frac = Math.max(cfg.gainMin, Math.min(cfg.gainBase, cfg.gainBase - cfg.fishHold * q));
  return cfg.reelSpeed * Math.sqrt(rodStrength) * frac;
}

/** 0..1: how much of the reel gain applies at this tension (slack line moves no fish). */
export function tightness(cfg: FightConfig, tension: number): number {
  return Math.max(0, Math.min(1, (tension - cfg.tightBelow) / cfg.tightSpan));
}

/** Advance the fight by dt seconds. `reeling` is true while the player holds. Mutates and returns s. */
export function stepFight(s: FightState, p: FightParams, dt: number, reeling: boolean): FightState {
  if (s.outcome !== 'fighting' || dt <= 0) return s;
  s.events = [];
  s.elapsed += dt;
  const cfg = p.cfg;

  // Boss phases
  const phaseNow = bossPhaseIndex(s.stamina, p.bossPhases);
  if (phaseNow !== s.phase && phaseNow > s.phase) {
    s.phase = phaseNow;
    const label = p.bossPhases?.[phaseNow]?.label ?? '';
    s.events.push({ type: 'phase', index: phaseNow, label });
  }
  const runEveryMult = s.phase >= 0 && p.bossPhases ? p.bossPhases[s.phase].runEveryMult : 1;

  // Tired fish stop running
  if (!s.tired && s.stamina <= cfg.tiredBelow) {
    s.tired = true;
    s.events.push({ type: 'tired' });
  }

  // Runs
  const startRun = (resist: boolean) => {
    s.running = true;
    s.reelHeld = 0;
    s.runLeft = Math.max(cfg.minRunDuration, p.fish.runDuration * cfg.runDurationMult * (0.5 + 0.5 * s.stamina));
    s.events.push({ type: resist ? 'resist' : 'run' });
  };
  if (s.running) {
    s.runLeft -= dt;
    if (s.runLeft <= 0) {
      s.running = false;
      s.nextRun = p.fish.runEvery * cfg.restMult * runEveryMult * (0.7 + 0.6 * p.rng());
      s.events.push({ type: 'runEnd' });
    }
  } else if (!s.tired) {
    s.nextRun -= dt;
    // "reel until it resists": continuous reeling on a resting fish provokes a run sooner the fresher it is
    if (reeling) s.reelHeld += dt;
    else s.reelHeld = Math.max(0, s.reelHeld - dt * 2);
    const tolerance = cfg.resistAfter * (0.4 + 0.6 * s.stamina) * Math.sqrt(p.rodStrength / Math.max(0.5, p.fish.strength));
    if (s.nextRun <= 0) startRun(false);
    else if (s.reelHeld >= tolerance) startRun(true);
  } else if (reeling) {
    s.reelHeld += dt;
  }

  const strength = effectiveStrength(p, s);
  const pull = pullRate(cfg, strength, p.rodStrength);

  // Tension and line
  let resting = false;
  if (reeling) {
    const tolerance = cfg.resistAfter * (0.4 + 0.6 * s.stamina);
    const building = s.running || s.tired ? 1 : 1 + (cfg.resistRise - 1) * Math.min(1, s.reelHeld / Math.max(0.1, tolerance));
    const rise = (cfg.reelRise + pull * (s.running ? cfg.runRiseMult : 1)) * building;
    s.tension += rise * dt;
    if (s.running) {
      s.lineOut += cfg.runSpeed * 0.35 * dt;
    } else {
      s.lineOut -= reelGain(cfg, strength, p.rodStrength) * tightness(cfg, s.tension) * dt;
    }
  } else {
    s.tension -= cfg.releaseFall * dt;
    if (s.running) {
      s.tension += pull * 0.3 * dt;
      s.lineOut += cfg.runSpeed * dt;
    } else if (s.tension < cfg.restBelow) {
      resting = true;
    }
  }
  s.tension = Math.max(0, s.tension);
  s.lineOut = Math.min(s.lineOut, s.startLineOut * 1.5);

  // Stamina: running burns it, a tight line burns it slower, a slack line lets the fish recover
  const drainPerSecond = (s.running ? cfg.runDrain : cfg.holdDrain * (s.tension / p.lineCap)) / p.fish.stamina;
  s.stamina = Math.max(0, s.stamina - drainPerSecond * dt);
  if (resting) s.stamina = Math.min(1, s.stamina + (cfg.restRegen / p.fish.stamina) * dt);
  if (s.tired && s.stamina > cfg.tiredBelow * 2) s.tired = false;

  // Slack
  if (s.tension < cfg.slackBelow) s.slackTime += dt;
  else s.slackTime = 0;

  // Outcomes
  if (s.tension >= p.lineCap) {
    s.tension = p.lineCap;
    s.outcome = 'snapped';
  } else if (s.slackTime >= cfg.slackSeconds) {
    s.outcome = 'escaped';
  } else if (s.lineOut <= 0) {
    s.lineOut = 0;
    s.outcome = 'landed';
  }
  return s;
}

/**
 * Rough chance (0..1) that a player with this gear lands this fish. Used for shop/log hints and the sim bot.
 * Two factors: can you gain line against a fresh fish, and how long a tight line survives before it snaps.
 */
export function landability(cfg: FightConfig, fish: FightProfile, rodStrength: number, lineCap: number): number {
  const gain = reelGain(cfg, fish.strength, rodStrength) / (cfg.reelSpeed * Math.sqrt(rodStrength) * cfg.gainBase);
  const gainScore = Math.max(0, Math.min(1, (gain + 0.1) / 0.6));
  const rise = cfg.reelRise + pullRate(cfg, fish.strength, rodStrength);
  const holdSeconds = (lineCap - cfg.tightBelow - cfg.tightSpan) / rise;
  const holdScore = Math.max(0, Math.min(1, holdSeconds / 1.5));
  return Math.max(0, Math.min(1, gainScore * holdScore));
}

export function landabilityLabel(x: number): 'easy' | 'fair' | 'hard' | 'hopeless' {
  if (x >= 0.8) return 'easy';
  if (x >= 0.55) return 'fair';
  if (x >= 0.3) return 'hard';
  return 'hopeless';
}
