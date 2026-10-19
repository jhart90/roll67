import { useState } from 'react';
import {
  QY_CONTEMPT_POOL, QY_SEASONS, qyActiveSeat, qyCardLabel, qyContemptHeld, qyRuleHints, qySeasonOf,
  type QyAction, type QyState,
} from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * The Quiet Year's table, in the dock: the season and the week, the card in
 * play, the three phases of a week, the project dice, the lists, Contempt,
 * and a log of the year so far. The map itself is the shared scene, drawn on
 * with the ordinary pencil.
 *
 * Every rule runs on the server (shared/quietYear.ts); this only shows the
 * year and sends actions. The card prompts come from the group's own deck,
 * imported into their campaign — or read off the physical card.
 */
export function QuietYearPanel() {
  const s = useGameStore((st) => st.qyState);
  const isDm = useGameStore((st) => st.isDm());
  const me = useGameStore((st) => st.you?.userId ?? null);
  if (!s) return <div className="qy-panel"><p className="dim">Loading the year…</p></div>;
  const act = (a: QyAction) => intents.qy(a);
  return (
    <div className="qy-panel">
      {s.phase === 'setup' && <Setup s={s} isDm={isDm} me={me} act={act} />}
      {s.phase !== 'setup' && <Play s={s} isDm={isDm} me={me} act={act} />}
      <Lists s={s} act={act} />
      {s.phase !== 'setup' && <Contempt s={s} me={me} act={act} />}
      <Log s={s} />
      {isDm && <FacilitatorTools s={s} act={act} />}
    </div>
  );
}

type Props = { s: QyState; isDm: boolean; me: string | null; act: (a: QyAction) => void };

// ------------------------------------------------------------------ setup

function Setup({ s, isDm, me, act }: Props) {
  const members = useGameStore((st) => st.members);
  const [terrain, setTerrain] = useState(s.setup.terrain);
  const mine = s.setup.resources.find((r) => r.userId === me)?.resource ?? '';
  const [resource, setResource] = useState(mine);
  const [abundance, setAbundance] = useState('');
  const seated = new Set(s.seats.map((x) => x.userId));
  const setSeats = (ids: string[]) => act({
    type: 'setSeats',
    seats: ids.map((id) => ({ userId: id, name: members.find((m) => m.userId === id)?.username ?? id })),
  });
  const move = (i: number, d: number) => {
    const ids = s.seats.map((x) => x.userId);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSeats(ids);
  };
  return (
    <section className="qy-section">
      <h3>A quiet year begins</h3>
      <p className="dim qy-help">
        Set up together, as the book's first chapters describe: agree the terrain, each draw one detail,
        then each name a resource. One goes in Abundance; the rest are Scarcities.
      </p>

      <h4>Around the table</h4>
      <ol className="qy-seats">
        {s.seats.map((x, i) => (
          <li key={x.userId}>
            {x.name}
            {isDm && (
              <span className="qy-mini">
                <button className="link" onClick={() => move(i, -1)} title="Earlier">▲</button>
                <button className="link" onClick={() => move(i, 1)} title="Later">▼</button>
                <button className="link" onClick={() => setSeats(s.seats.map((y) => y.userId).filter((id) => id !== x.userId))} title="Unseat">✕</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {isDm && (
        <div className="qy-row">
          {members.filter((m) => !seated.has(m.userId)).map((m) => (
            <button key={m.userId} onClick={() => setSeats([...s.seats.map((x) => x.userId), m.userId])}>+ {m.username}</button>
          ))}
          {s.seats.length === 0 && <button onClick={() => setSeats(members.map((m) => m.userId))}>Seat everyone</button>}
        </div>
      )}
      {!isDm && s.seats.length === 0 && <p className="dim">The facilitator will seat everyone.</p>}

      <h4>The land</h4>
      <textarea
        className="qy-text" rows={2} value={terrain} placeholder="Where is the community? A rocky desert, a wet coast…"
        onChange={(e) => setTerrain(e.target.value)} onBlur={() => terrain !== s.setup.terrain && act({ type: 'setTerrain', text: terrain })}
      />

      <h4>Resources</h4>
      <ul className="qy-plain">
        {s.setup.resources.map((r) => <li key={r.userId}><b>{r.name}:</b> {r.resource}</li>)}
      </ul>
      <div className="qy-row">
        <input value={resource} placeholder="Name an important resource" onChange={(e) => setResource(e.target.value)} />
        <button onClick={() => act({ type: 'nameResource', resource })}>{mine ? 'Change' : 'Name it'}</button>
      </div>

      {isDm && (
        <>
          <h4>Begin</h4>
          <label className="qy-check">
            <input type="checkbox" checked={s.fleeting} onChange={(e) => act({ type: 'setFleeting', fleeting: e.target.checked })} />
            A fleeting year — five cards out of each season (a shorter game)
          </label>
          <div className="qy-row">
            <select value={abundance} onChange={(e) => setAbundance(e.target.value)}>
              <option value="">In Abundance…</option>
              {s.setup.resources.map((r) => <option key={r.userId} value={r.resource}>{r.resource}</option>)}
            </select>
            <button
              className="primary" disabled={!abundance || s.seats.length === 0}
              onClick={() => act({ type: 'start', abundance })}
            >
              Start the year
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ play

function Play({ s, isDm, me, act }: Props) {
  const active = qyActiveSeat(s);
  const mine = !!active && active.userId === me;
  const canRun = mine || isDm;
  const seasonOf = s.current ? QY_SEASONS.find((x) => x.id === qySeasonOf(s.current!.cardId)) : null;
  const upcoming = s.deck[0] ? QY_SEASONS.find((x) => x.id === qySeasonOf(s.deck[0])) : null;
  const left = (id: string) => s.deck.filter((c) => qySeasonOf(c) === id).length;

  if (s.phase === 'over') {
    return (
      <section className="qy-section qy-over">
        <h3>❄ The Frost Shepherds have arrived</h3>
        <p>The year is over after {s.week} week{s.week === 1 ? '' : 's'}. Now you can wonder together: who or what were they, and what did their coming mean?</p>
      </section>
    );
  }

  return (
    <section className="qy-section">
      <div className="qy-season-bar">
        {QY_SEASONS.map((x) => (
          <span key={x.id} className={`qy-season ${(seasonOf ?? upcoming)?.id === x.id ? 'now' : ''}`} title={`${x.label}: ${left(x.id)} card${left(x.id) === 1 ? '' : 's'} left`}>
            {x.suit} {x.label} <small>{left(x.id)}</small>
          </span>
        ))}
      </div>
      <h3 className="qy-week">
        Week {Math.max(1, s.week + (s.current ? 0 : 1))} · {mine ? 'your week' : `${active?.name ?? '—'}’s week`}
      </h3>

      {/* 1. Play a card */}
      <div className={`qy-phase ${s.step === 'card' ? 'now' : 'done'}`}>
        <div className="qy-phase-title">1 · Play a card</div>
        {!s.current && (canRun
          ? <button className="primary" onClick={() => act({ type: 'draw' })}>Draw this week's card</button>
          : <p className="dim">Waiting for {active?.name} to draw.</p>)}
        {s.current && <Card s={s} canRun={canRun} act={act} />}
      </div>

      {/* 2. Adjust the dice */}
      <div className={`qy-phase ${s.step === 'dice' ? 'now' : s.step === 'card' ? 'later' : 'done'}`}>
        <div className="qy-phase-title">2 · Adjust the dice</div>
        {(s.step === 'card' || s.step === 'dice') && s.current && canRun && (
          <div className="qy-row">
            <button className={s.step === 'dice' ? 'primary' : ''} onClick={() => act({ type: 'adjustDice' })}>
              {s.skipDice ? 'Leave the dice this week' : `Reduce every project by ${s.diceStep || 1}`}
            </button>
            <label className="qy-check" title="Some cards say the dice stay put this week">
              <input type="checkbox" checked={s.skipDice} onChange={(e) => act({ type: 'setSkipDice', skip: e.target.checked })} />
              the card says not to
            </label>
          </div>
        )}
      </div>

      {/* 3. Take an action */}
      <div className={`qy-phase ${s.step === 'action' ? 'now' : s.step === 'done' ? 'done' : 'later'}`}>
        <div className="qy-phase-title">3 · Take an action{s.actionsLeft > 1 && s.step === 'action' ? ` (${s.actionsLeft} this week)` : ''}</div>
        {s.discussion && <Discussion s={s} isDm={isDm} me={me} act={act} />}
        {s.step === 'action' && !s.discussion && canRun && <Actions act={act} />}
        {s.step === 'action' && !s.discussion && !canRun && <p className="dim">{active?.name} is choosing an action.</p>}
      </div>

      {s.step === 'done' && s.current && canRun && (
        <button className="primary qy-end" onClick={() => act({ type: 'endWeek' })}>End the week →</button>
      )}

      <Projects s={s} canRun={canRun} act={act} />
    </section>
  );
}

function Card({ s, canRun, act }: { s: QyState; canRun: boolean; act: (a: QyAction) => void }) {
  const cur = s.current!;
  const options = s.oracle?.[cur.cardId] ?? [];
  const [startText, setStartText] = useState('');
  const [startWeeks, setStartWeeks] = useState(2);
  return (
    <div className="qy-card">
      <div className="qy-card-face">{qyCardLabel(cur.cardId)}</div>
      {options.length > 0 ? (
        <div className="qy-options">
          {options.map((o, i) => {
            const hints = qyRuleHints(o);
            const chosen = cur.choice === i;
            const rules = [
              hints.skipDice && 'dice stay put', hints.diceStep > 1 && 'dice move 2', hints.twoActions && 'two actions',
              hints.discardTwo && 'discard two', hints.endsWeek && 'week ends', hints.extraDiscussion && 'extra discussion',
            ].filter(Boolean);
            return (
              <button
                key={i}
                className={`qy-option ${chosen ? 'chosen' : ''} ${cur.choice !== null && !chosen ? 'faded' : ''}`}
                disabled={!canRun || cur.choice !== null}
                onClick={() => act({ type: 'choose', option: i })}
              >
                <span className="qy-option-text">{o}</span>
                {rules.length > 0 && <span className="qy-rules">{rules.join(' · ')}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div>
          <p className="dim qy-help">Read this card from your deck, choose one prompt, and resolve it.</p>
          {canRun && cur.choice === null && (
            <div className="qy-row">
              <button onClick={() => act({ type: 'choose', option: 0 })}>Read and resolved</button>
            </div>
          )}
        </div>
      )}
      {/* "Start a project to reflect": a card can start one before the dice move. */}
      {canRun && (s.step === 'card' || s.step === 'dice') && (
        <details className="qy-inline">
          <summary>The card starts a project</summary>
          <div className="qy-row">
            <input value={startText} placeholder="What the community will do" onChange={(e) => setStartText(e.target.value)} />
            <WeeksPicker value={startWeeks} onChange={setStartWeeks} />
            <button onClick={() => { act({ type: 'startProject', text: startText, weeks: startWeeks }); setStartText(''); }}>Start</button>
          </div>
        </details>
      )}
    </div>
  );
}

function WeeksPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} title="How many weeks it will take">
      {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} wk{n === 1 ? '' : 's'}</option>)}
    </select>
  );
}

function Actions({ act }: { act: (a: QyAction) => void }) {
  const [tab, setTab] = useState<'discover' | 'discuss' | 'project'>('discover');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'question' | 'statement'>('question');
  const [weeks, setWeeks] = useState(2);
  const go = () => {
    if (tab === 'discover') act({ type: 'discover', text });
    if (tab === 'discuss') act({ type: 'openDiscussion', kind, text });
    if (tab === 'project') act({ type: 'startProject', text, weeks });
    setText('');
  };
  return (
    <div className="qy-actions">
      <div className="qy-tabs">
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>Discover something new</button>
        <button className={tab === 'discuss' ? 'active' : ''} onClick={() => setTab('discuss')}>Hold a discussion</button>
        <button className={tab === 'project' ? 'active' : ''} onClick={() => setTab('project')}>Start a project</button>
      </div>
      <p className="dim qy-help">
        {tab === 'discover' && 'A new situation — a problem, an opportunity, or both. Draw it small on the map.'}
        {tab === 'discuss' && 'Everyone weighs in once, clockwise, in a sentence or two. A question lets you speak last. Nothing gets decided.'}
        {tab === 'project' && 'The community simply begins. Agree quickly how many weeks (1–6); anything longer goes in stages.'}
      </p>
      {tab === 'discuss' && (
        <div className="qy-row">
          <label className="qy-check"><input type="radio" checked={kind === 'question'} onChange={() => setKind('question')} /> a question</label>
          <label className="qy-check"><input type="radio" checked={kind === 'statement'} onChange={() => setKind('statement')} /> a statement</label>
        </div>
      )}
      <div className="qy-row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && go()}
          placeholder={tab === 'discover' ? 'What is found or what happens' : tab === 'discuss' ? 'Open the discussion' : 'What the community will do'} />
        {tab === 'project' && <WeeksPicker value={weeks} onChange={setWeeks} />}
        <button className="primary" disabled={!text.trim()} onClick={go}>Go</button>
      </div>
    </div>
  );
}

function Discussion({ s, isDm, me, act }: Props) {
  const d = s.discussion!;
  const [text, setText] = useState('');
  const next = d.waiting[0];
  const nextName = s.seats.find((x) => x.userId === next)?.name ?? '—';
  const mine = next === me;
  return (
    <div className="qy-discussion">
      <div className="qy-opening"><b>{d.openerName}</b> {d.kind === 'question' ? 'asks' : 'says'}: “{d.opening}”</div>
      {d.statements.map((x, i) => <div key={i} className="qy-statement"><b>{x.name}:</b> {x.text}</div>)}
      <div className="dim qy-help">{mine ? 'Your turn to weigh in — one or two sentences.' : `${nextName} weighs in next.`}</div>
      {(mine || isDm) && (
        <div className="qy-row">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mine ? 'Weigh in' : `On ${nextName}’s behalf`}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { act({ type: 'weighIn', text }); setText(''); } }} />
          <button disabled={!text.trim()} onClick={() => { act({ type: 'weighIn', text }); setText(''); }}>Say it</button>
          <button className="link" onClick={() => act({ type: 'passWeighIn' })}>stay silent</button>
        </div>
      )}
    </div>
  );
}

function Projects({ s, canRun, act }: { s: QyState; canRun: boolean; act: (a: QyAction) => void }) {
  if (s.projects.length === 0) return <p className="dim qy-help">No projects underway.</p>;
  return (
    <div className="qy-projects">
      <h4>Projects</h4>
      {s.projects.map((p) => (
        <div key={p.id} className="qy-project">
          <span className="qy-die" title={`${p.weeksLeft} week${p.weeksLeft === 1 ? '' : 's'} to go`}>{p.weeksLeft}</span>
          <span className="qy-project-text">{p.text}<small className="dim"> — {p.startedByName}, week {p.startedWeek}{p.fresh ? ' · just started' : ''}</small></span>
          {canRun && (
            <span className="qy-mini">
              <button className="link" title="One more week" onClick={() => act({ type: 'projectAdjust', id: p.id, delta: 1 })}>+</button>
              <button className="link" title="One week less" onClick={() => act({ type: 'projectAdjust', id: p.id, delta: -1 })}>−</button>
              <button className="link" title="It finishes early" onClick={() => act({ type: 'projectFinish', id: p.id })}>✔</button>
              <button className="link" title="It fails" onClick={() => act({ type: 'projectFail', id: p.id })}>✖</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ shared lists

function Lists({ s, act }: { s: QyState; act: (a: QyAction) => void }) {
  return (
    <section className="qy-section qy-lists">
      <ListCard title="Abundances" items={s.abundances} onAdd={(t) => act({ type: 'list', list: 'abundances', op: 'add', text: t })}
        onRemove={(t) => act({ type: 'list', list: 'abundances', op: 'remove', text: t })} />
      <ListCard title="Scarcities" items={s.scarcities} onAdd={(t) => act({ type: 'list', list: 'scarcities', op: 'add', text: t })}
        onRemove={(t) => act({ type: 'list', list: 'scarcities', op: 'remove', text: t })} />
      <ListCard title="Names" items={s.names} onAdd={(t) => act({ type: 'list', list: 'names', op: 'add', text: t })}
        onRemove={(t) => act({ type: 'list', list: 'names', op: 'remove', text: t })} />
    </section>
  );
}

function ListCard({ title, items, onAdd, onRemove }: { title: string; items: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="qy-list">
      <h4>{title}</h4>
      <ul className="qy-plain">
        {items.map((x) => (
          <li key={x}>{x} <button className="link qy-x" title="Remove" onClick={() => onRemove(x)}>✕</button></li>
        ))}
      </ul>
      <input value={text} placeholder="+ add" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onAdd(text); setText(''); } }} />
    </div>
  );
}

function Contempt({ s, me, act }: { s: QyState; me: string | null; act: (a: QyAction) => void }) {
  const held = qyContemptHeld(s);
  const mine = me ? s.contempt[me] ?? 0 : 0;
  return (
    <section className="qy-section">
      <h4>Contempt <small className="dim">· {QY_CONTEMPT_POOL - held} left in the pool</small></h4>
      <div className="qy-contempt">
        {s.seats.map((x) => (
          <span key={x.userId} className="qy-contempt-seat">
            {x.name} <b>{'●'.repeat(s.contempt[x.userId] ?? 0) || '—'}</b>
          </span>
        ))}
      </div>
      <p className="dim qy-help">Felt unheard or disregarded? You don't argue out of turn — take Contempt instead. Discard one when someone heals a past tension.</p>
      <div className="qy-row">
        <button disabled={held >= QY_CONTEMPT_POOL} onClick={() => act({ type: 'takeContempt' })}>Take Contempt</button>
        <button disabled={mine <= 0} onClick={() => act({ type: 'discardContempt' })}>Discard one</button>
      </div>
    </section>
  );
}

function Log({ s }: { s: QyState }) {
  if (s.log.length === 0) return null;
  return (
    <section className="qy-section">
      <details>
        <summary>The year so far ({s.log.length})</summary>
        <ol className="qy-log">
          {[...s.log].reverse().slice(0, 80).map((l) => (
            <li key={l.id} className={`qy-log-${l.kind}`}><small className="dim">wk {l.week}</small> <b>{l.by}</b> {l.text}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ the facilitator's drawer

function FacilitatorTools({ s, act }: { s: QyState; act: (a: QyAction) => void }) {
  const [text, setText] = useState('');
  const loaded = s.oracle ? Object.keys(s.oracle).length : 0;
  return (
    <section className="qy-section">
      <details>
        <summary>Facilitator</summary>
        <h4>Your deck's text</h4>
        <p className="dim qy-help">
          {loaded > 0
            ? `${loaded} of 52 cards loaded — choosing a prompt applies its rules (dice, discards, extra actions) by itself.`
            : 'Not loaded: players read each card from the physical deck. To load it, open the deck PDF you own, select all the text, copy it, and paste it here. It stays in this campaign only.'}
        </p>
        <textarea className="qy-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={'A Spring\n…\nor...\n…\n2 Spring\n…'} />
        <div className="qy-row">
          <button disabled={!text.trim()} onClick={() => { act({ type: 'importOracle', text }); setText(''); }}>Load the deck text</button>
          {loaded > 0 && <button className="link" onClick={() => act({ type: 'clearOracle' })}>remove it</button>}
        </div>
        {s.phase === 'play' && (
          <>
            <h4>Card effects by hand</h4>
            <div className="qy-row">
              <button onClick={() => act({ type: 'discardCards', count: 2 })}>Discard the top two cards</button>
              <button onClick={() => act({ type: 'addExtraAction' })}>An extra action this week</button>
            </div>
          </>
        )}
        <h4>Start over</h4>
        <button className="danger" onClick={() => { if (window.confirm('Start a new year? The deck, lists, projects and log are cleared; the seats and the deck text stay.')) act({ type: 'reset' }); }}>
          New year
        </button>
      </details>
    </section>
  );
}
