import { useEffect, useRef } from 'react';
import type { MapView, Point, VisibilityLitMask } from 'shared';
import { mapPixelSize } from '../util/stage';

function fillPolygon(ctx: CanvasRenderingContext2D, poly: Point[]): void {
  if (poly.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Renders colored light overlays: tinted light-source polygons (additive blending)
 * and stained-glass cones, each clipped to its parent light polygon.
 * Sits between BackgroundCanvas and DrawingLayer in the render stack so the
 * color wash is visible under the fog and on top of the map image.
 *
 * Renders nothing when there are no colored lights or glass cones.
 */
export function LightColorOverlay({
  map, visibleLitMask, fadePolygons,
}: {
  map: MapView;
  visibleLitMask: VisibilityLitMask | null;
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

    if (!visibleLitMask) return;
    const { lightPolygons, lightColors, glassCones } = visibleLitMask;
    const hasColor = lightColors?.some(Boolean);
    const hasCones = glassCones && glassCones.length > 0;
    if (!hasColor && !hasCones) return;

    ctx.globalCompositeOperation = 'lighter';

    // Draw colored light polygons
    if (lightColors) {
      for (let i = 0; i < lightPolygons.length; i++) {
        const color = lightColors[i];
        if (!color) continue;
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        fillPolygon(ctx, lightPolygons[i]);
      }
    }

    // Draw stained glass cones, each clipped to its parent light polygon
    if (glassCones) {
      for (const gc of glassCones) {
        const parentPoly = lightPolygons[gc.lightIdx];
        if (!parentPoly || parentPoly.length === 0) continue;

        ctx.save();
        // Clip to parent light polygon
        ctx.beginPath();
        ctx.moveTo(parentPoly[0].x, parentPoly[0].y);
        for (let j = 1; j < parentPoly.length; j++) ctx.lineTo(parentPoly[j].x, parentPoly[j].y);
        ctx.closePath();
        ctx.clip();

        ctx.globalAlpha = 0.25;
        ctx.fillStyle = gc.color;
        fillPolygon(ctx, gc.cone);
        ctx.restore();
        // Restore additive blending after clip restore
        ctx.globalCompositeOperation = 'lighter';
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }, [visibleLitMask, fadePolygons, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
