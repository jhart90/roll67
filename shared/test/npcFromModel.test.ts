import { describe, expect, it } from 'vitest';
import { generateNpcFromModel, npcKindForEntry } from '../src/data/npcGen.js';
import { npcById } from '../src/data/npcLibrary.js';
import { seededRng } from '../src/dice/roller.js';
import { systemFor } from '../src/systems/index.js';

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
    // Creature names come from the epithet pool, not the townsfolk first/last pools.
    expect(npc.name).toMatch(/\w+ the \S+/);
    expect(String(npc.sheet.notes)).toContain('ancient red dragon');
    expect(String(npc.sheet.backstory)).toContain('ancient red dragon');
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
});
