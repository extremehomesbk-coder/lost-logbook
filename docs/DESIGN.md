# Lost Logbook (working title) — design brief

Working title is a placeholder and lives in `src/data/config.json` (`title`). Everything in this game is original:
no third-party names, characters, story, art, music or sound.

## Goal of this slice
Prove the core loop is fun on a phone before building a full RPG. A player should go from first cast to landing
the legendary fish in roughly 30-45 minutes.

## Premise (placeholder, in config)
A young angler finds an old logbook describing a legendary fish nobody has landed in 50 years. Catch it.

## Core loop
fish -> sell catch -> buy better gear/bait -> reach new spots and rarer fish -> collect the items needed for the
legendary fish -> land it.

## What the 1990s original actually does (researched 2026-10-09, drives v0.2)
From reviews and player FAQs of the Game Boy fishing adventure this is inspired by (no footage was watched):
- Fish are **visible** as outlines swimming near the float. One catches the scent, approaches, circles the float
  a few times (the float twitches and "rings"), then takes it: the float turns yellow and dips.
- Casting is **aimed** on the water with a held button for distance.
- A hooked fish cuts to an **underwater side view** where you see the fish. Rhythm: let it run until it stops,
  reel until it resists, let go; it tires each cycle. Reel constantly and the line snaps.
- **Lures** behave differently from bait: they sink and must be retrieved in pulses; fish chase the moving lure.
- Bait choice, hook size, rod and river section all decide which species can be caught.

v0.2 of this slice follows that: top-down bank with aimed hold-to-cast, five visible fish per spot (species from
the spot/time/bait pools, wrong-bait fish inspect and turn away), circle-then-bite, lure retrieval with chase
strikes, and an underwater cutaway for the fight. Hook size is not modelled (bait + rod + line do that job).

Fight loop as built (v0.5): tap on the take → STRIKE! (float yanked under, splash, zoom punch, short freeze) → cut
underwater where the fish is already on an opening run → LET IT RUN. The fish telegraphs each run by turning toward
the side it will go (+1 dives away, −1 jumps toward you); ease off on the tell, then LIFT against a dive or DIP
against a jump to shorten the run (steering with it feeds line and strains the rod). When it stops: REEL!, and the
crank slows as the fish resists; keep reeling and it fights back (EASE OFF!). Between runs it head-shakes: a slack
line throws the hook. Time in the red wears the line, so the breaking point creeps down for the rest of the fight.
Last 15%: the fish thrashes at the surface (HOLD ON!) and you must hold through it or it throws the hook. No sweet
zone is shown; the rod bend, crank speed and the fish are the feedback.

## 1. Fishing (the core, must feel great on touch)
- **Cast**: press and hold to build power, release to cast. Longer cast reaches deeper water and different fish.
- **Bite**: bobber twitches (fake nibbles) then dips. Tap within a short window to hook. Too early or too late = fish gone.
- **Fight**: a tension meter. Hold to reel (tension rises), release to let the fish run (tension falls). Line snaps if
  tension maxes out; fish escapes if line stays slack too long. Each fish has strength, stamina, and how often it runs.
- **Catch reveal**: short, punchy reveal with species, size and rarity. Rare and legendary catches get a bigger reveal.
  Used in short muted video clips, so it must read instantly without sound.

## 2. Fish (15-20 species, all in `src/data/fish.json`)
- Each species: rarity (common / uncommon / rare / legendary), spot(s), time of day (morning / day / dusk / night),
  preferred bait or lure, size range, sell value, fight profile.
- Some rare fish require a specific specialty bait or lure.
- The legendary fish requires three key items (a special lure assembled from three parts), each earned by catching a
  specific rare fish or finishing a quest.

## 3. World (one region, 4-5 spots, `src/data/spots.json`)
- Spots: dock, creek, lily pond, waterfall pool, night lake. Some are locked behind gear (rod strength, line strength)
  or quest progress.
- Simple top-down map screen; tap a spot to travel.
- Time of day advances per cast or per trip (not real time), so it can be tuned.

## 4. Gear and economy (`src/data/gear.json`)
- Sell fish for coins at a shop. Buy rods (strength tiers), lines (tension cap), baits and lures.
- Gear gates which fish you can realistically land.

## 5. Collection log
- Every species shown as a silhouette until caught. Records count caught and biggest size.

## 6. Encounters (no turn-based combat)
- Occasionally a predator (bird, otter, big pike) tries to steal a hooked fish mid-fight. The player gets a short
  quick-tap defense; fail and the fish is lost.
- The waterfall pool has one boss fish with a multi-phase fight.

## 7. Quests (tiny, `src/data/quests.json`)
- 3-5 quests from a notice board, e.g. "catch a perch over 30 cm", rewarding coins, specialty bait or a key item.

## Not in this slice
Full overworld exploration, dialogue trees, multiple regions, monetization, accounts, online features.

## Monetization ideas (documented only, NOT built)
- **Gear packs**: themed rod + line + lure bundles that skip early grind (never stronger than the top earned tier).
- **Cosmetic rods and bobbers**: visual only, no stat change; shown in the catch reveal so clips advertise them.
- **Extra regions**: paid regions, each with its own legendary, boss and notice board.
- **Logbook pages**: cosmetic journal skins, photo-mode frames for sharing catch cards.
- Nothing pay-to-win: all fish must be landable with earned gear.

## Build requirements
- Phaser 3 + TypeScript, Vite. Portrait iPhone layout, touch-first; mouse/keyboard for desktop testing.
- All content as data files: fish.json, spots.json, gear.json, quests.json, config.json. Every data file validated
  against a zod schema at load; a clear error screen if one is invalid.
- Fight physics/math in plain TypeScript modules (`src/sim/`), separate from rendering, with Vitest unit tests for
  tension, escape, snap and catch-chance logic.
- Saving: autosave to localStorage after every catch and purchase (try/catch). Settings screen with Export save
  (save code) and Import save (validated before applying). Save format is versioned for migration.
- Placeholder art: simple original shapes and colors; sprite keys named so real art can drop in.
- Lint and type-check clean, tests passing. No secrets, analytics or external network calls.
- Deployed to GitHub Pages.
- Docs: this file, `docs/TUNING.md` (every number that controls feel and where it lives), `CLAUDE.md` under 50 lines.
