import { memo } from 'react';
import type { MapObject } from 'shared';
import { hexDistance, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

const MapObjectPiece = memo(function MapObjectPiece({ obj }: { obj: MapObject }) {
  const map = useGameStore((s) => s.map)!;
  const isDm = useGameStore((s) => s.you?.role === 'dm');

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
    if (isDm) useGameStore.getState().openObjectInspector(obj.id);
  }

  function onPointerDown(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
  }

  return (
    <g
      transform={`translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})`}
      style={{ cursor: 'pointer', pointerEvents: 'all' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      {artUrl ? (
        <image
          href={artUrl}
          x={-r} y={-r} width={r * 2} height={r * 2}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <>
          {obj.kind === 'chest' ? (
            <rect x={-r * 0.7} y={-r * 0.5} width={r * 1.4} height={r} rx={3}
              fill="#8B6914" stroke="#5c4a0e" strokeWidth={1.5} />
          ) : obj.kind === 'shop' ? (
            <rect x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} rx={4}
              fill="#2a6e3f" stroke="#1a4a2a" strokeWidth={1.5} />
          ) : (
            <circle r={r * 0.5} fill="#d4af37" stroke="#8b7722" strokeWidth={1.5} />
          )}
          <text textAnchor="middle" dy="0.35em" fontSize={r * 0.7} fill="white" style={{ pointerEvents: 'none' }}>
            {obj.kind === 'chest' ? '📦' : obj.kind === 'shop' ? '🏪' : '✦'}
          </text>
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
  const objects = Object.values(mapObjects);

  if (!map) return null;

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
