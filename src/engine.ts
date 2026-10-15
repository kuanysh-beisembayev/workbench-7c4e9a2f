import type { Draft, Hero, Rank, Role, Statistics } from './data.ts';
import { roles } from './data.ts';

export type Recommendation = {
  hero: Hero;
  score: number;
  matches: number;
  winRate: number;
  rankFallback: boolean;
  reasons: string[];
  risk: string;
  coverage: string;
};

const round = (value: number) => Math.round(value * 10) / 10;

export function recommend(heroes: Hero[], stats: Statistics, draft: Draft, role: Role, rank: Rank): Recommendation[] {
  const unavailable = new Set([...draft.allies, ...draft.enemies, ...draft.bans]);
  const heroById = new Map(heroes.map(hero => [hero.id, hero]));
  const ownPosition = roles.indexOf(role);
  const allies = draft.allies.filter((id, index): id is number => id !== null && index !== ownPosition);
  const enemies = draft.enemies.filter((id): id is number => id !== null);
  // Score replacements without treating the current position as another teammate.
  const otherAllies = allies;
  const teamTags = new Set(otherAllies.flatMap(id => heroById.get(id)?.tags ?? []));
  const results: Recommendation[] = [];
  const pairIndex = new Map<number, Statistics['matchups']>();
  const selected = new Set([...allies, ...enemies]);
  for (const pair of stats.matchups) {
    if ((pair.role && pair.role !== role) || !selected.has(pair.otherHeroId)) continue;
    const pairs = pairIndex.get(pair.heroId) ?? [];
    pairs.push(pair); pairIndex.set(pair.heroId, pairs);
  }

  for (const hero of heroes) {
    if (unavailable.has(hero.id)) continue;
    const rows = stats.roleStats.filter(row => row.heroId === hero.id && row.role === role);
    const row = rows.find(item => item.rank === rank) ?? rows.find(item => item.rank === 'all');
    if (!row || row.matches < 500) continue;

    // Shrink small samples towards a neutral 50% baseline.
    const winRate = 'wins' in row ? row.wins / row.matches : row.winRate;
    const base = (winRate - 0.5) * row.matches / (row.matches + 500);
    const applicable = pairIndex.get(hero.id) ?? [];
    const effects: { kind: 'enemy' | 'ally'; otherHeroId: number; effect: number }[] = [];
    for (const kind of ['enemy', 'ally'] as const) {
      for (const otherHeroId of kind === 'enemy' ? enemies : allies) {
        const otherRole = kind === 'ally' ? roles[draft.allies.indexOf(otherHeroId)] : undefined;
        const pairs = applicable.filter(pair => pair.kind === kind && pair.otherHeroId === otherHeroId &&
          (!otherRole || !pair.otherRole || pair.otherRole === otherRole));
        const matches = pairs.reduce((sum, pair) => sum + pair.matches, 0);
        if (matches < 100) continue;
        const delta = pairs.reduce((sum, pair) => sum + pair.matches *
          ('advantage' in pair ? pair.advantage / 100 : pair.winRate - winRate), 0) / matches;
        effects.push({ kind, otherHeroId, effect: delta * matches / (matches + 300) });
      }
    }
    // Missing enemy data must not masquerade as a neutral matchup.
    if (effects.filter(pair => pair.kind === 'enemy').length !== enemies.length) continue;
    const enemyEffect = effects.filter(pair => pair.kind === 'enemy').reduce((sum, pair) => sum + pair.effect, 0) / Math.max(1, enemies.length);
    const allyEffect = effects.filter(pair => pair.kind === 'ally').reduce((sum, pair) => sum + pair.effect, 0) / Math.max(1, allies.length);
    const fills = otherAllies.length >= 2 ? hero.tags.filter(tag => !teamTags.has(tag)).slice(0, 2) : [];
    const needBonus = fills.length * 0.006;
    const score = round(Math.max(1, Math.min(99, 50 + 300 * (base + 0.65 * enemyEffect + 0.4 * allyEffect + needBonus))));
    const reasons = [`${round(winRate * 100)}% role win rate across ${row.matches.toLocaleString('en-US')} matches.`];
    const best = [...effects].sort((a, b) => b.effect - a.effect)[0];
    if (best && best.effect > 0) reasons.push(`Positive results ${best.kind === 'enemy' ? 'against' : 'with'} ${heroById.get(best.otherHeroId)?.name ?? 'a selected hero'}.`);
    const labels: Record<string, string> = { stun: 'stuns', frontline: 'a front-line hero', 'tower-damage': 'tower damage', save: 'a save ability' };
    if (fills.length) reasons.push(`Adds ${fills.map(tag => labels[tag]).join(' and ')} to your team.`);
    const worst = [...effects].sort((a, b) => a.effect - b.effect)[0];
    const requestedPairs = enemies.length + allies.length;
    const covered = effects.length;
    let risk = 'Draft statistics do not cover every possible team interaction.';
    if (worst && worst.effect < 0) risk = `Weaker results ${worst.kind === 'enemy' ? 'against' : 'with'} ${heroById.get(worst.otherHeroId)?.name ?? 'a selected hero'}.`;
    else if (row.matches < 500) risk = 'Small role sample. Treat this suggestion with caution.';
    else if (covered < requestedPairs) risk = 'Some selected hero matchups have no statistics.';
    results.push({ hero, score, matches: row.matches, winRate, rankFallback: rank !== 'all' && row.rank === 'all', reasons, risk,
      coverage: requestedPairs ? `${covered}/${requestedPairs} selected hero matchups covered` : 'Add picks for matchup suggestions',
    });
  }
  return results.sort((a, b) => b.score - a.score || b.matches - a.matches || a.hero.name.localeCompare(b.hero.name)).slice(0, 5);
}
