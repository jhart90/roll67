import type { ReactNode } from 'react';
import type { AoeShape, Hex, Point } from 'shared';
import { hexToPixel, pixelToHex } from 'shared';
import { useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

const MY_COLOR = '#d26c6c';

/** The shape's outline, in map-pixel space — mirrors shared/src/hex/aoe.ts's hit-test geometry exactly. */
function shapeNode(shape: AoeShape, originPx: Point, aimPx: Point, sizePx: number, widthPx: number, color: string): ReactNode {
  const fill = `${color}33`;
  if (shape === 'sphere' || shape === 'cylinder') {
    return <circle cx={aimPx.x} cy={aimPx.y} r={sizePx} fill={fill} stroke={color} strokeWidth={2.5} />;
  }
  const dirX = aimPx.x - originPx.x;
  const dirY = aimPx.y - originPx.y;
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;

  if (shape === 'cone') {
    const half = Math.PI / 6; // matches CONE_HALF_ANGLE in hex/aoe.ts
    const cos = Math.cos(half);
    const sin = Math.sin(half);
    const left = { x: originPx.x + sizePx * (ux * cos - uy * sin), y: originPx.y + sizePx * (ux * sin + uy * cos) };
    const right = { x: originPx.x + sizePx * (ux * cos + uy * sin), y: originPx.y + sizePx * (-ux * sin + uy * cos) };
    return <polygon points={`${originPx.x},${originPx.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={fill} stroke={color} strokeWidth={2.5} />;
  }

  // line and cube: a rectangle from the origin toward the aim direction.
  const perpX = -uy;
  const perpY = ux;
  const halfW = (shape === 'cube' ? sizePx : widthPx) / 2;
  const p1 = { x: originPx.x + perpX * halfW, y: originPx.y + perpY * halfW };
  const p2 = { x: originPx.x - perpX * halfW, y: originPx.y - perpY * halfW };
  const p3 = { x: p2.x + ux * sizePx, y: p2.y + uy * sizePx };
  const p4 = { x: p1.x + ux * sizePx, y: p1.y + uy * sizePx };
  return <polygon points={`${p1.x},${p1.y} ${p4.x},${p4.y} ${p3.x},${p3.y} ${p2.x},${p2.y}`} fill={fill} stroke={color} strokeWidth={2.5} />;
}

/**
 * AoE spell template placement: the caster aims a shape with the mouse (live
 * — everyone else sees it too, via aoePreviews), then clicks anywhere on the
 * map to lock it in. TokenLayer separately highlights which tokens the shape
 * currently covers using the same shared/src/hex/aoe.ts hit-test.
 */
export function AoeTemplateLayer() {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const you = useGameStore((s) => s.you);
  const mine = useGameStore((s) => s.aoeTargeting);
  const others = useGameStore((s) => s.aoePreviews);
  const { width, height } = mapPixelSize(map);
  const grid = map.grid;
  const feetPerHex = grid.feetPerHex > 0 ? grid.feetPerHex : 5;
  const pxPerFt = (grid.hexSize * Math.sqrt(3)) / feetPerHex;

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!mine) return;
    const hex = pixelToHex(stage.toMap(e.clientX, e.clientY), grid);
    useGameStore.getState().updateAoeAim(hex);
  }

  function onPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (!mine || e.button !== 0) return;
    e.stopPropagation();
    useGameStore.getState().confirmAoeTargeting();
  }

  const templates: Array<{ key: string; shape: AoeShape; sizeFt: number; widthFt?: number; originHex: Hex; aimHex: Hex; color: string; byName: string }> = [];
  if (mine?.action.aoe) {
    templates.push({
      key: 'mine', shape: mine.action.aoe.shape, sizeFt: mine.action.aoe.sizeFt, widthFt: mine.action.aoe.widthFt,
      originHex: mine.originHex, aimHex: mine.aimHex, color: MY_COLOR, byName: 'you',
    });
  }
  for (const [userId, p] of Object.entries(others)) {
    if (userId === you?.userId) continue;
    templates.push({ key: userId, shape: p.shape, sizeFt: p.sizeFt, widthFt: p.widthFt, originHex: p.originHex, aimHex: p.aimHex, color: p.color, byName: p.byName });
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {mine && (
        <rect
          x={0} y={0} width={width} height={height}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
        />
      )}

      {templates.map((t) => {
        const originPx = hexToPixel(t.originHex, grid);
        const aimPx = hexToPixel(t.aimHex, grid);
        const sizePx = t.sizeFt * pxPerFt;
        const widthPx = (t.widthFt ?? 5) * pxPerFt;
        return (
          <g key={t.key} pointerEvents="none">
            {shapeNode(t.shape, originPx, aimPx, sizePx, widthPx, t.color)}
            <text
              x={aimPx.x} y={aimPx.y - grid.hexSize * 0.6}
              textAnchor="middle" fontSize={9} fontWeight={600}
              fill={t.color} stroke="#10131a" strokeWidth={2} paintOrder="stroke"
            >
              {t.byName} · {t.shape} {t.sizeFt}ft{t.key === 'mine' ? ' · click to cast' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
