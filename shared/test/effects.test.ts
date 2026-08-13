import { describe, expect, it } from 'vitest';
import {
  applyDamageDefenses, applyDamageMultiplier, attackAdvantage, conditionCombat, conditionsFor, conditionsOf,
  critDamageExpr, damageMultiplier, multiplierLabel, CONDITIONS, CONDITION_COLORS,
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

  /**
   * SWADE does not halve or double. Environmental Resistance and Weakness
   * move the total by a flat four — one raise, and so exactly one Wound —
   * which is a different answer from the 5e model at every damage value
   * except eight.
   */
  describe('applyDamageDefenses', () => {
    const sheet = { resist: 'fire', vulnerable: 'cold', immune: 'poison' };

    it('shifts a SWADE hit by four in either direction', () => {
      expect(applyDamageDefenses('swade', sheet, 'fire', 11).amount).toBe(7);
      expect(applyDamageDefenses('swade', sheet, 'cold', 11).amount).toBe(15);
      expect(applyDamageDefenses('swade', sheet, 'slashing', 11).amount).toBe(11);
    });

    it('never drives a resisted SWADE hit below zero', () => {
      expect(applyDamageDefenses('swade', sheet, 'fire', 3).amount).toBe(0);
    });

    it('zeroes an immunity in every system', () => {
      for (const sys of ['swade', 'dnd5e', 'swn'] as const) {
        expect(applyDamageDefenses(sys, sheet, 'poison', 20)).toEqual({ amount: 0, label: 'immune' });
      }
    });

    it('keeps halving and doubling for the systems that use them', () => {
      expect(applyDamageDefenses('dnd5e', sheet, 'fire', 11).amount).toBe(5);
      expect(applyDamageDefenses('dnd5e', sheet, 'cold', 11).amount).toBe(22);
      expect(applyDamageDefenses('swn', sheet, 'fire', 11).amount).toBe(5);
    });

    it('says which defence fired, for the chat card', () => {
      expect(applyDamageDefenses('swade', sheet, 'fire', 11).label).toMatch(/resistance −4/);
      expect(applyDamageDefenses('swade', sheet, 'cold', 11).label).toMatch(/weakness \+4/);
      expect(applyDamageDefenses('swade', sheet, 'slashing', 11).label).toBe('');
    });
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
  it('advantage and disadvantage cancel out', () => {
    // melee vs prone: advantage from prone
    expect(attackAdvantage(null, [], ['prone'], false)).toBe('adv');
    // ranged vs prone: disadvantage from prone
    expect(attackAdvantage(null, [], ['prone'], true)).toBe('dis');
  });

  it("attacker's own poisoned gives disadvantage; target restrained gives advantage → cancel", () => {
    expect(attackAdvantage(null, ['poisoned'], ['restrained'], false)).toBe(null);
  });

  it('honors the chosen adv/dis when no conditions apply', () => {
    expect(attackAdvantage('adv', [], [], false)).toBe('adv');
    expect(attackAdvantage('dis', [], [], false)).toBe('dis');
    expect(attackAdvantage(null, [], [], false)).toBe(null);
  });

  it('judges each target condition against range individually (restrained + prone)', () => {
    // RAW: restrained always grants advantage; prone grants ranged attackers
    // disadvantage → the two cancel to a normal ranged attack (the old fold
    // misread the pair as prone's own split and returned flat disadvantage).
    expect(attackAdvantage(null, [], ['restrained', 'prone'], true)).toBe(null);
    // Melee: both grant advantage → advantage.
    expect(attackAdvantage(null, [], ['restrained', 'prone'], false)).toBe('adv');
  });

  it('restrained + invisible target vs melee cancels to normal', () => {
    // Restrained grants advantage, invisible grants disadvantage → normal.
    expect(attackAdvantage(null, [], ['restrained', 'invisible'], false)).toBe(null);
  });

  it('an invisible attacker rolls with advantage', () => {
    expect(attackAdvantage(null, ['invisible'], [], false)).toBe('adv');
    // ...and a blinded invisible attacker cancels back to normal.
    expect(attackAdvantage(null, ['invisible', 'blinded'], [], false)).toBe(null);
  });
});

describe('condition colours', () => {
  it('gives every condition one, so none of them falls back to plain grey', () => {
    const missing = CONDITIONS.filter((c) => !CONDITION_COLORS[c.id]).map((c) => c.id);
    expect(missing, 'conditions with no colour').toEqual([]);
  });

  it('gives each one a pair — one for the dark log, one for the light', () => {
    for (const c of CONDITIONS) {
      const pair = CONDITION_COLORS[c.id]!;
      expect(pair.on, `${c.id}.on`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pair.alt, `${c.id}.alt`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pair.on).not.toBe(pair.alt);
    }
  });
});
