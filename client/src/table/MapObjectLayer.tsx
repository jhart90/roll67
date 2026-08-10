import { memo, useRef, useState } from 'react';
import type { MapObject } from 'shared';
import { hexDistance, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';
import { openWindow } from '../store/windowManager';

const MapObjectPiece = memo(function MapObjectPiece({ obj }: { obj: MapObject }) {
  const map = useGameStore((s) => s.map)!;
  const isDm = useGameStore((s) => s.you?.role === 'dm');
  const selected = useGameStore((s) => s.selectedObjectId === obj.id);
  const stage = useStage();
  // DM drag-to-relocate: live pixel position while dragging, committed to a
  // hex on release. A drag suppresses the click-to-open that release fires.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragMoved = useRef(false);

  const pos = hexToPixel({ q: obj.q, r: obj.r }, map.grid);
  const r = map.grid.hexSize * 0.5;
  const artUrl = obj.artAssetId ? `/uploads/${obj.artAssetId}` : null;

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
            <circle r={r * 0.5} fill="#d4af37" stroke="#8b7722" strokeWidth={1.5} />
          ) : obj.kind === 'chest' ? (
            <rect x={-r * 0.7} y={-r * 0.5} width={r * 1.4} height={r} rx={3}
              fill="#8B6914" stroke="#5c4a0e" strokeWidth={1.5} />
          ) : obj.kind === 'shop' ? (
            <rect x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} rx={4}
              fill="#2a6e3f" stroke="#1a4a2a" strokeWidth={1.5} />
          ) : (
            <circle r={r * 0.5} fill="#d4af37" stroke="#8b7722" strokeWidth={1.5} />
          )}
          <text textAnchor="middle" dy="0.35em" fontSize={r * 0.7} fill="white" style={{ pointerEvents: 'none' }}>
            {obj.kind === 'chest' ? (obj.items.length === 1 ? '✦' : '📦') : obj.kind === 'shop' ? '🏪' : '✦'}
          </text>
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
