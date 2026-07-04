import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import { applyNpcBoost, needsNpcBoost, planNpcBoost } from '../src/systems/npcBoost5e.js';

describe('needsNpcBoost', () => {
  it('is false for a blank class (fresh level-1 PC setup) and for a real PC class', () => {
    expect(needsNpcBoost('')).toBe(false);
    expect(needsNpcBoost('Fighter')).toBe(false);
    expect(needsNpcBoost('  Wizard  ')).toBe(false);
  });

  it('is true for the "Monster" class every library NPC is stamped with', () => {
    expect(needsNpcBoost('Monster')).toBe(true);
  });

  it('is true for an arbitrary non-PC-class string (occupation/role flavor text)', () => {
    expect(needsNpcBoost('Guard Captain')).toBe(true);
  });
});

describe('planNpcBoost / applyNpcBoost', () => {
  it('a weak monster (low HP) boosted one tier lands near CR 1/8 stats', () => {
    const sheet = { ...dnd5e.defaultSheet(), class: 'Monster', maxHp: 4, hp: 4, ac: 12 };
    const plan = planNpcBoost(sheet, 1);
    expect(plan.fromCr).toBe('0');
    expect(plan.toCr).toBe('1/8');
    expect(plan.newMaxHp).toBeGreaterThan(4);
    expect(plan.newAc).toBeGreaterThanOrEqual(12);
  });

  it('never lowers an already-strong stat when boosting', () => {
    // AC 18 already exceeds CR 1's table AC of 13 — boosting must not reduce it.
    const sheet = { ...dnd5e.defaultSheet(), class: 'Monster', maxHp: 80, hp: 80, ac: 18 };
    const plan = planNpcBoost(sheet, 1);
    expect(plan.newAc).toBe(18);
    expect(plan.newMaxHp).toBeGreaterThan(80);
  });

  it('applies HP/AC/level to the sheet patch and heals proportionally to the HP gain', () => {
    const sheet = { ...dnd5e.defaultSheet(), class: 'Monster', maxHp: 30, hp: 10, ac: 13, level: 1 };
    const plan = planNpcBoost(sheet, 1);
    const patch = applyNpcBoost(sheet, plan);
    expect(patch.maxHp).toBe(plan.newMaxHp);
    expect(patch.ac).toBe(plan.newAc);
    expect(patch.level).toBe(plan.newLevel);
    // hp gained the same delta as maxHp, not reset to full.
    expect(Number(patch.hp)).toBe(10 + (plan.newMaxHp - 30));
  });

  it('bumps every attack row\'s bonus and appends/raises a flat damage bonus', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), class: 'Monster', maxHp: 80, hp: 80, ac: 13,
      attacks: [{ name: 'Claw', bonus: 3, damage: '1d6+1' }, { name: 'Bite', bonus: 3, damage: '2d4' }],
    };
    const plan = planNpcBoost(sheet, 3); // jump several tiers for a clearly nonzero gain
    const patch = applyNpcBoost(sheet, plan);
    const attacks = patch.attacks as Array<{ bonus: number; damage: string }>;
    expect(attacks[0].bonus).toBe(3 + plan.attackBonusGain);
    expect(attacks[1].bonus).toBe(3 + plan.attackBonusGain);
    expect(attacks[0].damage).toBe(`1d6+${1 + plan.damageBonusGain}`);
    expect(attacks[1].damage).toBe(`2d4+${plan.damageBonusGain}`);
  });

  it('boosting stops at the top of the table (CR 30) instead of throwing', () => {
    const sheet = { ...dnd5e.defaultSheet(), class: 'Monster', maxHp: 850, hp: 850, ac: 19 };
    const plan = planNpcBoost(sheet, 5);
    expect(plan.toCr).toBe('30');
  });
});
