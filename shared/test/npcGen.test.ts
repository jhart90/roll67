import { describe, expect, it } from 'vitest';
import { generateNpc } from '../src/data/npcGen.js';
import { seededRng } from '../src/dice/roller.js';
import { systemFor } from '../src/systems/index.js';

describe('random NPC generator', () => {
  it('produces a named 5e NPC with a fully filled sheet', () => {
    const npc = generateNpc('dnd5e', seededRng(1));
    expect(npc.name).toMatch(/\w+ \w+/);
    expect(npc.tags.length).toBeGreaterThanOrEqual(3);
    const schema = systemFor('dnd5e');
    expect(schema.hp(npc.sheet).maxHp).toBeGreaterThan(0);
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      expect(typeof npc.sheet[ab]).toBe('number');
    }
    expect(schema.vision(npc.sheet).visionRange).toBeGreaterThan(0);
    // Character-building fields are all populated with plausible content.
    for (const f of ['race', 'background', 'alignment', 'age', 'height', 'weight', 'eyes', 'skin', 'hair',
      'personalityTraits', 'ideals', 'bonds', 'flaws', 'backstory', 'proficienciesLanguages']) {
      expect(String(npc.sheet[f] ?? '').length, f).toBeGreaterThan(0);
    }
    expect(Array.isArray(npc.sheet.features) && (npc.sheet.features as unknown[]).length).toBeTruthy();
    expect(Array.isArray(npc.sheet.inventory) && (npc.sheet.inventory as unknown[]).length).toBeTruthy();
    // The starting weapon is a click-to-roll attack.
    expect(schema.rollables(npc.sheet).some((r) => r.id.startsWith('attack_'))).toBe(true);
  });

  it('produces an SWN NPC with attributes, gear, and bio filled', () => {
    const npc = generateNpc('swn', seededRng(2));
    expect(npc.name).toBeTruthy();
    for (const f of ['background', 'homeworld', 'species', 'goal', 'age', 'height', 'weight', 'notes']) {
      expect(String(npc.sheet[f] ?? '').length, f).toBeGreaterThan(0);
    }
    expect(systemFor('swn').hp(npc.sheet).maxHp).toBeGreaterThan(0);
    expect(Array.isArray(npc.sheet.skills) && (npc.sheet.skills as unknown[]).length).toBeTruthy();
    expect(Array.isArray(npc.sheet.attacks) && (npc.sheet.attacks as unknown[]).length).toBeTruthy();
  });

  it('is deterministic with a seeded RNG and varied without', () => {
    const a = generateNpc('dnd5e', seededRng(42));
    const b = generateNpc('dnd5e', seededRng(42));
    expect(a).toEqual(b);
    const names = new Set(Array.from({ length: 20 }, (_, i) => generateNpc('dnd5e', seededRng(i)).name));
    expect(names.size).toBeGreaterThan(5); // meaningfully varied
  });
});
