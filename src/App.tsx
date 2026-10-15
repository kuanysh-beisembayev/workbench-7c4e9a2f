import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { emptyDraft, loadData, preferencesSchema, savedDraftSchema, roles } from './data.ts';
import type { Draft, Hero, Role, Statistics } from './data.ts';
import { recommend } from './engine.ts';

const roleNames: Record<Role, string> = { carry: 'Carry · 1', mid: 'Mid · 2', offlane: 'Offlane · 3', support: 'Support · 4', 'hard-support': 'Hard support · 5' };
const STORAGE_KEY = 'draft-assistant-v3';
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
  const [target, setTarget] = useState<Target>({ team: 'enemies', index: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [activeRole, setActiveRole] = useState<Role>('carry');
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const roleTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const heroById = useMemo(() => new Map(heroes.map(hero => [hero.id, hero])), [heroes]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let active = true;
    loadData().then(data => {
      if (!active) return;
      setHeroes(data.heroes); setStatistics(data.statistics); setError('');
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        const current = savedDraftSchema.safeParse(stored);
        const legacy = current.success ? null : preferencesSchema.safeParse(JSON.parse(localStorage.getItem('draft-assistant-v2') ?? 'null'));
        const saved = current.success ? current.data.draft : legacy?.success ? legacy.data.draft : null;
        if (saved) {
          const ids = new Set(data.heroes.map(hero => hero.id));
          const used = [...saved.allies, ...saved.enemies, ...saved.bans];
          if (used.every(id => id === null || ids.has(id))) setDraft(saved);
        }
      } catch { /* Browser storage is optional. */ }
      setRestored(true);
    }).catch(() => { if (active) setError('Could not load the data. Check the JSON files and try again.'); });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, draft })); }
    catch { /* The draft still works when browser storage is unavailable. */ }
  }, [draft, restored]);

  useLayoutEffect(() => {
    if (pickerOpen) {
      pickerRef.current?.showModal();
      searchRef.current?.focus({ preventScroll: true });
    } else pickerRef.current?.close();
  }, [pickerOpen]);

  const unavailable = useMemo(() => new Set([...draft.allies, ...draft.enemies, ...draft.bans]), [draft]);
  const query = search.trim().toLowerCase();
  const results = useMemo(() => query ? heroes.filter(hero => [hero.name, ...hero.aliases].some(name => name.toLowerCase().includes(query))).sort((a, b) => Number([b.name.toLowerCase(), ...b.aliases].includes(query)) - Number([a.name.toLowerCase(), ...a.aliases].includes(query))) : [], [heroes, query]);
  const suggestionsByRole = useMemo(() => roles.map(role => ({
    role, suggestions: statistics && !statistics.isDemo ? recommend(heroes, statistics, draft, role, 'all') : [],
  })), [heroes, statistics, draft]);
  const targetRole = target.team === 'allies' ? roles[target.index] : undefined;
  const targetLabel = target.team === 'bans' ? 'Bans' : targetRole ? roleNames[targetRole] : `Enemy team · Slot ${target.team === 'enemies' ? target.index + 1 : 1}`;

  function selectTarget(next: Target) {
    setTarget(next); setSearch(''); setPickerOpen(true);
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
    setPickerOpen(false);
  }

  function removeCurrent() {
    if (target.team !== 'bans') removeHero(target.team, target.index);
  }

  function removeHero(team: 'allies' | 'enemies', index: number) {
    setDraft(previous => ({ ...previous, [team]: previous[team].map((id, i) => i === index ? null : id) }));
    setPickerOpen(false);
  }

  return <div className="app-shell">
    <header className="toolbar" aria-label="Draft settings">
      <h1>Draft</h1>
      <button className="new-draft" disabled={!restored} onClick={() => { setDraft(emptyDraft()); setSearch(''); setPickerOpen(false); setTarget({ team: 'enemies', index: 0 }); setStatus('Draft cleared.'); }}>New draft</button>
    </header>

    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Reload data</button></div>}

    <main className="workspace">
    <div className="draft-panel">
    <section className="draft" aria-label="Draft">
      {(['enemies', 'allies'] as const).map(team => <section key={team} className={`team ${team}`} aria-label={team === 'allies' ? 'Your team' : 'Enemy team'}>
        <h2><span className="team-title">{team === 'allies' ? 'Your team' : 'Enemy team'}</span><span>{draft[team].filter(id => id !== null).length} / 5</span></h2>
        <div className="slots">{draft[team].map((id, index) => {
          const hero = id === null ? undefined : heroById.get(id);
          const positionRole = team === 'allies' ? roles[index] : undefined;
          const content = <>
            <span className="slot-art">{hero ? <HeroImage key={hero.id} hero={hero} /> : <span className="empty-slot" aria-hidden="true">+</span>}</span>
            <span className="slot-name">{hero?.name ?? 'Add hero'}</span>
            {positionRole && <span className="slot-position">{index + 1} · {roleNames[positionRole].split(' · ')[0]}</span>}
          </>;
          return <button className={`slot${hero ? ' filled' : ''}`} key={index} disabled={!restored} aria-label={`${positionRole ? `Your team, ${roleNames[positionRole]}` : `Enemy team, slot ${index + 1}`}${hero ? `, ${hero.name}` : ', empty'}`} onClick={() => selectTarget({ team, index })}>{content}</button>;
        })}</div>
      </section>)}
    </section>

    <section className="bans" aria-label="Banned heroes"><span className="section-label">Bans</span><div className="ban-list">{draft.bans.map(id => {
      const hero = heroById.get(id);
      return hero && <button key={id} className="ban-chip" aria-label={`Remove ban: ${hero.name}`} onClick={() => setDraft(previous => ({ ...previous, bans: previous.bans.filter(value => value !== id) }))}><HeroImage hero={hero} small /><span>{hero.name}</span><span aria-hidden="true">×</span></button>;
    })}</div><button className="add-ban" onClick={() => selectTarget({ team: 'bans' })}>+ Add ban</button></section>

    </div>
      <section className="recommendations" aria-label="Recommendations">
        <div className="recommendations-heading"><h2>Suggested picks</h2><span>{draft.enemies.some(id => id !== null) ? 'Draft picks' : 'Role meta'}</span></div>
        {!statistics && !error && <p className="empty-message">Loading statistics…</p>}
        {isMobile && <div className="role-tabs" role="tablist" aria-label="Positions">{roles.map((role, index) => <button
          key={role} ref={element => { roleTabRefs.current[index] = element; }} id={`role-tab-${role}`} role="tab"
          aria-selected={activeRole === role} aria-controls={`role-panel-${role}`} tabIndex={activeRole === role ? 0 : -1}
          onClick={() => setActiveRole(role)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % roles.length : event.key === 'ArrowLeft' ? (index + roles.length - 1) % roles.length : event.key === 'Home' ? 0 : event.key === 'End' ? roles.length - 1 : null;
            if (next === null) return;
            const nextRole = roles[next];
            if (!nextRole) return;
            event.preventDefault(); setActiveRole(nextRole); roleTabRefs.current[next]?.focus();
          }}><span>{index + 1}</span><span>{role === 'hard-support' ? 'Hard sup.' : roleNames[role].split(' · ')[0]}</span></button>)}</div>}
        <div className="role-suggestions">{suggestionsByRole.map(({role, suggestions}) => <section className="suggestions" key={role}
          id={`role-panel-${role}`} role={isMobile ? 'tabpanel' : undefined} hidden={isMobile && activeRole !== role}
          aria-labelledby={isMobile ? `role-tab-${role}` : undefined} aria-label={isMobile ? undefined : `${roleNames[role]} suggestions`} tabIndex={isMobile ? 0 : undefined}>
          <div className="suggestions-heading"><h3><span className="role-number">{roles.indexOf(role) + 1}</span>{roleNames[role].split(' · ')[0]}</h3></div>
          {statistics && suggestions.length === 0 && <p className="empty-message">Not enough matchup data.</p>}
          <div className="suggestion-list">{suggestions.map((suggestion, index) => <article key={suggestion.hero.id} className="suggestion">
            <span className="position">{index + 1}</span><HeroImage hero={suggestion.hero} /><h4>{suggestion.hero.name}</h4>
          </article>)}</div>
        </section>)}</div>
      </section>
    </main>

    <dialog ref={pickerRef} className="hero-picker" aria-labelledby="picker-title" onCancel={() => setPickerOpen(false)} onClose={() => setPickerOpen(false)} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setPickerOpen(false); } }}>
      <div className="picker-header"><h2 id="picker-title">{targetLabel}</h2><button className="close-picker" aria-label="Close hero search" onClick={() => setPickerOpen(false)}>×</button></div>
      <section aria-label="Hero search">
        <div className="search-bar"><span aria-hidden="true">⌕</span><input ref={searchRef} autoFocus type="search" enterKeyHint="search" aria-label="Search heroes" placeholder="Search heroes…" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" onKeyDown={event => { const first = results.find(hero => !unavailable.has(hero.id)); if (event.key === 'Enter' && first) { event.preventDefault(); selectHero(first); } if (event.key === 'Escape') setSearch(''); }} /></div>
        {target.team !== 'bans' && draft[target.team][target.index] !== null && <button className="remove-selection" onClick={removeCurrent}>Remove hero</button>}
        {!query && <p className="empty-message">Search by name or abbreviation</p>}
        {query && <div className="hero-grid" aria-label="Search results">{results.map(hero => <button className="hero-card" key={hero.id} disabled={unavailable.has(hero.id)} onClick={() => selectHero(hero)}><HeroImage hero={hero} /><span>{hero.name}</span>{unavailable.has(hero.id) && <small>Unavailable</small>}</button>)}</div>}
        {query && results.length === 0 && <p className="empty-message">No heroes found. Try another name.</p>}
      </section>

    </dialog>
    <div className="sr-only" role="status">{status}</div>
  </div>;
}
