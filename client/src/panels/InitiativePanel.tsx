import { intents, useGameStore } from '../store/game';

export function InitiativePanel() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const selectedTokenId = useGameStore((s) => s.selectedTokenId);
  const tokens = useGameStore((s) => s.tokens);

  if (!you) return null;
  const isDm = you.role === 'dm';
  const selected = selectedTokenId ? tokens[selectedTokenId] : undefined;

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
            <span className="init-value">{e.value}</span>
            <span className="init-name">{e.name}{e.hidden ? ' 🕶' : ''}</span>
            {isDm && (
              <span className="init-actions">
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
