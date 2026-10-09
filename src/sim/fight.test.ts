import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { autoFight } from './bot';
import {
  bossPhaseIndex, createFight, fightTraits, landability, landabilityLabel, pullRate, stepFight, type FightParams, type FightState,
  type Steer,
} from './fight';
import { makeRng } from './rng';

const data = loadGameData();
const cfg = data.config.fight;
const fish = (id: string) => data.fish.find((f) => f.id === id)!;

function params(id: string, rodStrength: number, lineTier: number, lineOut = 30, seed = 1): FightParams {
  const f = fish(id);
  return { fish: f.fight, bossPhases: f.boss?.phases, rodStrength, lineCap: cfg.lineCaps[String(lineTier)], lineOut, cfg, rng: makeRng(seed) };
}

/** A resting fish with no run or head-shake due, at the given tension. */
function quiet(p: FightParams, tension: number): FightState {
  const s = createFight(p);
  s.nextRun = 99;
  s.headShakeIn = 99;
  s.tension = tension;
  return s;
}

describe('tension', () => {
  it('rises while reeling and falls while released', () => {
    const p = params('dock_perch', 1, 1);
    const s = createFight(p);
    const t0 = s.tension;
    stepFight(s, p, 0.5, true);
    expect(s.tension).toBeGreaterThan(t0);
    const t1 = s.tension;
    stepFight(s, p, 0.5, false);
    expect(s.tension).toBeLessThan(t1);
  });

  it('never goes below zero', () => {
    const p = params('dock_perch', 1, 1);
    const s = createFight(p);
    stepFight(s, p, 5, false);
    expect(s.tension).toBe(0);
  });

  it('stronger fish on the same rod raise tension faster', () => {
    expect(pullRate(cfg, 3, 1)).toBeGreaterThan(pullRate(cfg, 1, 1));
  });

  it('a stronger rod lowers the pull rate of the same fish', () => {
    expect(pullRate(cfg, 3, 4)).toBeLessThan(pullRate(cfg, 3, 1));
  });
});

describe('snap', () => {
  it('snaps when tension reaches the (worn) line cap under constant reeling', () => {
    const p = params('moss_carp', 1, 1, 60);
    const s = createFight(p);
    for (let i = 0; i < 60 * 20 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, true);
    expect(s.outcome).toBe('snapped');
    expect(s.tension).toBe(s.effectiveCap);
    expect(s.effectiveCap).toBeLessThanOrEqual(p.lineCap);
  });

  it('a higher line tier survives longer under the same pull', () => {
    const a = createFight(params('moss_carp', 1, 1, 60));
    const b = createFight(params('moss_carp', 1, 3, 60));
    const pa = params('moss_carp', 1, 1, 60);
    const pb = params('moss_carp', 1, 3, 60);
    let ta = 0;
    let tb = 0;
    while (a.outcome === 'fighting') { stepFight(a, pa, 1 / 60, true); ta += 1 / 60; }
    while (b.outcome === 'fighting') { stepFight(b, pb, 1 / 60, true); tb += 1 / 60; }
    expect(tb).toBeGreaterThan(ta);
  });
});

describe('escape', () => {
  it('the fish gets away when the line stays slack too long', () => {
    const p = params('dock_perch', 1, 1);
    const s = createFight(p);
    for (let i = 0; i < 60 * 10 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, false);
    expect(['escaped', 'thrown']).toContain(s.outcome);
  });

  it('a slack line with no head-shake due ends in an escape', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 0);
    for (let i = 0; i < 60 * 10 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, false);
    expect(s.outcome).toBe('escaped');
  });

  it('slack timer resets once tension comes back', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 35);
    stepFight(s, p, 1.0, false); // drop to 0, slack for part of a second
    expect(s.slackTime).toBeGreaterThan(0);
    stepFight(s, p, 0.5, true);
    expect(s.slackTime).toBe(0);
    expect(s.outcome).toBe('fighting');
  });

  it('a zero-delta frame clears last frame\'s events', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 50);
    s.nextRun = 0.01;
    stepFight(s, p, 1 / 60, false);
    expect(s.events.length).toBeGreaterThan(0);
    stepFight(s, p, 0, false);
    expect(s.events).toEqual([]);
  });

  it('letting go during a tell or a run never counts as slack', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = quiet(p, 0);
    s.slackTime = cfg.slackSeconds - 0.05;
    s.nextRun = fightTraits(p.fish, cfg).tell - 0.01;
    for (let i = 0; i < 60 * 2 && (s.telling || s.running || s.elapsed < 0.1); i++) {
      stepFight(s, p, 1 / 60, false);
      expect(s.outcome).toBe('fighting');
      expect(s.slackTime).toBe(0);
    }
  });

  it('a fish running against a released line does not count as slack', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = createFight(p);
    s.running = true;
    s.runLeft = 1.5;
    s.runTotal = 1.5;
    s.tension = 40;
    for (let i = 0; i < 60; i++) stepFight(s, p, 1 / 60, false);
    expect(s.outcome).toBe('fighting');
    expect(s.lineOut).toBeGreaterThan(40);
  });
});

describe('opening run', () => {
  it('every fight opens with a run shortly after the hook', () => {
    const p = params('dock_perch', 1, 1, 30);
    const s = createFight(p);
    let ran = false;
    for (let i = 0; i < 60 && !ran; i++) {
      stepFight(s, p, 1 / 60, false);
      ran = s.running;
    }
    expect(ran).toBe(true);
  });
  it('runs ramp in: line taken in the first tick is less than at full speed', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = createFight(p);
    s.running = true; s.runLeft = 2; s.runTotal = 2; s.tension = 50;
    const l0 = s.lineOut;
    stepFight(s, p, 0.05, false);
    const first = s.lineOut - l0;
    for (let i = 0; i < 10; i++) stepFight(s, p, 0.05, false);
    const l1 = s.lineOut;
    stepFight(s, p, 0.05, false);
    expect(s.lineOut - l1).toBeGreaterThan(first);
  });
});

describe('tells and late release', () => {
  it('a tell precedes every timed run and names its side', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = quiet(p, 60);
    s.nextRun = 1.5;
    let tellAt = -1;
    let runAt = -1;
    let tellSide = 0;
    for (let i = 0; i < 60 * 3 && runAt < 0; i++) {
      stepFight(s, p, 1 / 60, false);
      s.tension = 60;
      for (const e of s.events) {
        if (e.type === 'tell') {
          tellAt = s.elapsed;
          tellSide = e.side;
          expect(s.telling).toBe(true);
          expect(s.tellLeft).toBeGreaterThan(0);
        }
        if (e.type === 'run') runAt = s.elapsed;
      }
    }
    expect(tellAt).toBeGreaterThan(0);
    expect(runAt).toBeGreaterThan(tellAt);
    expect(runAt - tellAt).toBeCloseTo(fightTraits(p.fish, cfg).tell, 1);
    expect(s.side).toBe(tellSide);
    expect(s.telling).toBe(false);
  });

  it('per-fish tell overrides the default', () => {
    expect(fightTraits(fish('dock_perch').fight, cfg).tell).toBe(cfg.tellSeconds);
    expect(fightTraits(fish('old_greyback').fight, cfg).tell).toBeLessThan(cfg.tellSeconds);
  });

  it('run sides follow sideBias (jumpers mostly surface, divers mostly go deep)', () => {
    const deepShare = (id: string) => {
      let deep = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const p = params(id, 3, 3, 40, seed);
        const s = createFight(p);
        for (let i = 0; i < 60 && !s.telling; i++) stepFight(s, p, 1 / 60, false);
        if (s.side === 1) deep++;
      }
      return deep / 200;
    };
    expect(deepShare('speckled_trout')).toBeLessThan(0.35);
    expect(deepShare('moss_carp')).toBeGreaterThan(0.7);
  });

  it('a resist run carries no late-release spike (the resist is the penalty)', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = quiet(p, 50);
    s.reelHeld = 99; // well past the tolerance
    const before = s.tension;
    stepFight(s, p, 1 / 60, true);
    expect(s.events.some((e) => e.type === 'resist')).toBe(true);
    expect(s.events.some((e) => e.type === 'lateRelease')).toBe(false);
    expect(s.tension - before).toBeLessThan(cfg.lateSpike / 2);
  });

  it('a fish that tires during a tell cancels it with a runEnd', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = quiet(p, 50);
    s.nextRun = 0.2;
    stepFight(s, p, 1 / 60, false);
    expect(s.telling).toBe(true);
    s.stamina = cfg.tiredBelow * 0.5;
    stepFight(s, p, 1 / 60, false);
    expect(s.events.map((e) => e.type)).toEqual(expect.arrayContaining(['tired', 'runEnd']));
    expect(s.telling).toBe(false);
    for (let i = 0; i < 60; i++) stepFight(s, p, 1 / 60, true);
    expect(s.running).toBe(false);
  });

  it('reeling when a run starts spikes tension and emits lateRelease', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const a = quiet(p, 50);
    const b = quiet(p, 50);
    a.nextRun = 0.01;
    b.nextRun = 0.01;
    stepFight(a, p, 1 / 60, true);
    stepFight(b, p, 1 / 60, false);
    expect(a.running && b.running).toBe(true);
    expect(a.events.some((e) => e.type === 'lateRelease')).toBe(true);
    expect(b.events.some((e) => e.type === 'lateRelease')).toBe(false);
    expect(a.tension - b.tension).toBeGreaterThan(cfg.lateSpike);
  });
});

describe('steering', () => {
  /** Line taken and time spent over one run with the given steer relative to the run side (-1 against, 1 with). */
  function oneRun(rel: -1 | 0 | 1): { seconds: number; line: number } {
    const p = params('moss_carp', 3, 3, 40, 7);
    const s = quiet(p, 70);
    s.nextRun = 0.01;
    stepFight(s, p, 1 / 60, false);
    expect(s.running).toBe(true);
    const l0 = s.lineOut;
    const t0 = s.elapsed;
    while (s.running && s.outcome === 'fighting') stepFight(s, p, 1 / 60, false, (rel * s.side) as Steer);
    return { seconds: s.elapsed - t0, line: s.lineOut - l0 };
  }

  it('steering against the run shortens it and gives less line than steering with it', () => {
    const against = oneRun(-1);
    const neutral = oneRun(0);
    const withIt = oneRun(1);
    expect(against.seconds).toBeLessThan(neutral.seconds * 0.6);
    expect(against.line).toBeLessThan(neutral.line);
    expect(neutral.line).toBeLessThan(withIt.line);
    expect(withIt.seconds).toBeCloseTo(neutral.seconds, 1);
  });

  it('a run costs the same stamina whether it is steered against or not', () => {
    const cost = (rel: -1 | 0) => {
      const p = params('moss_carp', 3, 3, 40, 7);
      const s = quiet(p, 70);
      s.nextRun = 0.01;
      stepFight(s, p, 1 / 60, false);
      const st0 = s.stamina;
      while (s.running && s.outcome === 'fighting') stepFight(s, p, 1 / 60, false, (rel * s.side) as Steer);
      return st0 - s.stamina;
    };
    expect(cost(-1)).toBeCloseTo(cost(0), 2);
  });

  it('steering with the run raises tension faster than steering against it', () => {
    const p = params('moss_carp', 3, 3, 40, 7);
    const run = (rel: -1 | 1) => {
      const s = quiet(p, 70);
      s.running = true; s.runLeft = 2; s.runTotal = 2;
      s.side = 1;
      stepFight(s, p, 0.1, true, rel as Steer);
      return s.tension;
    };
    expect(run(1)).toBeGreaterThan(run(-1));
  });

  it('steering does nothing while the fish rests', () => {
    const p = params('moss_carp', 3, 3, 40);
    const a = quiet(p, 60);
    const b = quiet(p, 60);
    stepFight(a, p, 0.2, true, 1);
    stepFight(b, p, 0.2, true, -1);
    expect(a.lineOut).toBe(b.lineOut);
    expect(a.tension).toBe(b.tension);
  });
});

describe('head-shakes', () => {
  it('a head-shake on a slack line throws the hook', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, cfg.headShakeSlackBelow - 6);
    s.headShakeIn = 0.01;
    stepFight(s, p, 1 / 60, false);
    expect(s.events.some((e) => e.type === 'headShake')).toBe(true);
    expect(s.outcome).toBe('thrown');
  });

  it('a head-shake on a tight line is survived', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 60);
    s.headShakeIn = 0.01;
    stepFight(s, p, 1 / 60, true);
    expect(s.events.some((e) => e.type === 'headShake')).toBe(true);
    expect(s.outcome).toBe('fighting');
    expect(s.headShakeIn).toBeGreaterThanOrEqual(cfg.headShakeEvery.min - 0.01);
  });

  it('the head-shake clock pauses during a tell, so letting go for a run is safe', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 5);
    s.headShakeIn = 0.05;
    s.nextRun = 0.3; // tell starts on the first step
    let shakes = 0;
    for (let i = 0; i < 15; i++) {
      stepFight(s, p, 1 / 60, false);
      shakes += s.events.filter((e) => e.type === 'headShake').length;
    }
    expect(s.telling || s.running).toBe(true);
    expect(shakes).toBe(0);
    expect(s.outcome).toBe('fighting');
  });

  it('a resting fish keeps shaking its head', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 60);
    s.headShakeIn = cfg.headShakeEvery.max;
    let shakes = 0;
    for (let i = 0; i < 60 * 12 && s.outcome === 'fighting'; i++) {
      stepFight(s, p, 1 / 60, false);
      s.tension = 60;
      s.nextRun = 99;
      shakes += s.events.filter((e) => e.type === 'headShake').length;
    }
    expect(shakes).toBeGreaterThanOrEqual(2);
  });
});

describe('line wear', () => {
  it('time in the red lowers effectiveCap and the line snaps below the nominal cap', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 0);
    const hold = p.lineCap * 0.86;
    for (let i = 0; i < 60 * 10 && s.outcome === 'fighting'; i++) {
      s.tension = hold;
      s.nextRun = 99;
      s.headShakeIn = 99;
      stepFight(s, p, 1 / 60, false);
    }
    expect(s.lineWear).toBeGreaterThan(0);
    expect(s.lineWear).toBeLessThanOrEqual(cfg.wearMax);
    expect(s.outcome).toBe('snapped');
    expect(s.tension).toBeLessThan(p.lineCap);
    expect(s.effectiveCap).toBeCloseTo(p.lineCap * (1 - s.lineWear), 6);
  });

  it('wear is measured against the worn cap and can reach wearMax', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 0);
    for (let i = 0; i < 60 * 20 && s.outcome === 'fighting'; i++) {
      s.tension = s.effectiveCap * (cfg.wearAbove + 0.05); // in the red of the worn cap, never at it
      s.nextRun = 99;
      s.headShakeIn = 99;
      stepFight(s, p, 1 / 60, false);
    }
    expect(s.outcome).toBe('fighting');
    expect(s.lineWear).toBeCloseTo(cfg.wearMax, 6);
    expect(s.effectiveCap).toBeCloseTo(p.lineCap * (1 - cfg.wearMax), 6);
  });

  it('tension under wearAbove does not wear the line', () => {
    const p = params('dock_perch', 1, 1);
    const s = quiet(p, 0);
    for (let i = 0; i < 60 * 3; i++) {
      s.tension = p.lineCap * (cfg.wearAbove - 0.05);
      stepFight(s, p, 1 / 60, false);
    }
    expect(s.lineWear).toBe(0);
    expect(s.effectiveCap).toBe(p.lineCap);
  });
});

describe('finale', () => {
  /** Moss Carp on a cane rod: the rod cannot gain line on it, so only holding through the finale lands it. */
  function atFinale(): { p: FightParams; s: FightState } {
    const p = params('moss_carp', 1, 1, 30);
    const s = quiet(p, 50);
    s.lineOut = 30 * cfg.finaleBelow * 0.9;
    stepFight(s, p, 1 / 60, true);
    return { p, s };
  }

  it('starts once the fish is close and is announced', () => {
    const { s } = atFinale();
    expect(s.finale).toBe(true);
    expect(s.events.some((e) => e.type === 'finale')).toBe(true);
    expect(s.finaleLeft).toBeGreaterThan(0);
  });

  it('letting go during the finale throws the hook', () => {
    const { p, s } = atFinale();
    for (let i = 0; i < 60 * 2 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, false);
    expect(s.outcome).toBe('thrown');
    expect(s.elapsed).toBeLessThan(1);
  });

  it('holding through the finale lands the fish and tension never passes finaleRiseCap', () => {
    const { p, s } = atFinale();
    let maxT = 0;
    let interruptions = 0;
    for (let i = 0; i < 60 * 10 && s.outcome === 'fighting'; i++) {
      stepFight(s, p, 1 / 60, true);
      maxT = Math.max(maxT, s.tension);
      interruptions += s.events.filter((e) => e.type === 'run' || e.type === 'tell' || e.type === 'headShake').length;
      expect(s.tension).toBeLessThanOrEqual(cfg.finaleRiseCap * s.effectiveCap + 1e-9);
    }
    expect(s.outcome).toBe('landed');
    expect(maxT).toBeGreaterThan(cfg.finaleRiseCap * p.lineCap * 0.95); // the clamp is what kept it safe
    expect(interruptions).toBe(0);
  });

  it('the thrashing fish gives line slowly (finaleGainMult) and holding does not wear the line', () => {
    const p = params('dock_perch', 3, 3, 30);
    const a = quiet(p, 100);
    const b = quiet(p, 100);
    b.finale = true;
    b.finaleLeft = 5;
    const la = a.lineOut;
    const lb = b.lineOut;
    stepFight(a, p, 0.1, true);
    stepFight(b, p, 0.1, true);
    expect(lb - b.lineOut).toBeCloseTo((la - a.lineOut) * cfg.finaleGainMult, 6);
    expect(b.lineWear).toBe(0);
  });

  it('a short let-go during the finale is forgiven', () => {
    const { p, s } = atFinale();
    for (let i = 0; i < 20; i++) stepFight(s, p, 1 / 60, false); // 0.33 s off
    for (let i = 0; i < 60 * 10 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, true);
    expect(s.outcome).toBe('landed');
  });
});

describe('landing', () => {
  it('a perch on starter gear is landed by the bot policy', () => {
    const s = autoFight(params('dock_perch', 1, 1, 30));
    expect(s.outcome).toBe('landed');
    expect(s.elapsed).toBeLessThan(30);
  });

  it('the bot reads tells: it is never caught reeling at a timed run and never shakes the hook', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = autoFight(params('speckled_trout', 2, 2, 30, seed));
      expect(s.outcome, `seed ${seed}`).toBe('landed');
    }
  });

  it('the legendary fish cannot be landed on starter gear', () => {
    let landed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      if (autoFight(params('old_greyback', 1, 1, 70, seed)).outcome === 'landed') landed++;
    }
    expect(landed).toBe(0);
  });

  it('the legendary fish is landed on top gear most of the time', () => {
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (autoFight(params('old_greyback', 4, 4, 70, seed)).outcome === 'landed') landed++;
    }
    expect(landed).toBeGreaterThanOrEqual(14);
  });

  it('stamina drains during the fight and the fish eventually tires', () => {
    const s = autoFight(params('moss_carp', 3, 3, 50));
    expect(s.stamina).toBeLessThan(1);
  });
});

describe('boss phases', () => {
  const phases = fish('ironjaw').boss!.phases;
  it('picks the deepest matching phase', () => {
    expect(bossPhaseIndex(1, phases)).toBe(-1);
    expect(bossPhaseIndex(0.5, phases)).toBe(0);
    expect(bossPhaseIndex(0.1, phases)).toBe(1);
    expect(bossPhaseIndex(0.5, undefined)).toBe(-1);
  });
  it('emits a phase event when stamina crosses a threshold', () => {
    const p = params('ironjaw', 4, 4, 70);
    const s = createFight(p);
    s.stamina = 0.6;
    stepFight(s, p, 1 / 60, true);
    expect(s.events.some((e) => e.type === 'phase' && e.index === 0)).toBe(true);
  });
});

describe('catch chance (landability)', () => {
  it('is in [0, 1] and monotone in gear', () => {
    const f = fish('ironjaw').fight;
    const weak = landability(cfg, f, 1, cfg.lineCaps['1']);
    const mid = landability(cfg, f, 3, cfg.lineCaps['3']);
    const top = landability(cfg, f, 4, cfg.lineCaps['4']);
    expect(weak).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(1);
    expect(weak).toBeLessThan(mid);
    expect(mid).toBeLessThan(top);
  });
  it('labels starter gear vs a perch easy and vs the legend hopeless', () => {
    expect(landabilityLabel(landability(cfg, fish('dock_perch').fight, 1, cfg.lineCaps['1']))).toBe('easy');
    expect(landabilityLabel(landability(cfg, fish('old_greyback').fight, 1, cfg.lineCaps['1']))).toBe('hopeless');
  });
  it('every fish is at least "fair" on top gear', () => {
    for (const f of data.fish) {
      const x = landability(cfg, f.fight, 4, cfg.lineCaps['4']);
      expect(x, f.id).toBeGreaterThanOrEqual(0.55);
    }
  });
});
