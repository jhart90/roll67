import type { Door, GridConfig, Hex, Wall } from './types.js';
import { hexDistance, hexNeighbors } from './hex/coords.js';
import { hexToPixel } from './hex/pixel.js';
import { hexLine } from './hex/line.js';
import { packHex } from './hex/pack.js';
import { inBounds } from './vision/fov.js';
import { blockingSegments, rayBlocked } from './vision/raycast.js';

/**
 * What a move costs and how far one can get.
 *
 * ONE rule, shared: the server enforces it and the client draws it. It used
 * to live on the client as a hand-kept copy of what the server did step by
 * step, which held only as long as the server measured the same thing. Now
 * that a turn's movement is measured from where the turn STARTED (see the
 * budget's `from`) rather than accumulated a step at a time, both sides have
 * to agree on the cost of standing on any given hex — so there is one
 * function, and the map's shading is the server's own answer.
 *
 * Straight-line movement hex by hex, two inches for each patch of rough
 * ground, walls stop it, and nothing stands on blocked ground.
 */
export interface ReachOpts {
  grid: GridConfig;
  /** Packed hex keys painted as rough ground — two inches each to cross. */
  terrain: number[];
  /** Packed hex keys nothing can stand on. */
  blocked: number[];
  /** A crawler is already down in the rough and pays the ordinary rate. */
  crawling?: boolean;
  /**
   * The walls and doors a body cannot cross. Passed in rather than read from
   * anywhere, so this stays a piece of arithmetic either side can call.
   */
  sight: { walls: Wall[]; doors: Door[] } | null;
}

/**
 * What walking from `from` to `to` in a straight line costs, or null when the
 * ground itself refuses — a wall in the way, or a hex nothing can stand on.
 */
export function pathCost(from: Hex, to: Hex, opts: ReachOpts): number | null {
  if (from.q === to.q && from.r === to.r) return 0;
  if (!inBounds(to, opts.grid)) return null;
  const blocked = new Set(opts.blocked);
  if (blocked.has(packHex(to))) return null;
  const rough = opts.crawling ? new Set<number>() : new Set(opts.terrain);
  let cost = 0;
  for (const step of hexLine(from, to).slice(1)) {
    if (blocked.has(packHex(step))) return null;
    cost += rough.has(packHex(step)) ? 2 : 1;
  }
  // Movement blocking, not sight: a window stops a body and not a look.
  const segs = opts.sight ? blockingSegments(opts.sight.walls, opts.sight.doors) : [];
  if (segs.length > 0 && rayBlocked(hexToPixel(from, opts.grid), hexToPixel(to, opts.grid), segs)) return null;
  return cost;
}

/**
 * Every hex reachable from `from` for `left` inches or fewer, excluding the
 * hex it starts on. Nothing costs less than an inch a hex, so `left` inches
 * can never reach further than `left` hexes — that is the whole search space.
 */
export function reachableHexes(from: Hex, left: number, opts: ReachOpts): Hex[] {
  if (left <= 0) return [];
  const out: Hex[] = [];
  for (let dq = -left; dq <= left; dq++) {
    for (let dr = -left; dr <= left; dr++) {
      const hex = { q: from.q + dq, r: from.r + dr };
      if (hexDistance(from, hex) > left || (hex.q === from.q && hex.r === from.r)) continue;
      const cost = pathCost(from, hex, opts);
      if (cost !== null && cost <= left) out.push(hex);
    }
  }
  return out;
}

/**
 * The cheapest walk from `from` to `to` — hex by hex, round walls, through
 * rough ground at its double rate — or null when nothing reaches it.
 *
 * pathCost above measures a straight line, which is what a single drag is.
 * This is for planning: the player points at a hex and wants to know what
 * getting there actually costs, doors and corners included, before they
 * spend anything. Dijkstra with integer step costs, so a bucket queue is
 * enough; `limit` stops the search well short of the whole map.
 */
export function shortestPath(from: Hex, to: Hex, opts: ReachOpts, limit = 64): { path: Hex[]; cost: number } | null {
  if (from.q === to.q && from.r === to.r) return { path: [from], cost: 0 };
  if (!inBounds(to, opts.grid)) return null;
  const blocked = new Set(opts.blocked);
  const target = packHex(to);
  if (blocked.has(target)) return null;
  const rough = opts.crawling ? new Set<number>() : new Set(opts.terrain);
  const segs = opts.sight ? blockingSegments(opts.sight.walls, opts.sight.doors) : [];
  const start = packHex(from);
  const best = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, Hex>();
  const at = new Map<number, Hex>([[start, from]]);
  const buckets: number[][] = [[start]];
  for (let cost = 0; cost <= limit; cost++) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const key of bucket) {
      if ((best.get(key) ?? Infinity) !== cost) continue; // a cheaper visit already handled it
      if (key === target) {
        const path: Hex[] = [];
        for (let k: number | undefined = key; k !== undefined; k = prev.has(k) ? packHex(prev.get(k)!) : undefined) path.push(at.get(k)!);
        return { path: path.reverse(), cost };
      }
      const here = at.get(key)!;
      for (const nbr of hexNeighbors(here)) {
        if (!inBounds(nbr, opts.grid)) continue;
        const nk = packHex(nbr);
        if (blocked.has(nk)) continue;
        const step = cost + (rough.has(nk) ? 2 : 1);
        if (step > limit || step >= (best.get(nk) ?? Infinity)) continue;
        if (segs.length > 0 && rayBlocked(hexToPixel(here, opts.grid), hexToPixel(nbr, opts.grid), segs)) continue;
        best.set(nk, step);
        prev.set(nk, here);
        at.set(nk, nbr);
        (buckets[step] ??= []).push(nk);
      }
    }
  }
  return null;
}
