import { useRef, useState, useCallback } from 'react';
import { hexCorners, hexDistance, hexToPixel, packHex, pixelToHex, unpackHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

export function TerrainPainter() {
  const map = useGameStore((s) => s.map)!;
  const tool = useGameStore((s) => s.tool);
  const brush = useGameStore((s) => s.terrainBrush);
  const erasing = useGameStore((s) => s.terrainErase);
  const stage = useStage();
  const { width, height } = mapPixelSize(map);

  const painting = useRef(false);
  const startHex = useRef<{ q: number; r: number } | null>(null);
  const [draft, setDraft] = useState<Set<number> | null>(null);
  const [preview, setPreview] = useState<number[] | null>(null);

  const commit = useCallback((hexKeys: Set<number>) => {
    const existing = new Set(map.terrain ?? []);
    if (erasing) {
      for (const k of hexKeys) existing.delete(k);
    } else {
      for (const k of hexKeys) existing.add(k);
    }
    intents.setTerrain(map.id, [...existing]);
  }, [map.id, map.terrain, erasing]);

  if (tool !== 'terrain') return null;

  function onPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = stage.toMap(e.clientX, e.clientY);
    const hex = pixelToHex(p, map.grid);
    painting.current = true;
    startHex.current = hex;

    if (brush === 'brush') {
      const key = packHex(hex);
      const d = new Set<number>([key]);
      setDraft(d);
      try { (e.target as SVGRectElement).setPointerCapture(e.pointerId); } catch {}
    } else {
      try { (e.target as SVGRectElement).setPointerCapture(e.pointerId); } catch {}
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!painting.current || !startHex.current) return;
    const p = stage.toMap(e.clientX, e.clientY);
    const hex = pixelToHex(p, map.grid);

    if (brush === 'brush') {
      setDraft((prev) => {
        const next = new Set(prev);
        next.add(packHex(hex));
        return next;
      });
    } else if (brush === 'rect') {
      const sh = startHex.current;
      const sp = hexToPixel(sh, map.grid);
      const ep = hexToPixel(hex, map.grid);
      const minX = Math.min(sp.x, ep.x);
      const maxX = Math.max(sp.x, ep.x);
      const minY = Math.min(sp.y, ep.y);
      const maxY = Math.max(sp.y, ep.y);
      const keys: number[] = [];
      const g = map.grid;
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const q = col - (row - (row & 1)) / 2;
          const c = hexToPixel({ q, r: row }, g);
          if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) {
            keys.push(packHex({ q, r: row }));
          }
        }
      }
      setPreview(keys);
    } else if (brush === 'circle') {
      const sh = startHex.current;
      const radius = hexDistance(sh, hex);
      const keys: number[] = [];
      const g = map.grid;
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const q = col - (row - (row & 1)) / 2;
          if (hexDistance(sh, { q, r: row }) <= radius) {
            keys.push(packHex({ q, r: row }));
          }
        }
      }
      setPreview(keys);
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGRectElement>) {
    if (!painting.current) return;
    painting.current = false;
    try { (e.target as SVGRectElement).releasePointerCapture(e.pointerId); } catch {}

    if (brush === 'brush' && draft) {
      commit(draft);
      setDraft(null);
    } else if ((brush === 'rect' || brush === 'circle') && preview) {
      commit(new Set(preview));
      setPreview(null);
    }
    startHex.current = null;
  }

  // Render draft/preview hexes as SVG paths for immediate visual feedback
  const draftKeys = brush === 'brush' ? draft : preview ? new Set(preview) : null;
  const existingSet = new Set(map.terrain ?? []);

  return (
    <svg
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      {/* Draft preview hexes */}
      {draftKeys && Array.from(draftKeys).map((key) => {
        const hex = unpackHex(key);
        const corners = hexCorners(hex, map.grid);
        const d = 'M' + corners.map((c) => `${c.x},${c.y}`).join('L') + 'Z';
        const alreadyExists = existingSet.has(key);
        if (erasing && !alreadyExists) return null;
        if (!erasing && alreadyExists) return null;
        return (
          <path
            key={key}
            d={d}
            fill={erasing ? 'rgba(210, 108, 108, 0.35)' : 'rgba(139, 90, 43, 0.35)'}
            stroke={erasing ? 'rgba(210, 108, 108, 0.6)' : 'rgba(139, 90, 43, 0.6)'}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        );
      })}
      {/* Invisible overlay to capture pointer events */}
      <rect
        x={0} y={0} width={width} height={height}
        fill="transparent"
        style={{ cursor: erasing ? 'not-allowed' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </svg>
  );
}
