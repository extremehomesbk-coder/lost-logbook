import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { candidates, hookQuality, hookResult, lineOutForPower, pickFish, planBite, zoneForPower } from './bite';
import { rollSizeCm, sellValue, sizeFraction } from './economy';
import { predatorTap, rollPredator, startPredator, stepPredator } from './predator';
import { makeRng } from './rng';
import { exportCode, importCode, migrate, validateSave } from './save';
import {
  beginCast, buy, claimQuest, equip, newPlayer, questReady, recordCatch, sellAll, shopItems, spotLocked, timeOfDay, travel, waitPeriod,
} from './state';

const data = loadGameData();
const fish = (id: string) => data.fish.find((f) => f.id === id)!;
const spot = (id: string) => data.spots.find((s) => s.id === id)!;

describe('data', () => {
  it('loads and cross-checks the bundled content', () => {
    expect(data.fish.length).toBeGreaterThanOrEqual(15);
    expect(data.fish.length).toBeLessThanOrEqual(20);
    expect(data.spots.length).toBe(5);
    expect(data.quests.length).toBeGreaterThanOrEqual(3);
  });
  it('rejects a broken file with a readable error', () => {
    expect(() => loadGameData({ fish: [{ id: 'x' }] })).toThrowError(/fish\.json|name/);
    expect(() => loadGameData({ quests: [{ ...data.quests[0], condition: { type: 'catch_species', fish: 'nope', count: 1 } }] })).toThrowError(/unknown fish/);
  });
  it('every rare/legendary fish with a requirement can be reached: its item is sold, rewarded or assembled', () => {
    const sold = new Set(data.gear.lures.filter((l) => l.price !== null).map((l) => l.id).concat(data.gear.baits.map((b) => b.id)));
    const rewarded = new Set(data.quests.flatMap((q) => Object.keys(q.reward.items ?? {})));
    for (const f of data.fish) {
      if (!f.requires) continue;
      const ok = sold.has(f.requires) || rewarded.has(f.requires) || f.requires === data.gear.assembly.result;
      expect(ok, `${f.id} requires ${f.requires}`).toBe(true);
    }
  });
  it('the three assembly parts are each granted by a fish or a quest', () => {
    const granted = new Set([...data.fish.map((f) => f.grantsKeyItem), ...data.quests.map((q) => q.reward.keyItem)]);
    for (const part of data.gear.assembly.parts) expect(granted.has(part), part).toBe(true);
  });
});

describe('cast and bite', () => {
  it('maps power to zones at the configured thresholds', () => {
    const z = data.config.cast.zones;
    expect(zoneForPower(0, z)).toBe('shallow');
    expect(zoneForPower(z.shallow, z)).toBe('mid');
    expect(zoneForPower(z.mid, z)).toBe('deep');
    expect(zoneForPower(1, z)).toBe('deep');
  });
  it('line out grows with power inside the spot range', () => {
    const s = spot('dock');
    expect(lineOutForPower(0, s)).toBe(s.castRange.min);
    expect(lineOutForPower(1, s)).toBe(s.castRange.max);
    expect(lineOutForPower(2, s)).toBe(s.castRange.max);
  });
  it('plans nibbles strictly before the dip', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 50; i++) {
      const b = planBite(data.config.bite, spot('dock'), rng);
      for (const t of b.nibbleTimes) expect(t).toBeLessThan(b.dipAt);
      expect(b.nibbleTimes.length).toBeLessThanOrEqual(data.config.bite.nibbles.max);
    }
  });
  it('hook timing: early, hooked, late; quality falls across the window', () => {
    expect(hookResult(4.9, 5, 0.6)).toBe('early');
    expect(hookResult(5.0, 5, 0.6)).toBe('hooked');
    expect(hookResult(5.6, 5, 0.6)).toBe('hooked');
    expect(hookResult(5.61, 5, 0.6)).toBe('late');
    expect(hookQuality(5.0, 5, 0.6)).toBe(1);
    expect(hookQuality(5.3, 5, 0.6)).toBeCloseTo(0.5);
    expect(hookQuality(4.0, 5, 0.6)).toBe(0);
  });
  it('candidates respect spot, zone, time, bait and specialty requirement', () => {
    const c = candidates(data.fish, 'creek', 'shallow', 'morning', 'lure_fly').map((f) => f.id);
    expect(c).toContain('silver_darter');
    expect(c).toContain('creek_dace');
    expect(candidates(data.fish, 'creek', 'shallow', 'morning', 'bait_worm').map((f) => f.id)).not.toContain('silver_darter');
    expect(candidates(data.fish, 'lake', 'deep', 'night', 'lure_greyback').map((f) => f.id)).toEqual(['old_greyback']);
    expect(candidates(data.fish, 'lake', 'deep', 'day', 'lure_greyback')).toEqual([]);
    expect(candidates(data.fish, 'lake', 'deep', 'night', 'lure_greyback', { old_greyback: { count: 1, best: 1 } })).toEqual([]);
  });
  it('weighted pick favours common fish', () => {
    const rng = makeRng(3);
    const c = candidates(data.fish, 'creek', 'shallow', 'morning', 'lure_fly');
    let rare = 0;
    for (let i = 0; i < 2000; i++) if (pickFish(c, data.config.rarityWeight, rng)?.rarity === 'rare') rare++;
    expect(rare / 2000).toBeGreaterThan(0.08);
    expect(rare / 2000).toBeLessThan(0.2);
    expect(pickFish([], data.config.rarityWeight, rng)).toBeNull();
  });
});

describe('economy', () => {
  it('sizes stay in range and value grows with size', () => {
    const f = fish('dock_perch');
    const rng = makeRng(11);
    for (let i = 0; i < 200; i++) {
      const cm = rollSizeCm(f, rng);
      expect(cm).toBeGreaterThanOrEqual(f.sizeCm.min);
      expect(cm).toBeLessThanOrEqual(f.sizeCm.max);
    }
    expect(sellValue(f, f.sizeCm.max, data.config.economy)).toBeGreaterThan(sellValue(f, f.sizeCm.min, data.config.economy));
    expect(sizeFraction(f, f.sizeCm.min)).toBe(0);
  });
});

describe('predator', () => {
  const cfg = data.config.predator;
  it('wins with enough taps, loses on timeout', () => {
    let s = startPredator(cfg);
    for (let i = 0; i < cfg.taps; i++) s = predatorTap(s, cfg);
    expect(s.outcome).toBe('won');
    let t = startPredator(cfg);
    t = stepPredator(t, cfg.seconds + 0.1);
    expect(t.outcome).toBe('lost');
    expect(predatorTap(t, cfg).outcome).toBe('lost');
  });
  it('never appears on boss fish', () => {
    expect(rollPredator(1, true, () => 0)).toBe(false);
    expect(rollPredator(1, false, () => 0)).toBe(true);
  });
});

describe('player state', () => {
  it('casting consumes bait and advances time after castsPerPeriod casts', () => {
    const p = newPlayer(data);
    const worms = p.inventory.bait_worm;
    expect(beginCast(data, p)).toEqual({ ok: true });
    expect(p.inventory.bait_worm).toBe(worms - 1);
    expect(timeOfDay(data, p)).toBe('morning');
    beginCast(data, p);
    beginCast(data, p);
    expect(timeOfDay(data, p)).toBe('day');
  });
  it('lures are not consumed', () => {
    const p = newPlayer(data);
    p.inventory.lure_fly = 1;
    equip(data, p, 'lure_fly');
    beginCast(data, p);
    expect(p.inventory.lure_fly).toBe(1);
  });
  it('refuses to cast with an empty bait slot or a full creel', () => {
    const p = newPlayer(data);
    p.inventory.bait_worm = 0;
    expect(beginCast(data, p).ok).toBe(false);
    p.inventory.bait_worm = 5;
    for (let i = 0; i < data.config.economy.creelSize; i++) p.creel.push({ fish: 'dock_perch', sizeCm: 20, value: 5 });
    expect(beginCast(data, p).ok).toBe(false);
  });
  it('spots lock on gear and key items; travel advances time', () => {
    const p = newPlayer(data);
    expect(spotLocked(data, p, spot('dock'))).toBeNull();
    expect(spotLocked(data, p, spot('creek'))).toMatch(/Ash Rod/);
    expect(spotLocked(data, p, spot('lake'))).toMatch(/Old Lantern/);
    expect(travel(data, p, 'creek')).toBe(false);
    p.rod = 'rod_ash';
    expect(travel(data, p, 'creek')).toBe(true);
    expect(p.spot).toBe('creek');
    expect(timeOfDay(data, p)).toBe('day');
    waitPeriod(data, p);
    expect(timeOfDay(data, p)).toBe('dusk');
  });
  it('catching logs, fills the creel, grants key items and assembles the lure', () => {
    const p = newPlayer(data);
    const r = recordCatch(data, p, fish('silver_darter'), 20, 'morning');
    expect(r.isNew).toBe(true);
    expect(r.keyItem).toBe('key_blade');
    expect(p.creel.length).toBe(1);
    expect(p.log.silver_darter.count).toBe(1);
    recordCatch(data, p, fish('golden_tench'), 40, 'dusk');
    const r3 = recordCatch(data, p, fish('ironjaw'), 100, 'day');
    expect(r3.lureAssembled).toBe(true);
    expect(p.inventory.lure_greyback).toBe(1);
    expect(p.flags.lureAssembled).toBe(true);
    const win = recordCatch(data, p, fish('old_greyback'), 150, 'night');
    expect(p.flags.won).toBe(true);
    expect(win.isNew).toBe(true);
  });
  it('quests count matching catches and pay out once', () => {
    const p = newPlayer(data);
    recordCatch(data, p, fish('dock_perch'), 25, 'day');
    expect(questReady(data, p, 'q_perch')).toBe(false);
    const r = recordCatch(data, p, fish('dock_perch'), 31, 'day');
    expect(r.questsReady).toContain('q_perch');
    const coins = p.coins;
    expect(claimQuest(data, p, 'q_perch')).toBe(true);
    expect(p.coins).toBe(coins + 45);
    expect(claimQuest(data, p, 'q_perch')).toBe(false);
    for (let i = 0; i < 6; i++) recordCatch(data, p, fish('mudskip_minnow'), 8, 'dusk');
    expect(claimQuest(data, p, 'q_dusk')).toBe(true);
    expect(p.keyItems).toContain('key_lantern');
  });
  it('shop: sell all, buy gear auto-equips, bait packs stack, honey dough gated by quest', () => {
    const p = newPlayer(data);
    p.creel.push({ fish: 'dock_perch', sizeCm: 20, value: 30 }, { fish: 'dock_perch', sizeCm: 20, value: 30 });
    expect(sellAll(p)).toBe(60);
    expect(p.coins).toBe(80);
    expect(buy(data, p, 'rod_ash')).toEqual({ ok: true });
    expect(p.rod).toBe('rod_ash');
    expect(buy(data, p, 'rod_ash').ok).toBe(false);
    expect(buy(data, p, 'rod_carbon').ok).toBe(false);
    const w = p.inventory.bait_worm;
    buy(data, p, 'bait_worm');
    expect(p.inventory.bait_worm).toBe(w + 5);
    expect(shopItems(data, p).some((i) => i.id === 'bait_honey')).toBe(false);
    p.quests.q_honey = 'claimed';
    expect(shopItems(data, p).some((i) => i.id === 'bait_honey')).toBe(true);
  });
});

describe('save codes', () => {
  it('round-trips through export/import', () => {
    const p = newPlayer(data);
    p.coins = 123;
    const code = exportCode(p, data.config.save.exportPrefix);
    const r = importCode(code, data.config.save.exportPrefix);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.coins).toBe(123);
  });
  it('rejects tampered, truncated and foreign codes', () => {
    const p = newPlayer(data);
    const code = exportCode(p, 'LL1.');
    expect(importCode(code.slice(0, -4) + 'zzzz', 'LL1.').ok).toBe(false);
    expect(importCode(code.slice(0, 20), 'LL1.').ok).toBe(false);
    expect(importCode('XX.' + code, 'LL1.').ok).toBe(false);
    expect(importCode('', 'LL1.').ok).toBe(false);
  });
  it('validates shape and migrates old versions', () => {
    expect(validateSave({ v: 1, coins: 'lots' }).ok).toBe(false);
    expect(validateSave({ ...newPlayer(data), v: 99 }).ok).toBe(false);
    const old = { ...newPlayer(data), v: 0 };
    expect((migrate(old) as { v: number }).v).toBe(1);
    expect(validateSave(old).ok).toBe(true);
  });
});
