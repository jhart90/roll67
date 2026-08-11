import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_TN, FAILED_ACTIVATION_PP, activationOutcome, backlashPatch, canRerollActivation,
  castingBlocker, disruptionPatch, hasActivePowers, isShorted, restRecovery, shortingPenalty,
  usesArcaneDevice,
} from '../src/systems/swadeActivation.js';
import type { DieRoll } from '../src/types.js';

const d = (value: number, extra: Partial<DieRoll> = {}): DieRoll =>
  ({ sides: 8, value, ...extra } as DieRoll);
/** A roll that is not a Critical Failure. */
const fine = [d(3), d(4, { wild: true })];
/** Snake eyes: trait die and Wild Die both showing 1. */
const snakeEyes = [d(1), d(1, { wild: true })];

const cast = (total: number, dice = fine, over = {}) =>
  activationOutcome({ total, dice, wildCard: true, cost: 3, ...over });

describe('the activation roll', () => {
  it('activates on a 4', () => {
    expect(cast(4).activated).toBe(true);
    expect(cast(4).verdict).toBe('success');
  });

  it('does not activate below 4', () => {
    expect(cast(3).activated).toBe(false);
    expect(cast(3).verdict).toBe('failure');
  });

  it('calls 4 over the target number a raise', () => {
    expect(cast(ACTIVATION_TN + 4).verdict).toBe('raise');
    expect(cast(ACTIVATION_TN + 3).verdict).toBe('success');
  });
});

describe('what it costs', () => {
  // "The power activates and consumes ALL the Power Points allocated to it,
  // even if it misses the target or the defender resists."
  it('spends the whole cost on a success', () => {
    expect(cast(6).ppSpent).toBe(3);
  });

  // "The caster spends one Power Point regardless." Charging the full cost
  // for a power that never went off was the engine's own invention.
  it('spends only one Power Point on a failure', () => {
    expect(cast(2).ppSpent).toBe(FAILED_ACTIVATION_PP);
    expect(cast(2).ppSpent).toBeLessThan(3);
  });

  it('never charges more than was paid in', () => {
    expect(cast(2, fine, { cost: 0, paid: 0 }).ppSpent).toBe(0);
  });
});

describe('Backlash', () => {
  it('is a Critical Failure while activating', () => {
    const out = cast(2, snakeEyes);
    expect(out.backlash).toBe(true);
    expect(out.verdict).toBe('backlash');
  });

  it('does not fire on an ordinary failure', () => {
    expect(cast(2).backlash).toBe(false);
  });

  it('does not fire on a success, whatever the dice show', () => {
    expect(cast(9, snakeEyes).backlash).toBe(false);
  });

  // A level of Fatigue, and everything currently running stops.
  it('costs Fatigue and drops every running power', () => {
    const patch = backlashPatch({ fatigue: 0, activePowers: [{ name: 'Fly', rounds: 3 }], armorActive: true });
    expect(patch.fatigue).toBe(1);
    expect(patch.activePowers).toEqual([]);
    expect(patch.armorActive).toBe(false);
  });

  it('respects the Fatigue cap', () => {
    expect(backlashPatch({ fatigue: 2 }).fatigue).toBe(2);
  });
});

describe('Shorting', () => {
  it('is −1 to the roll per point short', () => {
    expect(shortingPenalty(3, 0)).toBe(-3);
    expect(shortingPenalty(3, 2)).toBe(-1);
    expect(shortingPenalty(3, 3)).toBe(0);
  });

  it('is not shorting when the full cost is paid', () => {
    expect(isShorted(3, 3)).toBe(false);
    expect(isShorted(3, 1)).toBe(true);
  });

  // "If a character fails a shorted arcane skill roll, it's considered a
  // Critical Failure. That also means it can't be rerolled with a Benny!"
  it('turns any failed shorted cast into a Backlash', () => {
    const out = cast(2, fine, { cost: 3, paid: 1 });
    expect(out.verdict).toBe('backlash');
    expect(out.backlash).toBe(true);
  });

  it('refuses the Benny reroll a normal failure would allow', () => {
    expect(canRerollActivation(3, 1, false)).toBe(false);
    expect(canRerollActivation(3, 3, false)).toBe(true);
  });

  it('leaves a successful shorted cast alone', () => {
    expect(cast(6, fine, { cost: 3, paid: 1 }).verdict).toBe('success');
  });
});

describe('Disruption', () => {
  it('only threatens a caster who has something running', () => {
    expect(hasActivePowers({})).toBe(false);
    expect(hasActivePowers({ activePowers: [] })).toBe(false);
    expect(hasActivePowers({ activePowers: [{ name: 'Fly', rounds: 2 }] })).toBe(true);
    expect(hasActivePowers({ smiteActive: true })).toBe(true);
  });

  it('ignores a spent row that has already run out', () => {
    expect(hasActivePowers({ activePowers: [{ name: 'Fly', rounds: 0 }] })).toBe(false);
  });

  it('ends everything on a failure', () => {
    const patch = disruptionPatch();
    expect(patch.activePowers).toEqual([]);
    expect(patch.deflectionActive).toBe(false);
  });

  it('knows an Arcane Device when it sees one', () => {
    expect(usesArcaneDevice({ arcaneBackground: 'Weird Science (Arcane Device)' })).toBe(true);
    expect(usesArcaneDevice({ arcaneBackground: 'Magic' })).toBe(false);
  });
});

describe('Casting Requirements', () => {
  it('stops a Bound caster', () => {
    expect(castingBlocker(['bound'])).toMatch(/Bound/);
  });

  it('stops a caster who cannot see the target', () => {
    expect(castingBlocker(['blinded'])).toMatch(/see/);
  });

  it('lets an ordinary caster through', () => {
    expect(castingBlocker([])).toBeNull();
    expect(castingBlocker(['shaken', 'prone'])).toBeNull();
  });
});

describe('Recharging', () => {
  it('gives back five per hour', () => {
    expect(restRecovery({ pp: 0, maxPp: 20 }, 1)).toBe(5);
    expect(restRecovery({ pp: 0, maxPp: 20 }, 3)).toBe(15);
  });

  it('never overfills', () => {
    expect(restRecovery({ pp: 18, maxPp: 20 }, 4)).toBe(2);
    expect(restRecovery({ pp: 20, maxPp: 20 }, 4)).toBe(0);
  });

  it('gives nothing for less than an hour', () => {
    expect(restRecovery({ pp: 0, maxPp: 20 }, 0.5)).toBe(0);
  });
});
