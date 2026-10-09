/**
 * Fight model: pure math, no rendering. The scene calls stepFight every frame with the pointer and steer state.
 *
 * Tension is in "line units"; the line snaps at effectiveCap (lineCap shrunk by wear from time in the red).
 * Line-out is metres between angler and fish; the fish is landed at 0. Stamina is 0..1 and drains while the fish
 * runs or hangs on a tight line. Timed runs are telegraphed by a short tell; the player releases and steers
 * against the run's side. A resting fish head-shakes (a slack line throws the hook), and the last stretch is a
 * surface-thrash finale the player must hold through.
 */
import type { BossPhase, FightProfile, GameConfig } from '../data/schema';
import { between, type Rng } from './rng';

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

export type FightOutcome = 'fighting' | 'landed' | 'snapped' | 'escaped' | 'thrown';

/** +1 = dives deep / away, -1 = surfaces / jumps */
export type RunSide = -1 | 1;
export type Steer = -1 | 0 | 1;

export type FightEvent =
  | { type: 'run' }
  | { type: 'runEnd' }
  | { type: 'phase'; index: number; label: string }
  | { type: 'tired' }
  | { type: 'resist' }
  | { type: 'tell'; side: RunSide }
  | { type: 'headShake' }
  | { type: 'finale' }
  | { type: 'lateRelease' };

export interface FightState {
  tension: number;
  lineOut: number;
  startLineOut: number;
  stamina: number;
  running: boolean;
  runLeft: number;
  /** full length of the current run, for ramp-in / fade-out */
  runTotal: number;
  /** metres per second of line change this step (+ = fish taking line) */
  lineVelocity: number;
  nextRun: number;
  /** direction of the current or upcoming run (+1 deep/away, -1 surface/jump); meaningful while telling or running */
  side: RunSide;
  /** the fish is telegraphing a timed run */
  telling: boolean;
  /** seconds until the telegraphed run starts */
  tellLeft: number;
  /** last steer input (-1 / 0 / +1); only matters during a run */
  steer: Steer;
  /** 0..wearMax: fraction of the line cap lost to time in the red */
  lineWear: number;
  /** lineCap * (1 - lineWear); the line snaps here */
  effectiveCap: number;
  finale: boolean;
  finaleLeft: number;
  /** seconds spent not holding during the finale (decays at 2x while holding) */
  finaleHeldGap: number;
  /** seconds to the next head-shake (counts only while the fish rests) */
  headShakeIn: number;
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
    runTotal: 0,
    lineVelocity: 0,
    nextRun: p.cfg.firstRunDelay, // every fight opens with a run: the first decision is always "let it run"
    side: 1,
    telling: false,
    tellLeft: 0,
    steer: 0,
    lineWear: 0,
    effectiveCap: p.lineCap,
    finale: false,
    finaleLeft: 0,
    finaleHeldGap: 0,
    headShakeIn: between(p.rng, p.cfg.headShakeEvery.min, p.cfg.headShakeEvery.max),
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

/** Per-fish fight extras with their defaults resolved (tell seconds, run side bias, finale thrash). */
export function fightTraits(fish: FightProfile, cfg: FightConfig): { tell: number; sideBias: number; thrash: number } {
  return {
    tell: fish.tell ?? cfg.tellSeconds,
    sideBias: Math.max(-1, Math.min(1, fish.sideBias ?? 0)),
    thrash: Math.max(0, Math.min(1, fish.thrash ?? 0.5)),
  };
}

/** Effective pull of the fish right now, in fish strength units. */
export function effectiveStrength(p: FightParams, s: FightState): number {
  const phase = s.phase >= 0 && p.bossPhases ? p.bossPhases[s.phase] : undefined;
  const mult = phase ? phase.strengthMult : 1;
  const fatigue = p.cfg.weakPull + (1 - p.cfg.weakPull) * s.stamina;
  return p.fish.strength * mult * fatigue;
}

/**
 * How much of the steering benefit this rod can apply: a weak rod cannot turn a big fish.
 * 1 when the rod matches or beats the fish, falling toward 0 as the fish outclasses it.
 */
export function steerLeverage(p: FightParams): number {
  return Math.max(0, Math.min(1, p.rodStrength / Math.max(0.1, p.fish.strength)));
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

/**
 * Advance the fight by dt seconds. `reeling` is true while the player holds; `steer` is the rod direction
 * (-1 / 0 / +1) and only matters during a run: against the run's side (steer === -side) shortens it and gives
 * less line, with it (steer === side) gives more line and more tension. Mutates and returns s.
 */
export function stepFight(s: FightState, p: FightParams, dt: number, reeling: boolean, steer: Steer = 0): FightState {
  s.events = []; // cleared first so a zero-delta frame never replays last frame's banners
  if (s.outcome !== 'fighting' || dt <= 0) return s;
  s.elapsed += dt;
  s.steer = steer;
  const cfg = p.cfg;
  const traits = fightTraits(p.fish, cfg);
  const pickSide = (): RunSide => (p.rng() < (1 + traits.sideBias) / 2 ? 1 : -1);

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
    if (s.telling) {
      // the announced run never comes: cancel the tell and emit runEnd so the view shows REEL! again
      s.telling = false;
      s.tellLeft = 0;
      s.events.push({ type: 'runEnd' });
    }
  }

  // Runs (none during the finale)
  const startRun = (resist: boolean) => {
    if (!s.telling) s.side = pickSide(); // resist runs have no tell but follow the same side rule
    s.telling = false;
    s.tellLeft = 0;
    s.running = true;
    s.reelHeld = 0;
    s.runLeft = Math.max(cfg.minRunDuration, p.fish.runDuration * cfg.runDurationMult * (0.5 + 0.5 * s.stamina));
    s.runTotal = s.runLeft;
    s.events.push({ type: resist ? 'resist' : 'run' });
    if (reeling && !resist) {
      // still reeling when a telegraphed run starts: the line takes the shock (resist runs are their own penalty)
      s.tension += cfg.lateSpike;
      s.events.push({ type: 'lateRelease' });
    }
  };
  if (s.finale) {
    // the fish is on the surface: no runs, no tells
  } else if (s.running) {
    // steering against the run burns it out faster
    const against = s.steer !== 0 && s.steer === -s.side;
    const shorten = 1 - (1 - cfg.steerShorten) * steerLeverage(p);
    s.runLeft -= against ? dt / shorten : dt;
    if (s.runLeft <= 0) {
      s.running = false;
      s.nextRun = p.fish.runEvery * cfg.restMult * runEveryMult * (0.7 + 0.6 * p.rng());
      // the rest clock restarts so the player has time to re-tighten before the first head-shake
      s.headShakeIn = between(p.rng, cfg.headShakeEvery.min, cfg.headShakeEvery.max);
      s.events.push({ type: 'runEnd' });
    }
  } else if (!s.tired) {
    s.nextRun -= dt;
    // "reel until it resists": continuous reeling on a resting fish provokes a run sooner the fresher it is
    if (reeling) s.reelHeld += dt;
    else s.reelHeld = Math.max(0, s.reelHeld - dt * 2);
    const tolerance = cfg.resistAfter * (0.4 + 0.6 * s.stamina) * Math.sqrt(p.rodStrength / Math.max(0.5, p.fish.strength));
    if (!s.telling && s.nextRun > 0 && s.nextRun <= traits.tell) {
      s.telling = true;
      s.side = pickSide();
      s.events.push({ type: 'tell', side: s.side });
    }
    if (s.telling) s.tellLeft = Math.max(0, s.nextRun);
    if (s.nextRun <= 0) startRun(false);
    else if (s.reelHeld >= tolerance) startRun(true);
  } else if (reeling) {
    s.reelHeld += dt;
  }

  const strength = effectiveStrength(p, s);
  const pull = pullRate(cfg, strength, p.rodStrength);

  // Runs accelerate in and ease out instead of switching on and off
  const runElapsed = s.runTotal - s.runLeft;
  const ramp = s.running ? Math.min(1, runElapsed / cfg.runRampIn) * Math.min(1, Math.max(0.15, s.runLeft / cfg.runFadeOut)) : 0;
  const runSpeedNow = cfg.runSpeed * ramp;
  // Steering only matters during a run
  const steerAgainst = s.running && s.steer !== 0 && s.steer === -s.side;
  const steerWith = s.running && s.steer !== 0 && s.steer === s.side;
  const leverage = steerLeverage(p);
  const againstGain = 1 - (1 - cfg.steerAgainstGain) * leverage;
  const takeMult = steerAgainst ? againstGain : steerWith ? cfg.steerWrongGain : 1;
  const runRise = steerWith ? cfg.steerWrongRise : 1;
  const lineBefore = s.lineOut;

  // Tension and line
  let resting = false;
  if (reeling) {
    const tolerance = cfg.resistAfter * (0.4 + 0.6 * s.stamina);
    const building = s.running || s.tired || s.finale ? 1 : 1 + (cfg.resistRise - 1) * Math.min(1, s.reelHeld / Math.max(0.1, tolerance));
    const rise = (cfg.reelRise + pull * (s.running ? cfg.runRiseMult : 1)) * building * runRise;
    s.tension += rise * dt;
    if (s.running) {
      s.lineOut += runSpeedNow * 0.35 * takeMult * dt;
    } else {
      const finaleMult = s.finale ? cfg.finaleGainMult : 1; // the thrashing fish gives the last metres slowly
      s.lineOut -= reelGain(cfg, strength, p.rodStrength) * tightness(cfg, s.tension) * finaleMult * dt;
    }
  } else {
    s.tension -= cfg.releaseFall * dt;
    if (s.running) {
      s.tension += pull * 0.3 * runRise * dt;
      s.lineOut += runSpeedNow * takeMult * dt;
    } else if (s.tension < cfg.restBelow && !s.finale) {
      resting = true;
    }
  }
  s.tension = Math.max(0, s.tension);
  s.lineOut = Math.min(s.lineOut, s.startLineOut * 1.5);
  s.lineVelocity = (s.lineOut - lineBefore) / dt;

  // Line wear: time in the red (above wearAbove of the worn cap) permanently shrinks the cap for this fight
  if (!s.finale && s.tension > cfg.wearAbove * s.effectiveCap) {
    s.lineWear = Math.min(cfg.wearMax, s.lineWear + cfg.wearPerSecond * dt);
  }
  s.effectiveCap = p.lineCap * (1 - s.lineWear);

  // Finale: the fish is at the surface, thrashing; holding through it is safe, letting go throws the hook
  if (!s.finale && !s.running && s.lineOut < cfg.finaleBelow * s.startLineOut) {
    s.finale = true;
    s.telling = false;
    s.tellLeft = 0;
    s.finaleLeft = between(p.rng, cfg.finaleSeconds.min, cfg.finaleSeconds.max) * (0.6 + 0.8 * traits.thrash);
    s.finaleHeldGap = 0;
    s.events.push({ type: 'finale' });
  } else if (s.finale) {
    s.finaleLeft = Math.max(0, s.finaleLeft - dt);
    if (reeling) s.finaleHeldGap = Math.max(0, s.finaleHeldGap - dt * 2);
    else s.finaleHeldGap += dt;
  }
  if (s.finale) s.tension = Math.min(s.tension, cfg.finaleRiseCap * s.effectiveCap);

  // Stamina: running burns it, a tight line burns it slower, a slack line lets the fish recover
  // (a run steered against lasts steerShorten as long but costs the same stamina)
  const runDrainNow = steerAgainst ? cfg.runDrain / (1 - (1 - cfg.steerShorten) * leverage) : cfg.runDrain;
  const drainPerSecond = (s.running ? runDrainNow : cfg.holdDrain * (s.tension / p.lineCap)) / p.fish.stamina;
  s.stamina = Math.max(0, s.stamina - drainPerSecond * dt);
  if (resting) s.stamina = Math.min(1, s.stamina + (cfg.restRegen / p.fish.stamina) * dt);
  if (s.tired && s.stamina > cfg.tiredBelow * 2) s.tired = false;

  // Slack: only a resting fish on a dead line counts (letting go for a run or a tell is correct play)
  if (s.tension < cfg.slackBelow && !s.running && !s.telling) s.slackTime += dt;
  else s.slackTime = 0;

  // Head-shakes while the fish rests: on a slack line it throws the hook
  let shookFree = false;
  if (!s.running && !s.telling && !s.tired && !s.finale) {
    s.headShakeIn -= dt;
    if (s.headShakeIn <= 0) {
      s.headShakeIn = between(p.rng, cfg.headShakeEvery.min, cfg.headShakeEvery.max);
      s.events.push({ type: 'headShake' });
      if (s.tension < cfg.headShakeSlackBelow) shookFree = true;
    }
  }

  // Outcomes
  if (s.tension >= s.effectiveCap) {
    s.tension = s.effectiveCap;
    s.outcome = 'snapped';
  } else if (shookFree || (s.finale && s.finaleHeldGap > cfg.finaleThrowAfter)) {
    s.outcome = 'thrown';
  } else if (s.slackTime >= cfg.slackSeconds) {
    s.outcome = 'escaped';
  } else if (s.lineOut <= 0 || (s.finale && s.finaleLeft <= 0 && reeling)) {
    s.lineOut = Math.max(0, s.lineOut);
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
