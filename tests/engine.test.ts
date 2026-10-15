import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { emptyDraft, catalogSchema, draftSchema, parseStatistics, roles, savedDraftSchema } from '../src/data.ts';
import type { Statistics } from '../src/data.ts';
import { recommend } from '../src/engine.ts';

const heroes = catalogSchema.parse([
  { id: 1, name: 'First', slug: 'first' }, { id: 2, name: 'Second', slug: 'second' },
  { id: 3, name: 'Enemy', slug: 'enemy' }, { id: 4, name: 'Ally', slug: 'ally' },
]);
const base: Statistics = { version: 1, patch: 'TEST', updatedAt: '2026-10-15T00:00:00Z', isDemo: true, source: 'Test fixtures',
  roleStats: [1, 2].map(heroId => ({ heroId, role: 'offlane', rank: 'all', wins: 550, matches: 1000 })), matchups: [] };

test('picked and banned heroes never appear in suggestions', () => {
  const draft = emptyDraft(); draft.allies[0] = 1; draft.bans = [2];
  assert.deepEqual(recommend(heroes, base, draft, 'offlane', 'all'), []);
});
test('adjusted enemy matchup statistics change the order', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const stats: Statistics = { ...base, matchups: [{ heroId: 2, otherHeroId: 3, kind: 'enemy', matches: 1500, advantage: 6 }] };
  const results = recommend(heroes, stats, draft, 'offlane', 'all');
  assert.equal(results[0]?.hero.id, 2);
  assert.ok(results[0]?.reasons.some(reason => reason.includes('Enemy')));
  assert.equal(results[0]?.coverage, '1/1 selected hero matchups covered');
});
test('small samples are shrunk towards neutral', () => {
  const stats: Statistics = { ...base, roleStats: [
    { heroId: 1, role: 'offlane', rank: 'all', wins: 1, matches: 1 },
    { heroId: 2, role: 'offlane', rank: 'all', wins: 550, matches: 1000 },
  ] };
  assert.equal(recommend(heroes, stats, emptyDraft(), 'offlane', 'all')[0]?.hero.id, 2);
});
test('role and rank are enforced, with explicit all-rank fallback only', () => {
  assert.deepEqual(recommend(heroes, base, emptyDraft(), 'carry', 'all'), []);
  assert.equal(recommend(heroes, base, emptyDraft(), 'offlane', 'archon')[0]?.rankFallback, true);
  const onlyDivine: Statistics = { ...base, roleStats: [{ heroId: 1, role: 'offlane', rank: 'divine', wins: 600, matches: 1000 }] };
  assert.deepEqual(recommend(heroes, onlyDivine, emptyDraft(), 'offlane', 'herald'), []);
});
test('rank-specific statistics take priority over all-rank statistics', () => {
  const stats: Statistics = { ...base, roleStats: [...base.roleStats, { heroId: 1, role: 'offlane', rank: 'archon', wins: 300, matches: 1000 }] };
  const results = recommend(heroes, stats, emptyDraft(), 'offlane', 'archon');
  assert.equal(results[0]?.hero.id, 2);
  assert.equal(results.find(result => result.hero.id === 1)?.rankFallback, false);
});
test('invalid, duplicate, and unknown-hero statistics are rejected', () => {
  assert.throws(() => parseStatistics({ ...base, roleStats: [{ ...base.roleStats[0], wins: 1001 }] }, heroes));
  assert.throws(() => parseStatistics({ ...base, roleStats: [...base.roleStats, base.roleStats[0]] }, heroes));
  assert.throws(() => parseStatistics({ ...base, matchups: [{ heroId: 999, otherHeroId: 1, kind: 'enemy', matches: 500, advantage: 2 }] }, heroes));
});
test('a hero cannot appear twice in a saved draft', () => {
  const draft = emptyDraft(); draft.allies[0] = 1; draft.enemies[1] = 1;
  assert.equal(draftSchema.safeParse(draft).success, false);
});
test('missing enemy matchups cannot become neutral counter recommendations', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  assert.deepEqual(recommend(heroes, base, draft, 'offlane', 'all'), []);
});

test('the evaluated position is excluded from teammate scoring', () => {
  const stats: Statistics = { ...base,
    roleStats: base.roleStats.map(row => ({ ...row, role: 'support' })),
    matchups: [{ heroId: 1, otherHeroId: 3, kind: 'ally', matches: 1000, advantage: 8 }],
  };
  const draft = emptyDraft(); draft.allies[3] = 3;
  const baseline = recommend(heroes, stats, emptyDraft(), 'support', 'all');
  const actual = recommend(heroes, stats, draft, 'support', 'all');
  assert.deepEqual(actual.map(row => row.score), baseline.map(row => row.score));
  assert.ok(actual.every(row => row.coverage === 'Add picks for matchup suggestions'));
});

test('published win rates work without fabricated win counts', () => {
  const stats = parseStatistics({ ...base, roleStats: [
    { heroId: 1, role: 'offlane', rank: 'all', matches: 1000, winRate: 0.55 },
  ] }, heroes);
  const result = recommend(heroes, stats, emptyDraft(), 'offlane', 'all')[0];
  assert.equal(result?.winRate, 0.55);
  assert.equal(result?.score, recommend(heroes, base, emptyDraft(), 'offlane', 'all')[0]?.score);
  assert.throws(() => parseStatistics({ ...base, roleStats: [{ heroId: 1, role: 'offlane', rank: 'all', matches: 1000, wins: 550, winRate: 0.55 }] }, heroes));
});


test('raw matchup rates aggregate opponent roles instead of adding their effects', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const pairs = [1, 2].flatMap(heroId => roles.map(otherRole => ({
    heroId, otherHeroId: 3, kind: 'enemy' as const, role: 'offlane' as const,
    otherRole, matches: 200, winRate: heroId === 1 ? 0.60 : 0.50,
  })));
  const results = recommend(heroes, { ...base, matchups: pairs }, draft, 'offlane', 'all');
  const combined = recommend(heroes, { ...base, matchups: [
    {heroId: 1, otherHeroId: 3, kind: 'enemy', role: 'offlane', matches: 1000, winRate: 0.60},
    {heroId: 2, otherHeroId: 3, kind: 'enemy', role: 'offlane', matches: 1000, winRate: 0.50},
  ] }, draft, 'offlane', 'all');
  assert.equal(results[0]?.hero.id, 1);
  assert.deepEqual(results.map(x => x.score), combined.map(x => x.score));
});

test('ally pair statistics respect both positions', () => {
  const draft = emptyDraft(); draft.allies[1] = 4;
  const stats: Statistics = {...base, matchups: [
    {heroId: 2, otherHeroId: 4, kind: 'ally', role: 'offlane', otherRole: 'mid', matches: 1000, winRate: 0.65},
    {heroId: 1, otherHeroId: 4, kind: 'ally', role: 'offlane', otherRole: 'support', matches: 10000, winRate: 0.95},
    {heroId: 1, otherHeroId: 4, kind: 'ally', role: 'carry', otherRole: 'mid', matches: 10000, winRate: 0.95},
  ]};
  assert.equal(recommend(heroes, stats, draft, 'offlane', 'all')[0]?.hero.id, 2);
});

test('saved drafts no longer require a player role or rank', () => {
  assert.equal(savedDraftSchema.safeParse({version: 3, draft: emptyDraft()}).success, true);
  const draft = emptyDraft(); draft.bans = [1, 1];
  assert.equal(savedDraftSchema.safeParse({version: 3, draft}).success, false);
});

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL('../public/data/heroes.json', import.meta.url), 'utf8')));
const published = parseStatistics(JSON.parse(readFileSync(new URL('../public/data/statistics.json', import.meta.url), 'utf8')), catalog);

test('repository data supplies five finite recommendations for every position', () => {
  for (const enemyIds of [[], [12], [1, 2, 14, 44, 131]]) {
    const draft = emptyDraft(); enemyIds.forEach((id, index) => { draft.enemies[index] = id; });
    for (const role of roles) {
      const results = recommend(catalog, published, draft, role, 'all');
      assert.equal(results.length, 5, role);
      assert.ok(results.every(x => Number.isFinite(x.score) && !enemyIds.includes(x.hero.id)));
    }
  }
});

test('Phantom Lancer changes the carry recommendations without manual counter rules', () => {
  const draft = emptyDraft();
  const baseline = recommend(catalog, published, draft, 'carry', 'all').map(x => x.hero.id);
  draft.enemies[0] = 12;
  const picks = recommend(catalog, published, draft, 'carry', 'all').map(x => x.hero.id);
  assert.notDeepEqual(picks, baseline);
  draft.bans = [picks[0]];
  assert.ok(recommend(catalog, published, draft, 'carry', 'all').every(x => x.hero.id !== picks[0]));
});
