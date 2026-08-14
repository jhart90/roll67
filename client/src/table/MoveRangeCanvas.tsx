import { useEffect, useMemo, useRef } from 'react';
import type { GridConfig, Hex } from 'shared';
import { hexCorners, hexNeighbors, hexToPixel, packHex } from 'shared';
import { mapPixelSize } from '../util/stage';
import { sightGeometry, useGameStore } from '../store/game';
import { reachableHexes, type ReachOpts } from '../util/moveReach';

/**
 * The ground the token whose turn it is can reach — in two bands.
 *
 * SWADE's Pace is a real budget, an inch a hex and two through rough ground,
 * and the only way to find its edge used to be to walk into it and be told
 * no. The near band is that: what is left of this turn's Pace.
 *
 * The far band is what a RUN could buy — the running die's best face, the
 * most ground the turn could possibly hold. It is drawn fainter because it is
 * a maybe: taking it means rolling the die and wearing −2 on everything else
 * this turn, and a promise that costs something should not look like a
 * promise that does not.
 *
 * Both mirror the server's own rule rather than inventing a friendlier one —
 * see util/moveReach. Ground the shading offers must be ground the server
 * allows, or the shading is worse than nothing.
 */
export function MoveRangeCanvas({ grid }: { grid: GridConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useGameStore((s) => s.map)!;
  const budgets = useGameStore((s) => s.moveBudgets);
  const tokens = useGameStore((s) => s.tokens);
  const active = useGameStore((s) => s.initiativeState.active);
  const turnEntry = useGameStore((s) => s.initiativeState.entries[s.initiativeState.turnIdx]);
  // Subscribed to so the reach redraws when a door opens or a wall is moved,
  // not merely when the token next takes a step.
  const knownWalls = useGameStore((s) => s.knownWalls);
  const dmGeometry = useGameStore((s) => s.dmGeometry);
  const { width, height } = mapPixelSize(map);

  // Whoever is up, and their own budget — not whichever arrived last.
  const budget = turnEntry?.tokenId ? budgets[turnEntry.tokenId] : undefined;
  const token = budget ? tokens[budget.tokenId] : undefined;
  const live = !!budget && !!token && active && token.mapId === map.id;

  const bands = useMemo(() => {
    if (!live || !budget) return null;
    const left = Math.max(0, budget.pace + (budget.runBonus ?? 0) - budget.moved);
    const withRun = left + Math.max(0, budget.runMax);
    if (withRun <= 0) return null;
    // The hex the SERVER says it is on, not the one the client has optimistically
    // slid it to: an unconfirmed step must not move the whole reach with it.
    const from = budget.from;
    const opts: ReachOpts = {
      grid, terrain: map.terrain, blocked: map.blocked ?? [], crawling: budget.crawling,
      sight: sightGeometry(),
    };
    const walk = reachableHexes(from, left, opts);
    const walkable = new Set(walk.map((h) => packHex(h)));
    // The far band is only the EXTRA ground — drawing it under the near one
    // would double the wash and make the near band read as the darker half of
    // one shape rather than as its own answer.
    const run = reachableHexes(from, withRun, opts).filter((h) => !walkable.has(packHex(h)));
    return { walk, run };
  }, [live, budget, map.terrain, map.blocked, grid, knownWalls, dmGeometry]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!bands) return;

    /** Fill a set of hexes, then trace only the edges that face OUT of it —
     *  so a band reads as one shape rather than a honeycomb of outlines. */
    const paint = (hexes: Hex[], fill: string, stroke: string, lineWidth: number) => {
      if (hexes.length === 0) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const hex of hexes) {
        const corners = hexCorners(hex, grid);
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
      }
      ctx.fill();

      const inside = new Set(hexes.map((h) => packHex(h)));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (const hex of hexes) {
        const corners = hexCorners(hex, grid);
        for (const nbr of hexNeighbors(hex)) {
          if (inside.has(packHex(nbr))) continue;
          // The shared edge is the two corners nearest that neighbour's centre.
          // Found geometrically rather than by index, so it cannot be knocked
          // out of step by a change of coordinate convention.
          const c = hexToPixel(nbr, grid);
          const near = corners
            .map((pt, i) => ({ i, d: (pt.x - c.x) ** 2 + (pt.y - c.y) ** 2 }))
            .sort((x, y) => x.d - y.d)
            .slice(0, 2);
          ctx.moveTo(corners[near[0].i].x, corners[near[0].i].y);
          ctx.lineTo(corners[near[1].i].x, corners[near[1].i].y);
        }
      }
      ctx.stroke();
    };

    // The maybe first, so the certainty sits on top of it.
    paint(bands.run, 'rgba(126, 200, 255, 0.05)', 'rgba(126, 200, 255, 0.22)', 1);
    paint(bands.walk, 'rgba(126, 200, 255, 0.13)', 'rgba(126, 200, 255, 0.75)', 2);
  }, [bands, grid, width, height]);

  if (!live) return null;
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    />
  );
}
