import type { Draft, Hero, Rank, Role, Statistics } from './data.ts';
import { roles } from './data.ts';

export type Recommendation = {
  hero: Hero;
  /** Ranking utility only. This is not a predicted win probability. */
  score: number;
  matches: number;
  winRate: number;
  rankFallback: boolean;
  reasons: string[];
  risk: string;
  coverage: string;
  components: { meta: number; uncertainty: number; enemy: number; worstEnemy: number;
    ally: number; composition: number; counterRisk: number };
};

type Pair = Statistics['matchups'][number];
const indexes = new WeakMap<Statistics, Map<number, Pair[]>>();
function pairIndex(stats: Statistics) {
  let index = indexes.get(stats);
  if (!index) {
    index = new Map();
    for (const pair of stats.matchups) {
      // Raw pair rates from a different cohort cannot be adjusted using role meta.
      if (!('advantage' in pair)) continue;
      const rows = index.get(pair.heroId) ?? [];
      rows.push(pair); index.set(pair.heroId, rows);
    }
    indexes.set(stats, index);
  }
  return index;
}

function pairEffect(pairs: Pair[], otherId: number, kind: 'enemy' | 'ally', otherRole?: Role) {
  let rows = pairs.filter(pair => pair.otherHeroId === otherId && pair.kind === kind &&
    (!otherRole || !pair.otherRole || pair.otherRole === otherRole));
  // A generic row and its role breakdown can describe the same games.
  // Prefer the role-specific candidate rows, then the known teammate position.
  if (rows.some(row => row.role)) rows = rows.filter(row => row.role);
  if (otherRole && rows.some(row => row.otherRole === otherRole)) rows = rows.filter(row => row.otherRole === otherRole);
  else if (rows.some(row => !row.otherRole)) rows = rows.filter(row => !row.otherRole);
  const matches = rows.reduce((sum, row) => sum + row.matches, 0);
  if (matches < 100) return undefined;
  const weighted = rows.reduce((sum, row) => sum + ('advantage' in row ? row.advantage / 100 : 0) * row.matches /
    (1 + (row.disagreement ?? 0) / 2), 0) / matches;
  return weighted * matches / (matches + 1000);
}

/** Weighted mean of the worst 20% of available counter-pick mass. */
function counterTail(values: { effect: number; weight: number }[]) {
  let remaining = values.reduce((sum, value) => sum + value.weight, 0) * 0.2;
  const mass = remaining;
  let loss = 0;
  for (const value of values.sort((a, b) => a.effect - b.effect)) {
    const weight = Math.min(value.weight, remaining);
    loss += weight * Math.min(0, value.effect);
    remaining -= weight;
    if (remaining <= 0) break;
  }
  return mass ? -loss / mass : 0;
}

export function recommend(heroes: Hero[], stats: Statistics, draft: Draft, role: Role, rank: Rank): Recommendation[] {
  const unavailable = new Set([...draft.allies, ...draft.enemies, ...draft.bans]);
  const heroById = new Map(heroes.map(hero => [hero.id, hero]));
  const allies = draft.allies.flatMap((id, index) => id !== null && index !== roles.indexOf(role) ? [{ id, role: roles[index]! }] : []);
  // Canonical order keeps floating-point calculations and ties independent of slot order.
  const enemies = draft.enemies.filter((id): id is number => id !== null).sort((a, b) => a - b);
  const teamTags = new Set(allies.flatMap(ally => heroById.get(ally.id)?.tags ?? []));
  const index = pairIndex(stats);
  const roleRows = stats.roleStats.filter(row => row.rank === rank || row.rank === 'all');
  const selectedRows = roleRows.filter(row => row.rank === rank ||
    !roleRows.some(other => other.heroId === row.heroId && other.role === row.role && other.rank === rank));
  // Role match volume is a proxy for future enemy popularity, not a response model.
  const popularity = new Map<number, number>();
  for (const row of selectedRows) popularity.set(row.heroId, (popularity.get(row.heroId) ?? 0) + row.matches);
  const results: Recommendation[] = [];

  for (const row of selectedRows.filter(row => row.role === role && row.matches >= 500)) {
    const hero = heroById.get(row.heroId);
    if (!hero || unavailable.has(hero.id)) continue;
    const winRate = 'wins' in row ? row.wins / row.matches : row.winRate;
    const posterior = (winRate * row.matches + 500) / (row.matches + 1000);
    const meta = posterior - 0.5;
    // Conservative ranking penalty, not a confidence interval for draft outcomes.
    const uncertainty = 0.5 * Math.sqrt(posterior * (1 - posterior) / (row.matches + 1000));
    const pairs = (index.get(hero.id) ?? []).filter(pair => !pair.role || pair.role === role);
    const effects = enemies.map(id => ({ id, effect: pairEffect(pairs, id, 'enemy') }));
    if (effects.some(pair => pair.effect === undefined)) continue;
    const known = effects.map(pair => ({ id: pair.id, effect: pair.effect! }));
    const enemy = known.reduce((sum, pair) => sum + pair.effect, 0) / Math.sqrt(Math.max(1, enemies.length));
    const worstEnemy = 0.5 * Math.min(0, ...known.map(pair => pair.effect));
    const allyEffects = allies.map(ally => pairEffect(pairs, ally.id, 'ally', ally.role));
    const ally = 0.4 * allyEffects.reduce<number>((sum, effect) => sum + (effect ?? 0), 0) / Math.max(1, allies.length);
    const fills = allies.length >= 2 ? hero.tags.filter(tag => !teamTags.has(tag)).slice(0, 2) : [];
    const composition = fills.length * 0.004;
    const future = enemies.length < 5 ? heroes.flatMap(other => {
      if (other.id === hero.id || unavailable.has(other.id)) return [];
      const effect = pairEffect(pairs, other.id, 'enemy');
      const weight = popularity.get(other.id) ?? 0;
      return effect === undefined || !weight ? [] : [{ effect, weight }];
    }) : [];
    const counterRisk = 0.75 * (5 - enemies.length) / 5 * counterTail(future);
    const components = { meta, uncertainty, enemy, worstEnemy, ally, composition, counterRisk };
    const score = 100 * (meta - uncertainty + enemy + worstEnemy + ally + composition - counterRisk);
    const reasons = [`${(winRate * 100).toFixed(1)}% role win rate across ${row.matches} matches.`];
    const best = [...known].sort((a, b) => b.effect - a.effect)[0];
    if (best && best.effect > 0) reasons.push(`Adjusted advantage against ${heroById.get(best.id)?.name}.`);
    if (fills.length) reasons.push(`Adds team abilities: ${fills.join(', ')}.`);
    const covered = known.length + allyEffects.filter(effect => effect !== undefined).length;
    const requested = enemies.length + allies.length;
    results.push({ hero, score, components, matches: row.matches, winRate,
      rankFallback: rank !== 'all' && row.rank === 'all', reasons,
      risk: enemies.length < 5 ? 'Unrevealed enemies can counter this hero.' : 'Pair statistics cannot capture every team interaction.',
      coverage: requested ? `${covered}/${requested} selected hero matchups covered` : 'Add picks for matchup suggestions',
    });
  }
  return results.sort((a, b) => b.score - a.score || b.matches - a.matches || a.hero.id - b.hero.id).slice(0, 5);
}
