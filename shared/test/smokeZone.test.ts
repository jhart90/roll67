import { describe, expect, it } from 'vitest';
import { obscureBetween } from '../src/hex/aoe.js';
import type { MapZone } from '../src/types.js';

/**
 * Smoke is a penalty, not a wall.
 *
 * SWADE's answer to a smoke grenade is −4 on sight-based rolls into or
 * through the cloud, with line of sight technically still open — so this is
 * arithmetic about a line between two hexes, and has nothing to do with the
 * vision system. A cloud that blocked sight would be a different rule and a
 * much larger change.
 */
const cloud = (over: { q: number; r: number }, radius = 2, rounds = 5): MapZone => ({
  id: 'z1', kind: 'smoke', label: 'Smoke Grenade', hex: over, radius, penalty: -4, roundsLeft: rounds,
});

describe('shooting around smoke', () => {
  it('costs nothing when the cloud is nowhere near the line', () => {
    expect(obscureBetween([cloud({ q: 20, r: 20 })], { q: 0, r: 0 }, { q: 5, r: 0 })).toBeNull();
  });

  it('costs −4 when the target is standing in it', () => {
    expect(obscureBetween([cloud({ q: 5, r: 0 })], { q: 0, r: 0 }, { q: 5, r: 0 })?.penalty).toBe(-4);
  });

  it('…and when the shot merely passes through it', () => {
    const hit = obscureBetween([cloud({ q: 5, r: 0 })], { q: 0, r: 0 }, { q: 10, r: 0 });
    expect(hit?.penalty).toBe(-4);
    expect(hit?.label).toBe('Smoke Grenade');
  });

  it('…and when the SHOOTER is the one standing in it', () => {
    // You cannot see out of smoke any better than others can see into it.
    expect(obscureBetween([cloud({ q: 0, r: 0 })], { q: 0, r: 0 }, { q: 9, r: 0 })?.penalty).toBe(-4);
  });

  it('does not stack: two banks of smoke are still smoke', () => {
    const two = [cloud({ q: 3, r: 0 }), { ...cloud({ q: 6, r: 0 }), id: 'z2' }];
    expect(obscureBetween(two, { q: 0, r: 0 }, { q: 9, r: 0 })?.penalty).toBe(-4);
  });

  it('takes the worst cloud when they differ', () => {
    const thin = { ...cloud({ q: 3, r: 0 }), id: 'z2', penalty: -2, label: 'Haze' };
    expect(obscureBetween([thin, cloud({ q: 6, r: 0 })], { q: 0, r: 0 }, { q: 9, r: 0 })?.penalty).toBe(-4);
  });

  it('ignores a cloud that has already blown away', () => {
    expect(obscureBetween([cloud({ q: 5, r: 0 }, 2, 0)], { q: 0, r: 0 }, { q: 10, r: 0 })).toBeNull();
  });

  it('is nothing at all on a map with no clouds on it', () => {
    expect(obscureBetween(undefined, { q: 0, r: 0 }, { q: 5, r: 0 })).toBeNull();
    expect(obscureBetween([], { q: 0, r: 0 }, { q: 5, r: 0 })).toBeNull();
  });
});
