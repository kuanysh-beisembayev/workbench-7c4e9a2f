import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDraft, catalogSchema, draftSchema, parseStatistics } from '../src/data.ts';
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
test('missing matchups are disclosed and never invented', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const result = recommend(heroes, base, draft, 'offlane', 'all')[0];
  assert.equal(result?.coverage, '0/1 selected hero matchups covered');
  assert.ok(result?.risk.includes('no statistics'));
  assert.equal(result?.reasons.length, 1);
});

test('the user pick is excluded from ally scoring in the selected position', () => {
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
