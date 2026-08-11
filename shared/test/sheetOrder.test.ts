import { describe, expect, it } from 'vitest';
import { combatActions, systemFor, type Character, type SheetData } from '../src/index.js';

const swade = systemFor('swade');

function pc(sheet: Record<string, unknown>): Character {
  return { id: 'c1', campaignId: 'x', ownerUserId: 'u1', name: 'Hero', system: 'swade', sheet };
}

/** What the ▲▼ grip on a card does: swap a row with its neighbour. */
function moveRow(rows: SheetData[], i: number, dir: -1 | 1): SheetData[] {
  const j = i + dir;
  if (j < 0 || j >= rows.length) return rows;
  const next = rows.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

describe('the order of the cards is the order of the actions', () => {
  const knifeFirst = [
    { name: 'Knife', skill: 'Fighting', damage: '1d4!', range: 5 },
    { name: 'Colt Peacemaker', skill: 'Shooting', damage: '2d6!+1', range: 60 },
    { name: 'Winchester', skill: 'Shooting', damage: '2d8!', range: 120 },
  ];

  it('lists attacks in the order the sheet holds them', () => {
    const sheet = { ...swade.defaultSheet(), attacks: knifeFirst };
    const labels = combatActions(pc(sheet)).map((a) => a.label);
    expect(labels.slice(0, 3)).toEqual(['Knife', 'Colt Peacemaker', 'Winchester']);
  });

  // The point of the whole feature: promoting the gun on the sheet promotes
  // its attack in the right-hand pane, without touching anything else.
  it('promotes the gun’s action when the gun’s card moves up', () => {
    const moved = moveRow(knifeFirst, 1, -1);
    const sheet = { ...swade.defaultSheet(), attacks: moved };
    const labels = combatActions(pc(sheet)).map((a) => a.label);
    expect(labels.slice(0, 3)).toEqual(['Colt Peacemaker', 'Knife', 'Winchester']);
  });

  it('moves a card down without disturbing the rest', () => {
    const moved = moveRow(knifeFirst, 0, 1);
    expect(moved.map((r) => r.name)).toEqual(['Colt Peacemaker', 'Knife', 'Winchester']);
  });

  it('refuses to move the first card up or the last card down', () => {
    expect(moveRow(knifeFirst, 0, -1)).toBe(knifeFirst);
    expect(moveRow(knifeFirst, 2, 1)).toBe(knifeFirst);
  });

  // Actions carry the row index they came from; the server reads the row back
  // out of the live sheet with it, so the two must stay in step after a move.
  it('keeps each action pointing at its own row', () => {
    const moved = moveRow(knifeFirst, 1, -1);
    const sheet = { ...swade.defaultSheet(), attacks: moved };
    for (const a of combatActions(pc(sheet))) {
      // Maneuvers (Push, Grapple, …) are synthetic, parked at index 1000+.
      if (a.source !== 'attack' || a.index >= 1000) continue;
      expect(moved[a.index]!.name, a.label).toBe(a.label);
    }
  });

  it('reorders inventory actions the same way', () => {
    const inv = [
      { name: 'Healing Potion', qty: 2, effect: 'heal', amount: '1d6', range: 5 },
      { name: 'Dynamite', qty: 1, effect: 'damage', amount: '3d6', range: 25 },
    ];
    const before = combatActions(pc({ ...swade.defaultSheet(), inventory: inv })).map((a) => a.label);
    const after = combatActions(pc({ ...swade.defaultSheet(), inventory: moveRow(inv, 0, 1) })).map((a) => a.label);
    expect(before.join('|')).not.toBe(after.join('|'));
    expect(new Set(before)).toEqual(new Set(after));
  });
});
