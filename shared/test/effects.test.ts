import { describe, expect, it } from 'vitest';
import {
  applyDamageMultiplier, attackAdvantage, conditionCombat, conditionsFor, conditionsOf,
  critDamageExpr, damageMultiplier, multiplierLabel,
} from '../src/systems/effects.js';

describe('damage types & resistance', () => {
  it('reads resist/vulnerable/immune lists off the sheet', () => {
    const sheet = { resist: 'fire, cold', vulnerable: 'thunder', immune: 'poison' };
    expect(damageMultiplier(sheet, 'fire')).toBe(0.5);
    expect(damageMultiplier(sheet, 'THUNDER')).toBe(2);
    expect(damageMultiplier(sheet, 'poison')).toBe(0);
    expect(damageMultiplier(sheet, 'slashing')).toBe(1);
    expect(damageMultiplier(sheet, '')).toBe(1);
  });

  it('immunity beats resistance beats vulnerability', () => {
    const sheet = { resist: 'fire', immune: 'fire', vulnerable: 'fire' };
    expect(damageMultiplier(sheet, 'fire')).toBe(0);
  });

  it('applies the multiplier with floor, never negative', () => {
    expect(applyDamageMultiplier(7, 0.5)).toBe(3);
    expect(applyDamageMultiplier(10, 2)).toBe(20);
    expect(applyDamageMultiplier(9, 0)).toBe(0);
    expect(multiplierLabel(0)).toBe('immune');
    expect(multiplierLabel(0.5)).toBe('resisted');
    expect(multiplierLabel(2)).toBe('vulnerable');
    expect(multiplierLabel(1)).toBe('');
  });
});

describe('critical-hit dice doubling', () => {
  it('doubles dice counts but not flat modifiers', () => {
    expect(critDamageExpr('1d8+3')).toBe('2d8+3');
    expect(critDamageExpr('2d6')).toBe('4d6');
    expect(critDamageExpr('d10+2')).toBe('2d10+2');
    expect(critDamageExpr('1d12+1d6+2')).toBe('2d12+2d6+2');
    expect(critDamageExpr('5')).toBe('5');
  });
});

describe('conditions', () => {
  it('filters conditions by system', () => {
    const swn = conditionsFor('swn').map((c) => c.id);
    expect(swn).toContain('prone');
    expect(swn).not.toContain('charmed'); // 5e-only
    expect(conditionsFor('dnd5e').map((c) => c.id)).toContain('charmed');
  });

  it('reads active conditions off a sheet', () => {
    expect(conditionsOf({ conditions: ['prone', 'poisoned'] })).toEqual(['prone', 'poisoned']);
    expect(conditionsOf({})).toEqual([]);
  });

  it('folds conditions into combat implications', () => {
    const c = conditionCombat(['prone', 'poisoned']);
    expect(c.grantsAttackAdv).toBe(true);   // prone (melee)
    expect(c.grantsAttackDis).toBe(true);   // prone (ranged)
    expect(c.selfAttackDis).toBe(true);     // prone/poisoned
    const stunned = conditionCombat(['stunned']);
    expect(stunned.incapacitated).toBe(true);
    expect(stunned.grantsAttackAdv).toBe(true);
  });
});

describe('attack advantage resolution', () => {
  const none = conditionCombat([]);
  it('advantage and disadvantage cancel out', () => {
    const prone = conditionCombat(['prone']);
    // melee vs prone: advantage from prone
    expect(attackAdvantage(null, none, prone, false)).toBe('adv');
    // ranged vs prone: disadvantage from prone
    expect(attackAdvantage(null, none, prone, true)).toBe('dis');
  });

  it("attacker's own poisoned gives disadvantage; target restrained gives advantage → cancel", () => {
    const poisoned = conditionCombat(['poisoned']);
    const restrained = conditionCombat(['restrained']);
    expect(attackAdvantage(null, poisoned, restrained, false)).toBe(null);
  });

  it('honors the chosen adv/dis when no conditions apply', () => {
    expect(attackAdvantage('adv', none, none, false)).toBe('adv');
    expect(attackAdvantage('dis', none, none, false)).toBe('dis');
    expect(attackAdvantage(null, none, none, false)).toBe(null);
  });
});
