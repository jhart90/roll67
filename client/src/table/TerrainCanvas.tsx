import { useEffect, useRef } from 'react';
import type { GridConfig } from 'shared';
import { hexCorners, unpackHex } from 'shared';
import { mapPixelSize } from '../util/stage';
import { useGameStore } from '../store/game';

export function TerrainCanvas({ grid }: { grid: GridConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useGameStore((s) => s.map)!;
  const terrain = map.terrain;
  const { width, height } = mapPixelSize(map);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!terrain || terrain.length === 0) return;

    ctx.fillStyle = 'rgba(139, 90, 43, 0.28)';
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const packed of terrain) {
      const hex = unpackHex(packed);
      const corners = hexCorners(hex, grid);
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    // Hatch pattern for rough terrain visual
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.25)';
    ctx.lineWidth = 1;
    const step = 8;
    for (let x = -height; x < width + height; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height, height);
      ctx.stroke();
    }
    ctx.restore();
  }, [terrain, grid, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
