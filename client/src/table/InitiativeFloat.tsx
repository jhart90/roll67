import { useEffect, useRef, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { CardChip } from '../util/PlayingCardView';

const DEFAULT_POS = { x: 16, y: 140 }; // from the bottom-left corner

/**
 * A small floating, draggable readout of the initiative order — visible to
 * everyone the moment the DM starts combat, so players can track turn order
 * without leaving the chat tab. Purely a readout: the full-featured tab
 * (reorder, hide/reveal, call for save) stays DM-only.
 */
export function InitiativeFloat() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState(DEFAULT_POS);
  const wasActive = useRef(state.active);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // A fresh combat always reopens it, even if it was dismissed last time.
  useEffect(() => {
    if (state.active && !wasActive.current) setDismissed(false);
    wasActive.current = state.active;
  }, [state.active]);

  if (!you || !state.active || dismissed) return null;

  const current = state.entries[state.turnIdx];
  const isMine = !!current && current.ownerUserId === you.userId;
  const myTurn = isMine || you.role === 'dm';
  // Rotate so whoever is up leads the list. Only the DISPLAY rotates — the
  // stored order and turnIdx stay put, which keeps round counting and the DM's
  // back/forward controls working off a stable index. roundOffset marks where
  // the wrap happens so the next round can be labelled.
  const rotated = state.entries.map((_, i) => {
    const idx = (state.turnIdx + i) % state.entries.length;
    return { entry: state.entries[idx], roundOffset: idx < state.turnIdx ? 1 : 0 };
  });

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // x is a CSS `left` (grows rightward, same as clientX); y is a CSS
      // `bottom` (grows upward, opposite of clientY), so only y is inverted.
      setPos({
        x: Math.max(0, drag.originX + (ev.clientX - drag.startX)),
        y: Math.max(0, drag.originY - (ev.clientY - drag.startY)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div className="initiative-float" style={{ left: pos.x, bottom: pos.y }}>
      <div className="initiative-float-bar" onPointerDown={startDrag}>
        <span className="win-frame-title">Initiative <span className="tag">round {state.round}</span></span>
        <span className="spacer" />
        <button className="link" onClick={() => setDismissed(true)}>✕</button>
      </div>
      <ol className="init-list">
        {rotated.map(({ entry, roundOffset }, i) => (
          <li key={entry.id} className={`${i === 0 ? 'current' : ''} ${entry.hidden ? 'hidden-entry' : ''}`}>
            {/* Everything from here on happens next round, so say where the
                round breaks rather than letting the wrap pass unremarked. */}
            {roundOffset > 0 && i > 0 && rotated[i - 1].roundOffset !== roundOffset && (
              <span className="init-round-break">round {state.round + roundOffset}</span>
            )}
            {entry.card ? <CardChip card={entry.card} /> : <span className="init-value">{entry.value}</span>}
            <span className="init-name">{entry.name}{entry.hidden ? ' 🕶' : ''}</span>
          </li>
        ))}
        {state.entries.length === 0 && <p className="dim" style={{ margin: '4px 8px', fontSize: 12 }}>Nobody in initiative yet.</p>}
      </ol>
      {myTurn && (
        <button className="init-end-turn" onClick={() => intents.endTurn()}>
          End {isMine ? 'my' : `${current?.name}’s`} turn
        </button>
      )}
    </div>
  );
}
