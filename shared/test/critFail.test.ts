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

  it('does not count the 1 that ENDS an ace chain — that die rolled 13, not 1', () => {
    // A jump: trait d6 came up 1, Wild Die went 6 → 6 → 1 for thirteen. The
    // roll succeeded handsomely, and for a while this called it a fumble.
    expect(swadeSnakeEyes([
      d(1),
      d(6, { wild: true, ace: true }), d(6, { wild: true, ace: true }), d(1, { wild: true }),
    ])).toBe(false);
  });

  it('…nor the trait die that aced into one', () => {
    expect(swadeSnakeEyes([
      d(6, { ace: true }), d(1),
      d(1, { wild: true }),
    ])).toBe(false);
  });

  it('still fires when both arms genuinely fumble beside an aced third die', () => {
    expect(swadeSnakeEyes([
      d(6, { ace: true }), d(4),          // some other die, aced and done
      d(1), d(1, { wild: true }),
    ])).toBe(true);
  });
});

describe('swadeCritFail', () => {
  it('for a Wild Card, is exactly snake eyes', () => {
    expect(swadeCritFail([d(1), d(1, { wild: true })], true)).toBe(true);
    expect(swadeCritFail([d(1), d(3, { wild: true })], true)).toBe(false);
  });

  /**
   * An Extra has no Wild Die to pair a 1 with, so the book confirms with a
   * d6: only a 1 on THAT is a Critical Failure. Treating the bare 1 as one —
   * which this used to — fumbled a mob six times too often.
   */
  it('for an Extra, a natural 1 is confirmed by a d6', () => {
    expect(swadeCritFail([d(1)], false, () => 1)).toBe(true);
    expect(swadeCritFail([d(1)], false, () => 2)).toBe(false);
    expect(swadeCritFail([d(1)], false, () => 6)).toBe(false);
  });

  it('does not roll the confirming d6 at all without a natural 1', () => {
    let rolled = 0;
    expect(swadeCritFail([d(2)], false, () => { rolled++; return 1; })).toBe(false);
    expect(rolled).toBe(0);
  });

  it("treats an unconfirmed 1 as a plain failure when nobody asks", () => {
    expect(swadeCritFail([d(1)], false)).toBe(false);
  });

  it("does not let an Extra's raise die damn them", () => {
    expect(swadeCritFail([d(5), d(1, { raise: true })], false, () => 1)).toBe(false);
  });

  it("does not damn an Extra whose die aced into a 1", () => {
    let rolled = 0;
    expect(swadeCritFail([d(6, { ace: true }), d(1)], false, () => { rolled++; return 1; })).toBe(false);
    expect(rolled).toBe(0);
  });

  it('never asks for a confirming die on a Wild Card', () => {
    let rolled = 0;
    swadeCritFail([d(1), d(1, { wild: true })], true, () => { rolled++; return 1; });
    expect(rolled).toBe(0);
  });
});

describe('what a Critical Failure is immune to', () => {
  /**
   * The case that found this: a +4 for a Large target carried snake eyes to a
   * total of 5, which beat TN 4, and the engine called it a hit. It is not a
   * hit. A Critical Failure fails outright — the modifiers are exactly what
   * it does not care about.
   */
  it('is still snake eyes however big the bonus on the roll', () => {
    const dice = [d(1), d(1, { wild: true })];
    expect(swadeSnakeEyes(dice)).toBe(true);
    // The engine adds the modifier to the TOTAL, never to the dice, so the
    // predicate reading the dice is the one that cannot be fooled.
    expect(swadeCritFail(dice, true)).toBe(true);
  });

  it('…and a good total off good dice is still a good roll', () => {
    expect(swadeCritFail([d(1), d(5, { wild: true })], true)).toBe(false);
  });
});
