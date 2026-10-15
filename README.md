# Draft assistant

A minimal React app for Dota 2 drafts. Enter allied picks, enemy picks, and bans. The app shows five recommendations for each position, with hero portraits and names. There is no rank or player-role setup.

Allied slots correspond to positions 1–5: carry, mid, offlane, support, and hard support. Every slot is editable. Enemy positions remain unknown. On phones, position tabs show one recommendation list at a time. Hero search opens as a bottom sheet. Draft changes recalculate all five lists. The active draft is saved in browser storage.

The app runs entirely in the browser. It has no database, account system, LLM calls, or automatic statistics updates.

## Project documentation

Start with [the project handoff](docs/README.md) for the current scope and accepted product decisions.

- [Architecture](docs/architecture.md): source map, data flow, draft storage, and engine contract.
- [Development and deployment](docs/development.md): local setup, checks, data updates, and troubleshooting.
- [Recommendation data and formula](docs/data.md): source formats, scoring, and model limits.
- [Current status and roadmap](docs/roadmap.md): known gaps, evaluation plan, and deferred features.

The handoff, architecture, development guide, and roadmap are in Russian.

## Statistics are repository files

- `public/data/heroes.json`: the complete hero catalog, search aliases, and team ability tags.
- `public/data/statistics.json`: manually maintained patch statistics.
- `public/data/statistics.schema.json`: generated JSON Schema for editor validation.

Edit `public/data/statistics.json`, validate it, commit and push to `main`, then run `pnpm deploy`. The deployment publishes the updated file. There is no data upload control in the interface.

The snapshot combines 266 role records from [Dota2ProTracker](https://dota2protracker.com/meta) with 16,002 directional enemy records from [Dotabuff](https://www.dotabuff.com/heroes/doom/counters?date=week). Data was collected on 2026-10-15. Dotabuff's adjusted advantage replaces the previous raw matchup rates. Both views of each pair are reconciled without adding duplicate games. The saved source export is in `data-sources/`.

Role meta covers eight days of 7000+ MMR public matches, labelled patch 7.41f. Dotabuff uses its “This Week” filter. Its rank, role, ranked-only and patch-only coverage are unverified. These populations differ. The JSON records these limits. The patch label describes the role source, not a verified restriction on the enemy data.

The engine combines role strength, sample uncertainty, known enemy matchups, a penalty for severe counters, and missing team abilities. Before the enemy lineup is complete, it also penalizes exposure to available counter picks. Bans remove those future counters. Raw allied win rates with unknown source compatibility are no longer used. Allied positions and ability tags still affect composition.

Candidates require at least 500 role matches and adjusted data against every selected enemy. The engine returns up to five candidates per position. Its weights are explicit heuristics. Aggregate tables cannot validate a predicted draft win rate. There is no calibrated win probability or numerical fit score in the interface.

Hero names and identifiers come from [OpenDota constants](https://github.com/odota/dotaconstants). Hero portraits from Valve's Steam CDN are stored in `public/images/heroes` and served with the app. The build checks every hero's portrait file and dimensions. Dota 2 assets belong to Valve Corporation.

See [the data guide](docs/data.md) for the exact format and scoring method.

## Local development

Use Node.js 24 LTS and pnpm 11.25.0. Dependency downloads must use the Socket registry in `.npmrc`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Checks

```sh
pnpm test
pnpm run audit
pnpm build
pnpm preview
```

The audit checks every locked package against the OSV vulnerability database. Package installation still uses Socket. Socket currently returns HTTP 405 from its npm audit endpoint.

## GitHub Pages

Source lives on `main`. Compiled files live on `gh-pages`. Repository Pages settings use the root of the `gh-pages` branch. GitHub builds and deploys that branch.

Run `pnpm deploy` after committing and pushing a source change. It runs tests, checks advisory data, validates the statistics, builds the app, and publishes compiled files to `gh-pages`. It requires Git and an authenticated GitHub CLI. It does not require permission to upload GitHub Actions workflows.

Vite uses relative asset paths, so the app works at a repository Pages URL or a custom domain. The browser loads JSON from the same deployment.

The production page uses a restrictive Content Security Policy. GitHub Pages controls HTTP response headers; it does not expose custom header configuration. There are no private endpoints, credentials, cookies, or external API calls. Browser storage contains the active draft. Legacy role and rank settings are discarded during migration. An obscure repository name does not restrict access to a public repository or Pages site.
