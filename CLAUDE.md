# Lost Logbook (working title)

Mobile-web fishing RPG vertical slice. Own repo (`extremehomesbk-coder/lost-logbook`), deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main`. Not an EHM or Halsey project: no EHM data, skills or doc
routing apply here.

## Hard rules
- Everything original: no third-party game names, characters, story, art, music or sound. Placeholder art is
  generated in `src/game/textures.ts` under stable keys so real sprites can drop in.
- No secrets, analytics or network calls. The only persistence is `localStorage` via `src/sim/save.ts` (try/catch,
  versioned, export/import codes).
- Every tuning number lives in `src/data/*.json` and is listed in `docs/TUNING.md`. Do not hard-code tuning in
  scenes or sim code. Schemas in `src/data/schema.ts` must be updated with any new field.
- Fight/bite/economy/state logic stays in `src/sim/` (pure TypeScript, no Phaser) and keeps its Vitest coverage.

## Stack
Phaser 3 + TypeScript + Vite. zod for data validation. ESLint flat config. Vitest.

## Layout
```
src/data/        fish.json spots.json gear.json quests.json config.json, schema.ts (zod), load.ts (+cross-checks)
src/sim/         fight.ts bite.ts economy.ts predator.ts state.ts save.ts rng.ts bot.ts, *.test.ts,
                 playthrough.test.ts (full-run bot simulation with modeled time)
src/game/        session.ts (data + player + autosave), ui.ts (layout, palette, Button, ScrollList, HUD), textures.ts
src/scenes/      Boot, Error, Title, Map, Fishing, Shop, Log, Board, Settings
docs/            DESIGN.md (brief + monetization ideas, not built), TUNING.md (every number)
```

## Commands
```
npm run dev        # Vite dev server (port picked by Vite; the desktop preview uses 5181)
npm run check      # lint + typecheck + tests + build, run before every commit
npm run sim        # playthrough simulation, report in scratch/playthrough.txt
```

## Conventions
- Keep this file under 50 lines. Keep the sim deterministic (seeded `Rng`) so tests stay stable.
- Design resolution 390x844 portrait, Phaser FIT, tap targets >= 40px, mouse + SPACE work on desktop.
- Reveal cards must read with no sound: big rarity word, big size, colour-coded frame.
