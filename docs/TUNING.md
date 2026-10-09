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
| `fight.startTension` | 35 | Tension when hooked (line units; cap depends on line) |
| `fight.reelRise` | 20 /s | Tension rise from reeling alone |
| `fight.pullRise` | 13 /s | Tension rise per unit of (fish strength / rod strength) ^ pullExponent |
| `fight.pullExponent` | 1.6 | How sharply an outmatched rod gets punished |
| `fight.resistAfter` | 3.2 s | Reel a resting fish continuously this long (× fish freshness × sqrt(rod/strength)) and it fights back ("It resists!") |
| `fight.resistRise` | 1.8 | Tension rise multiplier reached as that tolerance runs out, so the player feels it coming |
| `fight.runDurationMult` | 1.7 | Scales every fish's `runDuration` (longer runs read better than twitches) |
| `fight.restMult` | 1.0 | Scales every fish's `runEvery` (rest length between runs) |
| `fight.releaseFall` | 42 /s | Tension drop when released |
| `fight.runRiseMult` | 1.7 | Reeling during a run multiplies the pull rise |
| `fight.slackBelow` | 8 | Tension under this counts as slack |
| `fight.slackSeconds` | 2.5 | Slack this long = fish escapes (only counted while the fish rests: never during a tell or a run) |
| `fight.reelSpeed` | 11 m/s | Base reel gain, scaled by sqrt(rod strength) |
| `fight.gainBase`, `fishHold`, `gainMin` | 1.2 / 0.5 / -0.6 | Reel gain fraction = clamp(gainBase - fishHold * strength/rod, gainMin, gainBase); negative = fish takes line while you reel |
| `fight.tightBelow`, `tightSpan` | 25 / 35 | Reel gain ramps from 0 at tension 25 to full at 60 (slack line moves no fish) |
| `fight.runSpeed` | 5.5 m/s | Line the fish takes per second during a run (35% of that if you keep reeling) |
| `fight.runDrain` | 1.0 | Stamina cost of running: (runDrain / fish.stamina) per second; ÷ steerShorten while steered against, so a run costs the same stamina either way |
| `fight.holdDrain` | 0.5 | Stamina cost on a tight line: (holdDrain * tension/cap / fish.stamina) per second |
| `fight.restBelow`, `restRegen` | 40 / 0.6 | Below this tension (released, not running) the fish regains (restRegen / fish.stamina) per second |
| `fight.tiredBelow` | 0.12 | Stamina under this: no more runs ("It is tiring"); a tell in progress is cancelled with a runEnd event so the view shows REEL! again |
| `fight.weakPull` | 0.4 | Pull of an exhausted fish as a fraction of fresh pull |
| `fight.firstRunDelay` | 0.35 s | Every fight opens with a run this soon after the hook (first decision is always "let it run") |
| `fight.tellSeconds` | 0.45 s | Default warning before a timed run (fish `fight.tell` overrides); the run's side is picked at the tell |
| `fight.lateSpike` | 18 | Tension added when a timed (telegraphed) run starts while the player is still reeling ("lateRelease"); resist runs add none |
| `fight.headShakeEvery.min/max` | 2.5 / 5 s | A resting, untired fish head-shakes this often (clock paused during tells, runs and the finale; restarts at every run end) |
| `fight.headShakeSlackBelow` | 20 | Tension under this at a head-shake = hook thrown |
| (steering benefit × rod/fish strength, clamped 0..1: `steerLeverage()` in fight.ts; a weak rod cannot turn a big fish) | | |
| `fight.steerShorten` | 0.45 | Steering against the run (steer = -side) makes it last this fraction as long |
| `fight.steerAgainstGain` | 0.6 | Line the fish takes while you steer against its run |
| `fight.steerWrongGain` | 1.6 | Line the fish takes while you steer with its run |
| `fight.steerWrongRise` | 1.5 | Tension rise multiplier while you steer with its run |
| `fight.wearAbove` | 0.8 | Tension above this fraction of the worn cap (effectiveCap) wears the line; no wear during the finale |
| `fight.wearPerSecond` | 0.06 | Cap lost per second in the red (effectiveCap = lineCap × (1 − lineWear)); lasts the whole fight |
| `fight.wearMax` | 0.4 | Most of the cap wear can take; because wear is measured against the worn cap it compounds and can reach this |
| `fight.finaleBelow` | 0.15 | Finale starts the first time line-out drops under this fraction of the hook-set line-out (fish not running) |
| `fight.finaleSeconds.min/max` | 1.5 / 3 s | Finale length before the fish is beaten, × (0.6 + 0.8 × fish `thrash`); landed when it ends while held, or at line-out 0 |
| `fight.finaleThrowAfter` | 0.6 s | Not holding this long in the finale = hook thrown (the gap decays at 2× while holding) |
| `fight.finaleRiseCap` | 0.78 | During the finale tension is clamped to this fraction of effectiveCap, so holding through it is safe |
| `fight.finaleGainMult` | 0.35 | Reel gain multiplier during the finale: the thrashing fish gives the last metres slowly, so thrash length and holding matter |
| `fight.runRampIn` / `runFadeOut` | 0.35 / 0.5 s | Runs accelerate in and ease out over these times |
| `fight.minRunDuration` | 0.6 s | Floor on run length (runs shorten as stamina drops) |
| `fight.lineCaps` | 100 / 130 / 170 / 220 | Tension cap per line tier |
| `school.count` | 5 | Visible fish in the water at once |
| `school.senseRadius` | 180 px | Distance at which a wandering fish notices a float |
| `school.wanderSpeed.min/max` | 9 / 24 px/s | Idle glide speed |
| `school.pause.min/max` | 0.6 / 2.2 s | Hover between glides |
| `school.turnRate` | 3.0 rad/s | How fast a fish turns (moves along its heading, so turns are arcs) |
| `school.scale.min/max` | 0.30 / 0.72 | Outline sprite scale for the smallest / largest species (×0.78 far to ×1.1 near) |
| `school.curiosity` | 0.6 | Chance an eligible fish picks its next glide target near a float in the water |
| `school.approachSpeed` | 42 px/s | Approach speed (chase = 1.2×, flee = 1.6×) |
| `school.circleRadius`, `circleSpeed` | 28 px / 1.5 rad/s | Circling the float before the bite |
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
Optional fight extras: `fight.tell` (seconds of warning, default `config.fight.tellSeconds`), `fight.sideBias` (-1..1,
default 0; a run goes deep with probability (1 + sideBias) / 2), `fight.thrash` (0..1, default 0.5; finale length).

| Fish | tell | sideBias | thrash | Why |
|---|---|---|---|---|
| Speckled Trout, Silver Darter, Whitewater Grayling | default | -0.6 | 0.8 | Jumpers: mostly surface runs, long thrash |
| Moss Carp, Lantern Catfish, Stonecrawler Bullhead | default | 0.7 | 0.3 | Divers: mostly deep runs, short thrash |
| The Ironjaw | 0.4 s | 0.4 | 1.0 | Boss: shorter tell, leans deep, longest thrash |
| Old Greyback | 0.4 s | 0 | 1.0 | Legend: shorter tell, unreadable side, longest thrash |
| everything else | default | 0 | 0.5 | |

Strength ladder: 0.6-1.4 dock/creek commons, 1.6-2.0 creek uncommon/rare, 2.4-2.8 pond/falls, 3.2-3.4 night lake,
5.0 Ironjaw (boss), 6.5 Old Greyback (legend). Rod strength 1-4 is on the same scale.

Bot landing matrix (20 seeds, `scratch/probe` style, tell/steer/finale model after the 2026-10-09 review fixes;
losses are snaps, the bot never throws the hook). 100% unless shown:

| Fish | rod 1 / line 1 | rod 2 / line 2 | rod 3 / line 3 | rod 4 / line 4 |
|---|---|---|---|---|
| Dock Perch | 14 s | 5 s | 5 s | 4 s |
| Speckled Trout | 26 s | 14 s | 13 s | 13 s |
| Moss Carp | 43 s | 16 s | 10 s | 7 s |
| Lantern Catfish | 82 s | 28 s | 15 s | 10 s |
| The Ironjaw | 0% | 79 s | 48 s | 15 s |
| Old Greyback | 0% | 65% in 159 s | 82 s | 31 s |

Steering pays (40 seeds, same policy, steer fixed against / centred / with the run): Moss Carp rod 1 lands 40/40 in
33 / 48 / 49 s, Ironjaw rod 2 40/40 in 66 / 88 / 90 s, Ironjaw rod 3 in 22 / 74 / 74 s, Old Greyback rod 4 in 18 / 87 / 95 s.
Rule tests: `src/sim/fight.test.ts` (tell before a timed run, late release, steering, head-shakes, wear, finale).

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
`fishtop_<id>` (top-down outline), `angler`, `wave`, `reed`, `leaf`, `predator_<id>`, `coin`, `lock`, `spark`, `ray`,
`bubble`, `drop`.

## Simulation constants (not gameplay; `src/sim/playthrough.test.ts`)

Bot time per action: cast 2.5 s, lost fish 1.5 s, failed hook 1.0 s, shop visit 10 s, travel 3 s, wait 2 s,
board 5 s, predator 2 s; hook success 90%, predator defence 85%. Bot fight policy (`src/sim/bot.ts`): reaction
0.3 s (human reaction plus touch latency); lets go on a tell or a run and steers against the run's side, except that
it misreads every second run and leaves the rod centred (`missSteerEvery` 2); holds through the finale; while the
fish rests it reels to 70% of the effective cap, releases to 45%, and never lets tension under headShakeSlackBelow + 8.
Retune 2026-10-09: release/resume 75% / 50% -> 70% / 45% (wear starts at 80%, a late release adds 18); reaction
0.25 -> 0.3 s; misread every second run added. A perfect bot (steers every run, 0.25-0.3 s) runs a 20-21 min median,
under the 22-min floor, because steering against a run leaves the fish ~27% of the line it used to take; with the
misreads the median is 26.9 min (25.0 at 0.35 s reaction, 26.9 at 0.25 s). The sweet-zone model ran 29.4 min.
