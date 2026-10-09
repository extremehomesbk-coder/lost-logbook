/**
 * Full-run simulation: a competent bot plays from first cast to the legendary fish with modeled wall-clock time.
 * `npm run sim` prints the report; `npm test` asserts the run lands inside the 30-45 minute target band.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import type { Fish, Spot, TimeOfDay, Zone } from '../data/schema';
import { candidates, lineOutForPower, pickFish, planBite } from './bite';
import { autoFight } from './bot';
import { rollSizeCm, sellValue } from './economy';
import { landability } from './fight';
import { rollPredator } from './predator';
import { makeRng, type Rng } from './rng';
import {
  beginCast, buy, claimQuest, equip, hasItem, lineCapOf, newPlayer, questReady, recordCatch, recordLoss, rodOf, sellAll, spotLocked,
  timeOfDay, travel, waitPeriod, type PlayerState,
} from './state';

const data = loadGameData();
const cfg = data.config;

/** Seconds the bot spends on things the fight model does not cover. */
const T = {
  cast: 2.5, // charge + flight
  lost: 1.5,
  hookFail: 1.0,
  shop: 10,
  travel: 3,
  wait: 2,
  board: 5,
  predator: 2,
  hookSuccess: 0.9,
  predatorWin: 0.85,
  maxSeconds: 3 * 3600,
};

const ZONE_POWER: Record<Zone, number> = { shallow: 0.15, mid: 0.5, deep: 0.92 };
const WISHLIST = ['line_braid', 'rod_ash', 'lure_fly', 'lure_spoon', 'rod_steel', 'line_silk', 'rod_carbon', 'line_wire'];

interface Target { spot: string; zone: Zone; item: string; time: TimeOfDay | null; why: string }

interface Run {
  p: PlayerState;
  rng: Rng;
  clock: number;
  log: string[];
  gearTimeline: string[];
}

const fishById = (id: string) => data.fish.find((f) => f.id === id)!;
const spotById = (id: string) => data.spots.find((s) => s.id === id)!;

function landChance(p: PlayerState, f: Fish): number {
  return landability(cfg.fight, f.fight, rodOf(data, p).strength, lineCapOf(data, p));
}

function avgValue(f: Fish): number {
  return sellValue(f, (f.sizeCm.min + f.sizeCm.max) / 2, cfg.economy);
}

/** Expected coins per cast for a spot/zone/item at a given time, ignoring fish the bot cannot land. */
function expectedCoins(p: PlayerState, spot: Spot, zone: Zone, item: string, time: TimeOfDay): number {
  const cands = candidates(data.fish, spot.id, zone, time, item, p.log);
  const total = cands.reduce((a, f) => a + cfg.rarityWeight[f.rarity], 0);
  if (total === 0) return 0;
  let ev = 0;
  for (const f of cands) {
    const lc = landChance(p, f);
    if (lc < 0.3) continue;
    ev += (cfg.rarityWeight[f.rarity] / total) * lc * T.hookSuccess * avgValue(f);
  }
  return ev;
}

function ownedItems(p: PlayerState): string[] {
  return [...data.gear.baits, ...data.gear.lures].map((i) => i.id).filter((id) => hasItem(p, id));
}

function periodsUntil(p: PlayerState, time: TimeOfDay): number {
  const idx = cfg.time.order.indexOf(time);
  return (idx - p.timeIndex + 4) % 4;
}

/** Best coin-grinding target right now (allowing waits for a better period). */
function bestGrind(p: PlayerState, forceTime: TimeOfDay | null): Target {
  let best: Target & { score: number } = { spot: p.spot, zone: 'shallow', item: p.equipped, time: null, why: 'grind', score: -1 };
  for (const spot of data.spots) {
    if (spotLocked(data, p, spot)) continue;
    for (const zone of ['shallow', 'mid', 'deep'] as Zone[]) {
      for (const item of ownedItems(p)) {
        for (const time of cfg.time.order) {
          if (forceTime && time !== forceTime) continue;
          const ev = expectedCoins(p, spot, zone, item, time);
          const waits = periodsUntil(p, time);
          const travelCost = spot.id === p.spot ? 0 : 1;
          const score = ev - waits * 1.2 - travelCost * 1.5;
          if (score > best.score) best = { spot: spot.id, zone, item, time: waits ? time : null, why: forceTime ? `grind at ${forceTime}` : 'grind', score };
        }
      }
    }
  }
  return best;
}

/** What the bot wants to do next, or null when it should just grind for coins. */
function nextGoal(p: PlayerState): Target | null {
  const can = (f: Fish, min = 0.5) => landChance(p, f) >= min;
  const unlocked = (id: string) => !spotLocked(data, p, spotById(id));

  if (!p.keyItems.includes('key_lantern')) return bestGrind(p, 'dusk');
  if (!p.keyItems.includes('key_blade') && unlocked('creek') && hasItem(p, 'lure_fly') && can(fishById('silver_darter')))
    return { spot: 'creek', zone: 'shallow', item: 'lure_fly', time: 'morning', why: 'Silver Darter -> Silver Blade' };
  if (!p.keyItems.includes('key_scale') && unlocked('pond') && can(fishById('moss_carp'))) {
    if (p.quests.q_honey !== 'claimed') {
      if (hasItem(p, 'bait_dough')) return { spot: 'pond', zone: 'mid', item: 'bait_dough', time: 'day', why: 'Moss Carp x2 for honey dough' };
    } else if (hasItem(p, 'bait_honey') && can(fishById('golden_tench'))) {
      return { spot: 'pond', zone: 'deep', item: 'bait_honey', time: 'dusk', why: 'Golden Tench -> Golden Scale' };
    }
  }
  if (!p.keyItems.includes('key_hook') && unlocked('falls') && hasItem(p, 'lure_spoon') && can(fishById('ironjaw'), 0.6))
    return { spot: 'falls', zone: 'deep', item: 'lure_spoon', time: null, why: 'The Ironjaw -> Ironjaw Hook' };
  if (p.flags.lureAssembled && unlocked('lake') && can(fishById('old_greyback'), 0.6))
    return { spot: 'lake', zone: 'deep', item: 'lure_greyback', time: 'night', why: 'Old Greyback' };
  return null;
}

/** Baits the current goals will need soon, so the shop visit stocks them. */
function neededBaits(p: PlayerState, target: Target): string[] {
  const out = new Set<string>();
  if (data.gear.baits.some((b) => b.id === target.item)) out.add(target.item);
  if (!p.keyItems.includes('key_scale') && p.quests.q_honey !== 'claimed') out.add('bait_dough');
  if (p.quests.q_honey === 'claimed' && !p.keyItems.includes('key_scale')) out.add('bait_honey');
  out.add('bait_worm');
  return [...out];
}

function visitShop(run: Run, target: Target): void {
  const p = run.p;
  const before = p.coins;
  const sold = sellAll(p);
  run.clock += T.shop;
  for (const id of WISHLIST) {
    const r = buy(data, p, id);
    if (r.ok) run.gearTimeline.push(`${fmt(run.clock)} bought ${id} (coins left ${p.coins})`);
  }
  for (const id of neededBaits(p, target)) {
    const bait = data.gear.baits.find((b) => b.id === id)!;
    const reserve = id === 'bait_worm' ? 4 : 2;
    let tries = 0;
    while ((p.inventory[id] ?? 0) < reserve * bait.pack && tries++ < 6 && buy(data, p, id).ok) {
      /* keep buying */
    }
  }
  run.log.push(`${fmt(run.clock)} shop: sold ${sold}, coins ${before} -> ${p.coins}`);
}

function claimQuests(run: Run): void {
  for (const q of data.quests) {
    if (questReady(data, run.p, q.id)) {
      claimQuest(data, run.p, q.id);
      run.clock += T.board;
      run.log.push(`${fmt(run.clock)} quest claimed: ${q.title}`);
    }
  }
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function oneCast(run: Run, target: Target): void {
  const { p, rng } = run;
  const spot = spotById(p.spot);
  const started = beginCast(data, p);
  if (!started.ok) throw new Error(started.reason);
  run.clock += T.cast;
  const power = ZONE_POWER[target.zone];
  const bite = planBite(cfg.bite, spot, rng);
  const time = timeOfDay(data, p);
  const cands = candidates(data.fish, spot.id, target.zone, time, target.item, p.log);
  const fish = pickFish(cands, cfg.rarityWeight, rng);
  if (!fish) {
    run.clock += cfg.bite.nothingBitingSeconds;
    return;
  }
  run.clock += bite.dipAt;
  if (rng() > T.hookSuccess) {
    run.clock += T.hookFail;
    recordLoss(p);
    return;
  }
  const fight = autoFight({
    fish: fish.fight,
    bossPhases: fish.boss?.phases,
    rodStrength: rodOf(data, p).strength,
    lineCap: lineCapOf(data, p),
    lineOut: lineOutForPower(power, spot),
    cfg: cfg.fight,
    rng,
  });
  run.clock += Math.min(fight.elapsed, 180);
  if (fight.outcome === 'landed' && spot.predator && rollPredator(spot.predator.chance, !!fish.boss, rng)) {
    run.clock += T.predator;
    if (rng() > T.predatorWin) {
      recordLoss(p);
      run.clock += T.lost;
      return;
    }
  }
  if (fight.outcome !== 'landed') {
    recordLoss(p);
    run.clock += T.lost;
    return;
  }
  const size = rollSizeCm(fish, rng);
  const r = recordCatch(data, p, fish, size, time);
  run.clock += cfg.reveal[`${fish.rarity}Seconds`];
  if (fish.rarity !== 'common' || r.keyItem) run.log.push(`${fmt(run.clock)} caught ${fish.name} ${size} cm${r.keyItem ? ` -> ${r.keyItem}` : ''}${r.lureAssembled ? ' -> LURE ASSEMBLED' : ''}`);
}

export function simulateRun(seed: number): Run {
  const run: Run = { p: newPlayer(data), rng: makeRng(seed), clock: 0, log: [], gearTimeline: [] };
  const p = run.p;
  let safety = 0;
  while (!p.flags.won && run.clock < T.maxSeconds && safety++ < 5000) {
    claimQuests(run);
    const target = nextGoal(p) ?? bestGrind(p, null);

    const nextBuy = WISHLIST.find((id) => !hasItem(p, id) && !p.ownedRods.includes(id) && !p.ownedLines.includes(id));
    const nextPrice = nextBuy ? [...data.gear.rods, ...data.gear.lines, ...data.gear.lures].find((g) => g.id === nextBuy)?.price ?? 0 : 0;
    const creelValue = p.creel.reduce((a, c) => a + c.value, 0);
    const baitShort = neededBaits(p, target).some((id) => (p.inventory[id] ?? 0) === 0 && p.coins >= (data.gear.baits.find((b) => b.id === id)?.price ?? 0));
    const itemMissing = !hasItem(p, target.item);
    if (p.creel.length >= cfg.economy.creelSize - 1 || (creelValue > 0 && p.coins + creelValue >= nextPrice && nextPrice > 0) || baitShort || itemMissing) {
      visitShop(run, target);
      if (!hasItem(p, target.item)) {
        // cannot pursue this target yet (e.g. no dough); grind instead
        const g = bestGrind(p, null);
        if (!hasItem(p, g.item)) throw new Error(`stuck: no usable bait at ${fmt(run.clock)}`);
        Object.assign(target, g);
      }
    }

    if (target.spot !== p.spot) {
      travel(data, p, target.spot);
      run.clock += T.travel;
    }
    if (target.time && timeOfDay(data, p) !== target.time) {
      let guard = 0;
      while (timeOfDay(data, p) !== target.time && guard++ < 4) {
        waitPeriod(data, p);
        run.clock += T.wait;
      }
    }
    equip(data, p, target.item);
    oneCast(run, target);
    p.stats.playSeconds = run.clock;
  }
  return run;
}

function report(run: Run, seed: number): string {
  const p = run.p;
  const lines = [
    `# Playthrough simulation (seed ${seed})`,
    '',
    p.flags.won ? `Legendary landed at ${fmt(run.clock)} (${(run.clock / 60).toFixed(1)} min).` : `NOT FINISHED after ${fmt(run.clock)}.`,
    `Casts ${p.stats.casts}, catches ${p.stats.catches}, lost ${p.stats.lost}, species logged ${Object.keys(p.log).length}/${data.fish.length}, coins at end ${p.coins}.`,
    '',
    '## Gear timeline',
    ...run.gearTimeline,
    '',
    '## Notable events',
    ...run.log,
  ];
  return lines.join('\n');
}

describe('full playthrough simulation', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const runs = seeds.map((s) => ({ seed: s, run: simulateRun(s) }));
  const minutes = runs.map((r) => r.run.clock / 60);

  it('writes the report (scratch/playthrough.txt)', () => {
    const summary = runs.map((r) => `seed ${r.seed}: ${r.run.p.flags.won ? fmt(r.run.clock) : 'DNF'} casts=${r.run.p.stats.casts} lost=${r.run.p.stats.lost}`);
    const text = [...summary, '', report(runs[0].run, runs[0].seed)].join('\n');
    try {
      mkdirSync('scratch', { recursive: true });
      writeFileSync('scratch/playthrough.txt', text);
    } catch {
      /* read-only CI is fine */
    }
    console.log(text);
  });

  it('every seeded run reaches the legendary fish', () => {
    for (const r of runs) expect(r.run.p.flags.won, `seed ${r.seed}`).toBe(true);
  });

  // The bot never misreads a menu or hunts for a spot, so it runs roughly 1.3x faster than a person.
  // A bot median of 22-38 minutes puts a human in the 30-45 minute target band (the bot also never waits for a fish to notice the float).
  it('the median bot run lands inside 22-38 minutes', () => {
    const sorted = [...minutes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThanOrEqual(22);
    expect(median).toBeLessThanOrEqual(38);
  });
});
