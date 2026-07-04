import { describe, expect, it } from 'vitest';
import type { Character } from '../src/types.js';
import { combatActions } from '../src/systems/combat.js';
import { castableLevels, spellSlots } from '../src/systems/spells.js';
import { dnd5e } from '../src/systems/dnd5e.js';
import { applyEntry } from '../src/data/compendiumTypes.js';

function pc(sheet: Record<string, unknown>): Character {
  return { id: 'c1', campaignId: 'x', ownerUserId: 'u1', name: 'Hero', system: 'dnd5e', sheet };
}

describe('combatActions', () => {
  it('derives a weapon attack with to-hit, damage and range', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), level: 5, str: 16,
      attacks: [{ name: 'Longsword', bonus: 5, damage: '1d8+3', range: 5 }],
    };
    const [a, ...rest] = combatActions(pc(sheet));
    expect(rest).toHaveLength(0);
    expect(a.source).toBe('attack');
    expect(a.effect).toBe('damage');
    expect(a.label).toBe('Longsword');
    expect(a.attackExpr).toBe('1d20+5');
    expect(a.amountExpr).toBe('1d8+3');
    expect(a.rangeFt).toBe(5);
    expect(a.consumesItem).toBe(false);
  });

  it('makes a healing inventory item a usable, consumable action', () => {
    const sheet = {
      ...dnd5e.defaultSheet(),
      inventory: [{ name: 'Potion of Healing', qty: 3, effect: 'heal', amount: '2d4+2', range: 5 }],
    };
    const actions = combatActions(pc(sheet));
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.source).toBe('item');
    expect(a.effect).toBe('heal');
    expect(a.amountExpr).toBe('2d4+2');
    expect(a.attackExpr).toBeNull();
    expect(a.consumesItem).toBe(true);
    expect(a.label).toContain('×3');
  });

  it('ignores items with no usable effect or zero quantity', () => {
    const sheet = {
      ...dnd5e.defaultSheet(),
      inventory: [
        { name: 'Rope', qty: 1, effect: 'none', amount: '' },
        { name: 'Empty Vial', qty: 0, effect: 'heal', amount: '2d4' },
      ],
    };
    expect(combatActions(pc(sheet))).toHaveLength(0);
  });

  it('compendium Potion of Healing applies as a usable heal item', () => {
    const entry = {
      id: 'p', system: 'dnd5e' as const, kind: 'gear' as const, name: 'Potion of Healing',
      category: 'Adventuring Gear', order: 0, subtitle: 'Regain 2d4+2 hit points',
    };
    const res = applyEntry(entry, dnd5e.defaultSheet());
    expect(res?.listId).toBe('inventory');
    expect(res?.row.effect).toBe('heal');
    expect(res?.row.amount).toBe('2d4+2');
  });

  it('a save-based attack row (breath weapon) forces a save with a fixed DC instead of a to-hit roll', () => {
    const sheet = {
      ...dnd5e.defaultSheet(),
      attacks: [{
        name: 'Fire Breath', bonus: 0, damage: '26d6', dtype: 'fire',
        save: 'dex', onSave: 'half', saveDc: 24, aoeShape: 'cone', aoeSize: 90,
      }],
    };
    const [a] = combatActions(pc(sheet));
    expect(a.attackExpr).toBeNull();
    expect(a.saveId).toBe('dex');
    expect(a.onSave).toBe('half');
    expect(a.fixedDc).toBe(24);
    expect(a.aoe).toEqual({ shape: 'cone', sizeFt: 90 });
    expect(a.amountExpr).toBe('26d6');
    expect(a.damageType).toBe('fire');
  });

  it('a line-shaped breath weapon carries its width', () => {
    const sheet = {
      ...dnd5e.defaultSheet(),
      attacks: [{ name: 'Lightning Breath', bonus: 0, damage: '12d10', save: 'dex', saveDc: 19, aoeShape: 'line', aoeSize: 90, aoeWidth: 5 }],
    };
    const [a] = combatActions(pc(sheet));
    expect(a.aoe).toEqual({ shape: 'line', sizeFt: 90, widthFt: 5 });
  });

  it('a plain attack row with no save stays a normal to-hit action, unaffected by the new columns', () => {
    const sheet = { ...dnd5e.defaultSheet(), level: 5, str: 16, attacks: [{ name: 'Longsword', bonus: 5, damage: '1d8+3' }] };
    const [a] = combatActions(pc(sheet));
    expect(a.attackExpr).toBe('1d20+5');
    expect(a.saveId).toBeUndefined();
    expect(a.fixedDc).toBeUndefined();
    expect(a.aoe).toBeUndefined();
  });

  it('leveled spells carry a slotLevel; cantrips do not', () => {
    const sheet = {
      ...dnd5e.defaultSheet(),
      cantrips: [{ name: 'Fire Bolt', damage: '1d10' }],
      spells: [{ name: 'Fireball', level: 3, damage: '8d6' }],
    };
    const rolls = dnd5e.rollables(sheet);
    expect(rolls.find((r) => r.id === 'cantrip_0')?.slotLevel).toBeUndefined();
    expect(rolls.find((r) => r.id === 'spell_0')?.slotLevel).toBe(3);
  });
});

describe('spell slots', () => {
  const sheet = { slots1: 3, slotsUsed1: 1, slots2: 2, slotsUsed2: 2, slots3: 1 };

  it('reports remaining slots per level, skipping levels with none', () => {
    expect(spellSlots(sheet)).toEqual([
      { level: 1, total: 3, remaining: 2 },
      { level: 2, total: 2, remaining: 0 },
      { level: 3, total: 1, remaining: 1 },
    ]);
  });

  it('castable levels are those at/above min with a remaining slot', () => {
    expect(castableLevels(sheet, 1)).toEqual([1, 3]); // L2 exhausted
    expect(castableLevels(sheet, 3)).toEqual([3]);
    expect(castableLevels(sheet, 2)).toEqual([3]);    // L2 has none left
    expect(castableLevels({ slots1: 1, slotsUsed1: 1 }, 1)).toEqual([]);
  });
});
