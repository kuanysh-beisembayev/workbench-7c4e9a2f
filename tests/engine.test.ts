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


test('adjusted matchups aggregate opponent roles instead of adding their effects', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const pairs = [1, 2].flatMap(heroId => roles.map(otherRole => ({
    heroId, otherHeroId: 3, kind: 'enemy' as const, role: 'offlane' as const,
    otherRole, matches: 200, advantage: heroId === 1 ? 5 : -5,
  })));
  const results = recommend(heroes, { ...base, matchups: pairs }, draft, 'offlane', 'all');
  const combined = recommend(heroes, { ...base, matchups: [
    {heroId: 1, otherHeroId: 3, kind: 'enemy', role: 'offlane', matches: 1000, advantage: 5},
    {heroId: 2, otherHeroId: 3, kind: 'enemy', role: 'offlane', matches: 1000, advantage: -5},
  ] }, draft, 'offlane', 'all');
  assert.equal(results[0]?.hero.id, 1);
  assert.deepEqual(results.map(x => x.score), combined.map(x => x.score));
});

test('ally pair statistics respect both positions', () => {
  const draft = emptyDraft(); draft.allies[1] = 4;
  const stats: Statistics = {...base, matchups: [
    {heroId: 2, otherHeroId: 4, kind: 'ally', role: 'offlane', otherRole: 'mid', matches: 1000, advantage: 8},
    {heroId: 1, otherHeroId: 4, kind: 'ally', role: 'offlane', otherRole: 'support', matches: 10000, advantage: 20},
    {heroId: 1, otherHeroId: 4, kind: 'ally', role: 'carry', otherRole: 'mid', matches: 10000, advantage: 20},
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

test('raw pair win rates cannot create artificial counters or synergy', () => {
  const draft = emptyDraft(); draft.allies[1] = 4;
  const stats: Statistics = { ...base, matchups: [
    { heroId: 1, otherHeroId: 4, kind: 'ally', matches: 10000, winRate: 0.99 },
  ] };
  assert.deepEqual(recommend(heroes, stats, draft, 'offlane', 'all').map(x => x.score),
    recommend(heroes, base, draft, 'offlane', 'all').map(x => x.score));
  draft.enemies[0] = 3;
  assert.equal(recommend(heroes, { ...base, matchups: [
    { heroId: 1, otherHeroId: 3, kind: 'enemy', matches: 10000, winRate: 0.99 },
  ] }, draft, 'offlane', 'all').length, 0);
});

test('an available counter reduces opening utility and its ban removes that risk', () => {
  const stats: Statistics = { ...base,
    roleStats: [...base.roleStats, { heroId: 3, role: 'mid', rank: 'all', matches: 10000, winRate: 0.5 }],
    matchups: [1, 2].map(heroId => ({ heroId, otherHeroId: 3, kind: 'enemy', matches: 10000, advantage: heroId === 1 ? -8 : 0 })),
  };
  const opening = recommend(heroes, stats, emptyDraft(), 'offlane', 'all');
  assert.equal(opening[0]?.hero.id, 2);
  assert.ok(opening.find(x => x.hero.id === 1)!.components.counterRisk > 0);
  const draft = emptyDraft(); draft.bans = [3];
  const banned = recommend(heroes, stats, draft, 'offlane', 'all');
  assert.equal(banned.find(x => x.hero.id === 1)!.components.counterRisk, 0);
  assert.ok(banned.find(x => x.hero.id === 1)!.score > opening.find(x => x.hero.id === 1)!.score);
});

test('the full enemy lineup removes future counter risk and slot order has no effect', () => {
  const draft = emptyDraft(); draft.enemies = [1, 2, 14, 44, 131];
  const first = recommend(catalog, published, draft, 'carry', 'all');
  assert.ok(first.every(x => x.components.counterRisk === 0));
  draft.enemies.reverse();
  assert.deepEqual(recommend(catalog, published, draft, 'carry', 'all'), first);
});

test('a severe bad matchup receives an additional penalty', () => {
  const stats: Statistics = { ...base, matchups: [
    { heroId: 1, otherHeroId: 3, kind: 'enemy', matches: 10000, advantage: -8 },
    { heroId: 2, otherHeroId: 3, kind: 'enemy', matches: 10000, advantage: 0 },
  ] };
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const results = recommend(heroes, stats, draft, 'offlane', 'all');
  assert.equal(results[0]?.hero.id, 2);
  assert.ok(results.find(x => x.hero.id === 1)!.components.worstEnemy < 0);
});

test('a small pair sample has less effect than a large sample', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const component = (matches: number) => recommend(heroes, { ...base, matchups: [
    { heroId: 1, otherHeroId: 3, kind: 'enemy', matches, advantage: 8 },
  ] }, draft, 'offlane', 'all')[0]!.components.enemy;
  assert.ok(component(100) < component(10000));
});

test('disagreeing source views reduce the matchup effect', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const component = (disagreement: number) => recommend(heroes, { ...base, matchups: [
    { heroId: 1, otherHeroId: 3, kind: 'enemy', matches: 10000, advantage: 8, disagreement },
  ] }, draft, 'offlane', 'all')[0]!.components.enemy;
  assert.ok(component(2) < component(0));
});

test('generic pair rows do not double count a position-specific breakdown', () => {
  const draft = emptyDraft(); draft.enemies[0] = 3;
  const specific: Statistics = { ...base, matchups: [
    { heroId: 1, otherHeroId: 3, kind: 'enemy', role: 'offlane', matches: 1000, advantage: 4 },
  ] };
  const overlapping: Statistics = { ...specific, matchups: [...specific.matchups,
    { heroId: 1, otherHeroId: 3, kind: 'enemy', matches: 100000, advantage: -8 },
  ] };
  assert.deepEqual(recommend(heroes, overlapping, draft, 'offlane', 'all'), recommend(heroes, specific, draft, 'offlane', 'all'));
});

test('team ability gaps affect the evaluated position without counting its occupant', () => {
  const tagged = catalogSchema.parse([
    { ...heroes[0], tags: ['stun'] }, heroes[1], heroes[2], heroes[3],
  ]);
  const draft = emptyDraft(); draft.allies[0] = 3; draft.allies[1] = 4;
  const results = recommend(tagged, base, draft, 'offlane', 'all');
  assert.equal(results[0]?.hero.id, 1);
  assert.ok(results[0]!.components.composition > 0);
});

test('the published enemy matrix is complete, reciprocal and adjusted', () => {
  assert.equal(published.matchups.length, catalog.length * (catalog.length - 1));
  const index = new Map(published.matchups.map(row => [`${row.heroId}:${row.otherHeroId}`, row]));
  for (const row of published.matchups) {
    const reverse = index.get(`${row.otherHeroId}:${row.heroId}`)!;
    assert.equal(row.kind, 'enemy');
    assert.ok('advantage' in row && 'advantage' in reverse);
    assert.ok(Math.abs(row.advantage + reverse.advantage) < 1e-8);
    assert.equal(row.matches, reverse.matches);
  }
  const doomAgainstAM = index.get('69:1')!;
  assert.ok('advantage' in doomAgainstAM && doomAgainstAM.advantage > 0);
});

test('five valid recommendations survive varied draft and ban combinations', () => {
  // Fixed generator: reproducible coverage checks, not a win-rate backtest.
  let seed = 741;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let trial = 0; trial < 100; trial++) {
    const shuffled = [...catalog].sort((a, b) => a.id - b.id);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const draft = emptyDraft();
    const enemyCount = trial % 6; const allyCount = Math.floor(trial / 6) % 5;
    shuffled.slice(0, enemyCount).forEach((hero, i) => { draft.enemies[i] = hero.id; });
    shuffled.slice(5, 5 + allyCount).forEach((hero, i) => { draft.allies[i] = hero.id; });
    draft.bans = shuffled.slice(10, 26).map(hero => hero.id);
    const used = new Set([...draft.enemies, ...draft.allies, ...draft.bans]);
    for (const role of roles) {
      const picks = recommend(catalog, published, draft, role, 'all');
      assert.equal(picks.length, 5, `${trial}: ${role}`);
      assert.equal(new Set(picks.map(x => x.hero.id)).size, 5);
      assert.ok(picks.every(x => !used.has(x.hero.id) && Number.isFinite(x.score)));
    }
  }
});
