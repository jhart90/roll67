import { useRef, useState } from 'react';
import type { SVGProps } from 'react';
import type { TokenShape, TokenView } from 'shared';
import { canMoveToken, conditionsOf, getCondition, hexDistance, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

const DRAG_THROTTLE_MS = 100;

type TargetState = 'off' | 'valid' | 'invalid';

function trianglePoints(r: number): string {
  return [[0, -r], [r * 0.87, r * 0.55], [-r * 0.87, r * 0.55]]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
function starPoints(r: number): string {
  const inner = r * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(Math.cos(ang) * rad).toFixed(1)},${(Math.sin(ang) * rad).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** SVG element for a token's outline, centered on the origin. */
function shapeNode(shape: TokenShape, r: number, extra: SVGProps<SVGElement>) {
  switch (shape) {
    case 'square': return <rect x={-r} y={-r} width={2 * r} height={2 * r} {...(extra as SVGProps<SVGRectElement>)} />;
    case 'rect-v': return <rect x={-r * 0.62} y={-r} width={r * 1.24} height={2 * r} {...(extra as SVGProps<SVGRectElement>)} />;
    case 'rect-h': return <rect x={-r} y={-r * 0.62} width={2 * r} height={r * 1.24} {...(extra as SVGProps<SVGRectElement>)} />;
    case 'triangle': return <polygon points={trianglePoints(r)} {...(extra as SVGProps<SVGPolygonElement>)} />;
    case 'star': return <polygon points={starPoints(r)} {...(extra as SVGProps<SVGPolygonElement>)} />;
    case 'circle':
    default: return <circle r={r} {...(extra as SVGProps<SVGCircleElement>)} />;
  }
}

function TokenPiece({ token, targetState }: { token: TokenView; targetState: TargetState }) {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((s) => s.characters);
  const selected = useGameStore((s) => s.selectedTokenId === token.id);
  const tool = useGameStore((s) => s.tool);
  const targetEffect = useGameStore((s) => s.targeting?.action.effect ?? null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const lastSent = useRef(0);

  const character = characters.find((c) => c.id === token.characterId);
  const movable = !!you && tool === 'select' && targetState === 'off' &&
    canMoveToken(you.role, you.userId, token, character);

  const home = hexToPixel({ q: token.q, r: token.r }, map.grid);
  const pos = dragPos ?? home;
  const radius = map.grid.hexSize * 0.72 * token.size;
  const shape = token.shape ?? 'circle';
  const ringColor = targetEffect === 'heal' ? '#7ed28a' : '#d26c6c';

  function onPointerDown(e: React.PointerEvent<SVGGElement>) {
    // Targeting mode: a click picks the target (if in range) instead of moving.
    if (targetState !== 'off') {
      e.stopPropagation();
      if (targetState === 'valid' && e.button === 0) useGameStore.getState().resolveTarget(token.id);
      return;
    }
    if (tool !== 'select') return;
    if (e.button === 2) return; // right-click handled by onContextMenu
    e.stopPropagation();
    useGameStore.getState().selectToken(token.id);
    useGameStore.getState().openInspector(null); // left-click closes the inspector
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

  function onContextMenu(e: React.MouseEvent<SVGGElement>) {
    if (targetState !== 'off' || tool !== 'select') { e.preventDefault(); return; }
    // Right-click opens the token inspector (DM-only panel; a no-op for players).
    e.preventDefault();
    e.stopPropagation();
    useGameStore.getState().selectToken(token.id);
    useGameStore.getState().openInspector(token.id);
  }

  const bar = token.bar;
  const hpFrac = bar && bar.maxHp > 0 ? Math.max(0, Math.min(1, bar.hp / bar.maxHp)) : null;
  // Condition badges (from the linked character we're allowed to see).
  const conditionIcons = character
    ? conditionsOf(character.sheet).map((id) => getCondition(id)?.icon).filter(Boolean) as string[]
    : [];

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        cursor: targetState === 'valid' ? 'crosshair' : movable ? 'grab' : 'default',
        opacity: (token.layer === 'gm' ? 0.55 : 1) * (targetState === 'invalid' ? 0.4 : 1),
        // The layer's svg root is pointer-events:none so draw/measure tools
        // beneath still work; tokens themselves stay interactive.
        pointerEvents: 'auto',
      }}
    >
      {targetState === 'valid' && (
        <circle className="target-ring" r={radius + 6} fill="none" stroke={ringColor} strokeWidth={3} />
      )}
      {selected && (
        <circle r={radius + 4} fill="none" stroke="#e8d27b" strokeWidth={3} strokeDasharray="6 4" />
      )}
      {shapeNode(shape, radius, { fill: token.color, stroke: '#10131a', strokeWidth: 2 })}
      {token.artUrl ? (
        <>
          <clipPath id={`clip-${token.id}`}>
            {shapeNode(shape, radius - 2, {})}
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
      {conditionIcons.length > 0 && (
        <text
          y={-radius - 5}
          textAnchor="middle"
          fontSize={13}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {conditionIcons.join(' ')}
        </text>
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
  const targeting = useGameStore((s) => s.targeting);
  const { width, height } = mapPixelSize(map);

  // In targeting mode, resolve which tokens are valid targets (in range, and
  // not the attacker itself for a damaging action).
  const src = targeting ? tokens[targeting.sourceTokenId] : undefined;
  const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
  const rangeHexes = targeting
    ? (targeting.action.rangeFt <= 0 ? 0 : Math.max(1, Math.ceil(targeting.action.rangeFt / feetPerHex)))
    : 0;
  function stateFor(t: TokenView): TargetState {
    if (!targeting || !src) return 'off';
    const inRange = hexDistance({ q: src.q, r: src.r }, { q: t.q, r: t.r }) <= rangeHexes;
    const selfBlocked = targeting.action.effect === 'damage' && t.id === src.id;
    return inRange && !selfBlocked ? 'valid' : 'invalid';
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {Object.values(tokens).map((t) => (
        <TokenPiece key={t.id} token={t} targetState={stateFor(t)} />
      ))}
      {Object.entries(dragGhosts).map(([id, p]) => (
        <DragGhost key={id} tokenId={id} x={p.x} y={p.y} />
      ))}
    </svg>
  );
}
