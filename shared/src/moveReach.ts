import type { Door, GridConfig, Hex, Wall } from './types.js';
import { hexDistance } from './hex/coords.js';
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
