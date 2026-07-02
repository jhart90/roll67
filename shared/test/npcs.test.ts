import { describe, expect, it } from 'vitest';
import { ALL_NPCS, npcById, npcCategories, npcsForSystem } from '../src/data/npcLibrary.js';
import { systemFor } from '../src/systems/index.js';

describe('pre-built NPC library', () => {
  it('has at least 200 entries', () => {
    expect(ALL_NPCS.length).toBeGreaterThanOrEqual(200);
  });

  it('covers both systems substantially', () => {
    expect(npcsForSystem('dnd5e').length).toBeGreaterThanOrEqual(140);
    expect(npcsForSystem('swn').length).toBeGreaterThanOrEqual(50);
  });

  it('all ids are unique and resolvable', () => {
    const ids = new Set(ALL_NPCS.map((n) => n.id));
    expect(ids.size).toBe(ALL_NPCS.length);
    for (const n of ALL_NPCS) expect(npcById(n.id)).toBe(n);
  });

  it('every entry has a usable sheet (hp, ac, at least vision stats)', () => {
    for (const n of ALL_NPCS) {
      const schema = systemFor(n.system);
      const hp = schema.hp(n.sheet);
      expect(hp.maxHp, n.id).toBeGreaterThan(0);
      expect(hp.hp, n.id).toBe(hp.maxHp);
      const vision = schema.vision(n.sheet);
      expect(vision.visionRange, n.id).toBeGreaterThan(0);
      expect(n.ac, n.id).toBeGreaterThan(0);
      expect(n.category.length, n.id).toBeGreaterThan(0);
    }
  });

  it('every entry produces rollable attacks when it has attacks', () => {
    for (const n of ALL_NPCS) {
      const attacks = n.sheet.attacks as Array<Record<string, unknown>>;
      if (!attacks || attacks.length === 0) continue;
      const rolls = systemFor(n.system).rollables(n.sheet);
      expect(rolls.some((r) => r.id.startsWith('attack_')), n.id).toBe(true);
    }
  });

  it('categories are non-empty and stable per system', () => {
    expect(npcCategories('dnd5e').length).toBeGreaterThanOrEqual(8);
    expect(npcCategories('swn').length).toBeGreaterThanOrEqual(5);
  });
});
