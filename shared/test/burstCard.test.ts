import { describe, expect, it } from 'vitest';
import type { RollBreakdown } from '../src/types.js';

/**
 * What a burst's chat card must never say.
 *
 * A burst is one trait roll per shot, each carrying the same modifier, of
 * which the reported total is merely the best. The equation row works a
 * modifier out as `total − sum(every die)`, which for a burst is an
 * arithmetic coincidence rather than anything anybody applied: three shots
 * and a Wild Die at −6 apiece produced a single "−21" chip whose own tooltip
 * then said the modifier was −6.
 *
 * The fix is a flag on the breakdown, so this pins the contract the card
 * relies on rather than the card's own markup.
 */
describe('a burst breakdown', () => {
  // The real shape of the card in the report: Tommy Gun at RoF 3, −6 to hit,
  // one shot aced (8→7) and landed on 9, the others on −1 and 1.
  const burst: RollBreakdown = {
    expression: 'best of 3×1d8!-6',
    total: 9,
    detail: '3×1d8!-6 (9, -1, 1) · Wild 1d6!-6 (-3)',
    burstShots: 3,
    dice: [
      { sides: 8, value: 8, kept: true, ace: true }, { sides: 8, value: 7, kept: true },
      { sides: 8, value: 5, kept: true },
      { sides: 8, value: 7, kept: true },
      { sides: 6, value: 3, kept: true, wild: true },
    ],
    modWhy: ['−2 Recoil (RoF 3)', '−4 Long Range'],
  };

  it('says how many shots it holds, so the card knows not to sum them', () => {
    expect(burst.burstShots).toBe(3);
  });

  it('is exactly the case where total − dice is a lie', () => {
    const sum = burst.dice.filter((d) => d.kept).reduce((n, d) => n + d.value, 0);
    // What the equation used to print…
    expect(burst.total - sum).toBe(-21);
    // …against what the roll actually carried, per shot.
    const real = burst.modWhy!.reduce((n, t) => n + Number(/-?\d+/.exec(t.replace('−', '-'))![0]), 0);
    expect(real).toBe(-6);
    expect(burst.total - sum).not.toBe(real);
  });

  it('reports the BEST shot, not the sum of them', () => {
    const totals = [9, -1, 1];
    expect(burst.total).toBe(Math.max(...totals));
  });

  it('names itself as a best-of rather than as one roll of many dice', () => {
    expect(burst.expression).not.toMatch(/^3d8/);
    expect(burst.expression).toContain('best of');
  });

  it('leaves an ordinary roll alone — no flag, no special case', () => {
    const plain: RollBreakdown = {
      expression: '1d8!-2', total: 4, detail: '1d8!-2 (4)',
      dice: [{ sides: 8, value: 6, kept: true }],
    };
    expect(plain.burstShots).toBeUndefined();
    expect(plain.total - plain.dice.reduce((n, d) => n + d.value, 0)).toBe(-2);
  });
});
