import { intents, useGameStore } from '../store/game';

/**
 * "Commit movement?" — small, in the top bar, only while the token whose turn
 * it is stands somewhere other than where its turn began.
 *
 * Movement inside the reach is provisional: the player may walk out, think
 * again, and walk somewhere else for the same Pace. Nothing is spent until
 * they say so here or take an action. The chip is deliberately quiet — it is
 * an offer, not a demand — and it disappears the moment there is nothing to
 * commit (back on the starting hex, or already committed).
 */
export function CommitMoveChip() {
  const you = useGameStore((s) => s.you);
  const isDm = useGameStore((s) => s.isDm());
  const asUser = useGameStore((s) => s.asUserId());
  const init = useGameStore((s) => s.initiativeState);
  const budgets = useGameStore((s) => s.moveBudgets);
  const characters = useGameStore((s) => s.characters);
  const tokens = useGameStore((s) => s.tokens);
  const feetPerHex = useGameStore((s) => s.map?.grid.feetPerHex ?? 5);
  if (!you || !init.active) return null;
  const entry = init.entries[init.turnIdx];
  const budget = entry?.tokenId ? budgets[entry.tokenId] : undefined;
  if (!budget || budget.provisional <= 0) return null;
  const token = tokens[budget.tokenId];
  const ch = token?.characterId ? characters.find((c) => c.id === token.characterId) : undefined;
  // Whose walk it is to commit: the controlling player, or the DM.
  const mine = isDm || (!!ch && ch.ownerUserId === asUser);
  if (!mine) return null;
  const feet = feetPerHex > 0 ? feetPerHex : 5;
  return (
    <button
      className="commit-move-chip"
      title={`Stay here: spend the ${budget.provisional}″ (${budget.provisional * feet} ft) this spot costs and measure the rest of the turn's Pace from it. Until then you can still walk somewhere else instead.`}
      onClick={() => intents.commitMove(budget.tokenId)}
    >
      ✔ Commit movement ({budget.provisional}″)
    </button>
  );
}
