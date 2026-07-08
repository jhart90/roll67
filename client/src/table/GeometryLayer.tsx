import { memo, useEffect, useState } from 'react';
import type { Door, Light, Point, Wall } from 'shared';
import { hexCorners, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

const WALL_STROKE: Record<string, string> = { solid: '#d26c6c', window: '#6cd2c8', oneway: '#e8a54b' };

/** A light marker: selectable, draggable, and right-clickable (DM), in both the
 *  light tool and the normal select cursor. */
const LightPiece = memo(function LightPiece({ light, selected, interactive, hexPx, mapId }: {
  light: Light; selected: boolean; interactive: boolean; hexPx: number; mapId: string;
}) {
  const stage = useStage();
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const pos = dragPos ?? { x: light.x, y: light.y };

  function onDown(e: React.PointerEvent<SVGCircleElement>) {
    if (e.button !== 0) return; // right-click handled by onContextMenu
    e.stopPropagation();
    useGameStore.getState().selectLight(light.id);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function onMove(e: React.PointerEvent<SVGCircleElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setDragPos(stage.toMap(e.clientX, e.clientY));
  }
  function onUp(e: React.PointerEvent<SVGCircleElement>) {
    if (!dragPos) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    intents.upsertLight(mapId, { ...light, x: dragPos.x, y: dragPos.y });
    setDragPos(null);
  }
  function onContext(e: React.MouseEvent<SVGCircleElement>) {
    e.preventDefault();
    e.stopPropagation();
    useGameStore.getState().selectLight(light.id);
  }

  return (
    <g>
      {selected && (
        <>
          <circle cx={pos.x} cy={pos.y} r={light.brightRadius * hexPx} fill="rgba(255, 220, 130, 0.10)" stroke="#e8d27b" strokeWidth={1.5} pointerEvents="none" />
          <circle cx={pos.x} cy={pos.y} r={light.dimRadius * hexPx} fill="none" stroke="#e8d27b" strokeWidth={1} strokeDasharray="8 6" pointerEvents="none" />
        </>
      )}
      <circle
        cx={pos.x} cy={pos.y} r={10}
        fill="#e8d27b" stroke={selected ? '#fff' : '#10131a'} strokeWidth={2}
        style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'move' : 'default' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onContextMenu={onContext}
      />
      <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize={12} pointerEvents="none">💡</text>
    </g>
  );
});

/** One wall polyline, colored + dashed by type. Memoized so an unrelated
 *  geometry change (a different wall, a door toggle, a light drag) doesn't
 *  force every other wall to re-render. A wide invisible polyline sits on top
 *  to give the DM's select cursor a comfortable hit target (the visible
 *  stroke alone would be razor-thin to click); left-click selects it, opening
 *  WallInspector so its type/flip can be edited without redrawing it. */
const WallPiece = memo(function WallPiece({ wall, selected, interactive }: { wall: Wall; selected: boolean; interactive: boolean }) {
  const type = wall.type ?? 'solid';
  const pts = wall.points.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <g>
      {selected && (
        <polyline points={pts} fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} pointerEvents="none" />
      )}
      <polyline
        points={pts}
        fill="none"
        stroke={WALL_STROKE[type]}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={type === 'window' ? '2 8' : type === 'oneway' ? '12 6' : undefined}
        opacity={0.9}
        pointerEvents="none"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'pointer' : 'default' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          useGameStore.getState().selectWall(wall.id);
        }}
      />
    </g>
  );
});

/** One door marker + toggle hotspot. Memoized per finding above; only
 *  re-renders when this specific door, the map, or the active tool changes.
 *  Left-click keeps its existing open/close behavior (players rely on this
 *  during play); right-click (DM only) selects it for DoorInspector instead,
 *  so toggling and editing don't compete for the same click. */
const DoorPiece = memo(function DoorPiece({ door, mapId, tool, selected, isDm }: {
  door: Door; mapId: string; tool: string; selected: boolean; isDm: boolean;
}) {
  const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
  const isGate = door.type === 'gate';
  // Gates get a blue palette (always see-through) instead of the normal
  // door's green/orange (blocks sight too, when closed).
  const color = isGate ? (door.open ? '#8ad2e8' : '#4b8fc9') : (door.open ? '#7ed28a' : '#c98d4b');
  return (
    <g>
      {selected && <circle cx={mid.x} cy={mid.y} r={15} fill="none" stroke="#fff" strokeWidth={2.5} opacity={0.7} pointerEvents="none" />}
      <line
        x1={door.a.x} y1={door.a.y} x2={door.b.x} y2={door.b.y}
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={door.open ? '4 8' : undefined}
      />
      {door.locked && (
        <text x={mid.x} y={mid.y - 12} textAnchor="middle" fontSize={12} pointerEvents="none">🔒</text>
      )}
      <circle
        cx={mid.x} cy={mid.y} r={9}
        fill={color}
        stroke="#10131a"
        strokeWidth={2}
        style={{ pointerEvents: tool === 'select' ? 'auto' : 'none', cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          intents.toggleDoor(mapId, door.id);
        }}
        onContextMenu={(e) => {
          if (!isDm) return;
          e.preventDefault();
          e.stopPropagation();
          useGameStore.getState().selectDoor(door.id);
        }}
      >
        <title>{`${door.open ? 'Close' : 'Open'}${isGate ? ' gate (always see-through)' : ' door'}${isDm ? ' · right-click to edit' : ''}`}</title>
      </circle>
    </g>
  );
});

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
  const selectedWallId = useGameStore((s) => s.selectedWallId);
  const selectedDoorId = useGameStore((s) => s.selectedDoorId);
  const drawingList = useGameStore((s) => s.drawingList);
  const cameraScale = useGameStore((s) => s.camera.scale);

  // In-progress wall polyline / door first point.
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);

  const { width, height } = mapPixelSize(map);
  const grid = map.grid;
  const editing = isDm && (tool === 'wall' || tool === 'door' || tool === 'light' || tool === 'erase' || tool === 'spawn');

  const walls = isDm ? dmGeometry?.walls ?? [] : [];
  const doors = isDm ? dmGeometry?.doors ?? [] : knownDoors;
  const lights = isDm ? dmGeometry?.lights ?? [] : [];
  const wallType = useGameStore((s) => s.wallType);
  const wallFlip = useGameStore((s) => s.wallFlip);
  const doorType = useGameStore((s) => s.doorType);

  const DOOR_STROKE: Record<string, string> = { door: '#c98d4b', gate: '#4b8fc9' };

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

  // How close a new wall/door point must land to an existing vertex before it
  // snaps there instead of sitting just beside it -- otherwise a hairline
  // crack between two segments meant to meet (a corner, a door frame) would
  // let sight/light straight through it. The tolerance is defined in screen
  // pixels and converted to map-space using the current zoom, so it's
  // equally easy to hit whether zoomed in or out -- a fixed map-pixel radius
  // would feel razor-thin when zoomed in and comically loose when zoomed out.
  const ENDPOINT_SNAP_SCREEN_PX = 28;
  const ENDPOINT_SNAP_DIST = ENDPOINT_SNAP_SCREEN_PX / cameraScale;
  // A segment-interior snap (below) only kicks in this far past either of
  // its own endpoints, so it never competes with the vertex snap right at a
  // corner -- vertex snap always owns that zone.
  const SEGMENT_SNAP_VERTEX_BUFFER = ENDPOINT_SNAP_DIST;

  /** The point on segment a-b closest to p, plus how far along the segment
   *  (in map units) that landed from each end -- lets callers exclude the
   *  zone right next to either endpoint. */
  function closestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; distFromA: number; distFromB: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { point: a, distFromA: 0, distFromB: 0 };
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    return { point: { x: a.x + t * dx, y: a.y + t * dy }, distFromA: t * len, distFromB: (1 - t) * len };
  }

  /** Where a new wall/door point should snap: onto any vertex of an existing
   *  wall/door, onto a vertex already placed earlier in the polyline
   *  currently being drawn (so a closing point can land exactly back on an
   *  earlier point of the same segment), or -- a buffer clear of any
   *  vertex -- onto the interior of an existing straight run, which is what
   *  lets a new wall's point land exactly on an existing wall/door's line to
   *  form a T junction instead of stopping just short of it. */
  function nearbySnapPoint(p: Point, existingWalls: Wall[], existingDoors: Door[], draftPoints: Point[]): Point | null {
    let best: Point | null = null;
    let bestD = ENDPOINT_SNAP_DIST;
    const consider = (q: Point) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) { bestD = d; best = q; }
    };
    for (const w of existingWalls) {
      for (const pt of w.points) consider(pt);
    }
    for (const d of existingDoors) {
      consider(d.a);
      consider(d.b);
    }
    for (const pt of draftPoints) consider(pt);

    const considerSegment = (a: Point, b: Point) => {
      const { point: q, distFromA, distFromB } = closestPointOnSegment(p, a, b);
      if (distFromA < SEGMENT_SNAP_VERTEX_BUFFER || distFromB < SEGMENT_SNAP_VERTEX_BUFFER) return;
      consider(q);
    };
    for (const w of existingWalls) {
      for (let i = 0; i + 1 < w.points.length; i++) considerSegment(w.points[i], w.points[i + 1]);
    }
    for (const d of existingDoors) considerSegment(d.a, d.b);
    for (let i = 0; i + 1 < draftPoints.length; i++) considerSegment(draftPoints[i], draftPoints[i + 1]);

    return best;
  }

  function snap(p: Point, shift: boolean): Point {
    // Closing a gap against an existing vertex or line always wins over
    // hex-grid snapping -- the point here is sealing the geometry exactly,
    // not aligning it to the grid.
    const geometrySnap = nearbySnapPoint(p, walls, doors, draft);
    if (geometrySnap) return geometrySnap;
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
        intents.upsertDoor(map.id, { a: draft[0], b: p, open: false, type: doorType });
        setDraft([]);
      }
    } else if (tool === 'light') {
      intents.upsertLight(map.id, { x: raw.x, y: raw.y, brightRadius: 4, dimRadius: 8 });
    } else if (tool === 'spawn') {
      const hex = pixelToHex(raw, grid);
      intents.setSpawn(map.id, hex.q, hex.r);
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

  // Right-click ends the in-progress wall/door, not the tool itself: any
  // completed segments are built, the in-progress segment ending at the
  // cursor is discarded, and the next click starts a fresh wall/door --
  // the wall/door tool stays selected so a DM tracing several separate
  // walls doesn't need to reselect the tool after every one.
  function onOverlayContextMenu(e: React.MouseEvent<SVGRectElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (tool === 'wall' && draft.length >= 2) {
      intents.upsertWall(map.id, { points: draft, type: wallType, flip: wallFlip });
    }
    if (tool === 'wall' || tool === 'door') {
      setDraft([]);
      setCursor(null);
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
          onContextMenu={onOverlayContextMenu}
        />
      )}

      {/* lights (DM only) — interactive in the light tool AND the select cursor */}
      {lights.map((l) => (
        <LightPiece
          key={l.id}
          light={l}
          selected={l.id === selectedLightId}
          interactive={isDm && (tool === 'light' || tool === 'select')}
          hexPx={grid.hexSize * Math.sqrt(3)}
          mapId={map.id}
        />
      ))}

      {/* spawn point (DM only): where new tokens dropped onto this map appear */}
      {isDm && map.spawn && (() => {
        const p = hexToPixel(map.spawn, grid);
        return (
          <g pointerEvents="none">
            <circle cx={p.x} cy={p.y} r={grid.hexSize * 0.55} fill="rgba(126,210,138,0.15)" stroke="#7ed28a" strokeWidth={2} strokeDasharray="5 4" />
            <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize={18}>🎯</text>
          </g>
        );
      })()}

      {/* walls (DM only) — colored + dashed by type */}
      {walls.map((w) => (
        <WallPiece key={w.id} wall={w} selected={w.id === selectedWallId} interactive={isDm && tool === 'select'} />
      ))}

      {/* doors (DM: all; players: known) */}
      {doors.map((d) => (
        <DoorPiece key={d.id} door={d} mapId={map.id} tool={tool} selected={d.id === selectedDoorId} isDm={isDm} />
      ))}

      {/* draft wall / door preview -- colored by the variant about to be
          placed (matches the final render's colors) so it's clear which
          kind you're drawing before you commit it, not just after. */}
      {draft.length > 0 && (() => {
        const draftColor = tool === 'door' ? DOOR_STROKE[doorType] : WALL_STROKE[wallType];
        return (
          <>
            <polyline
              points={[...draft, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={draftColor}
              strokeWidth={3}
              strokeDasharray="6 4"
            />
            {draft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5} fill={draftColor} />
            ))}
          </>
        );
      })()}

    </svg>
  );
}
