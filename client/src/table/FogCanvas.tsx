import { useEffect, useRef } from 'react';
import type { MapView } from 'shared';
import { hexCorners, unpackHex } from 'shared';
import { mapPixelSize } from '../util/stage';

/**
 * Fog-of-war canvas: unexplored = black, explored-but-not-visible = dimmed,
 * currently visible = clear. Renders nothing in DM god mode (visible null).
 */
export function FogCanvas({
  map, visible, fade, explored,
}: {
  map: MapView;
  visible: Set<number> | null;
  fade: Set<number> | null;
  explored: Set<number> | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = mapPixelSize(map);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (visible === null) return; // god mode

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);

    const punch = (keys: Iterable<number>, alpha: number) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const key of keys) {
        const corners = hexCorners(unpackHex(key), map.grid);
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    // Explored memory is dimmest, the fade rim brighter, current vision clear.
    if (explored) punch(explored, 0.55);
    if (fade && fade.size > 0) punch(fade, 0.75);
    if (visible.size > 0) punch(visible, 1);
  }, [map.grid, visible, fade, explored, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
