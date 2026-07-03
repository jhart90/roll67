import { describe, expect, it } from 'vitest';
import { swn } from '../src/systems/swn.js';
import {
  applyBackground, applyFocus, applyLevelUpSwn, applyPackage, getSwnClass,
  planLevelUpSwn, swnAttackBonus, SWN_BACKGROUNDS, SWN_FOCI, SWN_PACKAGES,
} from '../src/systems/swnData.js';

describe('SWN classes & attack bonus', () => {
  it('warrior has the better attack progression + HP bonus', () => {
    expect(getSwnClass('warrior')?.hpBonusPerLevel).toBe(2);
    expect(swnAttackBonus('warrior', 1)).toBe(1);
    expect(swnAttackBonus('warrior', 10)).toBe(8);
    expect(swnAttackBonus('expert', 10)).toBe(5);
    expect(swnAttackBonus('psychic', 1)).toBe(0);
  });
});

describe('SWN level-up', () => {
  it('first level sets HP to max hit die + CON (+2 for Warrior) and attack bonus', () => {
    const sheet = { ...swn.defaultSheet(), con: 14 }; // CON mod +1
    const plan = planLevelUpSwn(sheet, 'warrior', 1)!;
    expect(plan.first).toBe(true);
    expect(plan.firstHp).toBe(9); // 6 + 1 CON + 2 Warrior
    const patch = applyLevelUpSwn(sheet, 'warrior', 1, { hpGained: plan.firstHp });
    expect(patch.maxHp).toBe(9);
    expect(patch.hp).toBe(9);
    expect(patch.attackBonus).toBe(1);
    expect(patch.class).toBe('Warrior');
    const foci = patch.foci as Array<{ id: string }>;
    expect(foci.some((f) => f.id === 'class-warrior')).toBe(true);
  });

  it('later levels add HP rather than replacing it', () => {
    const sheet = { ...swn.defaultSheet(), class: 'Expert', level: 1, maxHp: 6, hp: 6 };
    const patch = applyLevelUpSwn(sheet, 'expert', 2, { hpGained: 4 });
    expect(patch.maxHp).toBe(10);
    expect(patch.hp).toBe(10);
    expect(patch.attackBonus).toBe(1);
  });

  it('first level can apply a background and its free skill', () => {
    const sheet = swn.defaultSheet();
    const patch = applyLevelUpSwn(sheet, 'expert', 1, { hpGained: 6, background: 'soldier' });
    expect(patch.background).toBe('Soldier');
    const skills = patch.skills as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'Shoot')).toBe(true);
  });
});

describe('SWN backgrounds', () => {
  it('grants the free skill without duplicating an existing one', () => {
    const sheet = { ...swn.defaultSheet(), skills: [{ name: 'Shoot', level: 1, attr: 'dex', notes: '' }] };
    const patch = applyBackground(sheet, 'soldier');
    const skills = patch.skills as Array<{ name: string; level: number }>;
    expect(skills.filter((s) => s.name === 'Shoot').length).toBe(1);
    expect(skills.find((s) => s.name === 'Shoot')?.level).toBe(1);
  });
  it('has 20 backgrounds', () => expect(SWN_BACKGROUNDS.length).toBe(20));
});

describe('SWN foci', () => {
  it('adds a focus at level 1 and grants its skill', () => {
    const patch = applyFocus(swn.defaultSheet(), 'gunslinger');
    const foci = patch.foci as Array<{ id: string; level: number }>;
    expect(foci[0].id).toBe('gunslinger');
    expect(foci[0].level).toBe(1);
    const skills = patch.skills as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'Shoot')).toBe(true);
  });

  it('re-applying a focus raises it to level 2 with the level-2 text', () => {
    const first = applyFocus(swn.defaultSheet(), 'sniper');
    const patched = { ...swn.defaultSheet(), foci: first.foci };
    const second = applyFocus(patched, 'sniper');
    const foci = second.foci as Array<{ id: string; level: number; notes: string }>;
    expect(foci[0].level).toBe(2);
    expect(foci[0].notes).toContain('extra damage');
  });

  it('Die Hard boosts max HP by 2 per level', () => {
    const sheet = { ...swn.defaultSheet(), level: 3, maxHp: 20, hp: 20 };
    const patch = applyFocus(sheet, 'die-hard');
    expect(patch.maxHp).toBe(26); // +2 * level 3
    expect(patch.hp).toBe(26);
  });

  it('has a healthy focus catalog', () => expect(SWN_FOCI.length).toBeGreaterThanOrEqual(20));
});

describe('SWN equipment packages', () => {
  it('adds weapons, armor, gear and credits', () => {
    const patch = applyPackage(swn.defaultSheet(), 'soldier');
    const attacks = patch.attacks as Array<{ name: string }>;
    const armor = patch.armor as Array<{ name: string }>;
    const inv = patch.inventory as unknown[];
    expect(attacks.some((a) => a.name === 'Combat Rifle')).toBe(true);
    expect(armor.length).toBe(1);
    expect(inv.length).toBeGreaterThan(0);
    expect(patch.credits).toBe(50);
  });
  it('offers packages A–F', () => expect(SWN_PACKAGES.length).toBe(6));
});
