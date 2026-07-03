import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import {
  CLASS_LIST_5E, getClass5e, spellSlotsForClass,
} from '../src/systems/classes5e.js';
import { applyLevelUp, planLevelUp } from '../src/systems/levelup5e.js';

describe('class definitions', () => {
  it('covers all 13 5e classes', () => {
    expect(CLASS_LIST_5E).toHaveLength(13);
    for (const c of CLASS_LIST_5E) {
      expect(c.saves).toHaveLength(2);
      expect(c.hitDie).toBeGreaterThanOrEqual(6);
      expect(getClass5e(c.name)).toBe(c); // resolvable by display name too
    }
  });
});

describe('spell slots', () => {
  it('full caster follows the standard table', () => {
    expect(spellSlotsForClass('full', 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass('full', 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass('full', 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });
  it('half caster (Paladin/Ranger) has no slots at level 1, then rounds up', () => {
    expect(spellSlotsForClass('half', 1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass('half', 2)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass('half', 5)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('Artificer (half, round up) gets slots at level 1', () => {
    expect(spellSlotsForClass('half', 1, true)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('Warlock pact magic: a few slots, all at the highest level', () => {
    expect(spellSlotsForClass('pact', 1)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass('pact', 3)).toEqual([0, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass('pact', 11)).toEqual([0, 0, 0, 0, 3, 0, 0, 0, 0]);
  });
  it('non-caster has no slots', () => {
    expect(spellSlotsForClass('none', 20)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('level-up plan + apply', () => {
  it('level 1 Fighter sets saves, hit die, HP and skills', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 0, con: 14, hp: 0, maxHp: 0 };
    const plan = planLevelUp(sheet, 'fighter', 1)!;
    expect(plan.hitDie).toBe(10);
    expect(plan.avgHp).toBe(6 + 2); // 10/2+1=6, +2 CON
    expect(plan.needsSkills).toBe(2);
    expect(plan.featuresGained.map((f) => f.name)).toContain('Second Wind');

    const patch = applyLevelUp(sheet, 'fighter', 1, { hpGained: 12, skills: ['athletics', 'perception'] });
    expect(patch.level).toBe(1);
    expect(patch.class).toBe('Fighter');
    expect(patch.save_str).toBe(true);
    expect(patch.save_con).toBe(true);
    expect(patch.maxHp).toBe(12);
    expect(patch.hp).toBe(12);
    expect(patch.skill_athletics).toBe(true);
    expect((patch.features as unknown[]).length).toBeGreaterThan(0);
  });

  it('Fighter has extra ASI levels (6 and 14)', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 5 };
    expect(planLevelUp(sheet, 'fighter', 6)!.asi).toBe(true);
    expect(planLevelUp(sheet, 'wizard', 6)!.asi).toBe(false);
  });

  it('ASI: +2 to one ability caps at 20', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 3, str: 19 };
    const patch = applyLevelUp(sheet, 'fighter', 4, { hpGained: 6, asi: { mode: 'asi', a: 'str', b: 'str' } });
    expect(patch.str).toBe(20); // 19 +1 +1 capped at 20
  });

  it('a full-caster level-up sets the spell-slot totals', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 4, int: 16, class: 'Wizard' };
    const patch = applyLevelUp(sheet, 'wizard', 5, { hpGained: 4 });
    expect(patch.slots1).toBe(4);
    expect(patch.slots3).toBe(2);
    expect(patch.spellAbility).toBeUndefined(); // only set on the first level (class already set)
  });

  it('Cleric chooses a subclass at level 1', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 0 };
    expect(planLevelUp(sheet, 'cleric', 1)!.needsSubclass).toBe(true);
    const patch = applyLevelUp(sheet, 'cleric', 1, { hpGained: 8, subclass: 'Life Domain', skills: ['medicine'] });
    expect(patch.subclass).toBe('Life Domain');
    expect(patch.spellAbility).toBe('wis');
  });
});
