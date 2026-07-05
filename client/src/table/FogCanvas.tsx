import { useEffect, useRef } from 'react';
import type { MapView, Point } from 'shared';
import { hexCorners, unpackHex } from 'shared';
import { mapPixelSize } from '../util/stage';

/**
 * Fog-of-war canvas: unexplored = black, explored-but-not-visible = dimmed,
 * currently visible = clear. Renders nothing in DM god mode (visible null).
 *
 * The "explored memory" layer always punches out whole hexes (fog-of-war
 * memory is inherently hex-grained -- what you've ever seen). The current
 * vision/fade layers punch out `visiblePolygons`/`fadePolygons` instead when
 * the server supplies them (global-daylight maps): smooth, wall-accurate
 * shapes that cut through hexes rather than stair-stepping along their
 * edges. Under 'dark'/'dim' lighting those are null and it falls back to the
 * old hex-shaped punch, same as before.
 */
export function FogCanvas({
  map, visible, fade, explored, visiblePolygons, fadePolygons,
}: {
  map: MapView;
  visible: Set<number> | null;
  fade: Set<number> | null;
  explored: Set<number> | null;
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
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

    const punch = (polygons: Point[][], alpha: number) => {
      if (polygons.length === 0) return;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const poly of polygons) {
        if (poly.length === 0) continue;
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    const hexPolys = (keys: Set<number>): Point[][] => [...keys].map((key) => hexCorners(unpackHex(key), map.grid));

    // Explored memory is dimmest, the fade rim brighter, current vision clear.
    if (explored) punch(hexPolys(explored), 0.55);
    if (fadePolygons) punch(fadePolygons, 0.75);
    else if (fade) punch(hexPolys(fade), 0.75);
    if (visiblePolygons) punch(visiblePolygons, 1);
    else punch(hexPolys(visible), 1);
  }, [map.grid, visible, fade, explored, visiblePolygons, fadePolygons, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
