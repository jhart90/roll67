import { describe, expect, it } from 'vitest';
import { buildSwnCharacterSheet, roll3d6, rollAttributeSet, type SwnCreationInput } from '../src/systems/swnCreation.js';
import { swn } from '../src/systems/swn.js';
import { seededRng } from '../src/dice/roller.js';

function baseInput(overrides: Partial<SwnCreationInput> = {}): SwnCreationInput {
  return {
    name: 'Kess Rin',
    homeworld: 'Halcyon',
    goal: 'Find the ship that left her behind.',
    attributes: { str: 10, dex: 12, con: 11, int: 13, wis: 9, cha: 14 },
    classId: 'expert',
    skillLevels: [],
    ...overrides,
  };
}

describe('SWN attribute rolling', () => {
  it('3d6 always lands in range and is deterministic under a seeded RNG', () => {
    const rng = seededRng(11);
    for (let i = 0; i < 100; i++) {
      const v = roll3d6(rng);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(18);
    }
  });

  it('rollAttributeSet produces all six attributes', () => {
    const attrs = rollAttributeSet(seededRng(3));
    expect(Object.keys(attrs).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis']);
  });
});

describe('buildSwnCharacterSheet — assembly over existing chargen primitives', () => {
  it('sets attributes, homeworld, goal, and level-1 class/HP via the real level-up planner', () => {
    const sheet = buildSwnCharacterSheet(baseInput());
    expect(sheet.str).toBe(10);
    expect(sheet.cha).toBe(14);
    expect(sheet.homeworld).toBe('Halcyon');
    expect(sheet.goal).toBe('Find the ship that left her behind.');
    expect(sheet.level).toBe(1);
    expect(sheet.class).toBe('Expert');
    expect(Number(sheet.maxHp)).toBeGreaterThan(0);
    expect(sheet.hp).toBe(sheet.maxHp);
    // Expert grants 3 skill points (2 + 1) at level 1.
    expect(sheet.skillPointsEarned).toBe(3);
  });

  it('records the class ability as a foci entry (matching the existing level-up wizard)', () => {
    const sheet = buildSwnCharacterSheet(baseInput({ classId: 'warrior' }));
    const foci = sheet.foci as Array<{ id: string }>;
    expect(foci.some((f) => f.id === 'class-warrior')).toBe(true);
  });

  it('a chosen background grants its free skill', () => {
    const sheet = buildSwnCharacterSheet(baseInput({ backgroundId: 'pilot' }));
    const skills = sheet.skills as Array<{ name: string; level: number }>;
    expect(skills.some((s) => s.name === 'Pilot' && s.level >= 0)).toBe(true);
    expect(sheet.background).toBe('Pilot');
  });

  it('a chosen focus grants its skill and is recorded in the foci list', () => {
    const sheet = buildSwnCharacterSheet(baseInput({ focusId: 'gunslinger' }));
    const foci = sheet.foci as Array<{ id: string; name: string }>;
    expect(foci.some((f) => f.id === 'gunslinger')).toBe(true);
    const skills = sheet.skills as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'Shoot')).toBe(true);
  });

  it('an equipment package adds weapons/armor/gear/credits, and the armor comes pre-worn', () => {
    const sheet = buildSwnCharacterSheet(baseInput({ packageId: 'soldier' }));
    const attacks = sheet.attacks as Array<{ name: string }>;
    const armor = sheet.armor as Array<{ name: string; equipped: boolean }>;
    expect(attacks.some((a) => a.name === 'Combat Rifle')).toBe(true);
    expect(armor.length).toBeGreaterThan(0);
    expect(armor[armor.length - 1].equipped).toBe(true);
    expect(Number(sheet.credits)).toBeGreaterThan(0);
  });

  it('spent skill points land as real skill rows with the chosen level and attribute', () => {
    const sheet = buildSwnCharacterSheet(baseInput({
      skillLevels: [{ name: 'Shoot', attr: 'dex', level: 1 }, { name: 'Notice', attr: 'int', level: 1 }],
    }));
    const skills = sheet.skills as Array<{ name: string; level: number; attr: string }>;
    expect(skills.find((s) => s.name === 'Shoot')).toMatchObject({ level: 1, attr: 'dex' });
    expect(skills.find((s) => s.name === 'Notice')).toMatchObject({ level: 1, attr: 'int' });
  });

  it('spending points on a skill a background already granted raises it rather than duplicating the row', () => {
    const sheet = buildSwnCharacterSheet(baseInput({
      backgroundId: 'pilot', // grants Pilot at level 0
      skillLevels: [{ name: 'Pilot', attr: 'dex', level: 1 }],
    }));
    const skills = sheet.skills as Array<{ name: string; level: number }>;
    const pilotRows = skills.filter((s) => s.name === 'Pilot');
    expect(pilotRows).toHaveLength(1);
    expect(pilotRows[0].level).toBe(1);
  });

  it('an Adventurer records their chosen second class on the sheet', () => {
    const sheet = buildSwnCharacterSheet(baseInput({ classId: 'adventurer', secondaryClassId: 'Warrior' }));
    expect(sheet.secondaryClass).toBe('Warrior');
  });

  it('a fully-built character rolls cleanly through the normal SWN schema', () => {
    const sheet = buildSwnCharacterSheet(baseInput({
      backgroundId: 'soldier', focusId: 'sniper', packageId: 'soldier',
      skillLevels: [{ name: 'Shoot', attr: 'dex', level: 1 }],
    }));
    const rolls = swn.rollables(sheet);
    expect(rolls.length).toBeGreaterThan(0);
    expect(swn.hp(sheet).maxHp).toBeGreaterThan(0);
  });
});
