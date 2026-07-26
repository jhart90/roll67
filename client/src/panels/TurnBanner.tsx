import { useGameStore } from '../store/game';
import { playerColorFor, readableOn } from '../util/playerColor';

/**
 * Whose turn it is, over the map. Deliberately loud — at a table the single
 * most-asked question is "wait, whose go is it?".
 */
/**
 * The colour the top bar wears while someone is up, plus the text colour that
 * stays legible on it. Exported so the bar itself can take the fill — the
 * banner alone is a small target, and the whole bar changing colour is
 * impossible to miss from across a table.
 */
export function useTurnTint(): { bg: string; fg: string } | null {
  const state = useGameStore((s) => s.initiativeState);
  const members = useGameStore((s) => s.members);
  if (!state.active || state.entries.length === 0) return null;
  const current = state.entries[state.turnIdx];
  if (!current) return null;
  const member = current.ownerUserId ? members.find((m) => m.userId === current.ownerUserId) : undefined;
  // A DM-run NPC has no player colour, so the bar stays its usual slate.
  const bg = member ? playerColorFor(member) : '#3a3f4d';
  return { bg, fg: readableOn(bg) };
}

export function TurnBanner() {
  const state = useGameStore((s) => s.initiativeState);
  const tint = useTurnTint();
  if (!tint || !state.active) return null;
  const current = state.entries[state.turnIdx];
  if (!current) return null;
  return (
    <div className="turn-banner" style={{ color: tint.fg }}>
      <strong>Round {state.round}: {current.name}’s Turn</strong>
      <span className="turn-banner-sub">
        {current.ownerName ? `(controlled by ${current.ownerName})` : '(controlled by the DM)'}
      </span>
    </div>
  );
}
