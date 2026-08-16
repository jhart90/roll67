import { useEffect, useRef, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { CardChip } from '../util/PlayingCardView';

/** The tool rail owns the left edge: a 40px button plus 6px padding either
 *  side plus its border. Starting at 16 put the tracker on top of it. */
const TOOL_RAIL_W = 53;
const DEFAULT_POS = { x: TOOL_RAIL_W + 16, y: 140 }; // from the bottom-left corner

/**
 * A small floating, draggable readout of the initiative order — visible to
 * everyone the moment the DM starts combat, so players can track turn order
 * without leaving the chat tab. Purely a readout: the full-featured tab
 * (reorder, hide/reveal, call for save) stays DM-only.
 */
export function InitiativeFloat() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const dismissed = useGameStore((s) => s.initFloatHidden);
  const setDismissed = useGameStore((s) => s.setInitFloatHidden);
  const [pos, setPos] = useState(DEFAULT_POS);
  const wasActive = useRef(state.active);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // A fresh combat always reopens it, even if it was dismissed last time.
  useEffect(() => {
    if (state.active && !wasActive.current) setDismissed(false);
    wasActive.current = state.active;
  }, [state.active]);

  // Every hook ABOVE the early return, unconditionally. Two of these used to
  // sit below it, which held together exactly as long as combat was running —
  // and the moment it ended, the early return skipped them, React counted
  // fewer hooks than the render before, and the whole app came down to a
  // black screen. A component's hooks are a contract about every render, not
  // just the interesting ones.
  const budgets = useGameStore((st) => st.moveBudgets);
  const upTokenId = useGameStore((st) => st.initiativeState.entries[st.initiativeState.turnIdx]?.tokenId ?? null);

  if (!you || !state.active || dismissed) return null;

  const current = state.entries[state.turnIdx];
  const isMine = !!current && current.ownerUserId === you.userId;
  // The same signal the turn coach lights up on: the rules' one demand is
  // dealt with and the turn has been used for something.
  const budget = upTokenId ? budgets[upTokenId] : undefined;
  const turnSpent = !!budget && !budget.shaken && (budget.actions > 0 || budget.moved > 0);
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
            <span className="init-name">{entry.name}{entry.hidden ? ' 🕶' : ''}{entry.held ? ' ⏸' : ''}</span>
            {entry.held && (entry.ownerUserId === you.userId || you.role === 'dm') && (
              <button className="link" title="Stop holding — act right now" onClick={() => intents.actNow(entry.id)}>▶ act</button>
            )}
          </li>
        ))}
        {state.entries.length === 0 && <p className="dim" style={{ margin: '4px 8px', fontSize: 12 }}>Nobody in initiative yet.</p>}
      </ol>
      {myTurn && (
        <div className="row" style={{ gap: 4 }}>
          <button
            className={`init-end-turn${turnSpent ? ' ready' : ''}`}
            onClick={() => intents.endTurn()}
          >
            End {isMine ? 'my' : `${current?.name}’s`} turn
          </button>
          <button
            className="init-end-turn"
            style={{ width: 'auto' }}
            title="Hold your action — skip for now, jump back in later this round"
            onClick={() => intents.holdTurn()}
          >
            ⏸ Hold
          </button>
        </div>
      )}
    </div>
  );
}
