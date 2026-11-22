import { describe, expect, it } from 'vitest';
import type { Character } from '../src/types.js';
import { combatActions } from '../src/systems/combat.js';
import { swade, swadeDamageExpr } from '../src/systems/swade.js';

const pc = (sheet: Record<string, unknown>): Character =>
  ({ id: 'chad', campaignId: 'x', ownerUserId: 'u', name: 'Chad', system: 'swade', sheet: { ...swade.defaultSheet(), ...sheet } });

describe('SWADE "Str" in a weapon damage field', () => {
  it('becomes the current acing Strength die, and the weapon die aces too', () => {
    expect(swadeDamageExpr({ strength: 'd10' }, 'Str+d4')).toBe('1d10!+1d4!');
    expect(swadeDamageExpr({ strength: 'd8' }, 'str + 1d6!')).toBe('1d8!+1d6!');
    expect(swadeDamageExpr({ strength: 'd6' }, 'Strength+d8+2')).toBe('1d6!+1d8!+2');
    expect(swadeDamageExpr({ strength: 'd12' }, 'Str')).toBe('1d12!');
  });

  it('leaves a field without Str exactly as typed (compendium rows already fold Str in)', () => {
    expect(swadeDamageExpr({ strength: 'd10' }, '1d10!+1d4!')).toBe('1d10!+1d4!');
    expect(swadeDamageExpr({ strength: 'd10' }, '2d6!+1')).toBe('2d6!+1');
  });

  it('a knife typed "Str+d4" attacks with Str+d4, and follows Strength as it rises', () => {
    const knife = { name: 'Knife', skill: 'Fighting', damage: 'Str+d4', range: 5 };
    const a = combatActions(pc({ strength: 'd10', attacks: [knife] })).find((x) => x.id === 'attack:0');
    expect(a?.amountExpr).toBe('1d10!+1d4!');
    const b = combatActions(pc({ strength: 'd12', attacks: [knife] })).find((x) => x.id === 'attack:0');
    expect(b?.amountExpr).toBe('1d12!+1d4!');
  });
});

describe('SWADE Unarmed action', () => {
  it('is always offered: Fighting with the Wild Die to hit, bare Str die for damage', () => {
    const a = combatActions(pc({ strength: 'd10', skills: [{ name: 'Fighting', die: 'd10' }] }))
      .find((x) => x.id === 'unarmed');
    expect(a).toBeDefined();
    expect(a!.attackExpr).toMatch(/^best\(1d10!, 1d6!\)/);
    expect(a!.amountExpr).toBe('1d10!');
    expect(a!.ranged).toBe(false);
    expect(a!.rangeFt).toBe(5);
  });

  it('steps aside when the sheet lists its own fists', () => {
    const acts = combatActions(pc({ attacks: [{ name: 'Unarmed (Brawler)', skill: 'Fighting', damage: 'Str+d4' }] }));
    expect(acts.find((x) => x.id === 'unarmed')).toBeUndefined();
  });
});
