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
- `scope` (optional): the source population and coverage limits.
- `sourceUrls` (optional): the original public data pages.

Use compatible source filters where available. Document every unknown time window or cohort difference in `scope`. Omit unavailable records.

## Role statistics

Each record requires a hero ID, role, rank, match count, and either `wins` or `winRate`. Find hero IDs in `heroes.json`. For example, Axe is `2`.

Use `wins` when exact counts are available. If a source publishes only a win rate, use `winRate` as a fraction between 0 and 1. For example, 52.7% becomes `0.527`. Do not supply both fields or manufacture exact wins from a rounded percentage.

Allowed roles: `carry`, `mid`, `offlane`, `support`, `hard-support`.

Allowed ranks: `all`, `herald`, `guardian`, `crusader`, `archon`, `legend`, `ancient`, `divine`, `immortal`.

Use `all` when the source has no rank breakdown. This means unsegmented within the documented source population, not necessarily every Dota 2 rank. Do not relabel professional-match statistics as a specific ranked bracket. A hero, role, and rank combination must appear only once.

The interface evaluates all five positions using `rank: "all"`. Rank-specific rows remain supported by the engine for future use. Heroes without applicable role statistics remain searchable but cannot become recommendations.

Allied slots correspond to positions 1–5. When scoring a position, the engine excludes its current occupant from teammate effects. That occupant remains unavailable as a candidate. Other allied positions determine which synergy rows apply.

## Hero pairs

- `heroId`: the hero being scored.
- `otherHeroId`: the selected allied or enemy hero.
- `kind`: `enemy` or `ally`.
- `matches`: the supporting sample size.
- `role` (optional): the candidate position.
- `otherRole` (optional): the other hero's position.
- Exactly one of `advantage` or `winRate`.

`advantage` is an adjusted advantage in percentage points, between `-25` and `25`. `winRate` is the published raw rate, from `0` to `1`. Do not convert a rounded rate to invented exact win counts. Records are directional. A candidate, candidate role, other hero, other role, and kind combination must be unique.

The current snapshot uses raw rates from Dota2ProTracker. Enemy positions are unknown, so the engine averages their role rows by match count. Allied positions are known, so it uses only matching or unspecified `otherRole` rows. Candidate role rows must match the evaluated position.

## Scoring

The engine removes picks and bans and requires at least 500 role matches per candidate. It shrinks role rates towards 50%:

```text
base = (role win rate - 0.5) * role matches / (role matches + 500)
raw pair delta = pair win rate - role win rate
adjusted pair delta = advantage / 100
pair effect = weighted average delta * pair matches / (pair matches + 300)
score = clamp(50 + 300 * (base + 0.65 * average enemy effect
                        + 0.40 * average allied effect + team needs), 1, 99)
```

Pair rows below 30 matches are omitted from the snapshot. A selected hero needs at least 100 combined applicable pair matches. A candidate with missing enemy coverage is excluded. Missing allied coverage contributes zero. Empty enemy lists use zero enemy effect.

With at least two other allies, each missing team ability adds `0.006`, up to two abilities. Tags are maintained in `heroes.json`: `stun`, `frontline`, `tower-damage`, and `save`.

Return up to five heroes per role, ordered by score, match count, and name. Empty drafts show role meta rather than a first-pick safety estimate. Incomplete evidence can produce fewer than five suggestions. The interface displays portraits and names only.

These weights are initial heuristics. Raw rates remain affected by player selection and team composition. They are not causal counter measurements or calibrated win probabilities. The source cohort is 7000+ MMR. Role tables cover eight days under patch 7.41f; matchup windows are unspecified. Their compatibility has not been independently verified.

## Publish an update

1. Replace the statistics with data from the intended patch and source.
2. Change the metadata and set `isDemo` correctly.
3. Run `pnpm validate:data` and `pnpm test`.
4. Commit and push to `main`, then run `pnpm deploy`.
5. Wait for the Pages deployment, then reload the app.

The build rejects malformed records, unknown hero IDs, duplicate records, and wins exceeding matches. Failed checks stop publication and preserve the last deployment.
