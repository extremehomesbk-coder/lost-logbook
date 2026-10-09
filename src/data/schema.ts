import { z } from 'zod';

export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export const ZONES = ['shallow', 'mid', 'deep'] as const;
export const TIMES = ['morning', 'day', 'dusk', 'night'] as const;

export type Rarity = (typeof RARITIES)[number];
export type Zone = (typeof ZONES)[number];
export type TimeOfDay = (typeof TIMES)[number];

const range = z.object({ min: z.number(), max: z.number() }).refine((r) => r.min <= r.max, 'min must be <= max');

export const FightProfileSchema = z.object({
  strength: z.number().positive(),
  stamina: z.number().positive(),
  runEvery: z.number().positive(),
  runDuration: z.number().positive(),
});

export const BossPhaseSchema = z.object({
  staminaBelow: z.number().min(0).max(1),
  strengthMult: z.number().positive(),
  runEveryMult: z.number().positive(),
  label: z.string(),
});

export const FishSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rarity: z.enum(RARITIES),
  spots: z.array(z.string()).min(1),
  zones: z.array(z.enum(ZONES)).min(1),
  times: z.array(z.enum(TIMES)).min(1),
  takes: z.array(z.string()).min(1),
  requires: z.string().optional(),
  sizeCm: range,
  value: z.number().nonnegative(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fight: FightProfileSchema,
  grantsKeyItem: z.string().optional(),
  /** bites only until it has been logged once (bosses, the legend) */
  once: z.boolean().optional(),
  boss: z.object({ phases: z.array(BossPhaseSchema).min(1) }).optional(),
  blurb: z.string(),
});

export const SpotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  blurb: z.string(),
  unlock: z
    .object({ rod: z.number().int().optional(), line: z.number().int().optional(), keyItem: z.string().optional() })
    .nullable(),
  biteDelay: range,
  castRange: range,
  predator: z.object({ id: z.string(), name: z.string(), chance: z.number().min(0).max(1) }).nullable(),
});

const gearItem = z.object({ id: z.string().min(1), name: z.string().min(1), blurb: z.string() });

export const GearSchema = z.object({
  rods: z.array(gearItem.extend({ tier: z.number().int().positive(), strength: z.number().positive(), price: z.number().nonnegative() })).min(1),
  lines: z.array(gearItem.extend({ tier: z.number().int().positive(), price: z.number().nonnegative() })).min(1),
  baits: z.array(gearItem.extend({ price: z.number().nonnegative(), pack: z.number().int().positive(), shopUnlock: z.string().optional() })),
  lures: z.array(gearItem.extend({ price: z.number().nonnegative().nullable() })),
  keyItems: z.array(gearItem),
  assembly: z.object({ result: z.string(), parts: z.array(z.string()).min(1) }),
});

export const QuestConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('catch_species'), fish: z.string(), minSizeCm: z.number().optional(), count: z.number().int().positive() }),
  z.object({ type: z.literal('catch_at_time'), time: z.enum(TIMES), count: z.number().int().positive() }),
]);

export const QuestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string(),
  condition: QuestConditionSchema,
  reward: z.object({
    coins: z.number().nonnegative().optional(),
    items: z.record(z.string(), z.number().int().positive()).optional(),
    keyItem: z.string().optional(),
  }),
});

export const ConfigSchema = z.object({
  title: z.string().min(1),
  premise: z.string(),
  start: z.object({
    coins: z.number().nonnegative(),
    rod: z.string(),
    line: z.string(),
    inventory: z.record(z.string(), z.number().int().nonnegative()),
    spot: z.string(),
    equipped: z.string(),
  }),
  time: z.object({
    order: z.array(z.enum(TIMES)).length(4),
    castsPerPeriod: z.number().int().positive(),
    travelAdvances: z.number().int().nonnegative(),
    waitAdvances: z.number().int().positive(),
  }),
  cast: z.object({
    chargeSeconds: z.number().positive(),
    zones: z.object({ shallow: z.number().min(0).max(1), mid: z.number().min(0).max(1) }),
    flightSeconds: z.number().positive(),
  }),
  bite: z.object({
    nibbles: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }),
    nibbleGap: range,
    hookWindowSeconds: z.number().positive(),
    nothingBitingSeconds: z.number().positive(),
    earlyTapSpooks: z.boolean(),
  }),
  fight: z.object({
    startTension: z.number().nonnegative(),
    reelRise: z.number().positive(),
    pullRise: z.number().positive(),
    releaseFall: z.number().positive(),
    runRiseMult: z.number().positive(),
    slackBelow: z.number().nonnegative(),
    slackSeconds: z.number().positive(),
    reelSpeed: z.number().positive(),
    tightBelow: z.number().nonnegative(),
    tightSpan: z.number().positive(),
    restBelow: z.number().nonnegative(),
    restRegen: z.number().nonnegative(),
    gainBase: z.number().positive(),
    fishHold: z.number().nonnegative(),
    gainMin: z.number(),
    runSpeed: z.number().positive(),
    runDrain: z.number().positive(),
    holdDrain: z.number().nonnegative(),
    tiredBelow: z.number().min(0).max(1),
    firstRunDelay: z.number().nonnegative(),
    minRunDuration: z.number().positive(),
    weakPull: z.number().min(0).max(1),
    pullExponent: z.number().positive(),
    resistAfter: z.number().positive(),
    sweetLow: z.number().min(0).max(1),
    sweetHigh: z.number().min(0).max(1),
    sweetGainMult: z.number().positive(),
    sweetDrainMult: z.number().positive(),
    runRampIn: z.number().positive(),
    runFadeOut: z.number().positive(),
    resistRise: z.number().positive(),
    runDurationMult: z.number().positive(),
    restMult: z.number().positive(),
    lineCaps: z.record(z.string(), z.number().positive()),
  }),
  school: z.object({
    count: z.number().int().positive(),
    senseRadius: z.number().positive(),
    wanderSpeed: range,
    approachSpeed: z.number().positive(),
    circleRadius: z.number().positive(),
    circleSpeed: z.number().positive(),
    pause: range,
    turnRate: z.number().positive(),
    scale: range,
    curiosity: z.number().min(0).max(1),
    inspectSeconds: z.number().positive(),
    eligibleSpawnChance: z.number().min(0).max(1),
    respawn: range,
    spookRadius: z.number().nonnegative(),
    lure: z.object({
      sinkSpeed: z.number().positive(),
      retrieveSpeed: z.number().positive(),
      strikeRadius: z.number().positive(),
      strikePerSecond: z.number().positive(),
      chaseRadius: z.number().positive(),
    }),
  }),
  predator: z.object({ taps: z.number().int().positive(), seconds: z.number().positive(), triggerStaminaBelow: z.number().min(0).max(1) }),
  economy: z.object({
    sellLowMult: z.number().positive(),
    sellHighMult: z.number().positive(),
    bigFishBonusAt: z.number().min(0).max(1),
    bigFishBonusMult: z.number().positive(),
    creelSize: z.number().int().positive(),
  }),
  rarityWeight: z.record(z.enum(RARITIES), z.number().positive()),
  reveal: z.object({
    commonSeconds: z.number().positive(),
    uncommonSeconds: z.number().positive(),
    rareSeconds: z.number().positive(),
    legendarySeconds: z.number().positive(),
  }),
  save: z.object({ key: z.string().min(1), version: z.number().int().positive(), exportPrefix: z.string().min(1) }),
});

export type Fish = z.infer<typeof FishSchema>;
export type FightProfile = z.infer<typeof FightProfileSchema>;
export type BossPhase = z.infer<typeof BossPhaseSchema>;
export type Spot = z.infer<typeof SpotSchema>;
export type Gear = z.infer<typeof GearSchema>;
export type Rod = Gear['rods'][number];
export type Line = Gear['lines'][number];
export type Bait = Gear['baits'][number];
export type Lure = Gear['lures'][number];
export type Quest = z.infer<typeof QuestSchema>;
export type GameConfig = z.infer<typeof ConfigSchema>;

export interface GameData {
  config: GameConfig;
  fish: Fish[];
  spots: Spot[];
  gear: Gear;
  quests: Quest[];
}
