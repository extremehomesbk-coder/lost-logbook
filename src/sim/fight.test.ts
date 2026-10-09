import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { autoFight } from './bot';
import { bossPhaseIndex, createFight, landability, landabilityLabel, pullRate, stepFight, type FightParams } from './fight';
import { makeRng } from './rng';

const data = loadGameData();
const cfg = data.config.fight;
const fish = (id: string) => data.fish.find((f) => f.id === id)!;

function params(id: string, rodStrength: number, lineTier: number, lineOut = 30, seed = 1): FightParams {
  const f = fish(id);
  return { fish: f.fight, bossPhases: f.boss?.phases, rodStrength, lineCap: cfg.lineCaps[String(lineTier)], lineOut, cfg, rng: makeRng(seed) };
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
  it('snaps when tension reaches the line cap under constant reeling', () => {
    const p = params('moss_carp', 1, 1, 60);
    const s = createFight(p);
    for (let i = 0; i < 60 * 20 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, true);
    expect(s.outcome).toBe('snapped');
    expect(s.tension).toBe(p.lineCap);
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
  it('the fish escapes when the line stays slack too long', () => {
    const p = params('dock_perch', 1, 1);
    const s = createFight(p);
    for (let i = 0; i < 60 * 10 && s.outcome === 'fighting'; i++) stepFight(s, p, 1 / 60, false);
    expect(s.outcome).toBe('escaped');
  });

  it('slack timer resets once tension comes back', () => {
    const p = params('dock_perch', 1, 1);
    const s = createFight(p);
    stepFight(s, p, 1.0, false); // drop to 0, slack for part of a second
    expect(s.slackTime).toBeGreaterThan(0);
    stepFight(s, p, 0.5, true);
    expect(s.slackTime).toBe(0);
    expect(s.outcome).toBe('fighting');
  });

  it('a fish running against a released line does not count as slack', () => {
    const p = params('speckled_trout', 2, 2, 40);
    const s = createFight(p);
    s.running = true;
    s.runLeft = 1.5;
    s.tension = 40;
    for (let i = 0; i < 60; i++) stepFight(s, p, 1 / 60, false);
    expect(s.outcome).toBe('fighting');
    expect(s.lineOut).toBeGreaterThan(40);
  });
});

describe('landing', () => {
  it('a perch on starter gear is landed by the bot policy', () => {
    const s = autoFight(params('dock_perch', 1, 1, 30));
    expect(s.outcome).toBe('landed');
    expect(s.elapsed).toBeLessThan(30);
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
