import { memo, useRef, useState } from 'react';
import type { MapObject } from 'shared';
import { hexDistance, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';
import { openWindow } from '../store/windowManager';
import { FlashHalo } from './FlashHalo';

/**
 * A treasure chest, drawn rather than glyphed. The old piece was a brown
 * rectangle with the 📦 cardboard-carton emoji on it, which read as a parcel
 * in a fantasy dungeon.
 *
 * Built as a domed lid over a banded body: two iron bands down the front, a
 * lock plate with a keyhole, corner braces, and a highlight along the top of
 * the dome so it reads as rounded at token size rather than as a flat shape.
 * All geometry is a fraction of `r`, so it scales with the hex.
 */
function TreasureChest({ r }: { r: number }) {
  const w = r * 1.55;          // full width
  const hx = w / 2;
  const lidTop = -r * 0.72;    // top of the dome
  const seam = -r * 0.08;      // where lid meets body
  const base = r * 0.66;       // bottom of the body
  const wood = '#8a5a2b';
  const woodDark = '#5e3a17';
  const iron = '#4a4f57';
  const ironLit = '#767d88';
  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Body */}
      <path
        d={`M ${-hx} ${seam} L ${hx} ${seam} L ${hx} ${base - r * 0.12} Q ${hx} ${base} ${hx - r * 0.12} ${base} L ${-hx + r * 0.12} ${base} Q ${-hx} ${base} ${-hx} ${base - r * 0.12} Z`}
        fill={wood} stroke={woodDark} strokeWidth={r * 0.07}
      />
      {/* Domed lid */}
      <path
        d={`M ${-hx} ${seam} L ${-hx} ${lidTop + r * 0.34} Q ${-hx} ${lidTop} ${-hx + r * 0.42} ${lidTop} L ${hx - r * 0.42} ${lidTop} Q ${hx} ${lidTop} ${hx} ${lidTop + r * 0.34} L ${hx} ${seam} Z`}
        fill={wood} stroke={woodDark} strokeWidth={r * 0.07}
      />
      {/* Highlight along the crown of the dome — what makes it read as round */}
      <path
        d={`M ${-hx + r * 0.18} ${lidTop + r * 0.3} Q ${0} ${lidTop + r * 0.02} ${hx - r * 0.18} ${lidTop + r * 0.3}`}
        fill="none" stroke="#c68b46" strokeWidth={r * 0.09} opacity={0.45}
      />
      {/* Iron bands, lid and body in one line each side */}
      {[-0.52, 0.52].map((f) => (
        <rect key={f} x={hx * f - r * 0.075} y={lidTop + r * 0.06} width={r * 0.15} height={base - lidTop - r * 0.06}
          fill={iron} opacity={0.9} />
      ))}
      {/* Seam band across the whole front */}
      <rect x={-hx} y={seam - r * 0.09} width={w} height={r * 0.18} fill={iron} />
      <rect x={-hx} y={seam - r * 0.09} width={w} height={r * 0.06} fill={ironLit} opacity={0.55} />
      {/* Lock plate + keyhole */}
      <rect x={-r * 0.19} y={seam - r * 0.13} width={r * 0.38} height={r * 0.44} rx={r * 0.06}
        fill="#e0b23c" stroke="#8a6a12" strokeWidth={r * 0.045} />
      <circle cy={seam + r * 0.05} r={r * 0.07} fill="#3a2c08" />
      <rect x={-r * 0.03} y={seam + r * 0.05} width={r * 0.06} height={r * 0.13} fill="#3a2c08" />
      {/* Corner braces */}
      {[[-hx, base], [hx - r * 0.2, base]].map(([x], i) => (
        <rect key={i} x={i === 0 ? x : x} y={base - r * 0.2} width={r * 0.2} height={r * 0.2}
          fill={iron} opacity={0.85} />
      ))}
    </g>
  );
}

const MapObjectPiece = memo(function MapObjectPiece({ obj }: { obj: MapObject }) {
  const map = useGameStore((s) => s.map)!;
  const isDm = useGameStore((s) => s.you?.role === 'dm');
  const selected = useGameStore((s) => s.selectedObjectId === obj.id);
  const flashing = useGameStore((s) => s.worldHover?.kind === 'object' && s.worldHover.id === obj.id);
  const stage = useStage();
  // DM drag-to-relocate: live pixel position while dragging, committed to a
  // hex on release. A drag suppresses the click-to-open that release fires.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragMoved = useRef(false);

  const pos = hexToPixel({ q: obj.q, r: obj.r }, map.grid);
  const r = map.grid.hexSize * 0.5;
  const artUrl = obj.artUrl ?? null;

  function playerInRange(range: number): boolean {
    if (isDm) return true;
    const s = useGameStore.getState();
    const myChars = new Set(
      Object.values(s.characters).filter((c) => c.ownerUserId === s.you?.userId).map((c) => c.id),
    );
    return Object.values(s.tokens).some(
      (t) => t.characterId && myChars.has(t.characterId) && hexDistance({ q: t.q, r: t.r }, { q: obj.q, r: obj.r }) <= range,
    );
  }

  function onPointerUp(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    // Left-click only: a right-click fires pointerup too, and without this
    // gate it opened the loot popup (and even the chest) on top of the
    // DM's context-menu editor.
    if (e.button !== 0) return;
    // A DM drag ends here: snap to the released hex, and don't ALSO open it.
    if (dragPos) {
      (e.currentTarget as SVGGElement).releasePointerCapture?.(e.pointerId);
      const moved = dragMoved.current;
      const hex = pixelToHex(dragPos, map.grid);
      setDragPos(null);
      dragMoved.current = false;
      if (moved) {
        intents.updateMapObject(obj.id, { q: hex.q, r: hex.r });
        return;
      }
    }
    if (obj.kind === 'shop' && obj.shopId) {
      if (!playerInRange(obj.interactRange)) return;
      useGameStore.setState({ presentedShopId: obj.shopId });
    } else if (obj.kind === 'chest' && obj.worldFolderId) {
      if (!playerInRange(1)) return;
      intents.openChest(obj.id);
      useGameStore.setState({ lootPopupId: obj.id });
    } else {
      if (!playerInRange(1)) return;
      useGameStore.setState({ lootPopupId: obj.id });
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDm) return;
    // Right-clicking a piece on the map opens whatever the world tab opens for
    // that same piece. A shop's real editor — stock, prices, currency, who may
    // buy — is the shop window; the map object only ever carried its name, art
    // and interact range, so the map was the one place a shop could be clicked
    // and NOT edited.
    if (obj.kind === 'shop' && obj.shopId) {
      openWindow('shop', obj.shopId, {}, obj.name || 'Shop');
      return;
    }
    useGameStore.getState().openObjectInspector(obj.id);
  }

  function onPointerDown(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    // Picking it here is the same act as picking its row in the World pane,
    // so it lights up in both places.
    if (e.button === 0) useGameStore.getState().selectObject(obj.id);
    if (!isDm || e.button !== 0) return;
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    dragMoved.current = false;
    setDragPos(stage.toMap(e.clientX, e.clientY));
  }

  function onPointerMove(e: React.PointerEvent<SVGGElement>) {
    if (!dragPos) return;
    const p = stage.toMap(e.clientX, e.clientY);
    if (Math.hypot(p.x - pos.x, p.y - pos.y) > map.grid.hexSize * 0.4) dragMoved.current = true;
    setDragPos(p);
  }

  const at = dragPos && dragMoved.current ? dragPos : pos;
  return (
    <g
      transform={`translate(${at.x.toFixed(1)},${at.y.toFixed(1)})`}
      style={{ cursor: isDm ? 'grab' : 'pointer', pointerEvents: 'all' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      {flashing && <FlashHalo r={r} />}
      {/* The same gold dashed ring a selected token wears — a chest picked in
          the World pane should look picked here in exactly the same way. */}
      {selected && (
        <circle r={r + 4} fill="none" stroke="#e8d27b" strokeWidth={3} strokeDasharray="6 4" style={{ pointerEvents: 'none' }} />
      )}
      {artUrl ? (
        <image
          href={artUrl}
          x={-r} y={-r} width={r * 2} height={r * 2}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <>
          {/* A chest holding exactly one thing IS that thing on the map — a
              sword lying on the flagstones, not a crate you open to find a
              sword. It still behaves as a chest, lock and all. */}
          {obj.kind === 'chest' && obj.items.length === 1 ? (
            <>
              <circle r={r * 0.5} fill="#d4af37" stroke="#8b7722" strokeWidth={1.5} />
              <text textAnchor="middle" dy="0.35em" fontSize={r * 0.7} fill="white" style={{ pointerEvents: 'none' }}>✦</text>
            </>
          ) : obj.kind === 'chest' ? (
            <TreasureChest r={r} />
          ) : obj.kind === 'shop' ? (
            <>
              <rect x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} rx={4}
                fill="#2a6e3f" stroke="#1a4a2a" strokeWidth={1.5} />
              <text textAnchor="middle" dy="0.35em" fontSize={r * 0.7} fill="white" style={{ pointerEvents: 'none' }}>🏪</text>
            </>
          ) : (
            <>
              <circle r={r * 0.5} fill="#d4af37" stroke="#8b7722" strokeWidth={1.5} />
              <text textAnchor="middle" dy="0.35em" fontSize={r * 0.7} fill="white" style={{ pointerEvents: 'none' }}>✦</text>
            </>
          )}
          {obj.locked && (
            <text textAnchor="middle" dy="0.35em" x={r * 0.6} y={-r * 0.6}
              fontSize={r * 0.5} style={{ pointerEvents: 'none' }}>🔒</text>
          )}
        </>
      )}
      <text
        textAnchor="middle"
        y={r + 12}
        fontSize={10}
        fill="white"
        stroke="black"
        strokeWidth={2.5}
        paintOrder="stroke"
        style={{ pointerEvents: 'none', fontWeight: 600 }}
      >
        {obj.name}
      </text>
    </g>
  );
});

export function MapObjectLayer() {
  const mapObjects = useGameStore((s) => s.mapObjects);
  const map = useGameStore((s) => s.map);
  const tool = useGameStore((s) => s.tool);
  const isDm = useGameStore((s) => s.you?.role === 'dm');
  const lootKind = useGameStore((s) => s.lootKind);
  const stage = useStage();

  if (!map) return null;
  // The store holds every map's objects (for the world tree) — render only
  // the ones placed on the map being viewed.
  const objects = Object.values(mapObjects).filter((o) => o.mapId === map.id);

  const { width, height } = mapPixelSize(map);

  function onSvgPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (!isDm || tool !== 'loot' || !map || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = stage.toMap(e.clientX, e.clientY);
    const hex = pixelToHex(p, map.grid);
    const name = lootKind === 'chest' ? 'Chest' : 'Loot';
    intents.placeMapObject(map.id, lootKind, name, hex.q, hex.r);
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {tool === 'loot' && (
        <rect
          x={0} y={0} width={width} height={height}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
          onPointerDown={onSvgPointerDown}
        />
      )}
      {objects.map((obj) => (
        <MapObjectPiece key={obj.id} obj={obj} />
      ))}
    </svg>
  );
}
