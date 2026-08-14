import type { Door, GridConfig, Hex, Wall } from 'shared';
import { blockingSegments, hexDistance, hexLine, hexToPixel, inBounds, packHex, rayBlocked } from 'shared';

/**
 * What a move costs and how far one can get — the client's copy of the rule
 * the server enforces.
 *
 * It is a copy on purpose. The server decides, always; this exists so the map
 * can DRAW the answer and so an impossible drag can be refused before it is
 * sent rather than bouncing back. Which means it has to mirror the server
 * exactly: straight-line movement hex by hex, two inches for each patch of
 * rough ground, walls stop it. A shading that promised ground the server then
 * refused would be worse than no shading at all.
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
   * the store, so this module stays a piece of arithmetic that the store can
   * import without the two of them importing each other.
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
