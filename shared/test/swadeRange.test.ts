import { describe, expect, it } from 'vitest';
import { swadeMaxRangeHexes, swadeRangeBand } from '../src/systems/swadeRange.js';

describe('SWADE range bands', () => {
  // A grenade lists 5 tiles, so 5 / 10 / 20 are its Short / Medium / Long.
  const nade = { thrown: true };

  it('reads the band and its penalty off the listed Short range', () => {
    expect(swadeRangeBand(3, 5)).toMatchObject({ band: 'short', penalty: 0 });
    expect(swadeRangeBand(5, 5)).toMatchObject({ band: 'short', penalty: 0 });
    expect(swadeRangeBand(6, 5)).toMatchObject({ band: 'medium', penalty: -2 });
    expect(swadeRangeBand(10, 5)).toMatchObject({ band: 'medium', penalty: -2 });
    expect(swadeRangeBand(11, 5)).toMatchObject({ band: 'long', penalty: -4 });
    expect(swadeRangeBand(20, 5)).toMatchObject({ band: 'long', penalty: -4 });
  });

  it('opens Extreme only while Aiming', () => {
    const far = swadeRangeBand(40, 5);
    expect(far.band).toBe('extreme');
    expect(far.penalty).toBe(-8);
    expect(far.reachable).toBe(false);
    expect(far.reason).toMatch(/Aiming/i);
    expect(swadeRangeBand(40, 5, { aiming: true }).reachable).toBe(true);
  });

  it('gives a grenade no Extreme band at all, even while Aiming', () => {
    // 20 tiles is the last hex a grenade reaches; 21 is simply too far.
    expect(swadeRangeBand(20, 5, nade)).toMatchObject({ band: 'long', reachable: true });
    const over = swadeRangeBand(21, 5, nade);
    expect(over.band).toBe('out');
    expect(over.reachable).toBe(false);
    expect(over.reason).toMatch(/thrown weapon reaches Long/i);
    expect(swadeRangeBand(21, 5, { thrown: true, aiming: true }).reachable).toBe(false);
  });

  it('caps how far each kind of weapon can reach', () => {
    expect(swadeMaxRangeHexes(5, nade)).toBe(20);
    expect(swadeMaxRangeHexes(5)).toBe(20);
    expect(swadeMaxRangeHexes(5, { aiming: true })).toBe(80);
    expect(swadeMaxRangeHexes(0)).toBe(0);
  });

  it('treats a melee weapon (no listed range) as always in reach', () => {
    expect(swadeRangeBand(1, 0)).toMatchObject({ band: 'short', penalty: 0, reachable: true });
  });
});
