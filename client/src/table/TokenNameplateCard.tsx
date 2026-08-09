import { useRef, useState } from 'react';
import { useGameStore } from '../store/game';
import { readableOn } from '../util/playerColor';

/** The chat dock owns the right edge of the screen, so 'lower right' means
 *  the lower right of the MAP, not of the window. */
const DOCK_W = 300;
const DEFAULT_POS = { x: DOCK_W + 16, y: 16 }; // insets from the bottom-RIGHT
const STORAGE_KEY = 'roll67.nameplatePos';

/** Where this player last dragged the card, so every later one opens there. */
function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
  } catch { /* unreadable or disabled storage: fall back to the default */ }
  return { ...DEFAULT_POS };
}

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
  const [pos, setPos] = useState(loadPos);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

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
      // Remember where they dropped it, so every later nameplate opens there.
      setPos((cur) => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cur)); } catch { /* storage disabled */ }
        return cur;
      });
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
      {plate.portraitUrl
        ? <img className="nameplate-portrait" src={plate.portraitUrl} alt="" draggable={false} />
        : <div className="nameplate-portrait-empty">🎭</div>}
      <div className="nameplate-body">
        <strong className="nameplate-name">{plate.name}</strong>
        {plate.lines.map((line, i) => (
          <span key={i} className={`nameplate-line np-${line.kind}`}>{line.text}</span>
        ))}
      </div>
    </div>
  );
}
