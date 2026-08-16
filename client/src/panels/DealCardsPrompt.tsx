import { useState } from 'react';
import { intents, useGameStore } from '../store/game';

/**
 * Setting up a fight before the deck comes out: what it is called, and who is
 * in it.
 *
 * Dealing used to be one click that swept up every token on the map, which is
 * right most of the time and wrong exactly when it matters — the shopkeeper
 * hiding behind the counter drew a card and took a turn. So the roster is
 * ticked, and every box starts ticked: the common case stays one click
 * through, and the uncommon one is a couple of unticks rather than a dozen
 * ticks.
 *
 * Naming the battle is optional. When it has a name, chat announces it by
 * that name, which is what the log will be read back as later.
 */
export function DealCardsPrompt({ onClose }: { onClose: () => void }) {
  const tokens = useGameStore((s) => s.tokens);
  const map = useGameStore((s) => s.map);
  const mapTokens = Object.values(tokens).filter((t) => t.mapId === map?.id);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(mapTokens.map((t) => t.id)));
  const [name, setName] = useState('');

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function deal() {
    if (!map || picked.size === 0) return;
    // The roster is explicit, so includeGm has nothing left to decide.
    intents.initCardCall(map.id, true, [...picked], name.trim());
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Deal Action Cards</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <label className="lu-field">
          Name this battle <span className="dim">(optional)</span>
          <input
            value={name}
            maxLength={60}
            autoFocus
            placeholder="The Ambush at Redwater"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') deal(); }}
          />
        </label>
        <p className="dim" style={{ fontSize: 12 }}>
          A named battle is announced in chat as “{name.trim() || 'The Ambush at Redwater'} begins!”,
          which is what the log reads back as afterwards.
        </p>

        <h4>
          In the fight
          <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}> — {picked.size} of {mapTokens.length}</span>
        </h4>
        <div className="row" style={{ gap: 6, marginBottom: 4 }}>
          <button
            className="link"
            onClick={() => setPicked(new Set(mapTokens.map((t) => t.id)))}
          >all in</button>
          <button className="link" onClick={() => setPicked(new Set())}>none</button>
        </div>
        <div className="lu-picks">
          {mapTokens.map((t) => (
            <label key={t.id} className="lu-pick">
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
              <span>
                {t.name}
                {t.layer === 'gm' && <span className="dim"> (hidden)</span>}
                {t.mountedOn ? ' (riding)' : ''}
              </span>
            </label>
          ))}
          {mapTokens.length === 0 && <p className="dim">No tokens on this map.</p>}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" style={{ width: 'auto' }} disabled={picked.size === 0} onClick={deal}>
            🂠 Deal the cards
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
