import { describe, expect, it } from 'vitest';
import { coverAdjustedDamage, hotPotatoPenalty } from '../src/systems/swadeDamage.js';

describe('hotPotatoPenalty', () => {
  it('is −4 for a standing grab, −2 if they were on Hold', () => {
    expect(hotPotatoPenalty(false)).toBe(-4);
    expect(hotPotatoPenalty(true)).toBe(-2);
  });
});

describe('coverAdjustedDamage', () => {
  const cover = (amount: number, isCoverer: boolean, coverToughness = 6) =>
    coverAdjustedDamage(amount, { isCoverer, coverToughness });

  it('doubles the damage on whoever threw themselves on it', () => {
    expect(cover(10, true)).toBe(20);
  });

  it("takes the coverer's Toughness off everyone else's damage", () => {
    expect(cover(10, false)).toBe(4);
  });

  it('never heals anyone: a body bigger than the blast just stops all of it', () => {
    expect(cover(4, false, 6)).toBe(0);
    expect(cover(1, false, 99)).toBe(0);
  });

  it('leaves a nil hit alone on both sides — doubling nothing is still nothing', () => {
    expect(cover(0, true)).toBe(0);
    expect(cover(0, false)).toBe(0);
  });

  it('ignores a nonsense negative Toughness rather than adding damage', () => {
    expect(cover(10, false, -5)).toBe(10);
  });

  it('is the whole rule: coverer up, everyone else down, from one blast roll', () => {
    const base = 12;
    expect(cover(base, true, 7)).toBe(24);
    expect(cover(base, false, 7)).toBe(5);
  });
});
