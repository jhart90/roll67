import { describe, expect, it } from 'vitest';
import { coneTemplatePath, pointInConeTemplate } from '../src/hex/aoe.js';

const L = 100;
const inside = (along: number, off: number) => pointInConeTemplate(along, off, L);

describe('the Cone Template is a teardrop, not a wedge', () => {
  it('excludes the caster’s own spot', () => {
    expect(inside(0, 0)).toBe(false);
    expect(inside(-5, 0)).toBe(false);
  });

  it('runs the full length down the middle', () => {
    expect(inside(1, 0)).toBe(true);
    expect(inside(L - 1, 0)).toBe(true);
  });

  it('stops at the far tip', () => {
    expect(inside(L + 1, 0)).toBe(false);
  });

  // The whole point of the shape: it is pinched at the caster and fat at the
  // far end. A 60° wedge does the opposite of pinching — it opens steadily.
  it('is narrow at the caster and wide at the end', () => {
    const nearHalfWidth = widthAt(10);
    const farHalfWidth = widthAt(L - 25);
    expect(nearHalfWidth).toBeLessThan(6);
    expect(farHalfWidth).toBeGreaterThan(20);
    expect(farHalfWidth).toBeGreaterThan(nearHalfWidth * 3);
  });

  it('is at its widest across the end circle', () => {
    // Widest across the circle's centre, at three quarters of the length.
    expect(widthAt(L * 0.75)).toBeGreaterThanOrEqual(widthAt(L * 0.6));
    expect(widthAt(L * 0.75)).toBeGreaterThanOrEqual(widthAt(L * 0.9));
  });

  it('is about half as wide as it is long', () => {
    expect(widthAt(L * 0.75) * 2).toBeGreaterThan(L * 0.45);
    expect(widthAt(L * 0.75) * 2).toBeLessThan(L * 0.55);
  });

  it('is symmetric about its axis', () => {
    for (const a of [10, 40, 75, 95]) {
      for (const s of [3, 12, 24]) {
        expect(inside(a, s), `${a},${s}`).toBe(inside(a, -s));
      }
    }
  });

  it('rounds off the end rather than cutting it square', () => {
    // A square end would still be inside at full length, well off-axis.
    expect(inside(L * 0.99, 20)).toBe(false);
    expect(inside(L * 0.75, 20)).toBe(true);
  });

  it('has no cone at all when the length is zero', () => {
    expect(pointInConeTemplate(1, 0, 0)).toBe(false);
  });
});

/** Half-width of the template at a given distance along its axis. */
function widthAt(along: number): number {
  let hit = 0;
  for (let s = 0; s <= L; s += 0.5) if (inside(along, s)) hit = s;
  return hit;
}

describe('the drawn path', () => {
  it('starts at the apex and arcs the long way round the end', () => {
    const d = coneTemplatePath(0, 0, 1, 0, L);
    expect(d.startsWith('M 0,0')).toBe(true);
    // large-arc-flag 1: the arc wraps the far tip rather than cutting across.
    expect(d).toMatch(/A 25,25 0 1 0/);
    expect(d.endsWith('Z')).toBe(true);
  });

  // The path and the hit test read the same two constants, so a change to the
  // shape can never leave the drawing and the maths disagreeing.
  it('puts its tangent points where the hit test says the edge is', () => {
    const d = coneTemplatePath(0, 0, 1, 0, L);
    const m = /L ([-\d.]+),([-\d.]+) A/.exec(d)!;
    const along = Number(m[1]);
    const off = Number(m[2]);
    expect(inside(along, off * 0.98)).toBe(true);
    expect(inside(along, off * 1.15)).toBe(false);
  });

  it('turns with the aim', () => {
    const east = coneTemplatePath(0, 0, 1, 0, L);
    const south = coneTemplatePath(0, 0, 0, 1, L);
    expect(east).not.toBe(south);
    expect(south.startsWith('M 0,0')).toBe(true);
  });
});
