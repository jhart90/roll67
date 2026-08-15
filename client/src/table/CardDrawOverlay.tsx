import { useEffect, useState } from 'react';
import { cardName } from 'shared';
import { intents, useGameStore } from '../store/game';
import { CardFace } from '../util/PlayingCardView';
import { CardBackView, cardBackCss } from '../util/cardBacks';

/** How long the flipped card lingers on screen before fading out. */
const FLASH_MS = 2600;

/**
 * SWADE action-deck initiative overlay. When the DM deals cards, everyone
 * who still owes a draw sees a face-down deck button; clicking it draws the
 * top card server-side, and the drawn card flips over center-screen (real
 * suit pips, not numbers) before settling into chat + the initiative list.
 * The DM sees the same deck for NPC/unclaimed tokens.
 */
export function CardDrawOverlay() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const flash = useGameStore((s) => s.cardDrawFlash);
  const clearCardFlash = useGameStore((s) => s.clearCardFlash);
  const [drawing, setDrawing] = useState(false);

  // Auto-dismiss the flipped card after it has had its moment.
  useEffect(() => {
    if (!flash) return;
    setDrawing(false);
    const t = setTimeout(() => clearCardFlash(), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!you || !state.cardMode) return null;

  const pending = state.pendingDraws ?? [];
  // Players draw for their own tokens; the DM draws for NPCs (and can cover
  // an absent player from the initiative tab if needed).
  const mine = you.role === 'dm'
    ? pending.filter((p) => p.ownerUserId === null)
    : pending.filter((p) => p.ownerUserId === you.userId);
  const next = mine[0];

  // Only the client that clicked gets the big flip (others follow via chat
  // and the initiative list reordering live).
  const showFlash = flash && flash.byUserId === you.userId;
  if (!next && !showFlash) return null;

  return (
    <div className="card-draw-overlay">
      {showFlash ? (
        <div className="card-flip-scene" key={flash.seq}>
          <div className="card-flipper">
            <CardBackView back={flash.back} />
            <CardFace card={flash.card} />
          </div>
          <div className="card-draw-label">{flash.name} — {cardName(flash.card)}</div>
        </div>
      ) : next ? (
        <div className="card-flip-scene">
          <button
            className="card-back card-deck-btn"
            style={cardBackCss((() => {
              // The deck you draw from wears YOUR back: it is your card on
              // top. Read off the sheet, which this client has — the pending
              // token is one of its own.
              const chId = tokens[next.tokenId]?.characterId;
              const sheet = chId ? characters.find((c) => c.id === chId)?.sheet : undefined;
              return sheet?.cardBack;
            })())}
            disabled={drawing}
            title={`Draw an action card for ${next.name}`}
            onClick={() => { setDrawing(true); intents.initCardDraw(next.tokenId); }}
          >
            <span className="card-deck-count">{state.deckRemaining ?? 54}</span>
          </button>
          <div className="card-draw-label">
            🂠 Draw initiative — <strong>{next.name}</strong>
            {mine.length > 1 && <span className="dim"> (+{mine.length - 1} more)</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
