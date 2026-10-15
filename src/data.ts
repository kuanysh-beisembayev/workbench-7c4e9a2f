import { z } from 'zod';

export const roles = ['carry', 'mid', 'offlane', 'support', 'hard-support'] as const;
export const ranks = ['all', 'herald', 'guardian', 'crusader', 'archon', 'legend', 'ancient', 'divine', 'immortal'] as const;
export const tags = ['stun', 'frontline', 'tower-damage', 'save'] as const;
export type Role = typeof roles[number];
export type Rank = typeof ranks[number];
export type Tag = typeof tags[number];

export const heroSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(64),
  slug: z.string().regex(/^[a-z0-9_]+$/),
  aliases: z.array(z.string().max(64)).default([]),
  tags: z.array(z.enum(tags)).default([]),
});
export type Hero = z.infer<typeof heroSchema>;

export const catalogSchema = z.array(heroSchema).min(1).max(300).superRefine((heroes, ctx) => {
  if (new Set(heroes.map(h => h.id)).size !== heroes.length) {
    ctx.addIssue({ code: 'custom', message: 'Hero IDs must be unique.' });
  }
});

const roleStatsIdentity = {
  heroId: z.number().int().positive(),
  role: z.enum(roles),
  rank: z.enum(ranks),
  matches: z.number().int().min(1).max(100_000_000),
};
const roleStatsSchema = z.union([
  z.object({ ...roleStatsIdentity, wins: z.number().int().min(0) }).strict()
    .refine(s => s.wins <= s.matches, 'Wins cannot exceed matches.'),
  // Preserve a source's published win rate without fabricating exact win counts.
  z.object({ ...roleStatsIdentity, winRate: z.number().min(0).max(1) }).strict(),
]);

const pairIdentity = {
  heroId: z.number().int().positive(),
  otherHeroId: z.number().int().positive(),
  role: z.enum(roles).optional(),
  otherRole: z.enum(roles).optional(),
  kind: z.enum(['enemy', 'ally']),
  matches: z.number().int().min(1).max(100_000_000),
};
const pairSchema = z.union([
  z.object({ ...pairIdentity, advantage: z.number().min(-25).max(25) }).strict(),
  z.object({ ...pairIdentity, winRate: z.number().min(0).max(1) }).strict(),
]).refine(p => p.heroId !== p.otherHeroId, 'A hero cannot be its own matchup.');

export const statisticsSchema = z.object({
  version: z.literal(1),
  patch: z.string().min(1).max(40),
  updatedAt: z.iso.datetime(),
  isDemo: z.boolean(),
  source: z.string().min(1).max(200),
  scope: z.string().max(200).optional(),
  sourceUrls: z.array(z.url()).max(300).optional(),
  roleStats: z.array(roleStatsSchema).max(20_000),
  matchups: z.array(pairSchema).max(200_000),
}).superRefine((data, ctx) => {
  const keys = data.roleStats.map(s => `${s.heroId}:${s.role}:${s.rank}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Duplicate hero, role, and rank statistics.' });
  const pairs = data.matchups.map(p => `${p.heroId}:${p.role ?? "all"}:${p.otherHeroId}:${p.otherRole ?? "all"}:${p.kind}`);
  if (new Set(pairs).size !== pairs.length) ctx.addIssue({ code: 'custom', message: 'Duplicate matchup statistics.' });
});
export type Statistics = z.infer<typeof statisticsSchema>;

export function parseStatistics(input: unknown, heroes: Hero[]): Statistics {
  const result = statisticsSchema.parse(input);
  const ids = new Set(heroes.map(h => h.id));
  if (result.roleStats.some(s => !ids.has(s.heroId)) || result.matchups.some(p => !ids.has(p.heroId) || !ids.has(p.otherHeroId))) {
    throw new Error('Statistics contain an unknown hero ID. Update the hero catalog first.');
  }
  return result;
}

export const emptyDraft = () => ({ allies: Array<number | null>(5).fill(null), enemies: Array<number | null>(5).fill(null), bans: [] as number[] });
export type Draft = ReturnType<typeof emptyDraft>;
export const draftSchema = z.object({
  allies: z.array(z.number().int().positive().nullable()).length(5),
  enemies: z.array(z.number().int().positive().nullable()).length(5),
  bans: z.array(z.number().int().positive()).max(300),
}).refine(draft => {
  const used = [...draft.allies, ...draft.enemies, ...draft.bans].filter(id => id !== null);
  return new Set(used).size === used.length;
}, 'A hero can appear only once in a draft.');

export const savedDraftSchema = z.object({ version: z.literal(3), draft: draftSchema });

export const preferencesSchema = z.object({
  version: z.literal(2),
  started: z.boolean(),
  role: z.enum(roles),
  rank: z.enum(ranks),
  draft: draftSchema,
}).refine(preferences => !preferences.started || preferences.rank !== 'all', 'Select your rank before starting a draft.');

export async function loadData(): Promise<{ heroes: Hero[]; statistics: Statistics }> {
  const root = new URL(import.meta.env.BASE_URL, window.location.href);
  const responses = await Promise.all(['data/heroes.json', 'data/statistics.json'].map(path => fetch(new URL(path, root))));
  if (responses.some(response => !response.ok)) throw new Error('Could not load hero statistics. Try again.');
  const [catalog, stats]: unknown[] = await Promise.all(responses.map(response => response.json()));
  const heroes = catalogSchema.parse(catalog);
  return { heroes, statistics: parseStatistics(stats, heroes) };
}
