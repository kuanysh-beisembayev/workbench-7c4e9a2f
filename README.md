# Draft assistant

A minimal React app for your ranked Dota 2 draft. Select your position and rank before starting. They stay fixed for that draft. Enter picks and bans, then inspect five suggested heroes.

Allied slots correspond to positions 1–5: carry, mid, offlane, support, and hard support. Your position is marked automatically. Enemy positions remain unknown. Suggestions show only hero portraits and names. Start a new draft to change your position or rank.

The app runs entirely in the browser. It has no database, account system, LLM calls, or automatic statistics updates.

## Statistics are repository files

- `public/data/heroes.json`: the complete hero catalog, search aliases, and team ability tags.
- `public/data/statistics.json`: manually maintained patch statistics.
- `public/data/statistics.schema.json`: generated JSON Schema for editor validation.

Edit `public/data/statistics.json`, validate it, commit and push to `main`, then run `pnpm deploy`. The deployment publishes the updated file. There is no data upload control in the interface.

The initial file is a manually transcribed [Dota2ProTracker](https://dota2protracker.com/meta) snapshot from 2026-10-15, patch 7.41f. It contains seven listed heroes per position from 7000+ MMR public matches. Published win rates are stored directly; exact win counts are not invented. The file lists the five source URLs.

**Initial data limits:** no rank-specific statistics and no adjusted enemy or allied matchup statistics are available in this snapshot. Rank therefore falls back to the unsegmented source cohort. Picks and bans exclude unavailable heroes; allied picks can also affect simple team-ability heuristics. Enemy counter scoring needs matchup records added to the JSON file. The app never displays fictional statistics or a numerical fit score.

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

The production page uses a restrictive Content Security Policy. GitHub Pages controls HTTP response headers; it does not expose custom header configuration. There are no private endpoints, credentials, cookies, or external API calls. Browser storage contains only your role, rank, and active draft. An obscure repository name does not restrict access to a public repository or Pages site.
