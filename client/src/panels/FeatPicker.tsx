import { useState } from 'react';
import type { Character } from 'shared';
import { applyFeat, FEATS_5E, meetsPrereq, takenFeatIds } from 'shared';
import { intents } from '../store/game';

/** Browse and add a 5e feat to a character; applies its numeric effects. */
export function FeatPicker({ character, onClose }: { character: Character; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [ability, setAbility] = useState<Record<string, string>>({});
  const taken = new Set(takenFeatIds(character.sheet));

  const q = search.trim().toLowerCase();
  const list = FEATS_5E
    .filter((f) => !q || f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  function add(id: string) {
    const feat = FEATS_5E.find((f) => f.id === id)!;
    const ab = feat.abilityChoice ? (ability[id] || feat.abilityChoice[0]) : undefined;
    intents.updateCharacter(character.id, applyFeat(character.sheet, id, ab));
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-window npc-library feat-picker">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>Feats</h3>
          <span className="dim">add to {character.name}</span>
          <span className="spacer" />
          <button className="link" onClick={onClose}>close</button>
        </div>
        <div className="npc-controls">
          <input placeholder="Search feats…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="feat-list">
          {list.map((f) => {
            const ok = meetsPrereq(character.sheet, f);
            return (
              <div key={f.id} className={`feat-row ${taken.has(f.id) ? 'taken' : ''}`}>
                <div className="feat-main">
                  <span className="feat-name">
                    {f.name}
                    {f.prereq ? <span className="dim" style={!ok ? { color: 'var(--danger)' } : undefined}> · {f.prereq}{!ok ? ' (not met)' : ''}</span> : null}
                  </span>
                  <span className="feat-desc dim">{f.desc}</span>
                </div>
                <div className="feat-actions">
                  {f.abilityChoice && (
                    <select value={ability[f.id] ?? f.abilityChoice[0]} onChange={(e) => setAbility((a) => ({ ...a, [f.id]: e.target.value }))}>
                      {f.abilityChoice.map((ab) => <option key={ab} value={ab}>+1 {ab.toUpperCase()}</option>)}
                    </select>
                  )}
                  <button
                    className="btn btn-sm btn-accent"
                    disabled={!ok}
                    title={!ok ? `Requires ${f.prereq}` : undefined}
                    onClick={() => add(f.id)}
                  >
                    {taken.has(f.id) ? 'add again' : 'add'}
                  </button>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <p className="dim" style={{ padding: 12 }}>No feats match that search.</p>}
        </div>
      </div>
    </div>
  );
}
