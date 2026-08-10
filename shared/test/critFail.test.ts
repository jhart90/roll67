import { describe, expect, it } from 'vitest';
import { swadeCritFail, swadeSnakeEyes } from '../src/systems/swade.js';
import type { DieRoll } from '../src/types.js';

const d = (value: number, extra: Partial<DieRoll> = {}): DieRoll =>
  ({ sides: 6, value, kept: true, ...extra });

describe('swadeSnakeEyes', () => {
  it('is both arms showing a natural 1', () => {
    expect(swadeSnakeEyes([d(1), d(1, { wild: true })])).toBe(true);
  });

  it('needs BOTH — one 1 alone is an ordinary failure', () => {
    expect(swadeSnakeEyes([d(1), d(4, { wild: true })])).toBe(false);
    expect(swadeSnakeEyes([d(5), d(1, { wild: true })])).toBe(false);
  });

  it('is false when there is no Wild Die at all', () => {
    // An Extra's roll, and any non-SWADE roll that happens to contain a 1 —
    // neither should light up the table.
    expect(swadeSnakeEyes([d(1)])).toBe(false);
    expect(swadeSnakeEyes([d(1, { sides: 20 })])).toBe(false);
  });

  it('ignores a raise die: you cannot earn one and still have failed', () => {
    // A bonus d6 that happens to land on 1 must not manufacture snake eyes.
    expect(swadeSnakeEyes([d(6), d(1, { raise: true }), d(1, { wild: true })])).toBe(false);
  });

  it('still fires when an ace chain follows the 1s', () => {
    // The trait die aced later in the array; the two 1s are what matter.
    expect(swadeSnakeEyes([d(1), d(1, { wild: true }), d(6, { ace: true })])).toBe(true);
  });

  it('is false for an empty roll', () => {
    expect(swadeSnakeEyes([])).toBe(false);
  });
});

describe('swadeCritFail', () => {
  it('for a Wild Card, is exactly snake eyes', () => {
    expect(swadeCritFail([d(1), d(1, { wild: true })], true)).toBe(true);
    expect(swadeCritFail([d(1), d(3, { wild: true })], true)).toBe(false);
  });

  it('for an Extra, a lone natural 1 is the whole rule — they roll no Wild Die', () => {
    expect(swadeCritFail([d(1)], false)).toBe(true);
    expect(swadeCritFail([d(2)], false)).toBe(false);
  });

  it("does not let an Extra's raise die damn them", () => {
    expect(swadeCritFail([d(5), d(1, { raise: true })], false)).toBe(false);
  });
});
