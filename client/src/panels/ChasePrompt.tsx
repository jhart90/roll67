import { useState } from 'react';
import { CHASE_INCREMENTS, CHASE_TRACK_DEFAULT, type ChaseIncrementId } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * Setting up a chase: who is in it, and at what scale.
 *
 * The scale is the only number that matters up front — it decides how many
 * yards a Chase Card is worth, and therefore whether anyone can shoot anyone.
 * The book tunes each one to the weapons of that kind of chase, which is why
 * a foot chase is 5 yards a card and a dogfight is 50.
 */
export function ChasePrompt({ onClose }: { onClose: () => void }) {
  const tokens = useGameStore((s) => s.tokens);
  const map = useGameStore((s) => s.map);
  const mapTokens = Object.values(tokens).filter((t) => t.mapId === map?.id);
  // Everyone on the map starts IN it. A chase usually sweeps up the whole
  // scene, so unticking the two bystanders beats ticking the other nine.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(mapTokens.map((t) => t.id)));
  const [incrementId, setIncrementId] = useState<ChaseIncrementId>('foot');
  const [trackLength, setTrackLength] = useState(CHASE_TRACK_DEFAULT);

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function start() {
    if (picked.size === 0) return;
    intents.chaseStart([...picked], incrementId, trackLength);
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Start a Chase</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <label className="lu-field">
          Scale
          <select value={incrementId} onChange={(e) => setIncrementId(e.target.value as ChaseIncrementId)}>
            {CHASE_INCREMENTS.map((c) => (
              <option key={c.id} value={c.id}>{c.label} — {c.increment} yards a card</option>
            ))}
          </select>
        </label>
        <p className="dim" style={{ fontSize: 12 }}>
          Range between two participants is the number of cards between them times that distance,
          so the scale decides who can shoot whom. Everyone starts on the rearmost card — open a
          gap with a few Change Positions before the first round if the fiction says someone is ahead.
        </p>

        <label className="lu-field">
          Chase Cards to lay out
          <input
            type="number" min={3} max={20} value={trackLength}
            onChange={(e) => setTrackLength(Math.max(3, Math.min(20, Number(e.target.value) || CHASE_TRACK_DEFAULT)))}
          />
        </label>

        <h4>In the chase</h4>
        <div className="lu-picks">
          {mapTokens.map((t) => (
            <label key={t.id} className="lu-pick">
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
              <span>{t.name}{t.mountedOn ? ' (riding)' : ''}</span>
            </label>
          ))}
          {mapTokens.length === 0 && <p className="dim">No tokens on this map.</p>}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" style={{ width: 'auto' }} disabled={picked.size === 0} onClick={start}>
            🏁 Lay out the track
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
