import { useEffect, useRef, useState } from 'react';
import type { MapView } from 'shared';
import { hexCorners, packHex } from 'shared';
import { mapPixelSize } from '../util/stage';
import { useGameStore } from '../store/game';

/** Canvas layer: background image + hex grid lines. Redrawn only when the
 * map, its grid config, or the image change — never during pan/zoom. */
export function BackgroundCanvas({ map }: { map: MapView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = mapPixelSize(map);
  // The DM painting terrain needs the whole grid, including over ground they
  // have marked inaccessible — they are aiming a brush at it. Everyone else
  // (players, and the DM's ordinary god-mode view) gets the holed grid.
  const painting = useGameStore((s) => s.tool === 'terrain' && s.isDm());
  const blocked = map.blocked;

  // The background image is loaded once per URL and kept, so a redraw — which
  // now happens every time a hex is painted — repaints from memory instead of
  // re-fetching and flashing the map away between strokes.
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!map.bgUrl) { setImg(null); return; }
    let cancelled = false;
    const next = new Image();
    next.onload = () => { if (!cancelled) setImg(next); };
    next.onerror = () => { if (!cancelled) setImg(null); };
    next.src = map.bgUrl;
    return () => { cancelled = true; };
  }, [map.bgUrl]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function drawGrid() {
      if (!ctx) return;
      const g = map.grid;
      // Hexes marked inaccessible are skipped entirely, which is exactly the
      // rule "hide any edge that only borders inaccessible hexes": an edge
      // with a normal hex on either side is still drawn by THAT hex, so the
      // outline of the region survives while its interior grid disappears.
      // No neighbour math needed — the shared edge does the work.
      const holes = !painting && blocked && blocked.length > 0 ? new Set(blocked) : null;
      ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(g.gridColor ?? '') ? g.gridColor! : '#ffffff';
      ctx.globalAlpha = Math.max(0, Math.min(1, g.gridOpacity ?? 0.16));
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const q = col - (row - (row & 1)) / 2;
          if (holes?.has(packHex({ q, r: row }))) continue;
          const corners = hexCorners({ q, r: row }, g);
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
          ctx.closePath();
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(0, 0, width, height);
    if (img) ctx.drawImage(img, 0, 0, width, height);
    if (map.grid.gridEnabled) drawGrid();
  }, [img, map.grid, blocked, painting, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    />
  );
}
