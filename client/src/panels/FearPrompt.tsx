import { useState } from 'react';
import { FEAR_SOURCE_LABEL, FEAR_TABLE, type FearSource } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * DM "call for a Fear check": pick who sees the thing, how bad it is, and the
 * creature's Fear penalty. Each target rolls Spirit at that penalty; failures
 * are resolved by the book, and the ones it sends to the Fear Table roll a
 * d20 there.
 */
export function FearPrompt({ onClose }: { onClose: () => void }) {
  const map = useGameStore((s) => s.map);
  const tokens = useGameStore((s) => s.tokens);
  const mapTokens = map ? Object.values(tokens).filter((t) => t.mapId === map.id) : [];

  const [source, setSource] = useState<FearSource>('terror');
  const [fearPenalty, setFearPenalty] = useState(2);
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showTable, setShowTable] = useState(false);

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function apply() {
    if (picked.size === 0) return;
    intents.requestFear({
      tokenIds: [...picked], source,
      fearPenalty: Math.abs(fearPenalty) || 0,
      label: label.trim() || undefined,
    });
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Call for a Fear Check</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <label className="lu-field">
          What are they looking at?
          <select value={source} onChange={(e) => setSource(e.target.value as FearSource)}>
            {(Object.keys(FEAR_SOURCE_LABEL) as FearSource[]).map((s) => (
              <option key={s} value={s}>{FEAR_SOURCE_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <p className="dim" style={{ fontSize: 12 }}>
          {source === 'nausea'
            ? 'A gruesome or horrific scene. A failed check leaves them Shaken and Fatigued; only a Critical Failure reaches the Fear Table.'
            : 'A terrifying creature or unknowable evil. Extras are simply Panicked. Wild Cards roll on the Fear Table — at +2 on a Critical Failure.'}
        </p>

        <label className="lu-field">
          Creature’s Fear penalty
          <input
            type="number" min={0} max={6} value={fearPenalty}
            onChange={(e) => setFearPenalty(Math.abs(Number(e.target.value)) || 0)}
          />
        </label>
        <p className="dim" style={{ fontSize: 12 }}>
          Enter it as a positive number. It applies twice, as the book has it: −{fearPenalty || 0} on
          the Spirit roll, and +{fearPenalty || 0} on the Fear Table roll, pushing the result worse.
        </p>

        <label className="lu-field">
          Label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="the dragon, the ossuary, …" />
        </label>

        <div className="lu-field">
          <span className="save-targets-head">
            Who sees it ({picked.size}/{mapTokens.length})
            <span className="spacer" />
            <button className="link" disabled={picked.size === mapTokens.length} onClick={() => setPicked(new Set(mapTokens.map((t) => t.id)))}>all</button>
            <button className="link" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>none</button>
          </span>
          <div className="save-targets">
            {mapTokens.map((t) => (
              <label key={t.id} className={`lu-skill ${picked.has(t.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                {t.name}{t.layer === 'gm' ? ' 🕶' : ''}
              </label>
            ))}
            {mapTokens.length === 0 && <span className="dim">No tokens on this map.</span>}
          </div>
        </div>

        <button className="link" onClick={() => setShowTable((v) => !v)} style={{ marginTop: 8 }}>
          {showTable ? 'hide' : 'show'} the Fear Table
        </button>
        {showTable && (
          <div className="save-targets" style={{ maxHeight: 220 }}>
            {FEAR_TABLE.map((r) => (
              <div key={r.outcome.id} style={{ fontSize: 12, padding: '3px 0' }}>
                <b>{r.min === r.max ? r.min : r.max > 100 ? `${r.min}+` : `${r.min}–${r.max}`}</b>
                {' '}<b>{r.outcome.label}:</b> <span className="dim">{r.outcome.effect}</span>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" style={{ width: 'auto' }} disabled={picked.size === 0} onClick={apply}>
            Roll Fear checks
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
