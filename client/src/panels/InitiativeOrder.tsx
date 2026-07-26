import { intents, useGameStore } from '../store/game';
import { cardShort } from 'shared';
import { playerColorFor } from '../util/playerColor';

/**
 * The turn order as a live queue.
 *
 * The combatant whose turn it is always sits at the top and the list wraps
 * around beneath them, so ending a turn visibly drops you to the bottom. The
 * underlying order never changes — rotating only the display keeps round
 * counting and the DM's back/forward controls working off a stable index.
 */
export function InitiativeOrder({ onClose }: { onClose: () => void }) {
  const state = useGameStore((s) => s.initiativeState);
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);

  const { entries, turnIdx, round, active } = state;
  if (!active || entries.length === 0) {
    return (
      <div className="dock-panel initiative-order">
        <div className="dock-header">
          <h3>Initiative Order</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>Combat hasn’t started yet.</p>
      </div>
    );
  }

  const current = entries[turnIdx];
  const myTurn = !!you && (current?.ownerUserId === you.userId || you.role === 'dm');
  // Rotate so the active combatant leads; everyone behind them follows in
  // turn order and wraps past the end of the round.
  const rotated = entries.map((_, i) => entries[(turnIdx + i) % entries.length]);
  const colorOf = (userId: string | null | undefined) => {
    if (!userId) return null;
    const m = members.find((x) => x.userId === userId);
    return m ? playerColorFor(m) : null;
  };

  return (
    <div className="dock-panel initiative-order">
      <div className="dock-header">
        <h3>Initiative Order</h3>
        <span className="dim" style={{ fontSize: 11 }}>Round {round}</span>
        <button className="link" onClick={onClose}>close</button>
      </div>

      <ol className="init-order-list">
        {rotated.map((e, i) => {
          const color = colorOf(e.ownerUserId);
          return (
            <li key={e.id} className={`init-order-row ${i === 0 ? 'current' : ''}`}>
              <span className="init-order-pos">{i === 0 ? '▶' : i + 1}</span>
              <span className="init-order-name" style={color ? { color } : undefined}>{e.name}</span>
              {e.ownerName && <span className="init-order-owner dim">{e.ownerName}</span>}
              <span className="init-order-value dim">{e.card ? cardShort(e.card) : e.value}</span>
            </li>
          );
        })}
      </ol>

      {myTurn && (
        <button className="init-end-turn" onClick={() => intents.endTurn()}>
          End {you?.role === 'dm' && current?.ownerUserId !== you.userId ? `${current?.name}’s` : 'my'} turn
        </button>
      )}
    </div>
  );
}

/**
 * Whose turn it is, over the map. Deliberately loud — at a table the single
 * most-asked question is "wait, whose go is it?".
 */
export function TurnBanner() {
  const state = useGameStore((s) => s.initiativeState);
  const members = useGameStore((s) => s.members);
  if (!state.active || state.entries.length === 0) return null;
  const current = state.entries[state.turnIdx];
  if (!current) return null;
  const member = current.ownerUserId ? members.find((m) => m.userId === current.ownerUserId) : undefined;
  const color = member ? playerColorFor(member) : null;
  return (
    <div className="turn-banner">
      <strong style={color ? { color } : undefined}>
        Round {state.round}: {current.name}’s Turn
      </strong>
      <span className="dim">
        {current.ownerName ? `(controlled by ${current.ownerName})` : '(controlled by the DM)'}
      </span>
    </div>
  );
}
