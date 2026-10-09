import { z } from 'zod';
import configJson from './config.json';
import fishJson from './fish.json';
import gearJson from './gear.json';
import questsJson from './quests.json';
import spotsJson from './spots.json';
import { ConfigSchema, FishSchema, GearSchema, QuestSchema, SpotSchema, type GameData } from './schema';

export class DataError extends Error {
  constructor(public readonly file: string, message: string) {
    super(message);
    this.name = 'DataError';
  }
}

function parse<T>(file: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new DataError(file, lines.join('\n'));
  }
  return result.data;
}

/** Cross-file checks the schemas cannot express (ids referring to other files). */
function crossCheck(data: GameData): void {
  const problems: string[] = [];
  const spotIds = new Set(data.spots.map((s) => s.id));
  const itemIds = new Set([
    ...data.gear.baits.map((b) => b.id),
    ...data.gear.lures.map((l) => l.id),
  ]);
  const keyIds = new Set(data.gear.keyItems.map((k) => k.id));
  const fishIds = new Set(data.fish.map((f) => f.id));
  const questIds = new Set(data.quests.map((q) => q.id));

  for (const f of data.fish) {
    for (const s of f.spots) if (!spotIds.has(s)) problems.push(`fish ${f.id}: unknown spot ${s}`);
    for (const t of f.takes) if (!itemIds.has(t)) problems.push(`fish ${f.id}: unknown bait/lure ${t}`);
    if (f.requires && !itemIds.has(f.requires)) problems.push(`fish ${f.id}: unknown requires ${f.requires}`);
    if (f.grantsKeyItem && !keyIds.has(f.grantsKeyItem)) problems.push(`fish ${f.id}: unknown key item ${f.grantsKeyItem}`);
  }
  for (const s of data.spots) {
    if (s.unlock?.keyItem && !keyIds.has(s.unlock.keyItem)) problems.push(`spot ${s.id}: unknown key item ${s.unlock.keyItem}`);
  }
  for (const q of data.quests) {
    if (q.condition.type === 'catch_species' && !fishIds.has(q.condition.fish)) problems.push(`quest ${q.id}: unknown fish ${q.condition.fish}`);
    if (q.reward.keyItem && !keyIds.has(q.reward.keyItem)) problems.push(`quest ${q.id}: unknown key item ${q.reward.keyItem}`);
    for (const id of Object.keys(q.reward.items ?? {})) if (!itemIds.has(id)) problems.push(`quest ${q.id}: unknown reward item ${id}`);
  }
  for (const b of data.gear.baits) if (b.shopUnlock && !questIds.has(b.shopUnlock)) problems.push(`bait ${b.id}: unknown quest ${b.shopUnlock}`);
  for (const p of data.gear.assembly.parts) if (!keyIds.has(p)) problems.push(`assembly: unknown part ${p}`);
  if (!itemIds.has(data.gear.assembly.result)) problems.push(`assembly: unknown result ${data.gear.assembly.result}`);
  if (!data.gear.rods.some((r) => r.id === data.config.start.rod)) problems.push(`config.start.rod ${data.config.start.rod} not in gear.rods`);
  if (!data.gear.lines.some((l) => l.id === data.config.start.line)) problems.push(`config.start.line ${data.config.start.line} not in gear.lines`);
  if (!spotIds.has(data.config.start.spot)) problems.push(`config.start.spot ${data.config.start.spot} not in spots`);
  if (!itemIds.has(data.config.start.equipped)) problems.push(`config.start.equipped ${data.config.start.equipped} unknown`);
  for (const l of data.gear.lines) if (!(String(l.tier) in data.config.fight.lineCaps)) problems.push(`line ${l.id}: no lineCaps entry for tier ${l.tier}`);
  const legendary = data.fish.filter((f) => f.rarity === 'legendary');
  if (legendary.length !== 1) problems.push(`expected exactly one legendary fish, found ${legendary.length}`);

  if (problems.length) throw new DataError('cross-file', problems.join('\n'));
}

/** Validate the bundled JSON. Throws DataError with a readable message. */
export function loadGameData(raw: {
  config?: unknown; fish?: unknown; spots?: unknown; gear?: unknown; quests?: unknown;
} = {}): GameData {
  const data: GameData = {
    config: parse('config.json', ConfigSchema, raw.config ?? configJson),
    fish: parse('fish.json', z.array(FishSchema).min(1), raw.fish ?? fishJson),
    spots: parse('spots.json', z.array(SpotSchema).min(1), raw.spots ?? spotsJson),
    gear: parse('gear.json', GearSchema, raw.gear ?? gearJson),
    quests: parse('quests.json', z.array(QuestSchema), raw.quests ?? questsJson),
  };
  crossCheck(data);
  return data;
}
