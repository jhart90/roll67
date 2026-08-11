/**
 * The walls a player is allowed to know about.
 *
 * Players are not sent the map's geometry, because a client holding the wall
 * list can read the unexplored dungeon straight out of its own memory. But a
 * player who has stood in a room has plainly seen the walls of that room, and
 * withholding them costs something real: their client cannot tell a blocked
 * move from a legal one, so every bump has to be refused by the server a round
 * trip later.
 *
 * The rule that gives both: a player may know the parts of a wall that lie
 * inside ground they have discovered, and nothing else.
 *
 * CLIPPING, not filtering, is the whole job. A corridor wall running from a
 * lit room off into the dark is one segment; handing it over because one end
 * is visible would tell the player exactly how far the corridor runs. So each
 * segment is cut down to the runs that cross discovered hexes, and only those
 * pieces are sent.
 */

import type { Hex, Point, Wall } from '../types.js';
import type { GridConfig } from '../types.js';
import { pixelToHex } from '../hex/pixel.js';

/** A wall fragment a player has earned the right to see. */
export interface KnownWallSegment {
  /** The wall this came from, so the client can style it by type. */
  wallId: string;
  a: Point;
  b: Point;
}

/**
 * How finely a segment is sampled when deciding which parts are known.
 *
 * Expressed as a fraction of a hex, so the resolution follows the grid rather
 * than the map's pixel size. Small enough that a fragment never visibly
 * overshoots into the dark; large enough that a long wall doesn't cost
 * hundreds of samples.
 */
const SAMPLES_PER_HEX = 6;

/**
 * Cut one segment down to the runs that lie on discovered ground.
 *
 * Walks the segment in small steps, asking which hex each step falls in, and
 * emits a fragment for every unbroken run of discovered hexes.
 *
 * A run ends at the last sample that was actually known, never part-way to
 * the first that wasn't. Rounding outward would close the hairline gaps where
 * a fragment meets a hex boundary, but it would do so by pushing the drawn
 * line a little way into the dark — which is the exact thing this module
 * exists to prevent. A seam is cosmetic; a leak is not.
 */
function clipSegment(
  wallId: string, a: Point, b: Point, grid: GridConfig, seen: (hex: Hex) => boolean,
): KnownWallSegment[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return [];
  const hexPx = grid.hexSize > 0 ? grid.hexSize : 1;
  const steps = Math.max(2, Math.ceil((len / hexPx) * SAMPLES_PER_HEX));

  const out: KnownWallSegment[] = [];
  let runStart: number | null = null;
  let lastKnown = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const known = seen(pixelToHex({ x: a.x + dx * t, y: a.y + dy * t }, grid));
    if (known) {
      if (runStart === null) runStart = t;
      lastKnown = t;
    } else if (runStart !== null) {
      push(out, wallId, a, dx, dy, runStart, lastKnown);
      runStart = null;
    }
  }
  if (runStart !== null) push(out, wallId, a, dx, dy, runStart, lastKnown);
  return out;
}

function push(
  out: KnownWallSegment[], wallId: string, a: Point, dx: number, dy: number, t0: number, t1: number,
): void {
  if (t1 - t0 <= 1e-6) return;
  out.push({
    wallId,
    a: { x: a.x + dx * t0, y: a.y + dy * t0 },
    b: { x: a.x + dx * t1, y: a.y + dy * t1 },
  });
}

/**
 * Every wall fragment this player has discovered, across the whole map.
 *
 * `seen` answers "has this player been shown that hex" — the same memory the
 * fog of war is drawn from, so a wall becomes known at exactly the moment the
 * ground beside it does.
 */
export function knownWallSegments(
  walls: readonly Wall[], grid: GridConfig, seen: (hex: Hex) => boolean,
): KnownWallSegment[] {
  const out: KnownWallSegment[] = [];
  for (const wall of walls) {
    for (let i = 1; i < wall.points.length; i++) {
      out.push(...clipSegment(wall.id, wall.points[i - 1]!, wall.points[i]!, grid, seen));
    }
  }
  return out;
}
