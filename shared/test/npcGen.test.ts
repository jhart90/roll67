import { describe, expect, it } from 'vitest';
import { generateNpc } from '../src/data/npcGen.js';
import { seededRng } from '../src/dice/roller.js';
import { systemFor } from '../src/systems/index.js';

describe('random NPC generator', () => {
  it('produces a named 5e NPC with a usable sheet', () => {
    const npc = generateNpc('dnd5e', seededRng(1));
    expect(npc.name).toMatch(/\w+ \w+/);
    expect(npc.tags.length).toBeGreaterThanOrEqual(3);
    const schema = systemFor('dnd5e');
    const hp = schema.hp(npc.sheet);
    expect(hp.maxHp).toBeGreaterThan(0);
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      expect(typeof npc.sheet[ab]).toBe('number');
    }
    // Vision is present so the NPC works on a map.
    expect(schema.vision(npc.sheet).visionRange).toBeGreaterThan(0);
  });

  it('produces an SWN NPC with attributes and a background', () => {
    const npc = generateNpc('swn', seededRng(2));
    expect(npc.name).toBeTruthy();
    expect(typeof npc.sheet.background).toBe('string');
    expect(systemFor('swn').hp(npc.sheet).maxHp).toBeGreaterThan(0);
  });

  it('is deterministic with a seeded RNG and varied without', () => {
    const a = generateNpc('dnd5e', seededRng(42));
    const b = generateNpc('dnd5e', seededRng(42));
    expect(a).toEqual(b);
    const names = new Set(Array.from({ length: 20 }, (_, i) => generateNpc('dnd5e', seededRng(i)).name));
    expect(names.size).toBeGreaterThan(5); // meaningfully varied
  });
});
