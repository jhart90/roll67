import { describe, expect, it } from 'vitest';
import { ALL_NPCS, npcById, npcCategories, npcsForSystem } from '../src/data/npcLibrary.js';
import { weaponRangeFt5e, weaponRangeFtSwn } from '../src/data/compendiumTypes.js';
import { ITEMS_5E } from '../src/data/items5e.js';
import { CONTENT_SWN } from '../src/data/contentSwn.js';
import { combatActions } from '../src/systems/combat.js';
import { systemFor } from '../src/systems/index.js';
import type { Character } from '../src/types.js';

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

  it('a named attack matching a real ranged compendium weapon gets its actual range, not the melee default', () => {
    // Regression test: attackRows() used to build every prebuilt NPC's
    // attacks with no compendium lookup at all, so a named weapon like
    // "Longbow" silently fell back to the schema's 5-ft melee default —
    // making every ranged NPC attack unusable beyond one hex.
    const rangedWeaponsByName = new Map<string, number>();
    for (const c of ITEMS_5E) {
      if (c.kind === 'weapon' && c.weapon) rangedWeaponsByName.set(c.name.toLowerCase(), weaponRangeFt5e(c.weapon.props));
    }
    for (const c of CONTENT_SWN) {
      if (c.kind === 'weapon' && c.weapon) rangedWeaponsByName.set(c.name.toLowerCase(), weaponRangeFtSwn(c.weapon.props));
    }
    let checked = 0;
    for (const n of ALL_NPCS) {
      const attacks = n.sheet.attacks as Array<Record<string, unknown>> | undefined;
      if (!attacks) continue;
      for (const atk of attacks) {
        const expected = rangedWeaponsByName.get(String(atk.name).toLowerCase());
        if (expected === undefined || expected <= 5) continue; // only a real ranged weapon proves the bug
        checked++;
        expect(atk.range, `${n.id}: ${atk.name}`).toBe(expected);
      }
    }
    expect(checked).toBeGreaterThan(10); // sanity: the library actually contains ranged weapons to check
  });

  it('categories are non-empty and stable per system', () => {
    expect(npcCategories('dnd5e').length).toBeGreaterThanOrEqual(8);
    expect(npcCategories('swn').length).toBeGreaterThanOrEqual(5);
  });
});

// Breath weapons (and similar "0 to-hit" special attacks) previously defaulted
// to a flat 5-ft to-hit-vs-AC attack with no save/area — every one of these
// must now resolve as a save-based, fixed-DC, area attack matching the SRD.
describe('breath-weapon-style special attacks', () => {
  const cases: Array<{
    id: string; label: string; shape: 'cone' | 'line'; size: number; width?: number;
    save: string; dc: number; dtype: string;
  }> = [
    { id: 'dnd5e-white-dragon-wyrmling', label: 'Cold Breath', shape: 'cone', size: 15, save: 'con', dc: 12, dtype: 'cold' },
    { id: 'dnd5e-black-dragon-wyrmling', label: 'Acid Breath', shape: 'line', size: 15, width: 5, save: 'dex', dc: 11, dtype: 'acid' },
    { id: 'dnd5e-green-dragon-wyrmling', label: 'Poison Breath', shape: 'cone', size: 15, save: 'con', dc: 11, dtype: 'poison' },
    { id: 'dnd5e-blue-dragon-wyrmling', label: 'Lightning Breath', shape: 'line', size: 30, width: 5, save: 'dex', dc: 12, dtype: 'lightning' },
    { id: 'dnd5e-red-dragon-wyrmling', label: 'Fire Breath', shape: 'cone', size: 15, save: 'dex', dc: 13, dtype: 'fire' },
    { id: 'dnd5e-young-white-dragon', label: 'Cold Breath', shape: 'cone', size: 30, save: 'con', dc: 15, dtype: 'cold' },
    { id: 'dnd5e-young-black-dragon', label: 'Acid Breath', shape: 'line', size: 30, width: 5, save: 'dex', dc: 14, dtype: 'acid' },
    { id: 'dnd5e-young-green-dragon', label: 'Poison Breath', shape: 'cone', size: 30, save: 'con', dc: 14, dtype: 'poison' },
    { id: 'dnd5e-young-blue-dragon', label: 'Lightning Breath', shape: 'line', size: 60, width: 5, save: 'dex', dc: 16, dtype: 'lightning' },
    { id: 'dnd5e-young-red-dragon', label: 'Fire Breath', shape: 'cone', size: 30, save: 'dex', dc: 17, dtype: 'fire' },
    { id: 'dnd5e-adult-white-dragon', label: 'Cold Breath', shape: 'cone', size: 60, save: 'con', dc: 19, dtype: 'cold' },
    { id: 'dnd5e-adult-green-dragon', label: 'Poison Breath', shape: 'cone', size: 60, save: 'con', dc: 18, dtype: 'poison' },
    { id: 'dnd5e-adult-blue-dragon', label: 'Lightning Breath', shape: 'line', size: 90, width: 5, save: 'dex', dc: 19, dtype: 'lightning' },
    { id: 'dnd5e-adult-red-dragon', label: 'Fire Breath', shape: 'cone', size: 60, save: 'dex', dc: 21, dtype: 'fire' },
    { id: 'dnd5e-ancient-red-dragon', label: 'Fire Breath', shape: 'cone', size: 90, save: 'dex', dc: 24, dtype: 'fire' },
    { id: 'dnd5e-chimera', label: 'Fire Breath', shape: 'cone', size: 15, save: 'dex', dc: 15, dtype: 'fire' },
    { id: 'dnd5e-hell-hound', label: 'Fire Breath', shape: 'cone', size: 15, save: 'dex', dc: 12, dtype: 'fire' },
    { id: 'dnd5e-iron-golem', label: 'Poison Breath', shape: 'cone', size: 15, save: 'con', dc: 19, dtype: 'poison' },
  ];

  for (const c of cases) {
    it(`${c.id}'s ${c.label} is a ${c.shape} save vs ${c.save.toUpperCase()} DC ${c.dc}`, () => {
      const entry = npcById(c.id);
      expect(entry, c.id).toBeTruthy();
      const character: Character = { id: 'x', campaignId: 'x', ownerUserId: null, name: entry!.name, system: 'dnd5e', sheet: entry!.sheet };
      const action = combatActions(character).find((a) => a.label === c.label);
      expect(action, `${c.id}: ${c.label}`).toBeTruthy();
      expect(action!.attackExpr, c.id).toBeNull();
      expect(action!.saveId, c.id).toBe(c.save);
      expect(action!.fixedDc, c.id).toBe(c.dc);
      expect(action!.damageType, c.id).toBe(c.dtype);
      expect(action!.aoe, c.id).toEqual({ shape: c.shape, sizeFt: c.size, ...(c.width ? { widthFt: c.width } : {}) });
      // Self-origin shapes (cone/line) anchor on the attacker — rangeFt must
      // be 0, or the server's "how far can this be aimed" check rejects
      // every aim point beyond melee range ("area out of range" on any click).
      expect(action!.rangeFt, c.id).toBe(0);
    });
  }
});
