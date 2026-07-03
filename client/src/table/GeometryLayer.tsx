import { useEffect, useState } from 'react';
import type { Point } from 'shared';
import { hexCorners, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

/** Distance from point to segment, for erase hit-testing. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Walls, doors, and lights: rendering + the DM's editing tools.
 * DM sees everything (from dmGeometry); players see only knownDoors.
 */
export function GeometryLayer() {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const isDm = useGameStore((s) => s.isDm());
  const dmGeometry = useGameStore((s) => s.dmGeometry);
  const knownDoors = useGameStore((s) => s.knownDoors);
  const tool = useGameStore((s) => s.tool);
  const selectedLightId = useGameStore((s) => s.selectedLightId);
  const drawingList = useGameStore((s) => s.drawingList);

  // In-progress wall polyline / door first point.
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);

  const { width, height } = mapPixelSize(map);
  const grid = map.grid;
  const editing = isDm && (tool === 'wall' || tool === 'door' || tool === 'light' || tool === 'erase');

  const walls = isDm ? dmGeometry?.walls ?? [] : [];
  const doors = isDm ? dmGeometry?.doors ?? [] : knownDoors;
  const lights = isDm ? dmGeometry?.lights ?? [] : [];
  const wallType = useGameStore((s) => s.wallType);
  const wallFlip = useGameStore((s) => s.wallFlip);

  const WALL_STROKE: Record<string, string> = { solid: '#d26c6c', window: '#6cd2c8', oneway: '#e8a54b' };

  // Cancel drafts when the tool changes.
  useEffect(() => {
    setDraft([]);
    setCursor(null);
  }, [tool, map.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDraft([]);
      if (e.key === 'Enter' && tool === 'wall' && draft.length >= 2) {
        intents.upsertWall(map.id, { points: draft, type: wallType, flip: wallFlip });
        setDraft([]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, draft, map.id]);

  function snap(p: Point, shift: boolean): Point {
    if (!shift) return p;
    const hex = pixelToHex(p, grid);
    let best = p;
    let bestD = Infinity;
    for (const c of hexCorners(hex, grid)) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function onOverlayPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const raw = stage.toMap(e.clientX, e.clientY);
    const p = snap(raw, e.shiftKey);

    if (tool === 'wall') {
      // Single-click one-way walls are 2-point; keep polyline for solid/window.
      setDraft((d) => [...d, p]);
    } else if (tool === 'door') {
      if (draft.length === 0) setDraft([p]);
      else {
        intents.upsertDoor(map.id, { a: draft[0], b: p, open: false });
        setDraft([]);
      }
    } else if (tool === 'light') {
      intents.upsertLight(map.id, { x: raw.x, y: raw.y, brightRadius: 4, dimRadius: 8 });
    } else if (tool === 'erase') {
      const threshold = 12;
      for (const w of walls) {
        for (let i = 0; i + 1 < w.points.length; i++) {
          if (distToSegment(raw, w.points[i], w.points[i + 1]) < threshold) {
            intents.deleteWall(map.id, w.id);
            return;
          }
        }
      }
      for (const d of doors) {
        if (distToSegment(raw, d.a, d.b) < threshold) {
          intents.deleteDoor(map.id, d.id);
          return;
        }
      }
      for (const l of lights) {
        if (Math.hypot(l.x - raw.x, l.y - raw.y) < threshold + 6) {
          intents.deleteLight(map.id, l.id);
          return;
        }
      }
      // Drawings render below this layer, so hit-test them here too.
      for (const dr of drawingList) {
        const pts = dr.shape.kind === 'line' ? [dr.shape.a, dr.shape.b] : dr.shape.points;
        for (let i = 0; i + 1 < pts.length; i++) {
          if (distToSegment(raw, pts[i], pts[i + 1]) < threshold) {
            intents.eraseDrawing(dr.id);
            return;
          }
        }
      }
    }
  }

  function onOverlayDoubleClick(e: React.MouseEvent<SVGRectElement>) {
    if (tool === 'wall' && draft.length >= 2) {
      e.stopPropagation();
      intents.upsertWall(map.id, { points: draft, type: wallType, flip: wallFlip });
      setDraft([]);
    }
  }

  function onOverlayPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (tool === 'wall' || tool === 'door') {
      setCursor(snap(stage.toMap(e.clientX, e.clientY), e.shiftKey));
    }
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {/* click-capture overlay while editing (below interactive elements) */}
      {editing && (
        <rect
          x={0} y={0} width={width} height={height}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
          onPointerDown={onOverlayPointerDown}
          onPointerMove={onOverlayPointerMove}
          onDoubleClick={onOverlayDoubleClick}
        />
      )}

      {/* lights (DM only) */}
      {lights.map((l) => {
        const hexPx = grid.hexSize * Math.sqrt(3);
        const selected = l.id === selectedLightId;
        return (
          <g key={l.id}>
            {selected && (
              <>
                <circle cx={l.x} cy={l.y} r={l.brightRadius * hexPx} fill="rgba(255, 220, 130, 0.10)" stroke="#e8d27b" strokeWidth={1.5} />
                <circle cx={l.x} cy={l.y} r={l.dimRadius * hexPx} fill="none" stroke="#e8d27b" strokeWidth={1} strokeDasharray="8 6" />
              </>
            )}
            <circle
              cx={l.x}
              cy={l.y}
              r={10}
              fill="#e8d27b"
              stroke="#10131a"
              strokeWidth={2}
              style={{ pointerEvents: isDm && tool === 'light' ? 'auto' : 'none', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                useGameStore.getState().selectLight(selected ? null : l.id);
              }}
            />
            <text x={l.x} y={l.y + 4} textAnchor="middle" fontSize={12} pointerEvents="none">💡</text>
          </g>
        );
      })}

      {/* walls (DM only) — colored + dashed by type */}
      {walls.map((w) => {
        const type = w.type ?? 'solid';
        return (
          <polyline
            key={w.id}
            points={w.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={WALL_STROKE[type]}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={type === 'window' ? '2 8' : type === 'oneway' ? '12 6' : undefined}
            opacity={0.9}
          />
        );
      })}

      {/* doors (DM: all; players: known) */}
      {doors.map((d) => {
        const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
        return (
          <g key={d.id}>
            <line
              x1={d.a.x} y1={d.a.y} x2={d.b.x} y2={d.b.y}
              stroke={d.open ? '#7ed28a' : '#c98d4b'}
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={d.open ? '4 8' : undefined}
            />
            <circle
              cx={mid.x} cy={mid.y} r={9}
              fill={d.open ? '#7ed28a' : '#c98d4b'}
              stroke="#10131a"
              strokeWidth={2}
              style={{ pointerEvents: tool === 'select' ? 'auto' : 'none', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                intents.toggleDoor(map.id, d.id);
              }}
            >
              <title>{d.open ? 'Close door' : 'Open door'}</title>
            </circle>
          </g>
        );
      })}

      {/* draft wall / door preview */}
      {draft.length > 0 && (
        <>
          <polyline
            points={[...draft, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#e8d27b"
            strokeWidth={3}
            strokeDasharray="6 4"
          />
          {draft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={5} fill="#e8d27b" />
          ))}
        </>
      )}

    </svg>
  );
}
