import { describe, expect, it } from 'vitest';
import {
  ABILITY_IDS, BACKGROUNDS_DEF_5E, KIT_BY_CLASS_5E, POINT_BUY_BUDGET, RACE_TRAITS_5E, STANDARD_ARRAY_5E,
  abilityMod5e, buildDnd5eCharacterSheet, finalAbilities5e, getRace5e, grantedSkills5e,
  pointBuyCost, pointBuySpent, roll4d6DropLowest, type AbilityId, type Dnd5eCreationInput,
} from '../src/systems/dnd5eCreation.js';
import { RACES_5E, BACKGROUNDS_5E, dnd5e } from '../src/systems/dnd5e.js';
import { CLASS_LIST_5E } from '../src/systems/classes5e.js';
import { seededRng } from '../src/dice/roller.js';
import { combatActions } from '../src/systems/combat.js';
import type { Character } from '../src/types.js';

const BASE: Record<AbilityId, number> = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

function input(over: Partial<Dnd5eCreationInput> = {}): Dnd5eCreationInput {
  return {
    name: 'Test Hero', raceName: 'Hill Dwarf', classId: 'fighter', backgroundName: 'Soldier',
    alignment: 'Lawful Good', baseAbilities: { ...BASE }, raceFreeAbilities: [],
    skillIds: ['athletics', 'perception'], takeKit: true, ...over,
  };
}

describe('5e character creation data', () => {
  it('every race in the dropdown has traits, and every background has two skills', () => {
    for (const name of RACES_5E) expect(getRace5e(name), name).toBeTruthy();
    expect(RACE_TRAITS_5E).toHaveLength(RACES_5E.length);
    for (const name of BACKGROUNDS_5E) {
      const bg = BACKGROUNDS_DEF_5E.find((b) => b.name === name);
      expect(bg, name).toBeTruthy();
      expect(bg!.skills.length, name).toBe(2);
    }
  });

  it('every class has a starting kit', () => {
    for (const c of CLASS_LIST_5E) expect(KIT_BY_CLASS_5E.get(c.id), c.id).toBeTruthy();
  });

  it('point buy prices the standard curve and the array fits the budget', () => {
    expect(pointBuyCost(8)).toBe(0);
    expect(pointBuyCost(13)).toBe(5);
    expect(pointBuyCost(14)).toBe(7);
    expect(pointBuyCost(15)).toBe(9);
    // 15/14/13/12/10/8 costs 9+7+5+4+2+0 = 27 — exactly the budget.
    const arr: Record<AbilityId, number> = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    expect(pointBuySpent(arr)).toBe(POINT_BUY_BUDGET);
    expect(STANDARD_ARRAY_5E).toEqual([15, 14, 13, 12, 10, 8]);
  });

  it('4d6-drop-lowest stays in range and is deterministic under a seed', () => {
    const rng = seededRng(11);
    for (let i = 0; i < 200; i++) {
      const v = roll4d6DropLowest(rng);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(18);
    }
    expect(roll4d6DropLowest(seededRng(5))).toBe(roll4d6DropLowest(seededRng(5)));
  });

  it('racial increases apply, including freely-assigned ones', () => {
    // Hill Dwarf: +2 CON, +1 WIS
    const dwarf = finalAbilities5e(BASE, 'Hill Dwarf', []);
    expect(dwarf.con).toBe(15);
    expect(dwarf.wis).toBe(11);
    expect(dwarf.str).toBe(15); // untouched
    // Half-Elf: +2 CHA and two free +1s
    const halfElf = finalAbilities5e(BASE, 'Half-Elf', ['str', 'dex']);
    expect(halfElf.cha).toBe(10);
    expect(halfElf.str).toBe(16);
    expect(halfElf.dex).toBe(15);
    // Extra picks past the race's allowance are ignored.
    const greedy = finalAbilities5e(BASE, 'Half-Elf', ['str', 'dex', 'con']);
    expect(greedy.con).toBe(13);
  });

  it('skills merge class picks with background grants, without duplicates', () => {
    // Soldier grants athletics + intimidation; athletics is also a class pick.
    const skills = grantedSkills5e(['athletics', 'perception'], 'Soldier');
    expect(skills.sort()).toEqual(['athletics', 'intimidation', 'perception']);
  });
});

describe('buildDnd5eCharacterSheet', () => {
  it('assembles a level-1 sheet: HP from hit die + CON, speed, darkvision, proficiencies', () => {
    const sheet = buildDnd5eCharacterSheet(input());
    expect(sheet.level).toBe(1);
    expect(sheet.class).toBe('Fighter');
    expect(sheet.race).toBe('Hill Dwarf');
    // Fighter d10 + CON 15 (13 base +2 dwarf) = +2 → 12 HP
    expect(sheet.maxHp).toBe(12);
    expect(sheet.hp).toBe(sheet.maxHp);
    expect(sheet.hitDice).toBe('1d10');
    expect(sheet.speed).toBe(25);      // dwarf
    expect(sheet.darkvision).toBe(60); // dwarf
    // Fighter saves: STR + CON
    expect(sheet.save_str).toBe(true);
    expect(sheet.save_con).toBe(true);
    expect(sheet.save_dex).toBeUndefined();
    // class picks + Soldier's grants
    expect(sheet.skill_athletics).toBe(true);
    expect(sheet.skill_perception).toBe(true);
    expect(sheet.skill_intimidation).toBe(true);
  });

  it('kit weapons become usable attacks with to-hit and damage baked in', () => {
    const sheet = buildDnd5eCharacterSheet(input());
    const attacks = sheet.attacks as Array<Record<string, unknown>>;
    const longsword = attacks.find((a) => a.name === 'Longsword')!;
    // STR 15 → +2, proficiency +2 → +4 to hit, 1d8+2 damage
    expect(longsword.bonus).toBe(4);
    expect(longsword.damage).toBe('1d8+2');
    // The light crossbow is ranged, so it uses DEX (14 → +2)
    const crossbow = attacks.find((a) => a.name === 'Light Crossbow')!;
    expect(crossbow.bonus).toBe(4);
    expect(crossbow.range).toBe(80);
  });

  it('kit armor arrives equipped so derived AC is correct immediately', () => {
    const sheet = buildDnd5eCharacterSheet(input());
    const armor = sheet.armor as Array<Record<string, unknown>>;
    expect(armor.every((a) => a.equipped === true)).toBe(true);
    // Chain mail 16 (no Dex) + shield 2 = 18
    expect(Number(dnd5e.derive(sheet).ac)).toBe(18);
  });

  it('the assembled sheet produces working combat actions', () => {
    const sheet = buildDnd5eCharacterSheet(input());
    const character = { id: 'c', campaignId: 'x', ownerUserId: 'u', name: 'Test Hero', system: 'dnd5e', sheet } as unknown as Character;
    const actions = combatActions(character);
    expect(actions.some((a) => a.label === 'Longsword')).toBe(true);
    const sword = actions.find((a) => a.label === 'Longsword')!;
    expect(sword.attackExpr).toBe('1d20+4');
    expect(sword.amountExpr).toBe('1d8+2');
  });

  it('spellcasters get their level-1 slots and casting ability', () => {
    const wizard = buildDnd5eCharacterSheet(input({ classId: 'wizard', raceName: 'High Elf' }));
    expect(wizard.spellAbility).toBe('int');
    expect(wizard.slots1).toBe(2);
    expect(wizard.slots2).toBeUndefined();
    // A fighter is not a caster at level 1.
    const fighter = buildDnd5eCharacterSheet(input());
    expect(fighter.spellAbility).toBeUndefined();
    expect(fighter.slots1).toBeUndefined();
  });

  it('records race, background, and level-1 class features as editable rows', () => {
    const sheet = buildDnd5eCharacterSheet(input());
    const features = sheet.features as Array<{ name: string; source: string; description: string }>;
    expect(features.some((f) => f.source === 'Race')).toBe(true);
    expect(features.some((f) => f.source.startsWith('Background'))).toBe(true);
    expect(features.some((f) => f.source === 'Fighter 1')).toBe(true);
  });

  it('skipping the kit leaves gear empty but the rest intact', () => {
    const sheet = buildDnd5eCharacterSheet(input({ takeKit: false }));
    expect(sheet.attacks).toEqual([]);
    expect(sheet.armor).toEqual([]);
    expect(sheet.inventory).toEqual([]);
    expect(sheet.maxHp).toBe(12);
  });

  it('every class + race combination builds a valid sheet', () => {
    for (const cls of CLASS_LIST_5E) {
      for (const race of RACES_5E) {
        const sheet = buildDnd5eCharacterSheet(input({ classId: cls.id, raceName: race, raceFreeAbilities: ['str', 'dex'] }));
        expect(Number(sheet.maxHp), `${cls.id}/${race}`).toBeGreaterThan(0);
        for (const id of ABILITY_IDS) {
          expect(Number(sheet[id]), `${cls.id}/${race} ${id}`).toBeGreaterThanOrEqual(3);
        }
        expect(() => dnd5e.rollables(sheet)).not.toThrow();
      }
    }
  });
});

describe('ability modifiers', () => {
  it('follow the 5e curve', () => {
    expect(abilityMod5e(8)).toBe(-1);
    expect(abilityMod5e(10)).toBe(0);
    expect(abilityMod5e(15)).toBe(2);
    expect(abilityMod5e(20)).toBe(5);
  });
});
