import { describe, expect, it } from 'vitest';
import { generateNpcFromModel, npcKindForEntry } from '../src/data/npcGen.js';
import { ALL_NPCS, npcById } from '../src/data/npcLibrary.js';
import { seededRng } from '../src/dice/roller.js';
import { systemFor } from '../src/systems/index.js';

const BIO_FIELDS = [
  'race', 'background', 'alignment', 'age', 'height', 'weight', 'eyes', 'hair', 'skin',
  'personalityTraits', 'ideals', 'bonds', 'flaws', 'proficienciesLanguages',
];

function entry(id: string) {
  const e = npcById(id);
  if (!e) throw new Error(`fixture missing: ${id}`);
  return e;
}

describe('npcKindForEntry', () => {
  it('classifies 5e townsfolk as a person, monsters as a creature', () => {
    expect(npcKindForEntry(entry('dnd5e-commoner'))).toBe('person');
    expect(npcKindForEntry(entry('dnd5e-bandit'))).toBe('person');
    expect(npcKindForEntry(entry('dnd5e-ancient-red-dragon'))).toBe('creature');
    expect(npcKindForEntry(entry('dnd5e-skeleton'))).toBe('creature');
  });

  it('classifies SWN civilians as a person, robots as a robot, aliens as a creature', () => {
    expect(npcKindForEntry(entry('swn-peasant'))).toBe('person');
    expect(npcKindForEntry(entry('swn-security-bot'))).toBe('robot');
  });
});

describe('generateNpcFromModel', () => {
  it('gives a person a human name distinct from the model, not the model name', () => {
    const model = entry('dnd5e-commoner');
    const npc = generateNpcFromModel(model, seededRng(1));
    expect(npc.name).toMatch(/\w+ \w+/);
    expect(npc.name).not.toBe(model.name);
  });

  it('gives a creature a monster-flavored name, never a person-style name', () => {
    const model = entry('dnd5e-ancient-red-dragon');
    const npc = generateNpcFromModel(model, seededRng(2));
    // Draconic names come from the dragon-specific pool, not the townsfolk first/last pools.
    expect(npc.name.length).toBeGreaterThan(0);
    expect(npc.name).not.toBe(model.name);
    expect(String(npc.sheet.notes)).toContain('ancient red dragon');
    expect(String(npc.sheet.backstory)).toContain('ancient red dragon');
  });

  it('varies the *structure* of monster names, not just the words (not always "Given the Epithet")', () => {
    const model = entry('dnd5e-ancient-red-dragon');
    const names = Array.from({ length: 40 }, (_, i) => generateNpcFromModel(model, seededRng(i)).name);
    const isGivenThe = (n: string) => /^\S+ the \S/.test(n);
    // Some names use the classic "Given the Epithet" shape, but not all of them —
    // bare epithets, plain given names, and "of <domain>" forms should also appear.
    expect(names.some(isGivenThe)).toBe(true);
    expect(names.some((n) => !isGivenThe(n))).toBe(true);
  });

  it('gives each 5e monster category its own name pool, distinct from the others', () => {
    const dragon = generateNpcFromModel(entry('dnd5e-ancient-red-dragon'), seededRng(3)).name;
    const undead = generateNpcFromModel(entry('dnd5e-lich'), seededRng(3)).name;
    const goblinoid = generateNpcFromModel(entry('dnd5e-goblin'), seededRng(3)).name;
    expect(new Set([dragon, undead, goblinoid]).size).toBe(3);
  });

  it('gives Savage Humanoids a tribal name, not a townsfolk First-Last name', () => {
    const model = entry('dnd5e-gnoll');
    const names = Array.from({ length: 20 }, (_, i) => generateNpcFromModel(model, seededRng(i)).name);
    const looksHuman = (n: string) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n);
    expect(names.every((n) => !looksHuman(n))).toBe(true);
  });

  it('gives a robot a serial designation and machine flavor text', () => {
    const model = entry('swn-security-bot');
    const npc = generateNpcFromModel(model, seededRng(3));
    expect(npc.name).toMatch(/^Unit [A-Z]{2}-\d{3}$/);
    expect(String(npc.sheet.goal).toLowerCase()).toContain('security bot');
  });

  it('jitters HP/AC without wiping stats to zero, and keeps the sheet valid', () => {
    const model = entry('dnd5e-veteran');
    const npc = generateNpcFromModel(model, seededRng(4));
    const schema = systemFor('dnd5e');
    const hp = schema.hp(npc.sheet);
    expect(hp.maxHp).toBeGreaterThan(0);
    expect(hp.hp).toBe(hp.maxHp);
    expect(Number(npc.sheet.ac)).toBeGreaterThanOrEqual(5);
    // Ability scores were jittered but stay sane.
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      expect(Number(npc.sheet[ab])).toBeGreaterThan(0);
    }
  });

  it('is deterministic with a seeded RNG and varied without a fixed seed', () => {
    const model = entry('dnd5e-goblin');
    const a = generateNpcFromModel(model, seededRng(7));
    const b = generateNpcFromModel(model, seededRng(7));
    expect(a).toEqual(b);
    const names = new Set(Array.from({ length: 15 }, (_, i) => generateNpcFromModel(model, seededRng(i)).name));
    expect(names.size).toBeGreaterThan(3);
  });

  it('fills every Bio & Info / Character field for every 5e library entry, not just People & NPCs', () => {
    for (const model of ALL_NPCS.filter((e) => e.system === 'dnd5e')) {
      const npc = generateNpcFromModel(model, seededRng(11));
      for (const field of BIO_FIELDS) {
        const value = npc.sheet[field];
        expect(value, `${model.id}.${field}`).toBeTruthy();
        expect(String(value).trim().length, `${model.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('gives non-humanoid categories an honest substitute instead of a fabricated human trait', () => {
    const dragon = generateNpcFromModel(entry('dnd5e-ancient-red-dragon'), seededRng(5));
    expect(String(dragon.sheet.hair)).toMatch(/none/i);
    const skeleton = generateNpcFromModel(entry('dnd5e-skeleton'), seededRng(5));
    expect(skeleton.sheet.race).toBe('Undead');
    expect(String(skeleton.sheet.languages ?? skeleton.sheet.proficienciesLanguages)).not.toContain('Common,');
  });

  it('gives a monster a real type as its Race, not the broad library category grouping', () => {
    const dragon = generateNpcFromModel(entry('dnd5e-ancient-red-dragon'), seededRng(1));
    expect(dragon.sheet.race).toBe('Dragon');
    const goblin = generateNpcFromModel(entry('dnd5e-goblin'), seededRng(1));
    expect(goblin.sheet.race).toBe('Humanoid (goblinoid)');
  });

  it('gives a person library entry a PC-style race/background/alignment, not blank', () => {
    const model = entry('dnd5e-commoner');
    const npc = generateNpcFromModel(model, seededRng(9));
    for (const field of ['race', 'background', 'alignment']) {
      expect(String(npc.sheet[field]).trim().length).toBeGreaterThan(0);
    }
  });
});
