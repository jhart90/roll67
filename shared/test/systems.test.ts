import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import { swn, swnMod } from '../src/systems/swn.js';

describe('D&D 5e sheet', () => {
  it('default sheet has sane values', () => {
    const sheet = dnd5e.defaultSheet();
    expect(sheet.level).toBe(1);
    expect(sheet.str).toBe(10);
    expect(sheet.hp).toBe(10);
    expect(Array.isArray(sheet.attacks)).toBe(true);
  });

  it('derives ability modifiers', () => {
    const sheet = { ...dnd5e.defaultSheet(), str: 16, dex: 8, con: 13 };
    const d = dnd5e.derive(sheet);
    expect(d.strMod).toBe('+3');
    expect(d.dexMod).toBe('-1');
    expect(d.conMod).toBe('+1');
  });

  it('proficiency bonus scales with level (2 at 1, 3 at 5, 4 at 9, 6 at 17)', () => {
    for (const [level, pb] of [[1, '+2'], [4, '+2'], [5, '+3'], [9, '+4'], [17, '+6']] as const) {
      expect(dnd5e.derive({ ...dnd5e.defaultSheet(), level }).profBonus).toBe(pb);
    }
  });

  it('saves add proficiency only when proficient', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 5, str: 16, save_str: true, save_dex: false, dex: 16 };
    const d = dnd5e.derive(sheet);
    expect(d.save_str).toBe('+6'); // +3 mod +3 prof
    expect(d.save_dex).toBe('+3'); // mod only
  });

  it('skill bonuses use the right ability', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 1, wis: 14, skill_perception: true };
    const d = dnd5e.derive(sheet);
    expect(d.skill_perception).toBe('+4'); // +2 wis, +2 prof
    expect(d.skill_athletics).toBe('+0');
  });

  it('spell DC = 8 + prof + ability mod', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 5, int: 18, spellAbility: 'int' };
    expect(dnd5e.derive(sheet).spellDc).toBe(8 + 3 + 4);
  });

  it('rollables include checks, saves, skills, and attacks with baked modifiers', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), str: 16, level: 5,
      attacks: [{ name: 'Longsword', bonus: 7, damage: '1d8+4' }],
    };
    const rolls = dnd5e.rollables(sheet);
    expect(rolls.find((r) => r.id === 'check_str')?.expr).toBe('1d20+3');
    expect(rolls.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+7');
    expect(rolls.find((r) => r.id === 'damage_0')?.expr).toBe('1d8+4');
    expect(rolls.find((r) => r.id === 'attack_0')?.d20).toBe(true);
    expect(rolls.find((r) => r.id === 'damage_0')?.d20).toBe(false);
  });

  it('exposes vision stats and hp for the VTT', () => {
    const sheet = { ...dnd5e.defaultSheet(), visionRange: 30, darkvision: 12, hp: 21, maxHp: 30 };
    expect(dnd5e.vision(sheet)).toEqual({ visionRange: 30, darkvision: 12 });
    expect(dnd5e.hp(sheet)).toEqual({ hp: 21, maxHp: 30 });
  });

  it('with nothing equipped, AC falls back to the manually-typed field (existing NPCs unaffected)', () => {
    const sheet = { ...dnd5e.defaultSheet(), ac: 16, dex: 18, armor: [] };
    expect(dnd5e.derive(sheet).ac).toBe(16);
  });

  it('equipping body armor overrides the manual AC field with base + capped Dex', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), ac: 10, dex: 18, // +4 dex
      armor: [{ name: 'Breastplate', baseAc: 14, addDex: true, maxDex: 2, equipped: true }],
    };
    expect(dnd5e.derive(sheet).ac).toBe(16); // 14 + min(4, 2)
  });

  it('unequipping armor falls back to the manual AC field again', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), ac: 10, dex: 18,
      armor: [{ name: 'Breastplate', baseAc: 14, addDex: true, maxDex: 2, equipped: false }],
    };
    expect(dnd5e.derive(sheet).ac).toBe(10);
  });

  it('an equipped shield adds its AC on top, whether or not body armor is worn', () => {
    const unarmored = { ...dnd5e.defaultSheet(), ac: 10, armor: [{ name: 'Shield', baseAc: 2, shield: true, equipped: true }] };
    expect(dnd5e.derive(unarmored).ac).toBe(12);
    const armored = {
      ...dnd5e.defaultSheet(), ac: 10, dex: 10,
      armor: [
        { name: 'Chain Mail', baseAc: 16, addDex: false, equipped: true },
        { name: 'Shield', baseAc: 2, shield: true, equipped: true },
      ],
    };
    expect(dnd5e.derive(armored).ac).toBe(18);
  });

  it('an equipped item AC/save bonus (e.g. Cloak of Protection) applies only while equipped', () => {
    const worn = {
      ...dnd5e.defaultSheet(), ac: 12, level: 5, str: 16, save_str: true,
      inventory: [{ name: 'Cloak of Protection', acBonus: 1, saveBonus: 1, equipped: true }],
    };
    expect(dnd5e.derive(worn).ac).toBe(13);
    expect(dnd5e.derive(worn).save_str).toBe('+7'); // +3 mod +3 prof +1 item
    const stashed = { ...worn, inventory: [{ ...worn.inventory[0], equipped: false }] };
    expect(dnd5e.derive(stashed).ac).toBe(12);
    expect(dnd5e.derive(stashed).save_str).toBe('+6');
  });

  it('save rollables also carry the equipped item bonus', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), dex: 14,
      inventory: [{ name: 'Ring of Protection', acBonus: 1, saveBonus: 1, equipped: true }],
    };
    const rolls = dnd5e.rollables(sheet);
    expect(rolls.find((r) => r.id === 'save_dex')?.expr).toBe('1d20+3'); // +2 mod +1 item
  });
});

describe('SWN sheet', () => {
  it('attribute modifier bands', () => {
    expect(swnMod(3)).toBe(-2);
    expect(swnMod(5)).toBe(-1);
    expect(swnMod(10)).toBe(0);
    expect(swnMod(14)).toBe(1);
    expect(swnMod(18)).toBe(2);
  });

  it('saves are 15 - level - best relevant mod', () => {
    const sheet = { ...swn.defaultSheet(), level: 3, str: 14, con: 10, dex: 18, int: 7, wis: 10, cha: 10 };
    const d = swn.derive(sheet);
    expect(d.save_physical).toBe(15 - 3 - 1); // str +1 beats con 0
    expect(d.save_evasion).toBe(15 - 3 - 2); // dex +2 beats int -1
    expect(d.save_mental).toBe(15 - 3 - 0);
  });

  it('skill checks roll 2d6 + level + attribute mod', () => {
    const sheet = {
      ...swn.defaultSheet(), int: 14,
      skills: [{ name: 'Program', level: 2, attr: 'int' }],
    };
    const rolls = swn.rollables(sheet);
    expect(rolls.find((r) => r.id === 'skill_0')?.expr).toBe('2d6+3');
  });

  it('attacks add the sheet attack bonus', () => {
    const sheet = {
      ...swn.defaultSheet(), attackBonus: 2,
      attacks: [{ name: 'Laser', bonus: 1, damage: '1d10' }],
    };
    const rolls = swn.rollables(sheet);
    expect(rolls.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+3');
  });

  it('initiative uses 1d8 + dex mod', () => {
    expect(swn.initiativeExpr({ ...swn.defaultSheet(), dex: 16 })).toBe('1d8+1');
  });
});
