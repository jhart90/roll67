// Movement legality: a token may move to a hex only if a walkable path
// exists that never crosses a wall or a closed door. Checked hex-by-hex
// (center to center), so players can drag around corners but never through
// blockers. Pure and server-side — players never receive wall geometry.

import type { Door, GridConfig, Hex, Wall } from '../types.js';
import { hexDistance, hexNeighbors } from '../hex/coords.js';
import { hexToPixel } from '../hex/pixel.js';
import { hexLine } from '../hex/line.js';
import { packHex } from '../hex/pack.js';
import { blockingSegments, rayBlocked, type Segment } from './raycast.js';
import { inBounds } from './fov.js';

export interface MoveInput {
  grid: GridConfig;
  walls: Wall[];
  doors: Door[];
}

/** Is the single step between two (adjacent) hexes blocked by geometry? */
export function stepBlocked(a: Hex, b: Hex, grid: GridConfig, segments: Segment[]): boolean {
  return rayBlocked(hexToPixel(a, grid), hexToPixel(b, grid), segments);
}

/**
 * Furthest hex a token reaches moving in a straight line from `from` toward
 * `to`: it walks the hex-line and stops on the last hex before a wall/closed
 * door (or the map edge). Returns `from` when the very first step is blocked
 * ("held up" against the wall). This is directional collision, not pathing —
 * to round a corner the player makes a second move.
 */
export function reachableAlong(from: Hex, to: Hex, input: MoveInput): Hex {
  if (from.q === to.q && from.r === to.r) return { ...from };
  const segments = blockingSegments(input.walls, input.doors);
  const line = hexLine(from, to);
  let last: Hex = { ...from };
  for (let i = 1; i < line.length; i++) {
    const step = line[i];
    if (!inBounds(step, input.grid)) break;
    if (segments.length > 0 && stepBlocked(line[i - 1], step, input.grid, segments)) break;
    last = step;
  }
  return last;
}

/**
 * Can a token walk from `from` to `to`? Breadth-first search over hexes,
 * where each step must not cross a wall or closed door. Bounded to a
 * neighbourhood of the endpoints so pathological drags stay cheap.
 */
export function canReachHex(from: Hex, to: Hex, input: MoveInput): boolean {
  if (from.q === to.q && from.r === to.r) return true;
  if (!inBounds(to, input.grid)) return false;
  const segments = blockingSegments(input.walls, input.doors);
  if (segments.length === 0) return true;

  const directDistance = hexDistance(from, to);
  // Allow detours around obstacles, but keep the search bounded.
  const maxRadius = Math.min(directDistance + 6, 40);
  const maxNodes = 1200;

  const visited = new Set<number>([packHex(from)]);
  const targetKey = packHex(to);
  let frontier: Hex[] = [from];
  let explored = 0;

  while (frontier.length > 0 && explored < maxNodes) {
    const next: Hex[] = [];
    for (const hex of frontier) {
      for (const n of hexNeighbors(hex)) {
        const key = packHex(n);
        if (visited.has(key)) continue;
        if (!inBounds(n, input.grid)) continue;
        if (hexDistance(from, n) > maxRadius && hexDistance(to, n) > maxRadius) continue;
        if (stepBlocked(hex, n, input.grid, segments)) continue;
        if (key === targetKey) return true;
        visited.add(key);
        next.push(n);
        explored++;
      }
    }
    frontier = next;
  }
  return false;
}
