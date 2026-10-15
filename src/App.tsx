import { useEffect, useMemo, useRef, useState } from 'react';
import { emptyDraft, loadData, preferencesSchema, ranks, roles } from './data.ts';
import type { Draft, Hero, Rank, Role, Statistics } from './data.ts';
import { recommend } from './engine.ts';

const roleNames: Record<Role, string> = { carry: 'Carry · 1', mid: 'Mid · 2', offlane: 'Offlane · 3', support: 'Support · 4', 'hard-support': 'Hard support · 5' };
const STORAGE_KEY = 'draft-assistant-v2';
const formatRank = (rank: Rank) => rank === 'all' ? 'All ranks' : rank[0]?.toUpperCase() + rank.slice(1);
type Target = { team: 'allies' | 'enemies'; index: number } | { team: 'bans' };

function HeroImage({ hero, small = false }: { hero: Hero; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = new URL('/apps/dota2/images/dota_react/heroes/' + encodeURIComponent(hero.slug) + '.png', 'https://cdn.cloudflare.steamstatic.com');
  return failed ? <span className={`image-fallback${small ? ' small' : ''}`} aria-hidden="true">{hero.name.slice(0, 2)}</span> :
    <img className={`hero-image${small ? ' small' : ''}`} src={url.href} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export default function App() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [role, setRole] = useState<Role>('offlane');
  const [rank, setRank] = useState<Rank>('all');
  const [started, setStarted] = useState(false);
  const [target, setTarget] = useState<Target>({ team: 'allies', index: 2 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const heroById = useMemo(() => new Map(heroes.map(hero => [hero.id, hero])), [heroes]);

  useEffect(() => {
    let active = true;
    loadData().then(data => {
      if (!active) return;
      setHeroes(data.heroes); setStatistics(data.statistics); setError('');
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        const parsed = preferencesSchema.safeParse(stored);
        if (parsed.success) {
          const ids = new Set(data.heroes.map(hero => hero.id));
          const used = [...parsed.data.draft.allies, ...parsed.data.draft.enemies, ...parsed.data.draft.bans];
          if (used.every(id => id === null || ids.has(id))) {
            setDraft(parsed.data.draft); setRole(parsed.data.role); setRank(parsed.data.rank);
            setStarted(parsed.data.started); setTarget({ team: 'allies', index: roles.indexOf(parsed.data.role) });
          }
        }
      } catch { /* Browser storage is optional. */ }
      setRestored(true);
    }).catch(() => { if (active) setError('Could not load the data. Check the JSON files and try again.'); });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, started, role, rank, draft })); }
    catch { /* The draft still works when browser storage is unavailable. */ }
  }, [draft, role, rank, restored, started]);

  const unavailable = useMemo(() => new Set([...draft.allies, ...draft.enemies, ...draft.bans]), [draft]);
  const query = search.trim().toLowerCase();
  const results = useMemo(() => query ? heroes.filter(hero => [hero.name, ...hero.aliases].some(name => name.toLowerCase().includes(query))) : [], [heroes, query]);
  const suggestions = useMemo(() => statistics ? recommend(heroes, statistics, draft, role, rank) : [], [heroes, statistics, draft, role, rank]);
  const ownPosition = roles.indexOf(role);
  const targetRole = target.team === 'allies' ? roles[target.index] : undefined;
  const targetLabel = target.team === 'bans' ? 'Bans' : targetRole ? `${roleNames[targetRole]}${target.index === ownPosition ? ' · You' : ''}` : `Enemy team · Slot ${target.team === 'enemies' ? target.index + 1 : 1}`;

  function selectTarget(next: Target) {
    setTarget(next); searchRef.current?.focus();
  }

  function selectHero(hero: Hero) {
    if (unavailable.has(hero.id)) return;
    setDraft(previous => {
      const next = { allies: [...previous.allies], enemies: [...previous.enemies], bans: [...previous.bans] };
      if (target.team === 'bans') next.bans.push(hero.id);
      else next[target.team][target.index] = hero.id;
      return next;
    });
    setSearch(''); setStatus(`${hero.name} ${target.team === 'bans' ? 'banned' : 'selected'}.`);
    searchRef.current?.focus();
  }

  function removeHero(team: 'allies' | 'enemies', index: number) {
    setDraft(previous => ({ ...previous, [team]: previous[team].map((id, i) => i === index ? null : id) }));
    selectTarget({ team, index });
  }

  if (!started) return <div className="setup-shell"><form className="setup-form" onSubmit={event => {
    event.preventDefault();
    if (rank === 'all' || !restored) return;
    setTarget({ team: 'allies', index: ownPosition }); setStarted(true);
  }}>
    <span className="setup-eyebrow">Before the draft</span>
    <h1>Set up your draft</h1>
    <p>Choose your position and rank. Both stay fixed for this draft.</p>
    <label className="setup-field">Your position<select value={role} onChange={event => { const next = roles.find(value => value === event.target.value); if (next) setRole(next); }}>{roles.map(value => <option key={value} value={value}>{roleNames[value]}</option>)}</select></label>
    <label className="setup-field">Your rank<select value={rank} onChange={event => { const next = ranks.find(value => value === event.target.value); if (next) setRank(next); }}><option value="all" disabled>Select your rank</option>{ranks.filter(value => value !== 'all').map(value => <option key={value} value={value}>{formatRank(value)}</option>)}</select></label>
    {error && <div className="error" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(''); setRefresh(value => value + 1); }}>Reload data</button></div>}
    <button className="start-draft" type="submit" disabled={rank === 'all' || !restored}>{restored ? 'Start draft' : 'Loading heroes…'}<span aria-hidden="true">→</span></button>
  </form></div>;

  return <div className="app-shell">
    <header className="toolbar" aria-label="Draft settings">
      <div className="preferences">
        <span className="locked-setting" aria-label={`Your position: ${roleNames[role]}`}>{roleNames[role]}</span>
        <span className="locked-setting" aria-label={`Your rank: ${formatRank(rank)}`}>{formatRank(rank)}</span>
      </div>
      <div className="toolbar-actions">
        <button className="new-draft" onClick={() => { setDraft(emptyDraft()); setSearch(''); setStarted(false); setTarget({ team: 'allies', index: ownPosition }); setStatus('New draft started.'); }}>New draft</button>
      </div>
    </header>

    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Reload data</button></div>}

    <section className="draft" aria-label="Draft">
      {(['allies', 'enemies'] as const).map(team => <section key={team} className={`team ${team}`} aria-label={team === 'allies' ? 'Your team' : 'Enemy team'}>
        <h2>{team === 'allies' ? 'Your team' : 'Enemy team'}<span>{draft[team].filter(id => id !== null).length} / 5</span></h2>
        <div className="slots">{draft[team].map((id, index) => {
          const hero = id === null ? undefined : heroById.get(id);
          const selected = target.team === team && target.index === index;
          const own = team === 'allies' && index === ownPosition;
          const positionRole = team === 'allies' ? roles[index] : undefined;
          return <div className={`slot-wrap${selected ? ' selected' : ''}`} key={index}>
            <button className={`slot${hero ? ' filled' : ''}`} aria-pressed={selected} aria-label={`${positionRole ? `Your team, ${roleNames[positionRole]}` : `Enemy team, slot ${index + 1}`}${own ? ', your pick' : ''}${hero ? `, ${hero.name}` : ', empty'}`} onClick={() => selectTarget({ team, index })}>
              {positionRole && <span className="slot-position">{index + 1} · {roleNames[positionRole].split(' · ')[0]}</span>}
              {hero ? <HeroImage key={hero.id} hero={hero} /> : <span className="empty-slot" aria-hidden="true">+</span>}
              <span className="slot-name">{hero?.name ?? (own ? 'Your pick' : 'Empty')}</span>
              {own && hero && <span className="own-label">You</span>}
            </button>
            {hero && <button className="remove-hero" aria-label={`Remove ${hero.name}`} onClick={() => removeHero(team, index)}>×</button>}
          </div>;
        })}</div>
      </section>)}
    </section>

    <section className="bans" aria-label="Banned heroes"><span className="section-label">Bans</span><div className="ban-list">{draft.bans.map(id => {
      const hero = heroById.get(id);
      return hero && <button key={id} className="ban-chip" aria-label={`Remove ban: ${hero.name}`} onClick={() => setDraft(previous => ({ ...previous, bans: previous.bans.filter(value => value !== id) }))}><HeroImage hero={hero} small /><span>{hero.name}</span><span aria-hidden="true">×</span></button>;
    })}</div><button className="add-ban" aria-pressed={target.team === 'bans'} onClick={() => selectTarget({ team: 'bans' })}>+ Add ban</button></section>

    <main>
      <section className="hero-picker" aria-label="Hero search">
        <div className="search-bar"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" aria-label="Search heroes" placeholder="Search heroes…" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" onKeyDown={event => { const first = results.find(hero => !unavailable.has(hero.id)); if (event.key === 'Enter' && first) { event.preventDefault(); selectHero(first); } if (event.key === 'Escape') setSearch(''); }} /><kbd>↵</kbd></div>
        <div className="search-meta"><span>Adding to <strong>{targetLabel}</strong></span>{query && <span>{results.length} found</span>}</div>
        {!query && <div className="search-empty"><span className="empty-search-icon" aria-hidden="true">⌕</span><p>Find a hero for the draft</p><span>Search a name or alias, such as “Axe” or “PA”.</span></div>}
        {query && <div className="hero-grid" aria-label="Search results">{results.map(hero => <button className="hero-card" key={hero.id} disabled={unavailable.has(hero.id)} onClick={() => selectHero(hero)}><HeroImage hero={hero} /><span>{hero.name}</span>{unavailable.has(hero.id) && <small>Unavailable</small>}</button>)}</div>}
        {query && results.length === 0 && <p className="empty-message">No heroes found. Try another name.</p>}
        <div className="sr-only" role="status">{status}</div>
      </section>

      <section className="suggestions" aria-label="Suggested picks">
        <div className="suggestions-heading"><h1>Suggested picks</h1><span>{statistics?.isDemo ? 'Sample ranking' : roleNames[role].split(' · ')[0]}</span></div>
        {statistics?.isDemo && <p className="sample-note">Illustrative statistics. Load real data before using these picks in a match.</p>}
        {!statistics && !error && <p className="empty-message">Loading statistics…</p>}
        {statistics && suggestions.length === 0 && <p className="empty-message">No eligible heroes have statistics for this position and rank.</p>}
        <div className="suggestion-list">{suggestions.map((suggestion, index) => <article key={suggestion.hero.id} className="suggestion">
          <div className="suggestion-row"><span className="position">{index + 1}</span><HeroImage hero={suggestion.hero} /><div className="suggestion-name"><h2>{suggestion.hero.name}</h2><span>{suggestion.rankFallback ? 'All-rank data' : formatRank(rank)}</span></div><span className="fit-score" aria-label={`${suggestion.score} fit score`} title="Fit score combines role strength, matchups, and team needs. It is not a win probability.">{suggestion.score}<small>fit</small></span></div>
          <details><summary>Why this hero</summary><div className="reasons">{suggestion.reasons.map(reason => <p key={reason}>{reason}</p>)}<p className="risk"><strong>Risk:</strong> {suggestion.risk}</p><p className="coverage">{suggestion.coverage}. Fit scores are not win probabilities.</p></div></details>
        </article>)}</div>
      </section>
    </main>

  </div>;
}
