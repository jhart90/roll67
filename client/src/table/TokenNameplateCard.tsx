import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/game';
import { readableOn } from '../util/playerColor';

const DEFAULT_POS = { x: 16, y: 16 }; // from the bottom-RIGHT corner

/**
 * The public face of someone else's token.
 *
 * Shows only for a selected token you do NOT control — your own sheet is a
 * click away, so a card over it would just be in the way. Everything drawn
 * here arrives on the token itself (see nameplateFor): a player never receives
 * another player's sheet, so none of it could be looked up locally.
 */
export function TokenNameplateCard() {
  const you = useGameStore((s) => s.you);
  const selectedId = useGameStore((s) => s.selectedTokenId);
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const [pos, setPos] = useState(DEFAULT_POS);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // A fresh selection re-homes the card, so it can't be lost off-screen after
  // being dragged somewhere awkward.
  useEffect(() => { setPos(DEFAULT_POS); }, [selectedId]);

  const token = selectedId ? tokens[selectedId] : undefined;
  const plate = token?.nameplate;
  if (!you || !token || !plate) return null;
  // "Do not control" = the sheet isn't one of mine. Players only hold their
  // own, so a hit here means it's mine; the DM holds everything, so they fall
  // back to the owner check.
  const mine = token.characterId
    ? characters.some((c) => c.id === token.characterId && c.ownerUserId === you.userId)
    : false;
  if (mine) return null;

  const fg = readableOn(plate.color);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // Both axes are inverted: x is a CSS `right`, y a CSS `bottom`.
      setPos({
        x: Math.max(0, d.originX - (ev.clientX - d.startX)),
        y: Math.max(0, d.originY - (ev.clientY - d.startY)),
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
    <div
      className="nameplate-card"
      style={{ right: pos.x, bottom: pos.y, background: plate.color, color: fg }}
      onPointerDown={startDrag}
    >
      {plate.portraitUrl && (
        <img className="nameplate-portrait" src={plate.portraitUrl} alt="" draggable={false} />
      )}
      <div className="nameplate-body">
        <strong className="nameplate-name">{plate.name}</strong>
        {plate.lines.map((line, i) => (
          <span key={i} className="nameplate-line">{line}</span>
        ))}
      </div>
    </div>
  );
}
