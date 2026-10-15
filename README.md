# Draft assistant

A minimal React app for Dota 2 drafts. Enter allied picks, enemy picks, and bans. The app shows five recommendations for each position, with hero portraits and names. There is no rank or player-role setup.

Allied slots correspond to positions 1–5: carry, mid, offlane, support, and hard support. Every slot is editable. Enemy positions remain unknown. On phones, position tabs show one recommendation list at a time. Hero search opens as a bottom sheet. Draft changes recalculate all five lists. The active draft is saved in browser storage.

The app runs entirely in the browser. It has no database, account system, LLM calls, or automatic statistics updates.

## Statistics are repository files

- `public/data/heroes.json`: the complete hero catalog, search aliases, and team ability tags.
- `public/data/statistics.json`: manually maintained patch statistics.
- `public/data/statistics.schema.json`: generated JSON Schema for editor validation.

Edit `public/data/statistics.json`, validate it, commit and push to `main`, then run `pnpm deploy`. The deployment publishes the updated file. There is no data upload control in the interface.

The file contains a manually collected [Dota2ProTracker](https://dota2protracker.com/meta) snapshot from 2026-10-15, with 266 role records and 49,210 directional matchup and synergy records. Role tables cover the last eight days of 7000+ MMR public matches under patch 7.41f. The matchup tables do not disclose a confirmed patch-only time window. Source URLs and these limits are stored in the JSON. Published rates are stored directly; exact win counts are not invented.

The sample does not represent every rank. Matchup coverage is incomplete. Candidates need at least 500 role matches and sufficient data against every selected enemy. A role can show fewer than five heroes when evidence is insufficient. Empty drafts show role meta, which does not measure first-pick safety. The engine uses statistical heuristics; it does not predict a calibrated win probability. The interface has no numerical fit scores.

Hero names and identifiers come from [OpenDota constants](https://github.com/odota/dotaconstants). Hero portraits load from Valve's Steam CDN. Dota 2 assets belong to Valve Corporation.

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
