# Statistics and recommendation method

The browser reads `public/data/statistics.json`. Updates are manual. There is no database or scheduled collection.

## Current sources

- Dota2ProTracker role meta: 266 hero/position records, collected 2026-10-15. The page covers eight days of 7000+ MMR public games and labels the meta 7.41f.
- Dotabuff counters: all 127 heroes, 16,002 directional enemy records, collected 2026-10-15 with `date=week` (“This Week”). Rank, position, ranked-only and patch-only restrictions are unverified.
- `data-sources/dotabuff-week-2026-10-15.json` preserves the exported public tables. It includes published disadvantage, win rate and match count. The import does not invent win counts.

The populations differ. Transferring a general matchup advantage into a high-MMR role model is a heuristic. The patch label refers to the role source. It does not establish the patch of every Dotabuff game.

## JSON fields

`version` is `1`. `patch`, `updatedAt`, `isDemo`, and `source` describe the snapshot. `scope`, `sourceUrls`, and `datasets` record source limits. Each dataset identifies its period, population and use: `role-prior` or `enemy-advantage`.

Role records contain `heroId`, `role`, `rank`, `matches`, and exactly one of `wins` or `winRate`. Rates are fractions from 0 to 1. Exact wins must come from the source. Hero/role/rank combinations must be unique.

Roles are `carry`, `mid`, `offlane`, `support`, and `hard-support`. The interface evaluates every role with `rank: "all"`. Here, `all` means unsegmented within the source population. It does not mean the sample represents every rank. The engine can also use a specific rank, with an explicit `all` fallback.

Pair records contain `heroId`, `otherHeroId`, `kind`, `matches`, optional `role` and `otherRole`, and either `advantage` or legacy `winRate`. `advantage` is in percentage points, between -25 and 25, from the candidate's perspective. Positive values favor the candidate. `disagreement` optionally records the difference between reciprocal source views, also in percentage points.

Legacy raw `winRate` pairs remain readable, but the engine ignores them. A role win rate cannot safely normalize a raw pair rate from another time window or population. Adjusted ally records are supported for future compatible data. The current snapshot contains no statistical ally synergy.

## Import Dotabuff

Save the public table export with `collectedAt`, `period: "week"`, and `pages`. Each page needs `name`, `period`, `url`, and `rows`. Each row needs the other hero's `name`, `path`, and three numeric strings in `values`: disadvantage, page-hero win rate percent, and matches.

Run:

```sh
node --experimental-strip-types scripts/import-dotabuff.ts data-sources/dotabuff-week-2026-10-15.json
```

The script validates the export and requires a complete matrix. The full Dotabuff table publishes the page hero's **disadvantage**. The importer reverses its sign. For reciprocal rows A→B and B→A:

```text
advantage(A,B) = (publishedAdvantage(A,B) - publishedAdvantage(B,A)) / 2
matches(A,B) = min(matches(A,B), matches(B,A))
disagreement(A,B) = abs(publishedAdvantage(A,B) + publishedAdvantage(B,A))
```

The reverse record gets the opposite advantage and the same sample count. These are two views of the same games. The importer never adds their counts. Differences can occur as source pages refresh. The engine discounts disagreeing estimates. The import preserves existing role records and replaces old pair records.

## Scoring

All quantities below are fractions, except published advantage and disagreement. A score is a ranking utility, not a win probability.

Candidates must have at least 500 applicable role matches. Picks and bans are excluded. Rank-specific role records take priority over `all` records.

```text
posterior = (roleWinRate * roleMatches + 500) / (roleMatches + 1000)
meta = posterior - 0.5
uncertainty = 0.5 * sqrt(posterior * (1 - posterior) / (roleMatches + 1000))

pairEffect = weightedMean(advantage / 100 / (1 + disagreement / 2))
             * pairMatches / (pairMatches + 1000)
```

The role prior adds 1,000 neutral pseudo-observations. It limits small-sample extremes. The uncertainty term is a conservative ranking penalty. It is not a confidence interval for a draft outcome.

Each pair needs at least 100 applicable matches. Candidate position filters apply first. A role-specific breakdown takes priority over a generic row. Enemy positions are unknown, so applicable disjoint position rows use sample weights. Known allied positions select matching rows. Generic rows and their breakdowns are never added together.

Every selected enemy needs adjusted data. Candidates with missing enemy coverage are omitted. Known enemy effects are summed and divided by the square root of the enemy count. This gives additional opponents diminishing influence. Half of the worst negative effect is added as a further penalty. A favorable pair cannot fully hide a severe counter.

For an incomplete enemy lineup, the engine examines remaining heroes. Picks, bans, and the candidate are unavailable. Source role match volume provides a rough popularity weight. The weighted worst 20% of available matchup effects estimates counter exposure:

```text
counterRisk = 0.75 * (5 - knownEnemyCount) / 5 * negativeTailMagnitude
```

This is a risk heuristic. It does not predict an opponent's response or a counter's position. It becomes zero when all five enemies are known. Banning an available counter removes that hero from the calculation.

Adjusted allied effects, when supplied, contribute `0.4 * mean(allyEffects)`. Missing allied data contributes zero. The evaluated allied slot is excluded from teammate scoring. Its current occupant remains unavailable as a recommendation.

With at least two other allies, the candidate receives `0.004` for each missing ability tag, up to two tags. Tags are `stun`, `frontline`, `tower-damage`, and `save`, maintained in `heroes.json`. This is a small composition heuristic, not a complete ability or lane simulation.

```text
score = 100 * (meta - uncertainty + enemy + worstEnemy
               + ally + composition - counterRisk)
```

Scores remain unrounded during sorting. Ties use role sample size, then hero ID. Up to five candidates are returned. The interface displays only portraits and names.

## Validation and limits

`pnpm test` checks counter direction, sample shrinkage, role filters, bans, counter exposure, full enemy lineups, team composition, matrix reciprocity, and 100 reproducible draft/ban combinations. These checks verify behavior. They do not measure win-rate improvement.

Match-level data and held-out evaluation are required to fit weights or compare draft outcomes. Aggregate tables cannot measure interactions between several heroes, lane execution, player skill, or causal pick value. Do not describe this model as trained, calibrated, or proven to win more games.

Before publication, run `pnpm test`, `pnpm run audit`, and `pnpm build`. Commit and push source changes, run `pnpm deploy`, and wait for GitHub Pages to finish.
