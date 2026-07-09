import { memo } from 'react';
import type { MapObject } from 'shared';
import { hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { useStage } from '../util/stage';

const MapObjectPiece = memo(function MapObjectPiece({ obj }: { obj: MapObject }) {
  const map = useGameStore((s) => s.map)!;
  const isDm = useGameStore((s) => s.you?.role === 'dm');

  const pos = hexToPixel({ q: obj.q, r: obj.r }, map.grid);
  const r = map.grid.hexSize * 0.5;
  const artUrl = obj.artAssetId ? `/uploads/${obj.artAssetId}` : null;

  function onPointerUp(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    useGameStore.setState({ lootPopupId: obj.id });
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
          ) : (
            <circle r={r * 0.5} fill="#d4af37" stroke="#8b7722" strokeWidth={1.5} />
          )}
          <text textAnchor="middle" dy="0.35em" fontSize={r * 0.7} fill="white" style={{ pointerEvents: 'none' }}>
            {obj.kind === 'chest' ? '📦' : '✦'}
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

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!isDm || tool !== 'loot' || !map || e.button !== 0) return;
    const p = stage.toMap(e.clientX, e.clientY);
    const hex = pixelToHex(p, map.grid);
    const name = lootKind === 'chest' ? 'Chest' : 'Loot';
    intents.placeMapObject(map.id, lootKind, name, hex.q, hex.r);
  }

  return (
    <svg
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: tool === 'loot' ? 'auto' : 'none', overflow: 'visible' }}
      onPointerUp={onSvgPointerUp}
    >
      {objects.map((obj) => (
        <MapObjectPiece key={obj.id} obj={obj} />
      ))}
    </svg>
  );
}
