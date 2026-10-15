import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { catalogSchema, parseStatistics } from '../src/data.ts';

// Import a saved public-page export. This script makes no network requests.
const numberText = z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number);
const snapshot = z.object({
  collectedAt: z.iso.datetime(), period: z.literal('week'),
  pages: z.array(z.object({
    name: z.string(), period: z.literal('week'), url: z.url(),
    rows: z.array(z.object({ name: z.string(), path: z.string(),
      values: z.tuple([numberText, numberText, numberText]),
    })),
  })),
}).parse(JSON.parse(readFileSync(process.argv[2] ?? 'data-sources/dotabuff-week-2026-10-15.json', 'utf8')));
const heroes = catalogSchema.parse(JSON.parse(readFileSync('public/data/heroes.json', 'utf8')));
const previous = parseStatistics(JSON.parse(readFileSync('public/data/statistics.json', 'utf8')), heroes);
const names = new Map(heroes.map(hero => [hero.name, hero.id]));
names.set('Outworld Destroyer', 76); names.set('Ringmaster', 131);
const idFor = (name: string) => {
  const id = names.get(name);
  if (!id) throw new Error(`Unknown hero: ${name}`);
  return id;
};
const raw = new Map<string, { advantage: number; matches: number }>();
const pageIds = new Set<number>();
for (const page of snapshot.pages) {
  const heroId = idFor(page.name);
  const url = new URL(page.url);
  if (url.origin !== 'https://www.dotabuff.com' || url.searchParams.get('date') !== 'week' ||
    !/^\/heroes\/[a-z-]+\/counters$/.test(url.pathname)) throw new Error('Unexpected source URL.');
  if (pageIds.has(heroId) || page.rows.length !== heroes.length - 1) throw new Error('Incomplete or duplicate page.');
  pageIds.add(heroId);
  for (const row of page.rows) {
    const otherHeroId = idFor(row.name);
    const key = `${heroId}:${otherHeroId}`;
    const [disadvantage, winRate, matches] = row.values;
    if (heroId === otherHeroId || raw.has(key) || Math.abs(disadvantage) > 25 ||
      winRate < 0 || winRate > 100 || !Number.isInteger(matches) || matches < 1) throw new Error(`Invalid pair: ${key}`);
    // The full counters table shows the PAGE hero's disadvantage, not advantage.
    raw.set(key, { advantage: -disadvantage, matches });
  }
}
if (pageIds.size !== heroes.length) throw new Error('Missing hero pages.');
const matchups = [...raw.entries()].map(([key, row]) => {
  const [heroId, otherHeroId] = key.split(':').map(Number) as [number, number];
  const reverse = raw.get(`${otherHeroId}:${heroId}`);
  if (!reverse) throw new Error(`Missing reverse pair: ${key}`);
  // These are two views of the same games. Do not add their sample counts.
  return { heroId, otherHeroId, kind: 'enemy' as const,
    matches: Math.min(row.matches, reverse.matches),
    advantage: Number(((row.advantage - reverse.advantage) / 2).toFixed(6)),
    disagreement: Number(Math.abs(row.advantage + reverse.advantage).toFixed(6)),
  };
}).sort((a, b) => a.heroId - b.heroId || a.otherHeroId - b.otherHeroId);
const result = parseStatistics({
  ...previous, updatedAt: snapshot.collectedAt,
  source: 'Dota2ProTracker role meta + Dotabuff adjusted enemy advantage; manual snapshots',
  scope: 'Role meta: 7000+ MMR, last 8 days, 7.41f. Enemy pairs: Dotabuff This Week, unsegmented public data; rank, role and patch-only coverage unverified. No statistical ally synergy.',
  sourceUrls: ['https://dota2protracker.com/meta', ...snapshot.pages.map(page => page.url)],
  datasets: [
    { source: 'Dota2ProTracker', period: 'Last 8 days; snapshot 2026-10-15', population: '7000+ MMR public matches; role meta labelled 7.41f', use: 'role-prior' },
    { source: 'Dotabuff', period: `This Week; snapshot ${snapshot.collectedAt}`, population: 'Public counters table; no verified rank, role, ranked-only or patch-only segmentation', use: 'enemy-advantage' },
  ], matchups,
}, heroes);
const { roleStats, matchups: importedPairs, ...metadata } = result;
const records = (rows: unknown[]) => rows.map(row => `    ${JSON.stringify(row)}`).join(',\n');
writeFileSync('public/data/statistics.json', JSON.stringify(metadata, null, 2).slice(0, -2) +
  `,\n  "roleStats": [\n${records(roleStats)}\n  ],\n  "matchups": [\n${records(importedPairs)}\n  ]\n}\n`);
console.log(`Imported ${matchups.length} directional pairs for ${pageIds.size} heroes.`);
