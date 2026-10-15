# Manual statistics updates

Change `public/data/statistics.json` in this repository. The browser reads this file when the app opens. There is no database or scheduled updater.

## File format

This is an illustrative example, not real match data:

```json
{
  "version": 1,
  "patch": "DEMO",
  "updatedAt": "2026-10-15T12:00:00Z",
  "isDemo": true,
  "source": "Illustrative data, not real match statistics",
  "roleStats": [
    { "heroId": 2, "role": "offlane", "rank": "all", "matches": 1000, "wins": 530 }
  ],
  "matchups": [
    { "heroId": 2, "otherHeroId": 93, "kind": "enemy", "matches": 600, "advantage": 2.5 }
  ]
}
```

## Metadata

- `version`: schema version; currently `1`.
- `patch`: the actual patch covered by these statistics.
- `updatedAt`: ISO 8601 timestamp with timezone, such as `2026-10-15T12:00:00Z`.
- `isDemo`: set to `false` only when every statistic is real and verified.
- `source`: the source name, URL, and any relevant filters.

Do not mix patches or incompatible sources in one file. If role and rank statistics are unavailable, omit those records.

## Role statistics

Each record requires a hero ID, role, rank, match count, and win count. Find hero IDs in `heroes.json`. For example, Axe is `2`.

Allowed roles: `carry`, `mid`, `offlane`, `support`, `hard-support`.

Allowed ranks: `all`, `herald`, `guardian`, `crusader`, `archon`, `legend`, `ancient`, `divine`, `immortal`.

Use `all` for genuinely unsegmented data. Do not relabel professional-match statistics as a specific ranked bracket. A hero, role, and rank combination must appear only once.

The player selects a specific rank before the draft starts. The engine uses that rank first. It falls back only to an `all` record and labels that fallback. It never substitutes another rank. Heroes without applicable role statistics cannot become recommendations, but remain available for draft entry.

Allied slots are positions 1–5 in order. The player's position determines their slot. The engine excludes that slot when calculating allied combinations and team needs. Current pair statistics apply across the other allied positions; role-specific lane combinations would require additional data.

## Hero pairs

- `heroId`: the hero being scored.
- `otherHeroId`: the selected allied or enemy hero.
- `kind`: `enemy` or `ally`.
- `matches`: the supporting sample size.
- `advantage`: adjusted advantage in percentage points, between `-25` and `25`.

For example, `2.5` means a positive adjusted advantage of 2.5 percentage points. It does **not** mean a 2.5% win rate or a 52.5% raw matchup win rate. These records are directional and currently apply across roles and ranks. The engine uses only explicitly supplied records.

Use adjusted statistics from a documented source or estimator. Raw matchup win rates include general hero strength and can double-count it. If adjusted data is unavailable, set `matchups` to `[]`. The app reports missing coverage instead of inventing results. Pair records must use the same patch as the role records.

## Scoring

The engine removes picks and bans, filters by role and rank coverage, and applies these terms:

```text
base = (wins / matches - 0.5) * matches / (matches + 500)
pair effect = (advantage / 100) * pair matches / (pair matches + 300)
fit = clamp(50 + 300 * (base + 0.65 * average enemy effect
                      + 0.40 * average allied effect + team needs), 1, 99)
```

Missing pair effects contribute zero. The averages use the complete selected enemy or ally count. This avoids amplifying one known matchup when other matchups are unknown.

Small samples move towards neutral. With at least two other allied picks, a missing team ability adds `0.006`, up to two abilities. Tags are manually maintained in `heroes.json`: `stun`, `frontline`, `tower-damage`, and `save`.

Weights are transparent initial heuristics. They have not been validated as a win prediction model. The fit score is not a win probability. This MVP does not infer lane assignments or model every five-hero interaction.

## Publish an update

1. Replace the statistics with data from the intended patch and source.
2. Change the metadata and set `isDemo` correctly.
3. Run `pnpm validate:data` and `pnpm test`.
4. Commit and push to `main`, then run `pnpm deploy`.
5. Wait for the Pages deployment, then reload the app.

The build rejects malformed records, unknown hero IDs, duplicate records, and wins exceeding matches. Failed checks stop publication and preserve the last deployment.
