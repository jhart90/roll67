import { describe, expect, it } from 'vitest';
import type { Character } from '../src/types.js';
import { combatActions } from '../src/systems/combat.js';
import { castableLevels, spellSlots } from '../src/systems/spells.js';
import { dnd5e } from '../src/systems/dnd5e.js';
import { swade } from '../src/systems/swade.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
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

/**
 * SWADE's creature abilities reach the action the same way AP and range do:
 * off the attack row. These used to have nowhere to be stated at all — the
 * bestiary described venom in prose and the engine borrowed 5e's `poisoned`
 * condition, which means something else entirely.
 */
describe('SWADE creature abilities on an attack', () => {
  const swadePc = (sheet: Record<string, unknown>): Character =>
    ({ id: 'c2', campaignId: 'x', ownerUserId: null, name: 'Thing', system: 'swade', sheet });

  it('carries the Heavy Weapon flag through', () => {
    const [a] = combatActions(swadePc({
      ...swade.defaultSheet(),
      attacks: [{ name: 'Deck Cannon', skill: 'Shooting', damage: '3d10!', range: 600, heavy: true }],
    }));
    expect(a.heavy).toBe(true);
  });

  it('leaves an ordinary weapon unflagged', () => {
    const [a] = combatActions(swadePc({
      ...swade.defaultSheet(),
      attacks: [{ name: 'Cutlass', skill: 'Fighting', damage: '1d6!+1d6!', range: 5 }],
    }));
    expect(a.heavy).toBeUndefined();
    expect(a.poison).toBeUndefined();
  });

  it('carries venom, its strength and what failing costs', () => {
    const [a] = combatActions(swadePc({
      ...swade.defaultSheet(),
      attacks: [{ name: 'Bite', skill: 'Fighting', damage: '1d4!+2', range: 5, poison: true, poisonMod: -2, poisonEffect: 'incapacitated' }],
    }));
    expect(a.poison).toEqual({ mod: -2, effect: 'incapacitated', kind: 'poison' });
  });

  it('defaults an unspecified venom to a level of Fatigue', () => {
    const [a] = combatActions(swadePc({
      ...swade.defaultSheet(),
      attacks: [{ name: 'Sting', skill: 'Fighting', damage: '1d6!', range: 5, poison: true }],
    }));
    expect(a.poison).toEqual({ mod: 0, effect: 'fatigue', kind: 'poison' });
  });

  it('reads an infectious bite as Infection, on the same machinery', () => {
    const [a] = combatActions(swadePc({
      ...swade.defaultSheet(),
      attacks: [{ name: 'Claws', skill: 'Fighting', damage: '1d12!+1d8!', range: 5, infection: true, poisonMod: 0, poisonEffect: 'shaken' }],
    }));
    expect(a.poison).toEqual({ mod: 0, effect: 'shaken', kind: 'infection' });
  });

  it('gives the bestiary’s venomous creatures real poison, not 5e’s condition', () => {
    const venomous = ['Snake, Venomous', 'Giant Spider', 'Giant Scorpion'];
    for (const name of venomous) {
      const npc = NPCS_SWADE.find((n) => n.name === name)!;
      const attacks = (npc.sheet.attacks ?? []) as Array<Record<string, unknown>>;
      expect(attacks.some((atk) => atk.poison === true), `${name} should be venomous`).toBe(true);
      expect(attacks.some((atk) => atk.condition === 'poisoned'), `${name} still borrows 5e poison`).toBe(false);
    }
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

/**
 * A heal has to be able to reach the person next to you.
 *
 * All three of these were the same bug wearing different hats: a heal whose
 * range box held 0 was read as reaching zero hexes, so the only token the
 * healer could pick was themselves — and a Healing POWER, whose range box is
 * blank by default, could not be aimed at anybody at all. The board simply
 * refused every click and said nothing about why.
 */
describe('healing reaches arm’s length', () => {
  const medic = (sheet: Record<string, unknown>): Character =>
    ({ id: 'c3', campaignId: 'x', ownerUserId: 'u1', name: 'Medic', system: 'swade', sheet });
  const find = (sheet: Record<string, unknown>, label: string) =>
    combatActions(medic(sheet)).find((a) => a.label === label);

  it('gives a range-less heal power a touch reach', () => {
    const a = find({
      ...swade.defaultSheet(), arcaneSkill: 'Faith', Faith: 'd8',
      powers: [{ name: 'Healing', effect: 'heal', damage: '5', cost: 3 }],
    }, 'Healing');
    expect(a?.rangeFt).toBe(5);
    expect(a?.healsWounds).toBe(true);
    // The margin of the arcane roll is the healing — never an amount.
    expect(a?.fixedTn).toBe(4);
  });

  it('…and a heal item whose range box holds a literal 0', () => {
    const a = find({
      ...swade.defaultSheet(),
      inventory: [{ name: 'Healing Potion', qty: 1, effect: 'heal', amount: '', range: 0 }],
    }, 'Healing Potion');
    expect(a?.rangeFt).toBe(5);
    expect(a?.healsWounds).toBe(true);
    expect(a?.consumesItem).toBe(true);
  });

  it('leaves a ranged heal alone', () => {
    const a = find({
      ...swade.defaultSheet(), arcaneSkill: 'Faith', Faith: 'd8',
      powers: [{ name: 'Mend at Range', effect: 'heal', damage: '5', range: 60 }],
    }, 'Mend at Range');
    expect(a?.rangeFt).toBe(60);
  });

  it('does not stretch a range-less ATTACK power — a Bolt still needs its range', () => {
    const a = find({
      ...swade.defaultSheet(), arcaneSkill: 'Faith', Faith: 'd8',
      powers: [{ name: 'Bolt', effect: 'damage', damage: '2d6!' }],
    }, 'Bolt');
    expect(a?.rangeFt).toBe(0);
  });
});

/**
 * The Healing skill button in the rolls column prints a number and stops
 * there: no patient, no consequence, nothing mended. Treating a wound is an
 * ACTION, so SWADE characters get one whether or not they are carrying a kit.
 */
describe('Treat Wounds', () => {
  const anyone = (sheet: Record<string, unknown>): Character =>
    ({ id: 'c4', campaignId: 'x', ownerUserId: 'u1', name: 'Anyone', system: 'swade', sheet });

  it('is offered to every SWADE character, kit or no kit', () => {
    const a = combatActions(anyone(swade.defaultSheet())).find((x) => x.id === 'heal:hands');
    expect(a).toBeDefined();
    expect(a?.effect).toBe('heal');
    expect(a?.healsWounds).toBe(true);
    expect(a?.traitName).toBe('Healing');
    expect(a?.rangeFt).toBe(5);
    expect(a?.consumesItem).toBe(false);
  });

  it('rolls the Healing skill, and carries a kit’s bonus into it', () => {
    const sheet = {
      ...swade.defaultSheet(), skills: [{ name: 'Healing', die: 'd8' }],
      inventory: [{ name: 'Medkit', qty: 1, bonusSkill: 'Healing', bonusAmt: 2, equipped: true }],
    };
    const a = combatActions(anyone(sheet)).find((x) => x.id === 'heal:hands');
    expect(a?.attackExpr).toContain('d8');
    expect(a?.attackExpr).toContain('+2');
  });

  it('is not offered outside SWADE, where healing is points off a spell', () => {
    const other: Character = { id: 'c5', campaignId: 'x', ownerUserId: 'u1', name: 'Cleric', system: 'dnd5e', sheet: dnd5e.defaultSheet() };
    expect(combatActions(other).some((x) => x.id === 'heal:hands')).toBe(false);
  });
});
