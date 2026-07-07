import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
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

/** Fill hexes (by packed key) as white mask shapes onto a mask canvas. */
function fillHexes(ctx: CanvasRenderingContext2D, keys: ArrayLike<number>, from: number, grid: GridConfig): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = from; i < keys.length; i++) {
    const poly = hexCorners(unpackHex(keys[i]), grid);
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k].x, poly[k].y);
    ctx.closePath();
  }
  ctx.fill();
}

/**
 * Get a scratch mask canvas ready for drawing: reuses the SAME canvas across
 * updates (a full-map canvas backing store can run tens of MB -- allocating
 * two fresh ones per vision update was pure churn), resizing only when the
 * map's pixel size actually changes and clearing otherwise.
 */
function scratchCanvas(ref: MutableRefObject<HTMLCanvasElement | null>, width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let canvas = ref.current;
  if (!canvas) {
    canvas = document.createElement('canvas');
    ref.current = canvas;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  } else {
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
  }
  return { canvas, ctx: canvas.getContext('2d')! };
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
  map, visible, fade, exploredLog, visiblePolygons, fadePolygons, visibleLitMask, fadeLitMask,
}: {
  map: MapView;
  visible: Set<number> | null;
  fade: Set<number> | null;
  /** Append-only log of explored hex keys (see the store); null = no fog memory (DM god mode). */
  exploredLog: number[] | null;
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
  visibleLitMask: VisibilityLitMask | null;
  fadeLitMask: VisibilityLitMask | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = mapPixelSize(map);
  // The explored log only ever GROWS (fog memory never un-explores), and its
  // identity only changes on map switch/join. So the mask persists across
  // updates and each newly-revealed hex is drawn into it exactly once, by
  // index: cost per reveal is O(hexes revealed just now), not O(every hex
  // ever explored) -- the latter measured ~600ms per step at ~10k explored
  // hexes, the dominant frame stall while exploring.
  const exploredMaskRef = useRef<{
    log: number[]; drawnCount: number; grid: GridConfig; width: number; height: number; canvas: HTMLCanvasElement;
  } | null>(null);
  // The visible/fade masks are rebuilt when their polygon/lit inputs change
  // (reference identity), but always INTO the same reused scratch canvases --
  // never a fresh allocation per update.
  const visibleMaskRef = useRef<{ polygons: Point[][]; lit: VisibilityLitMask | null; width: number; height: number } | null>(null);
  const fadeMaskRef = useRef<{ polygons: Point[][]; lit: VisibilityLitMask | null; width: number; height: number } | null>(null);
  const visibleScratchRef = useRef<HTMLCanvasElement | null>(null);
  const fadeScratchRef = useRef<HTMLCanvasElement | null>(null);
  const litScratchRef = useRef<HTMLCanvasElement | null>(null);

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
    if (exploredLog) {
      const cached = exploredMaskRef.current;
      let mask: HTMLCanvasElement;
      if (cached && cached.log === exploredLog && cached.grid === map.grid && cached.width === width && cached.height === height) {
        // Same map/grid/size: draw only the hexes appended since last time.
        if (cached.drawnCount < exploredLog.length) {
          fillHexes(cached.canvas.getContext('2d')!, exploredLog, cached.drawnCount, map.grid);
          cached.drawnCount = exploredLog.length;
        }
        mask = cached.canvas;
      } else {
        // Map switch, grid edit, or first mount: rebuild the mask from scratch.
        const fresh = document.createElement('canvas');
        fresh.width = width;
        fresh.height = height;
        fillHexes(fresh.getContext('2d')!, exploredLog, 0, map.grid);
        exploredMaskRef.current = { log: exploredLog, drawnCount: exploredLog.length, grid: map.grid, width, height, canvas: fresh };
        mask = fresh;
      }
      punchMask(mask, 0.55);
    } else {
      exploredMaskRef.current = null;
    }

    /**
     * One band's final visible-area mask, drawn into that band's persistent
     * scratch canvas: the reach polygons alone under 'light' (lit === null);
     * under 'dark'/'dim' only the parts of the reach that are ALSO lit
     * (darkvision/dim-ambient circles, or a light source's own wall-aware
     * illumination shape), via destination-in compositing. Skipped entirely
     * when the polygon/lit references are unchanged since the last draw.
     */
    const bandMask = (
      cacheRef: MutableRefObject<{ polygons: Point[][]; lit: VisibilityLitMask | null; width: number; height: number } | null>,
      scratchRef: MutableRefObject<HTMLCanvasElement | null>,
      polygons: Point[][],
      lit: VisibilityLitMask | null,
    ): HTMLCanvasElement => {
      const cached = cacheRef.current;
      if (cached && cached.polygons === polygons && cached.lit === lit && cached.width === width && cached.height === height && scratchRef.current) {
        return scratchRef.current;
      }
      const { canvas: reachCanvas, ctx: reachCtx } = scratchCanvas(scratchRef, width, height);
      reachCtx.fillStyle = '#fff';
      fillPolygons(reachCtx, polygons);
      if (lit) {
        const { canvas: litCanvas, ctx: litCtx } = scratchCanvas(litScratchRef, width, height);
        litCtx.fillStyle = '#fff';
        for (const c of lit.circles) {
          litCtx.beginPath();
          litCtx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          litCtx.fill();
        }
        fillPolygons(litCtx, lit.lightPolygons);
        reachCtx.globalCompositeOperation = 'destination-in';
        reachCtx.drawImage(litCanvas, 0, 0);
        reachCtx.globalCompositeOperation = 'source-over';
      }
      cacheRef.current = { polygons, lit, width, height };
      return reachCanvas;
    };

    if (fadePolygons) punchMask(bandMask(fadeMaskRef, fadeScratchRef, fadePolygons, fadeLitMask), 0.75);
    else { fadeMaskRef.current = null; if (fade) punch(hexPolys(fade), 0.75); }
    if (visiblePolygons) punchMask(bandMask(visibleMaskRef, visibleScratchRef, visiblePolygons, visibleLitMask), 1);
    else { visibleMaskRef.current = null; punch(hexPolys(visible), 1); }
  }, [map.grid, visible, fade, exploredLog, exploredLog?.length, visiblePolygons, fadePolygons, visibleLitMask, fadeLitMask, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
