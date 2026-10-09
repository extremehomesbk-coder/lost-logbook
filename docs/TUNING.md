# Tuning guide — every number that controls feel, and where it lives

All gameplay numbers are data. Nothing in `src/scenes/` or `src/sim/` hard-codes a tuning value except layout
pixels (`src/game/ui.ts`) and the simulation bot's own "human" constants (`src/sim/playthrough.test.ts`, `T`).
Every data file is validated by `src/data/schema.ts` at boot; an invalid value shows the error screen.

Quick check after any change:

```bash
npm run check     # lint + types + unit tests + playthrough simulation + build
npm run sim       # just the playthrough simulation (report in scratch/playthrough.txt)
```

## config.json

| Key | Value | What it does |
|---|---|---|
| `title`, `premise` | "Lost Logbook" | Working title and intro text (placeholders) |
| `start.coins` | 20 | Starting coins |
| `start.rod` / `start.line` | rod_cane / line_cotton | Starting gear (tier 1) |
| `start.inventory` | 10 worms, 6 bread | Starting bait |
| `start.spot`, `start.equipped` | dock, bait_worm | Where you begin and what is on the hook |
| `time.order` | morning, day, dusk, night | The four periods, in order |
| `time.castsPerPeriod` | 3 | Casts before the period advances |
| `time.travelAdvances` | 1 | Periods advanced by walking to another spot |
| `time.waitAdvances` | 1 | Periods advanced by the map's Wait button |
| `cast.chargeSeconds` | 1.6 | Hold time to reach full power (power is clamped at 1, no ping-pong) |
| `cast.zones.shallow` / `.mid` | 0.35 / 0.70 | Power below shallow = shallow water, below mid = mid, else deep |
| `cast.flightSeconds` | 0.9 | Bobber flight animation |
| `bite.nibbles.min/max` | 0 / 3 | Fake nibbles before the real dip |
| `bite.nibbleGap.min/max` | 0.5 / 1.1 s | Gap between nibbles (and nibble to dip) |
| `bite.hookWindowSeconds` | 0.6 | Tap window after the dip |
| `bite.nothingBitingSeconds` | 9 | How long an empty cast waits before "nothing biting" |
| `bite.earlyTapSpooks` | true | Tapping during a nibble loses the fish |
| `fight.startTension` | 25 | Tension when hooked (line units; cap depends on line) |
| `fight.reelRise` | 20 /s | Tension rise from reeling alone |
| `fight.pullRise` | 13 /s | Tension rise per unit of (fish strength / rod strength) ^ pullExponent |
| `fight.pullExponent` | 1.6 | How sharply an outmatched rod gets punished |
| `fight.releaseFall` | 42 /s | Tension drop when released |
| `fight.runRiseMult` | 1.7 | Reeling during a run multiplies the pull rise |
| `fight.slackBelow` | 8 | Tension under this counts as slack |
| `fight.slackSeconds` | 1.8 | Slack this long = fish escapes |
| `fight.reelSpeed` | 10 m/s | Base reel gain, scaled by sqrt(rod strength) |
| `fight.gainBase`, `fishHold`, `gainMin` | 1.2 / 0.5 / -0.6 | Reel gain fraction = clamp(gainBase - fishHold * strength/rod, gainMin, gainBase); negative = fish takes line while you reel |
| `fight.tightBelow`, `tightSpan` | 25 / 35 | Reel gain ramps from 0 at tension 25 to full at 60 (slack line moves no fish) |
| `fight.runSpeed` | 5.5 m/s | Line the fish takes per second during a run (35% of that if you keep reeling) |
| `fight.runDrain` | 1.0 | Stamina cost of running: (runDrain / fish.stamina) per second |
| `fight.holdDrain` | 0.5 | Stamina cost on a tight line: (holdDrain * tension/cap / fish.stamina) per second |
| `fight.restBelow`, `restRegen` | 40 / 0.6 | Below this tension (released, not running) the fish regains (restRegen / fish.stamina) per second |
| `fight.tiredBelow` | 0.12 | Stamina under this: no more runs ("It is tiring") |
| `fight.weakPull` | 0.4 | Pull of an exhausted fish as a fraction of fresh pull |
| `fight.firstRunDelay` | 1.2 s | Grace before the first run |
| `fight.minRunDuration` | 0.6 s | Floor on run length (runs shorten as stamina drops) |
| `fight.lineCaps` | 100 / 130 / 170 / 220 | Tension cap per line tier |
| `school.count` | 5 | Visible fish in the water at once |
| `school.senseRadius` | 150 px | Distance at which a wandering fish notices a float |
| `school.wanderSpeed.min/max` | 28 / 60 px/s | Idle swimming speed |
| `school.approachSpeed` | 85 px/s | Approach speed (chase = 1.2×, flee = 1.6×) |
| `school.circleRadius`, `circleSpeed` | 28 px / 2.6 rad/s | Circling the float before the bite |
| `school.inspectSeconds` | 0.9 | How long a wrong-bait fish sniffs the float before turning away |
| `school.eligibleSpawnChance` | 0.65 | Chance a spawned fish takes the current bait (else a "wrong bait" fish) |
| `school.respawn.min/max` | 2 / 4 s | Delay before a departed fish is replaced |
| `school.spookRadius` | 90 px | Fish this close to the float flee on a bad tap or a reel-in |
| `school.lure.sinkSpeed` | 14 | Lure fade rate while it sinks (visual only) |
| `school.lure.retrieveSpeed` | 70 px/s | Lure speed toward the angler while held |
| `school.lure.chaseRadius`, `strikeRadius` | 170 / 26 px | Fish chase a moving lure inside chaseRadius; strike inside strikeRadius |
| `school.lure.strikePerSecond` | 1.2 | Strike probability per second while in range and moving; a strike while you hold hooks itself |
| `predator.taps` | 5 | Taps needed to chase the predator off |
| `predator.seconds` | 2.0 | Time allowed |
| `predator.triggerStaminaBelow` | 0.55 | The attempt fires when the fish's stamina first drops under this |
| `economy.sellLowMult` / `sellHighMult` | 0.6 / 1.5 | Sell value = fish.value × lerp(low, high, size fraction) |
| `economy.bigFishBonusAt` / `bigFishBonusMult` | 0.9 / 1.25 | Top 10% sizes earn 25% extra |
| `economy.creelSize` | 8 | Fish carried before you must sell |
| `rarityWeight` | 10 / 4 / 1.2 / 1 | Spawn weights common / uncommon / rare / legendary among eligible fish |
| `reveal.*Seconds` | 1.8 / 2.2 / 3.2 / 5.0 | Reveal hold time by rarity (tap allowed after half of it) |
| `save.key`, `save.version`, `save.exportPrefix` | lostlogbook.save / 1 / LL1. | Storage key, save format version, save-code prefix |

## fish.json (20 species)

Per fish: `rarity`, `spots`, `zones`, `times`, `takes` (baits/lures it bites), optional `requires` (bites ONLY on
this item), `sizeCm.min/max` (sizes roll on a triangle peaked at 35% of the range, `src/sim/economy.ts`),
`value` (coins at mid size), `color` (placeholder art), `fight` (`strength`, `stamina` seconds of running, `runEvery`,
`runDuration`), optional `grantsKeyItem`, `once` (never bites again after the first catch: boss and legend),
optional `boss.phases` (`staminaBelow`, `strengthMult`, `runEveryMult`, `label`).

Strength ladder: 0.6-1.4 dock/creek commons, 1.6-2.0 creek uncommon/rare, 2.4-2.8 pond/falls, 3.2-3.4 night lake,
5.0 Ironjaw (boss), 6.5 Old Greyback (legend). Rod strength 1-4 is on the same scale.

Bot landing matrix (20 seeds, `scratch/probe` style, after the final tuning):

| Fish | rod 1 / line 1 | rod 2 / line 2 | rod 3 / line 3 | rod 4 / line 4 |
|---|---|---|---|---|
| Dock Perch | 100% in 12 s | 4 s | 3 s | 3 s |
| Speckled Trout | 100% in 29 s | 8 s | 6 s | 6 s |
| Moss Carp | 100% in 46 s | 14 s | 6 s | 5 s |
| Lantern Catfish | 15% | 25 s | 10 s | 7 s |
| The Ironjaw | 0% | 95 s | 33 s | 10 s |
| Old Greyback | 0% | 80% in 141 s | 100 s | 30 s |

## spots.json (5 spots)

`unlock` (`rod` tier, `line` tier, `keyItem`), `biteDelay.min/max` (seconds to first nibble), `castRange.min/max`
(metres of line out at power 0 and 1), `predator` (`id`, `name`, `chance` per hooked non-boss fish), `x/y` on the map.

| Spot | Unlock | Bite delay | Cast range | Predator |
|---|---|---|---|---|
| Old Dock | — | 2.5-6 s | 14-36 m | Grey Gull 12% |
| Stony Creek | Ash Rod | 2.5-6.5 s | 15-40 m | River Otter 15% |
| Lily Pond | Braided Line | 3-7 s | 20-50 m | Big Pike 15% |
| Waterfall Pool | Steel Rod + Silk Line | 3-7 s | 25-70 m | Night Heron 10% |
| Night Lake | Old Lantern | 3.5-8 s | 25-80 m | Big Pike 10% |

## gear.json

Rods: Cane 0 (str 1), Ash 60 (2), Steel 260 (3), Carbon 600 (4). Lines: Cotton 0, Braided 50, Silk 220, Wire 520.
Baits (price per pack): Worms 6/5, Bread 4/5, Shrimp 12/4, Dough 10/4, Honey Dough 20/2 (shop-locked behind
quest `q_honey`). Lures: Feather Fly 45, Tin Spoon 70, Glow Lure (quest only), Greyback Lure (assembled from
Silver Blade + Golden Scale + Ironjaw Hook; `assembly`). Buying a rod or line auto-equips it.

## quests.json

| Quest | Condition | Reward |
|---|---|---|
| A Proper Perch | Dock Perch ≥ 30 cm | 45 coins |
| Feathers for Trout | 1 Speckled Trout | Feather Fly + 20 |
| Dusk Patrol | 6 fish at dusk | Old Lantern (unlocks Night Lake) |
| Carp for the Baker | 2 Moss Carp | 2 Honey Dough + 30, unlocks Honey Dough in the shop |
| Lights Below | 1 Lantern Catfish | Glow Lure (Moonshade Bass) |

## Layout and art

Design resolution 390×844 (portrait iPhone), Phaser `FIT`; `src/game/ui.ts` (`W`, `H`, `TOP`, `BOTTOM`, palette,
rarity colours, sky colours per period). Placeholder textures are generated in `src/game/textures.ts`; the keys are
stable so real art can be loaded under the same key: `fish_<id>`, `fish_<id>_silhouette`, `bobber`, `spot_<id>`,
`fishtop_<id>` (top-down outline), `predator_<id>`, `coin`, `lock`, `spark`, `ray`.

## Simulation constants (not gameplay; `src/sim/playthrough.test.ts`)

Bot time per action: cast 2.5 s, lost fish 1.5 s, failed hook 1.0 s, shop visit 10 s, travel 3 s, wait 2 s,
board 5 s, predator 2 s; hook success 90%, predator defence 85%. Bot fight policy (`src/sim/bot.ts`): reaction
0.25 s, release at 75% of the cap, resume at 50%.
