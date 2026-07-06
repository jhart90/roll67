import { useEffect, useRef } from 'react';
import type { GridConfig, MapView, Point, VisibilityLitMask } from 'shared';
import { hexCorners, unpackHex } from 'shared';
import { mapPixelSize } from '../util/stage';

function fillPolygons(ctx: CanvasRenderingContext2D, polygons: Point[][]): void {
  ctx.beginPath();
  for (const poly of polygons) {
    if (poly.length === 0) continue;
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }
  ctx.fill();
}

function maskCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/**
 * The final visible-area mask for one band, as an (offscreen, never
 * attached) canvas whose alpha channel IS the mask -- ready to punch onto
 * the fog layer via destination-out. Under 'light' (lit === null) the reach
 * polygons alone are the mask, same as before. Under 'dark'/'dim', only the
 * parts of the reach that are ALSO lit (darkvision/dim-ambient circles, or a
 * light source's own wall-aware illumination shape) count as visible --
 * computed via canvas compositing (fill the lit shapes, then
 * destination-in against the reach) rather than real polygon-clipping math,
 * which the browser already does correctly and fast.
 */
function buildVisibilityMask(width: number, height: number, reach: Point[][], lit: VisibilityLitMask | null): HTMLCanvasElement {
  const { canvas: reachCanvas, ctx: reachCtx } = maskCanvas(width, height);
  reachCtx.fillStyle = '#fff';
  fillPolygons(reachCtx, reach);
  if (!lit) return reachCanvas;

  const { canvas: litCanvas, ctx: litCtx } = maskCanvas(width, height);
  litCtx.fillStyle = '#fff';
  for (const c of lit.circles) {
    litCtx.beginPath();
    litCtx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    litCtx.fill();
  }
  fillPolygons(litCtx, lit.lightPolygons);

  reachCtx.globalCompositeOperation = 'destination-in';
  reachCtx.drawImage(litCanvas, 0, 0);
  return reachCanvas;
}

/**
 * Fog-of-war canvas: unexplored = black, explored-but-not-visible = dimmed,
 * currently visible = clear. Renders nothing in DM god mode (visible null).
 *
 * The "explored memory" layer always punches out whole hexes (fog-of-war
 * memory is inherently hex-grained -- what you've ever seen). The current
 * vision/fade layers punch out `visiblePolygons`/`fadePolygons` instead when
 * the server supplies them: smooth, wall-accurate shapes that cut through
 * hexes rather than stair-stepping along their edges, for every lighting
 * mode. Falls back to the old hex-shaped punch only if the server ever
 * omits them (e.g. no owned viewer tokens on this map).
 */
export function FogCanvas({
  map, visible, fade, explored, visiblePolygons, fadePolygons, visibleLitMask, fadeLitMask,
}: {
  map: MapView;
  visible: Set<number> | null;
  fade: Set<number> | null;
  explored: Set<number> | null;
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
  visibleLitMask: VisibilityLitMask | null;
  fadeLitMask: VisibilityLitMask | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = mapPixelSize(map);
  // The explored set only ever grows and is usually untouched between moves
  // (the store now keeps its reference stable when nothing new is explored)
  // -- caching its render lets a token move that doesn't reveal new territory
  // skip re-filling what can be thousands of previously-explored hexes and
  // just re-blit the cached mask instead.
  const exploredMaskRef = useRef<{
    explored: Set<number>; grid: GridConfig; width: number; height: number; canvas: HTMLCanvasElement;
  } | null>(null);

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
      fillPolygons(ctx, polygons);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    const punchMask = (mask: HTMLCanvasElement, alpha: number) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = alpha;
      ctx.drawImage(mask, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    const hexPolys = (keys: Set<number>): Point[][] => [...keys].map((key) => hexCorners(unpackHex(key), map.grid));

    // Explored memory is dimmest, the fade rim brighter, current vision clear.
    if (explored) {
      const cached = exploredMaskRef.current;
      let mask: HTMLCanvasElement;
      if (cached && cached.explored === explored && cached.grid === map.grid && cached.width === width && cached.height === height) {
        mask = cached.canvas;
      } else {
        const { canvas: exploredCanvas, ctx: exCtx } = maskCanvas(width, height);
        exCtx.fillStyle = '#fff';
        fillPolygons(exCtx, hexPolys(explored));
        mask = exploredCanvas;
        exploredMaskRef.current = { explored, grid: map.grid, width, height, canvas: mask };
      }
      punchMask(mask, 0.55);
    } else {
      exploredMaskRef.current = null;
    }
    if (fadePolygons) punchMask(buildVisibilityMask(width, height, fadePolygons, fadeLitMask), 0.75);
    else if (fade) punch(hexPolys(fade), 0.75);
    if (visiblePolygons) punchMask(buildVisibilityMask(width, height, visiblePolygons, visibleLitMask), 1);
    else punch(hexPolys(visible), 1);
  }, [map.grid, visible, fade, explored, visiblePolygons, fadePolygons, visibleLitMask, fadeLitMask, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
