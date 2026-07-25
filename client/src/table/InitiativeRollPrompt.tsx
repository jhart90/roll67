import { useState } from 'react';
import { useGameStore } from '../store/game';
import { intents } from '../store/game';

/**
 * Roll-your-own initiative for the non-card systems (5e, SWN). When the DM
 * calls for initiative, everyone who owes a roll gets this prompt on their
 * own screen — players for their characters, the DM for NPCs — so each
 * result is rolled and announced by its own player rather than the server
 * quietly rolling for the table. Mirrors the SWADE card-draw overlay.
 */
export function InitiativeRollPrompt() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const [rolling, setRolling] = useState<string | null>(null);

  if (!you) return null;
  const pending = state.pendingRolls ?? [];
  if (pending.length === 0) return null;

  // Players roll for the characters they own; the DM covers everything
  // unowned (and can step in from the initiative tab for an absent player).
  const mine = you.role === 'dm'
    ? pending.filter((p) => p.ownerUserId === null)
    : pending.filter((p) => p.ownerUserId === you.userId);
  const next = mine[0];
  if (!next) return null;

  return (
    <div className="card-draw-overlay">
      <div className="card-flip-scene">
        <button
          className="init-roll-btn"
          disabled={rolling === next.tokenId}
          title={`Roll initiative for ${next.name}`}
          onClick={() => { setRolling(next.tokenId); intents.initRollMine(next.tokenId); }}
        >
          🎲
        </button>
        <div className="card-draw-label">
          Roll initiative — <strong>{next.name}</strong>
          {mine.length > 1 && <span className="dim"> (+{mine.length - 1} more)</span>}
        </div>
      </div>
    </div>
  );
}
