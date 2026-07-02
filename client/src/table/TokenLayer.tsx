import { useRef, useState } from 'react';
import type { TokenView } from 'shared';
import { canMoveToken, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

const DRAG_THROTTLE_MS = 100;

function TokenPiece({ token }: { token: TokenView }) {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((s) => s.characters);
  const selected = useGameStore((s) => s.selectedTokenId === token.id);
  const tool = useGameStore((s) => s.tool);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const lastSent = useRef(0);

  const character = characters.find((c) => c.id === token.characterId);
  const movable = !!you && tool === 'select' &&
    canMoveToken(you.role, you.userId, token, character);

  const home = hexToPixel({ q: token.q, r: token.r }, map.grid);
  const pos = dragPos ?? home;
  const radius = map.grid.hexSize * 0.72 * token.size;

  function onPointerDown(e: React.PointerEvent<SVGGElement>) {
    if (tool !== 'select') return;
    e.stopPropagation();
    useGameStore.getState().selectToken(token.id);
    if (!movable || e.button !== 0) return;
    try {
      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    } catch {
      // capture can fail for exotic pointers; selection already happened
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGGElement>) {
    if (!movable || !(e.currentTarget as SVGGElement).hasPointerCapture(e.pointerId)) return;
    const p = stage.toMap(e.clientX, e.clientY);
    setDragPos(p);
    const now = Date.now();
    if (now - lastSent.current > DRAG_THROTTLE_MS) {
      lastSent.current = now;
      intents.dragToken(token.id, p.x, p.y);
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGGElement>) {
    if (!movable || !dragPos) {
      setDragPos(null);
      return;
    }
    (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
    const hex = pixelToHex(dragPos, map.grid);
    setDragPos(null);
    intents.dragToken(token.id, dragPos.x, dragPos.y, true);
    if (hex.q !== token.q || hex.r !== token.r) {
      intents.moveToken(token.id, hex.q, hex.r);
    }
  }

  function onDoubleClick(e: React.MouseEvent<SVGGElement>) {
    e.stopPropagation();
    // Open the linked character sheet. We only hold characters we're allowed
    // to see (DM: all; player: their own), so a found character == permitted.
    if (character) useGameStore.getState().openSheet(character.id);
  }

  const bar = token.bar;
  const hpFrac = bar && bar.maxHp > 0 ? Math.max(0, Math.min(1, bar.hp / bar.maxHp)) : null;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        cursor: movable ? 'grab' : 'default',
        opacity: token.layer === 'gm' ? 0.55 : 1,
        // The layer's svg root is pointer-events:none so draw/measure tools
        // beneath still work; tokens themselves stay interactive.
        pointerEvents: 'auto',
      }}
    >
      {selected && (
        <circle r={radius + 4} fill="none" stroke="#e8d27b" strokeWidth={3} strokeDasharray="6 4" />
      )}
      <circle r={radius} fill={token.color} stroke="#10131a" strokeWidth={2} />
      {token.artUrl ? (
        <>
          <clipPath id={`clip-${token.id}`}>
            <circle r={radius - 2} />
          </clipPath>
          <image
            href={token.artUrl}
            x={-radius + 2}
            y={-radius + 2}
            width={(radius - 2) * 2}
            height={(radius - 2) * 2}
            clipPath={`url(#clip-${token.id})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      ) : (
        <text
          y={radius * 0.28}
          textAnchor="middle"
          fontSize={radius * 0.9}
          fill="#10131a"
          fontWeight={700}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {token.name.slice(0, 1).toUpperCase()}
        </text>
      )}
      {hpFrac !== null && (
        <g transform={`translate(${-radius}, ${radius + 4})`}>
          <rect width={radius * 2} height={5} rx={2} fill="#10131a" />
          <rect
            width={radius * 2 * hpFrac}
            height={5}
            rx={2}
            fill={hpFrac > 0.5 ? '#7ed28a' : hpFrac > 0.25 ? '#e8d27b' : '#d26c6c'}
          />
        </g>
      )}
      <text
        y={radius + (hpFrac !== null ? 20 : 14)}
        textAnchor="middle"
        fontSize={12}
        fill="#e6e8ee"
        stroke="#10131a"
        strokeWidth={3}
        paintOrder="stroke"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {token.name}
      </text>
    </g>
  );
}

function DragGhost({ tokenId, x, y }: { tokenId: string; x: number; y: number }) {
  const map = useGameStore((s) => s.map)!;
  const token = useGameStore((s) => s.tokens[tokenId]);
  if (!token) return null;
  const radius = map.grid.hexSize * 0.72 * token.size;
  return (
    <circle cx={x} cy={y} r={radius} fill={token.color} opacity={0.45} pointerEvents="none" />
  );
}

export function TokenLayer() {
  const map = useGameStore((s) => s.map)!;
  const tokens = useGameStore((s) => s.tokens);
  const dragGhosts = useGameStore((s) => s.dragGhosts);
  const { width, height } = mapPixelSize(map);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {Object.values(tokens).map((t) => (
        <TokenPiece key={t.id} token={t} />
      ))}
      {Object.entries(dragGhosts).map(([id, p]) => (
        <DragGhost key={id} tokenId={id} x={p.x} y={p.y} />
      ))}
    </svg>
  );
}
