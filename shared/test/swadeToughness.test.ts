import { describe, expect, it } from 'vitest';
import { swadeEffectiveToughness, swadeToughness } from '../src/systems/swade.js';
import { swadeDamageOutcome } from '../src/systems/swadeDamage.js';
import type { SheetData } from '../src/types.js';

// Vigor d6 → Toughness 2 + 3 = 5. Leather (+2 armor) makes 7; a Medium
// Shield adds +2 only against ranged attacks.
const leather = { name: 'Leather', armor: 2, equipped: true };
const shield = { name: 'Medium Shield', rangedArmor: 2, equipped: true };
const sheet = (armor: SheetData[]): SheetData => ({ vigor: 'd6', armor });

describe('swadeEffectiveToughness', () => {
  it('is plain Toughness for a melee blow with no AP', () => {
    const s = sheet([leather, shield]);
    expect(swadeToughness(s)).toBe(7);
    expect(swadeEffectiveToughness(s, { ranged: false, ap: 0 })).toEqual({ toughness: 7, base: 7, shield: 0, pierced: 0 });
  });

  it('adds the shield only against ranged attacks', () => {
    const s = sheet([leather, shield]);
    expect(swadeEffectiveToughness(s, { ranged: true, ap: 0 }).toughness).toBe(9);
    expect(swadeEffectiveToughness(sheet([leather]), { ranged: true, ap: 0 }).toughness).toBe(7);
  });

  it('lets AP pierce armor and the shield, never the base', () => {
    const s = sheet([leather, shield]);
    expect(swadeEffectiveToughness(s, { ranged: false, ap: 1 })).toMatchObject({ toughness: 6, pierced: 1 });
    expect(swadeEffectiveToughness(s, { ranged: false, ap: 4 })).toMatchObject({ toughness: 5, pierced: 2 });
    expect(swadeEffectiveToughness(s, { ranged: true, ap: 4 })).toMatchObject({ toughness: 5, pierced: 4 });
    // Unarmored: AP has nothing to bite.
    expect(swadeEffectiveToughness(sheet([]), { ranged: true, ap: 6 })).toMatchObject({ toughness: 5, pierced: 0 });
  });

  it('a damage total that EQUALS the number is Shaken — ties to the attacker, melee and ranged alike', () => {
    const s = sheet([leather, shield]);
    const melee = swadeEffectiveToughness(s, { ranged: false, ap: 0 }).toughness;
    const ranged = swadeEffectiveToughness(s, { ranged: true, ap: 0 }).toughness;
    const opts = { alreadyShaken: false, wildCard: true, currentWounds: 0 };
    expect(swadeDamageOutcome(melee, melee, opts).shaken).toBe(true);
    expect(swadeDamageOutcome(ranged, ranged, opts).shaken).toBe(true);
    expect(swadeDamageOutcome(melee - 1, melee, opts).shaken).toBe(false);
    expect(swadeDamageOutcome(ranged - 1, ranged, opts).shaken).toBe(false);
    // Four over is a raise: a Wound.
    expect(swadeDamageOutcome(melee + 4, melee, opts).woundsDealt).toBe(1);
  });
});
