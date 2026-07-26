import { useGameStore } from '../store/game';
import { playerColorFor } from '../util/playerColor';

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
