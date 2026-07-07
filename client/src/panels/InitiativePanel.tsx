import { useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { SavePrompt } from './SavePrompt';

export function InitiativePanel() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const selected = useGameStore((s) => (s.selectedTokenId ? s.tokens[s.selectedTokenId] : undefined));
  const map = useGameStore((s) => s.map);
  const [saving, setSaving] = useState(false);

  if (!you) return null;
  const isDm = you.role === 'dm';

  return (
    <div className="dock-panel">
      <div className="dock-header">
        <h3>Initiative {state.active && <span className="tag">round {state.round}</span>}</h3>
        {isDm && (
          <button className="link" onClick={() => intents.initSetActive(!state.active)}>
            {state.active ? 'end combat' : 'start combat'}
          </button>
        )}
      </div>

      <ol className="init-list">
        {state.entries.map((e, i) => (
          <li key={e.id} className={`${i === state.turnIdx && state.active ? 'current' : ''} ${e.hidden ? 'hidden-entry' : ''}`}>
            {isDm ? (
              <input
                key={`${e.id}:${e.value}`}
                type="number"
                className="init-value-input"
                defaultValue={e.value}
                title="Manually set this entry's initiative"
                onBlur={(ev) => {
                  const v = Number(ev.target.value);
                  if (!Number.isNaN(v) && v !== e.value) intents.initUpdate(e.id, { value: v });
                }}
              />
            ) : (
              <span className="init-value">{e.value}</span>
            )}
            <span className="init-name">{e.name}{e.hidden ? ' 🕶' : ''}</span>
            {isDm && (
              <span className="init-actions">
                <button className="link" title="Re-roll this entry's initiative" onClick={() => intents.initUpdate(e.id, { reroll: true })}>
                  🎲
                </button>
                <button className="link" title={e.hidden ? 'Reveal to players' : 'Hide from players'}
                  onClick={() => intents.initUpdate(e.id, { hidden: !e.hidden })}>
                  {e.hidden ? '👁' : '🕶'}
                </button>
                <button className="link danger" onClick={() => intents.initRemove(e.id)}>×</button>
              </span>
            )}
          </li>
        ))}
        {state.entries.length === 0 && <p className="dim">Nobody in initiative yet.</p>}
      </ol>

      {isDm && map && (
        <div className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
          <button onClick={() => intents.initRollMap(map.id, false)}>Roll all tokens</button>
          <button onClick={() => intents.initRollMap(map.id, true)}>+ hidden NPCs</button>
          <button onClick={() => setSaving(true)}>⚑ Call for save</button>
        </div>
      )}
      {saving && <SavePrompt onClose={() => setSaving(false)} />}

      {isDm && state.entries.length > 0 && (
        <div className="row init-controls">
          <button onClick={() => intents.initPrev()}>◀ prev</button>
          <button className="primary" style={{ width: 'auto', flex: 1 }} onClick={() => intents.initNext()}>next ▶</button>
          <button onClick={() => intents.initSort()}>sort</button>
          <button className="link danger" onClick={() => intents.initClear()}>clear</button>
        </div>
      )}

      <div className="stack" style={{ marginTop: 12 }}>
        {selected && (
          <button onClick={() => intents.initAdd({ tokenId: selected.id, roll: true })}>
            Roll initiative: {selected.name}
          </button>
        )}
        {!selected && <p className="dim" style={{ fontSize: 12 }}>Select a token to roll it into initiative.</p>}
        {isDm && selected && (
          <button onClick={() => intents.initAdd({ tokenId: selected.id, roll: true, hidden: true })}>
            Roll hidden: {selected.name}
          </button>
        )}
      </div>
    </div>
  );
}
