import type { Door, Point, Wall } from '../types.js';
import { segmentsIntersect } from '../hex/line.js';

export interface Segment {
  a: Point;
  b: Point;
}

/** Flatten wall polylines + closed doors into blocking segments. */
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

/** Is the straight ray from `from` to `to` blocked by any segment? */
export function rayBlocked(from: Point, to: Point, segments: Segment[]): boolean {
  for (const s of segments) {
    if (segmentsIntersect(from, to, s.a, s.b)) return true;
  }
  return false;
}
