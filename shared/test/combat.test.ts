import { describe, expect, it } from 'vitest';
import type { Character } from '../src/types.js';
import { combatActions } from '../src/systems/combat.js';
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
});
