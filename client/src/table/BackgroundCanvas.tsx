import { useEffect, useRef } from 'react';
import type { MapView } from 'shared';
import { hexCorners } from 'shared';
import { mapPixelSize } from '../util/stage';

/** Canvas layer: background image + hex grid lines. Redrawn only when the
 * map, its grid config, or the image change — never during pan/zoom. */
export function BackgroundCanvas({ map }: { map: MapView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = mapPixelSize(map);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    function drawGrid() {
      if (!ctx) return;
      const g = map.grid;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const q = col - (row - (row & 1)) / 2;
          const corners = hexCorners({ q, r: row }, g);
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
          ctx.closePath();
        }
      }
      ctx.stroke();
    }

    function paint(img: HTMLImageElement | null) {
      if (cancelled || !ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#1a1d24';
      ctx.fillRect(0, 0, width, height);
      if (img) ctx.drawImage(img, 0, 0, width, height);
      if (map.grid.gridEnabled) drawGrid();
    }

    if (map.bgUrl) {
      const img = new Image();
      img.onload = () => paint(img);
      img.onerror = () => paint(null);
      img.src = map.bgUrl;
    } else {
      paint(null);
    }

    return () => { cancelled = true; };
  }, [map.bgUrl, map.grid, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0 }}
    />
  );
}
