import type { Door, Point, Wall } from '../types.js';
import { segmentsIntersect } from '../hex/line.js';

export interface Segment {
  a: Point;
  b: Point;
}

/** Segments that block MOVEMENT: every wall (any type) + closed doors. */
export function blockingSegments(walls: Wall[], doors: Door[]): Segment[] {
  const out: Segment[] = [];
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.points.length; i++) {
      out.push({ a: wall.points[i], b: wall.points[i + 1] });
    }
  }
  for (const door of doors) {
    if (!door.open) out.push({ a: door.a, b: door.b });
  }
  return out;
}

/**
 * Segments that block SIGHT for a viewer at `viewer`. `window` walls are
 * transparent; `oneway` walls block only when the viewer is on the blocked
 * side (see-out-not-in). Closed doors always block.
 */
export function sightSegments(walls: Wall[], doors: Door[], viewer: Point): Segment[] {
  const out: Segment[] = [];
  for (const wall of walls) {
    const type = wall.type ?? 'solid';
    if (type === 'window') continue;
    for (let i = 0; i + 1 < wall.points.length; i++) {
      const a = wall.points[i];
      const b = wall.points[i + 1];
      if (type === 'oneway') {
        // Sign of the cross product tells which side of the segment the
        // viewer is on. One side sees through; the other is blocked.
        const cross = (b.x - a.x) * (viewer.y - a.y) - (b.y - a.y) * (viewer.x - a.x);
        const blocked = wall.flip ? cross > 0 : cross < 0;
        if (!blocked) continue;
      }
      out.push({ a, b });
    }
  }
  for (const door of doors) {
    if (!door.open) out.push({ a: door.a, b: door.b });
  }
  return out;
}

/** Is the straight ray from `from` to `to` blocked by any segment? */
export function rayBlocked(from: Point, to: Point, segments: Segment[]): boolean {
  for (const s of segments) {
    if (segmentsIntersect(from, to, s.a, s.b)) return true;
  }
  return false;
}
