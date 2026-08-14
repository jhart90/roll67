import { useEffect, useMemo, useRef } from 'react';
import type { GridConfig, Hex } from 'shared';
import { blockingSegments, hexCorners, hexDistance, hexLine, hexNeighbors, hexToPixel, inBounds, packHex, rayBlocked } from 'shared';
import { mapPixelSize } from '../util/stage';
import { sightGeometry, useGameStore } from '../store/game';

/**
 * The ground the token whose turn it is can actually reach.
 *
 * SWADE's Pace is a real budget — an inch a hex, two through rough ground,
 * spent down over the turn — but until now the only way to find its edge was
 * to walk into it and be told no. This draws it: the hexes still within reach
 * are tinted, and the last ring of them is outlined, so the shape of what is
 * left of the turn is on the map rather than in somebody's head.
 *
 * It mirrors the server's own rule rather than inventing a friendlier one —
 * straight-line movement, hex by hex, 2″ for each patch of rough ground, and
 * walls stop it. A shading that promised ground the server then refused would
 * be worse than no shading at all.
 */
export function MoveRangeCanvas({ grid }: { grid: GridConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useGameStore((s) => s.map)!;
  const budget = useGameStore((s) => s.moveBudget);
  const tokens = useGameStore((s) => s.tokens);
  const active = useGameStore((s) => s.initiativeState.active);
  const turnEntry = useGameStore((s) => s.initiativeState.entries[s.initiativeState.turnIdx]);
  // Subscribed to so the reach redraws when a door opens or a wall is moved,
  // not merely when the token next takes a step.
  const knownWalls = useGameStore((s) => s.knownWalls);
  const dmGeometry = useGameStore((s) => s.dmGeometry);
  const { width, height } = mapPixelSize(map);

  const token = budget ? tokens[budget.tokenId] : undefined;
  // Only for whoever is up, and only while they are the one standing there:
  // a budget left over from someone else's turn is not this token's reach.
  const live = !!budget && !!token && active && turnEntry?.tokenId === budget.tokenId
    && token.mapId === map.id;

  const reach = useMemo(() => {
    if (!live || !budget || !token) return null;
    const left = Math.max(0, budget.pace + (budget.runBonus ?? 0) - budget.moved);
    if (left <= 0) return { hexes: [] as Hex[], left: 0 };
    const from = { q: token.q, r: token.r };
    // A crawler is already down in the rough and pays the ordinary rate;
    // everyone else pays double for it.
    const rough = budget.crawling ? new Set<number>() : new Set(map.terrain);
    const blocked = new Set(map.blocked ?? []);
    // MOVEMENT blocking, not sight: a window stops a body and not a look, so
    // this is the same segment set the server walks a move against.
    const geo = sightGeometry();
    const segs = geo ? blockingSegments(geo.walls, geo.doors) : [];
    const fromPx = hexToPixel(from, grid);

    const out: Hex[] = [];
    // Nothing can cost less than an inch a hex, so `left` inches can never
    // reach further than `left` hexes — that is the whole search space.
    for (let dq = -left; dq <= left; dq++) {
      for (let dr = -left; dr <= left; dr++) {
        const hex = { q: from.q + dq, r: from.r + dr };
        if (hexDistance(from, hex) > left) continue;
        if (hex.q === from.q && hex.r === from.r) continue;
        if (!inBounds(hex, grid) || blocked.has(packHex(hex))) continue;
        // The cost of walking there in a straight line, which is how the
        // server charges it.
        const path = hexLine(from, hex).slice(1);
        let cost = 0;
        let over = false;
        for (const step of path) {
          if (blocked.has(packHex(step))) { over = true; break; }
          cost += rough.has(packHex(step)) ? 2 : 1;
          if (cost > left) { over = true; break; }
        }
        if (over) continue;
        if (segs.length > 0 && rayBlocked(fromPx, hexToPixel(hex, grid), segs)) continue;
        out.push(hex);
      }
    }
    return { hexes: out, left };
  }, [live, budget, token, map.terrain, map.blocked, grid, knownWalls, dmGeometry]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!reach || reach.hexes.length === 0) return;

    // A wash rather than a colour: the map underneath is the thing being
    // read, and this is only saying where the legs stop.
    ctx.fillStyle = 'rgba(126, 200, 255, 0.13)';
    ctx.beginPath();
    for (const hex of reach.hexes) {
      const corners = hexCorners(hex, grid);
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
    }
    ctx.fill();

    // The edge itself: only the sides that face OUT of the reachable set, so
    // the region reads as one shape instead of a honeycomb of outlines.
    const inside = new Set(reach.hexes.map((h) => packHex(h)));
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const hex of reach.hexes) {
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
  }, [reach, grid, width, height]);

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
