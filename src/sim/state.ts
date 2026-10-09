/** Player state and every rule that changes it. Pure functions; the scenes only call these. */
import { z } from 'zod';
import type { Fish, GameData, Spot, TimeOfDay } from '../data/schema';
import { TIMES } from '../data/schema';
import { sellValue } from './economy';

export const CreelEntrySchema = z.object({ fish: z.string(), sizeCm: z.number(), value: z.number() });
export const LogEntrySchema = z.object({ count: z.number().int().nonnegative(), best: z.number().nonnegative() });

export const PlayerStateSchema = z.object({
  v: z.number().int().positive(),
  coins: z.number().int().nonnegative(),
  rod: z.string(),
  line: z.string(),
  equipped: z.string(),
  inventory: z.record(z.string(), z.number().int().nonnegative()),
  ownedRods: z.array(z.string()),
  ownedLines: z.array(z.string()),
  keyItems: z.array(z.string()),
  creel: z.array(CreelEntrySchema),
  log: z.record(z.string(), LogEntrySchema),
  quests: z.record(z.string(), z.enum(['open', 'claimed'])),
  counters: z.record(z.string(), z.number().int().nonnegative()),
  timeIndex: z.number().int().min(0).max(3),
  castsInPeriod: z.number().int().nonnegative(),
  spot: z.string(),
  stats: z.object({
    casts: z.number().int().nonnegative(),
    catches: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    playSeconds: z.number().nonnegative(),
    legendaryAtSeconds: z.number().nullable(),
  }),
  flags: z.object({ lureAssembled: z.boolean(), won: z.boolean() }),
});

export type PlayerState = z.infer<typeof PlayerStateSchema>;
export type CreelEntry = z.infer<typeof CreelEntrySchema>;

export function newPlayer(data: GameData): PlayerState {
  const s = data.config.start;
  return {
    v: data.config.save.version,
    coins: s.coins,
    rod: s.rod,
    line: s.line,
    equipped: s.equipped,
    inventory: { ...s.inventory },
    ownedRods: [s.rod],
    ownedLines: [s.line],
    keyItems: [],
    creel: [],
    log: {},
    quests: Object.fromEntries(data.quests.map((q) => [q.id, 'open' as const])),
    counters: {},
    timeIndex: 0,
    castsInPeriod: 0,
    spot: s.spot,
    stats: { casts: 0, catches: 0, lost: 0, playSeconds: 0, legendaryAtSeconds: null },
    flags: { lureAssembled: false, won: false },
  };
}

// ---------- lookups ----------

export function rodOf(data: GameData, p: PlayerState) {
  return data.gear.rods.find((r) => r.id === p.rod) ?? data.gear.rods[0];
}
export function lineOf(data: GameData, p: PlayerState) {
  return data.gear.lines.find((l) => l.id === p.line) ?? data.gear.lines[0];
}
export function lineCapOf(data: GameData, p: PlayerState): number {
  return data.config.fight.lineCaps[String(lineOf(data, p).tier)] ?? 100;
}
export function isLure(data: GameData, itemId: string): boolean {
  return data.gear.lures.some((l) => l.id === itemId);
}
export function itemName(data: GameData, id: string): string {
  return (
    data.gear.baits.find((b) => b.id === id)?.name ??
    data.gear.lures.find((l) => l.id === id)?.name ??
    data.gear.keyItems.find((k) => k.id === id)?.name ??
    data.gear.rods.find((r) => r.id === id)?.name ??
    data.gear.lines.find((l) => l.id === id)?.name ??
    id
  );
}
export function timeOfDay(data: GameData, p: PlayerState): TimeOfDay {
  return data.config.time.order[p.timeIndex] ?? TIMES[0];
}
export function hasItem(p: PlayerState, id: string): boolean {
  return (p.inventory[id] ?? 0) > 0;
}
export function spotOf(data: GameData, p: PlayerState): Spot {
  return data.spots.find((s) => s.id === p.spot) ?? data.spots[0];
}

// ---------- time ----------

export function advanceTime(p: PlayerState, periods: number): void {
  p.timeIndex = (p.timeIndex + periods) % 4;
  p.castsInPeriod = 0;
}

/** Called once per cast. Consumes bait, counts the cast, advances time when the period is spent. */
export function beginCast(data: GameData, p: PlayerState): { ok: true } | { ok: false; reason: string } {
  if (p.creel.length >= data.config.economy.creelSize) return { ok: false, reason: 'Creel full. Sell your catch at the shop.' };
  if (!isLure(data, p.equipped)) {
    if (!hasItem(p, p.equipped)) return { ok: false, reason: `Out of ${itemName(data, p.equipped)}.` };
    p.inventory[p.equipped] -= 1;
  }
  p.stats.casts += 1;
  p.castsInPeriod += 1;
  if (p.castsInPeriod >= data.config.time.castsPerPeriod) advanceTime(p, 1);
  return { ok: true };
}

// ---------- travel ----------

export function spotLocked(data: GameData, p: PlayerState, spot: Spot): string | null {
  const u = spot.unlock;
  if (!u) return null;
  const rod = rodOf(data, p);
  const line = lineOf(data, p);
  const needs: string[] = [];
  if (u.rod !== undefined && rod.tier < u.rod) needs.push(data.gear.rods.find((r) => r.tier === u.rod)?.name ?? `rod tier ${u.rod}`);
  if (u.line !== undefined && line.tier < u.line) needs.push(data.gear.lines.find((l) => l.tier === u.line)?.name ?? `line tier ${u.line}`);
  if (u.keyItem !== undefined && !p.keyItems.includes(u.keyItem)) needs.push(itemName(data, u.keyItem));
  return needs.length ? `Needs ${needs.join(' + ')}` : null;
}

export function travel(data: GameData, p: PlayerState, spotId: string): boolean {
  const spot = data.spots.find((s) => s.id === spotId);
  if (!spot || spotLocked(data, p, spot)) return false;
  if (spot.id !== p.spot) advanceTime(p, data.config.time.travelAdvances);
  p.spot = spot.id;
  return true;
}

export function waitPeriod(data: GameData, p: PlayerState): void {
  advanceTime(p, data.config.time.waitAdvances);
}

// ---------- catching ----------

export interface CatchResult {
  entry: CreelEntry;
  isNew: boolean;
  isRecord: boolean;
  keyItem: string | null;
  lureAssembled: boolean;
  questsReady: string[];
}

export function recordCatch(data: GameData, p: PlayerState, fish: Fish, sizeCm: number, time: TimeOfDay): CatchResult {
  const value = sellValue(fish, sizeCm, data.config.economy);
  const entry: CreelEntry = { fish: fish.id, sizeCm, value };
  p.creel.push(entry);
  p.stats.catches += 1;

  const prev = p.log[fish.id];
  const isNew = !prev;
  const isRecord = !prev || sizeCm > prev.best;
  p.log[fish.id] = { count: (prev?.count ?? 0) + 1, best: Math.max(prev?.best ?? 0, sizeCm) };

  let keyItem: string | null = null;
  if (fish.grantsKeyItem && !p.keyItems.includes(fish.grantsKeyItem)) {
    p.keyItems.push(fish.grantsKeyItem);
    keyItem = fish.grantsKeyItem;
  }
  const lureAssembled = tryAssemble(data, p);

  const questsReady: string[] = [];
  for (const q of data.quests) {
    if (p.quests[q.id] !== 'open') continue;
    const c = q.condition;
    let matches = false;
    if (c.type === 'catch_species') matches = c.fish === fish.id && (c.minSizeCm === undefined || sizeCm >= c.minSizeCm);
    else if (c.type === 'catch_at_time') matches = c.time === time;
    if (matches) {
      const before = p.counters[q.id] ?? 0;
      p.counters[q.id] = before + 1;
      if (before < c.count && before + 1 >= c.count) questsReady.push(q.id);
    }
  }

  if (fish.rarity === 'legendary' && !p.flags.won) {
    p.flags.won = true;
    p.stats.legendaryAtSeconds = p.stats.playSeconds;
  }
  return { entry, isNew, isRecord, keyItem, lureAssembled, questsReady };
}

export function recordLoss(p: PlayerState): void {
  p.stats.lost += 1;
}

function tryAssemble(data: GameData, p: PlayerState): boolean {
  const a = data.gear.assembly;
  if (p.flags.lureAssembled) return false;
  if (!a.parts.every((part) => p.keyItems.includes(part))) return false;
  p.inventory[a.result] = 1;
  p.flags.lureAssembled = true;
  return true;
}

// ---------- quests ----------

export function questProgress(p: PlayerState, questId: string): number {
  return p.counters[questId] ?? 0;
}
export function questReady(data: GameData, p: PlayerState, questId: string): boolean {
  const q = data.quests.find((x) => x.id === questId);
  return !!q && p.quests[questId] === 'open' && questProgress(p, questId) >= q.condition.count;
}
export function claimQuest(data: GameData, p: PlayerState, questId: string): boolean {
  if (!questReady(data, p, questId)) return false;
  const q = data.quests.find((x) => x.id === questId)!;
  p.quests[questId] = 'claimed';
  if (q.reward.coins) p.coins += q.reward.coins;
  for (const [id, n] of Object.entries(q.reward.items ?? {})) {
    p.inventory[id] = isLure(data, id) ? 1 : (p.inventory[id] ?? 0) + n;
  }
  if (q.reward.keyItem && !p.keyItems.includes(q.reward.keyItem)) p.keyItems.push(q.reward.keyItem);
  tryAssemble(data, p);
  return true;
}

// ---------- shop ----------

export function sellAll(p: PlayerState): number {
  const total = p.creel.reduce((a, c) => a + c.value, 0);
  p.coins += total;
  p.creel = [];
  return total;
}

export type ShopItem =
  | { kind: 'rod'; id: string; name: string; price: number; blurb: string; owned: boolean }
  | { kind: 'line'; id: string; name: string; price: number; blurb: string; owned: boolean }
  | { kind: 'bait'; id: string; name: string; price: number; pack: number; blurb: string; have: number }
  | { kind: 'lure'; id: string; name: string; price: number; blurb: string; owned: boolean };

export function shopItems(data: GameData, p: PlayerState): ShopItem[] {
  const out: ShopItem[] = [];
  for (const r of data.gear.rods) if (r.price > 0) out.push({ kind: 'rod', id: r.id, name: r.name, price: r.price, blurb: r.blurb, owned: p.ownedRods.includes(r.id) });
  for (const l of data.gear.lines) if (l.price > 0) out.push({ kind: 'line', id: l.id, name: l.name, price: l.price, blurb: l.blurb, owned: p.ownedLines.includes(l.id) });
  for (const b of data.gear.baits) {
    if (b.shopUnlock && p.quests[b.shopUnlock] !== 'claimed') continue;
    out.push({ kind: 'bait', id: b.id, name: b.name, price: b.price, pack: b.pack, blurb: b.blurb, have: p.inventory[b.id] ?? 0 });
  }
  for (const l of data.gear.lures) if (l.price !== null) out.push({ kind: 'lure', id: l.id, name: l.name, price: l.price, blurb: l.blurb, owned: hasItem(p, l.id) });
  return out;
}

export function buy(data: GameData, p: PlayerState, itemId: string): { ok: true } | { ok: false; reason: string } {
  const item = shopItems(data, p).find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'Not for sale.' };
  if (item.kind !== 'bait' && item.owned) return { ok: false, reason: 'Already owned.' };
  if (p.coins < item.price) return { ok: false, reason: 'Not enough coins.' };
  p.coins -= item.price;
  switch (item.kind) {
    case 'rod':
      p.ownedRods.push(item.id);
      p.rod = item.id; // auto-equip the better rod
      break;
    case 'line':
      p.ownedLines.push(item.id);
      p.line = item.id;
      break;
    case 'bait':
      p.inventory[item.id] = (p.inventory[item.id] ?? 0) + item.pack;
      break;
    case 'lure':
      p.inventory[item.id] = 1;
      break;
  }
  return { ok: true };
}

export function equip(data: GameData, p: PlayerState, itemId: string): boolean {
  if (!hasItem(p, itemId)) return false;
  if (!isLure(data, itemId) && !data.gear.baits.some((b) => b.id === itemId)) return false;
  p.equipped = itemId;
  return true;
}

/** Everything the player can put on the hook right now. */
export function equippable(data: GameData, p: PlayerState): { id: string; name: string; count: number | null }[] {
  const out: { id: string; name: string; count: number | null }[] = [];
  for (const b of data.gear.baits) if (hasItem(p, b.id)) out.push({ id: b.id, name: b.name, count: p.inventory[b.id] });
  for (const l of data.gear.lures) if (hasItem(p, l.id)) out.push({ id: l.id, name: l.name, count: null });
  return out;
}
