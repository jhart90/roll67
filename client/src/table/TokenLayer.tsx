import { memo, useMemo, useRef, useState } from 'react';
import type { SVGProps } from 'react';
import type { TokenShape, TokenView } from 'shared';
import { canMoveToken, conditionsOf, getCondition, hexDistance, hexToPixel, pixelToHex, pointInAoe, pxPerFoot } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';
import { worldDrag } from '../store/worldDrag';

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

const TokenPiece = memo(function TokenPiece({ token, targetState }: { token: TokenView; targetState: TargetState }) {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const you = useGameStore((s) => s.you);
  const character = useGameStore((s) => s.characters.find((c) => c.id === token.characterId));
  const selected = useGameStore((s) => s.selectedTokenIds.includes(token.id));
  const tool = useGameStore((s) => s.tool);
  const targetEffect = useGameStore((s) => s.targeting?.action.effect ?? null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const lastSent = useRef(0);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const isDm = you?.role === 'dm';
  const movable = !!you && tool === 'select' && targetState === 'off' &&
    canMoveToken(you.role, you.userId, token, character);

  const home = hexToPixel({ q: token.q, r: token.r }, map.grid);
  const pos = dragPos ?? home;
  const radius = map.grid.hexSize * 0.72 * token.size;
  const shape = token.shape ?? 'circle';
  const ringColor = targetEffect === 'heal' ? '#7ed28a' : '#d26c6c';

  function onPointerDown(e: React.PointerEvent<SVGGElement>) {
    if (targetState !== 'off') {
      e.stopPropagation();
      if (targetState === 'valid' && e.button === 0) useGameStore.getState().resolveTarget(token.id);
      return;
    }
    if (tool !== 'select') return;
    if (e.button === 2) return;
    e.stopPropagation();
    useGameStore.getState().selectToken(token.id, e.shiftKey);
    useGameStore.getState().openInspector(null);
    if (!movable || e.button !== 0) return;
    dragOrigin.current = stage.toMap(e.clientX, e.clientY);
    try {
      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    } catch {}
  }

  function onPointerMove(e: React.PointerEvent<SVGGElement>) {
    if (!movable || !(e.currentTarget as SVGGElement).hasPointerCapture(e.pointerId) || !dragOrigin.current) return;
    const p = stage.toMap(e.clientX, e.clientY);
    const dx = p.x - dragOrigin.current.x;
    const dy = p.y - dragOrigin.current.y;
    setDragPos({ x: home.x + dx, y: home.y + dy });
    const now = Date.now();
    if (now - lastSent.current > DRAG_THROTTLE_MS) {
      lastSent.current = now;
      const s = useGameStore.getState();
      if (s.selectedTokenIds.length > 1 && s.selectedTokenIds.includes(token.id)) {
        for (const id of s.selectedTokenIds) {
          const t = s.tokens[id];
          if (!t) continue;
          const th = hexToPixel({ q: t.q, r: t.r }, map.grid);
          intents.dragToken(id, th.x + dx, th.y + dy);
        }
      } else {
        intents.dragToken(token.id, home.x + dx, home.y + dy);
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGGElement>) {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    if (!movable || !dragPos || !origin) {
      setDragPos(null);
      return;
    }
    (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
    const dx = dragPos.x - home.x;
    const dy = dragPos.y - home.y;
    setDragPos(null);

    const s = useGameStore.getState();
    const isMulti = s.selectedTokenIds.length > 1 && s.selectedTokenIds.includes(token.id);

    // Check if pointer released over a map node in the World panel (cross-panel drop)
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const mapNode = el?.closest('[data-map-id]') as HTMLElement | null;
    if (isMulti && mapNode) {
      const targetMapId = mapNode.dataset.mapId!;
      for (const id of s.selectedTokenIds) {
        const t = s.tokens[id];
        if (!t?.characterId) continue;
        intents.dropCharacterOnMap(t.characterId, targetMapId, 0, 0);
      }
      for (const id of s.selectedTokenIds) intents.dragToken(id, 0, 0, true);
      return;
    }

    if (isMulti) {
      for (const id of s.selectedTokenIds) {
        const t = s.tokens[id];
        if (!t) continue;
        const th = hexToPixel({ q: t.q, r: t.r }, map.grid);
        intents.dragToken(id, th.x + dx, th.y + dy, true);
        const hex = pixelToHex({ x: th.x + dx, y: th.y + dy }, map.grid);
        if (hex.q !== t.q || hex.r !== t.r) intents.moveToken(id, hex.q, hex.r);
      }
    } else {
      intents.dragToken(token.id, dragPos.x, dragPos.y, true);
      const hex = pixelToHex(dragPos, map.grid);
      if (hex.q !== token.q || hex.r !== token.r) intents.moveToken(token.id, hex.q, hex.r);
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
    e.preventDefault();
    e.stopPropagation();
    if (isDm) {
      useGameStore.getState().selectToken(token.id, e.shiftKey);
      useGameStore.getState().openInspector(token.id);
    } else if (token.characterId) {
      const shops = useGameStore.getState().shopList;
      const linkedShop = shops.find((s) => s.linkedCharacterId === token.characterId);
      if (linkedShop) {
        useGameStore.setState({ presentedShopId: linkedShop.id });
      }
    }
  }

  const bar = token.bar;
  const hpFrac = bar && bar.maxHp > 0 ? Math.max(0, Math.min(1, bar.hp / bar.maxHp)) : null;
  // Beefier creatures get a visibly wider HP bar: the base width (2×radius,
  // same as always) covers up to 20 max HP, scaling linearly to 3× that width
  // at 100+ max HP — so a bandit's sliver and a giant's slab read differently
  // at a glance.
  const barScale = bar && bar.maxHp > 20 ? Math.min(3, 1 + (2 * (bar.maxHp - 20)) / 80) : 1;
  const barW = radius * 2 * barScale;
  // Condition badges (from the linked character we're allowed to see).
  const conditionIcons = character
    ? conditionsOf(character.sheet).map((id) => getCondition(id)?.icon).filter(Boolean) as string[]
    : [];
  if (character && typeof character.sheet.concentration === 'string' && character.sheet.concentration) {
    conditionIcons.push('🌀');
  }

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
      {you?.role === 'dm' && token.light && (token.light.bright > 0 || token.light.dim > 0) && (
        <>
          <circle r={token.light.dim * map.grid.hexSize * Math.sqrt(3)} fill="rgba(255,220,130,0.05)" stroke="#e8d27b" strokeWidth={1} strokeDasharray="8 6" pointerEvents="none" />
          <circle r={token.light.bright * map.grid.hexSize * Math.sqrt(3)} fill="rgba(255,220,130,0.08)" stroke="#e8d27b" strokeWidth={1} pointerEvents="none" />
        </>
      )}
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
        <g transform={`translate(${-barW / 2}, ${radius + 4})`}>
          <rect width={barW} height={5} rx={2} fill="#10131a" />
          <rect
            width={barW * hpFrac}
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
});

const DragGhost = memo(function DragGhost({ tokenId, x, y }: { tokenId: string; x: number; y: number }) {
  const map = useGameStore((s) => s.map)!;
  const token = useGameStore((s) => s.tokens[tokenId]);
  if (!token) return null;
  const radius = map.grid.hexSize * 0.72 * token.size;
  return (
    <circle cx={x} cy={y} r={radius} fill={token.color} opacity={0.45} pointerEvents="none" />
  );
});

export function TokenLayer() {
  const map = useGameStore((s) => s.map)!;
  const tokens = useGameStore((s) => s.tokens);
  const dragGhosts = useGameStore((s) => s.dragGhosts);
  const targeting = useGameStore((s) => s.targeting);
  const aoeTargeting = useGameStore((s) => s.aoeTargeting);
  const { width, height } = mapPixelSize(map);

  // In targeting mode, resolve which tokens are valid targets (in range, and
  // not the attacker itself for a damaging action).
  const src = targeting ? tokens[targeting.sourceTokenId] : undefined;
  const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
  const rangeHexes = targeting
    ? (targeting.action.rangeFt <= 0 ? 0 : Math.max(1, Math.ceil(targeting.action.rangeFt / feetPerHex)))
    : 0;

  // While aiming an AoE spell, highlight exactly the tokens the shape covers
  // right now — the same hit-test the server re-runs authoritatively on cast.
  const aoeHitIds = useMemo(() => {
    const aoe = aoeTargeting?.action.aoe;
    if (!aoe) return null;
    const pxPerFt = pxPerFoot(map.grid);
    const geo = { originPx: hexToPixel(aoeTargeting!.originHex, map.grid), aimPx: hexToPixel(aoeTargeting!.aimHex, map.grid) };
    const hit = new Set<string>();
    for (const t of Object.values(tokens)) {
      if (pointInAoe(hexToPixel({ q: t.q, r: t.r }, map.grid), aoe, geo, pxPerFt)) hit.add(t.id);
    }
    return hit;
  }, [aoeTargeting, tokens, map.grid]);

  function stateFor(t: TokenView): TargetState {
    if (aoeTargeting) return aoeHitIds?.has(t.id) ? 'valid' : 'invalid';
    if (!targeting || !src) return 'off';
    const reach = rangeHexes + (t.size >= 3 ? 1 : 0);
    const inRange = hexDistance({ q: src.q, r: src.r }, { q: t.q, r: t.r }) <= reach;
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
