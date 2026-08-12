import { describe, expect, it } from 'vitest';
import {
  extraWoundsFor, scaleFor, scaleLabel, sizeAttackMod, sizeAttackTag,
} from '../src/systems/swadeSize.js';

describe('the Size Table', () => {
  // Every band boundary off the book's page.
  it.each([
    [-4, -6, 'Tiny', 0],
    [-3, -4, 'Very Small', 0],
    [-2, -2, 'Small', 0],
    [-1, 0, 'Normal', 0],
    [0, 0, 'Normal', 0],
    [3, 0, 'Normal', 0],
    [4, 2, 'Large', 1],
    [7, 2, 'Large', 1],
    [8, 4, 'Huge', 2],
    [11, 4, 'Huge', 2],
    [12, 6, 'Gargantuan', 3],
    [20, 6, 'Gargantuan', 3],
  ])('Size %i is Scale %i (%s), +%i wounds', (size, scale, label, wounds) => {
    expect(scaleFor(size as number)).toBe(scale);
    expect(scaleLabel(size as number)).toBe(label);
    expect(extraWoundsFor(size as number)).toBe(wounds);
  });

  it('clamps past either end of the table', () => {
    expect(scaleFor(-99)).toBe(-6);
    expect(scaleFor(999)).toBe(6);
  });

  it('treats a missing or junk Size as Normal', () => {
    expect(scaleFor(NaN)).toBe(0);
  });
});

describe('Scale difference on attacks', () => {
  // The book's own two worked examples.
  it('gives a Tiny fairy +10 to hurl a bolt at a Huge dragon', () => {
    expect(sizeAttackMod(-4, 9)).toBe(10);
  });

  it('costs a Very Small eagle 2 to attack a Tiny fairy', () => {
    expect(sizeAttackMod(-3, -4)).toBe(-2);
  });

  // The common case: nothing happens, which is most rolls at most tables.
  it('is nothing between two Normal creatures', () => {
    expect(sizeAttackMod(0, 2)).toBe(0);
    expect(sizeAttackTag(0, 2)).toBeNull();
  });

  it('is symmetric — what one side adds, the other subtracts', () => {
    expect(sizeAttackMod(0, 8)).toBe(-sizeAttackMod(8, 0));
  });

  it('names both scales in the tag', () => {
    expect(sizeAttackTag(-4, 9)).toBe('+10 Scale (Tiny vs Huge)');
    expect(sizeAttackTag(9, -4)).toBe('−10 Scale (Huge vs Tiny)');
  });
});

import { hasHeavyArmor } from '../src/systems/swadeSize.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import { num } from '../src/systems/types.js';

/**
 * Heavy Armor is a wall, not a discount: an ordinary weapon does nothing at
 * all to a Gargantuan hull. Getting the boundary right is what keeps a
 * boarding action interesting and a cutlass-versus-warship fight from
 * happening at all.
 */
describe('Heavy Armor', () => {
  it('comes with Gargantuan size and not before it', () => {
    expect(hasHeavyArmor({ size: 12 })).toBe(true);
    expect(hasHeavyArmor({ size: 20 })).toBe(true);
    expect(hasHeavyArmor({ size: 11 })).toBe(false);
    expect(hasHeavyArmor({ size: 0 })).toBe(false);
  });

  it('can be declared by something merely Huge, like a tank', () => {
    expect(hasHeavyArmor({ size: 8, flag: true })).toBe(true);
    expect(hasHeavyArmor({ size: 8, flag: false })).toBe(false);
  });

  it('covers the ships that need it and spares the brigantine', () => {
    const byName = (n: string) => NPCS_SWADE.find((x) => x.name === n)!;
    const heavy = (n: string) => hasHeavyArmor({
      size: num(byName(n).sheet, 'size', 0), flag: byName(n).sheet.heavyArmor,
    });
    expect(heavy('East Indiaman')).toBe(true);
    expect(heavy('Sailing Ship')).toBe(true);
    expect(heavy('Main Battle Tank')).toBe(true);
    // Huge, not Gargantuan — she can be chopped at, slowly.
    expect(heavy('Pirate Brigantine')).toBe(false);
    expect(heavy('Pirate Captain')).toBe(false);
  });

  it('arms those ships with something that can answer', () => {
    const attacks = (n: string) => (NPCS_SWADE.find((x) => x.name === n)!.sheet.attacks ?? []) as Array<Record<string, unknown>>;
    expect(attacks('East Indiaman').some((a) => a.heavy === true)).toBe(true);
    // The gunner on the wharf is the one crewman who can hurt a hull.
    expect(attacks('VOC Gunner').some((a) => a.heavy === true)).toBe(true);
    expect(attacks('Pirate Cutthroat').some((a) => a.heavy === true)).toBe(false);
  });
});

describe('bestiary sizes', () => {
  it('gives every SWADE creature a Size', () => {
    for (const npc of NPCS_SWADE) {
      expect(typeof npc.sheet.size, `${npc.name} has no size`).toBe('number');
    }
  });

  it('reads the size the entry states rather than defaulting it', () => {
    const byName = (n: string) => NPCS_SWADE.find((x) => x.name === n)!;
    expect(num(byName('Alamosaurus').sheet, 'size', 0)).toBe(8);   // "Size +8 (Huge)"
    expect(num(byName('Triceratops').sheet, 'size', 0)).toBe(5);   // "Size +5"
    expect(num(byName('Triceratops Cub').sheet, 'size', 0)).toBe(1); // stated in the note
  });

  // A Huge dinosaur swinging at a person eats the Scale penalty, and the
  // person swinging back gets the bonus.
  it('makes a Huge creature harder for it to hit a person, and easier the other way', () => {
    const huge = num(NPCS_SWADE.find((x) => x.name === 'Alamosaurus')!.sheet, 'size', 0);
    expect(sizeAttackMod(huge, 0)).toBe(-4);
    expect(sizeAttackMod(0, huge)).toBe(4);
  });
});

import { swadeWoundCap } from '../src/systems/swadeSize.js';
import { swadeDamageOutcome } from '../src/systems/swadeDamage.js';

describe('wound cap from Size', () => {
  it('is the book three for a normal Wild Card, none for an Extra', () => {
    expect(swadeWoundCap({ wildCard: true, size: 0 })).toBe(3);
    expect(swadeWoundCap({ wildCard: false, size: 0 })).toBe(0);
  });

  it('adds the band bonus on top', () => {
    expect(swadeWoundCap({ wildCard: true, size: 5 })).toBe(4);   // Large
    expect(swadeWoundCap({ wildCard: true, size: 9 })).toBe(5);   // Huge
    expect(swadeWoundCap({ wildCard: false, size: 9 })).toBe(2);  // Huge Extra
    expect(swadeWoundCap({ wildCard: true, size: 14 })).toBe(6);  // Gargantuan
  });

  it('lets an override win outright', () => {
    expect(swadeWoundCap({ wildCard: false, size: 0, override: 5 })).toBe(5);
  });

  // A blank number field reads as 0, and nobody means "dies instantly" by it.
  it('treats a blank override as no override', () => {
    expect(swadeWoundCap({ wildCard: true, size: 0, override: 0 })).toBe(3);
  });

  it('keeps a Huge Extra standing through wounds that would drop a normal one', () => {
    const opts = { alreadyShaken: false, wildCard: false, currentWounds: 1 };
    expect(swadeDamageOutcome(9, 5, opts).incapacitated).toBe(true);
    expect(swadeDamageOutcome(9, 5, { ...opts, maxWounds: 2 }).incapacitated).toBe(false);
  });
});
