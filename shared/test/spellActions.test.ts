import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import { combatActions } from '../src/systems/combat.js';

function char(sheet: Record<string, unknown>) {
  return { id: 'c1', campaignId: 'x', ownerUserId: 'u', name: 'Wiz', system: 'dnd5e' as const, sheet: { ...dnd5e.defaultSheet(), ...sheet } };
}

describe('spells as targeted combat actions', () => {
  it('a save-for-half damage spell becomes a save action that spends a slot', () => {
    const actions = combatActions(char({
      level: 5, int: 18,
      spells: [{ name: 'Fireball', level: 3, damage: '8d6', save: 'dex', dtype: 'fire', range: 150 }],
    }));
    const fb = actions.find((a) => a.id === 'spell:0')!;
    expect(fb.effect).toBe('damage');
    expect(fb.saveId).toBe('dex');
    expect(fb.onSave).toBe('half');
    expect(fb.attackExpr).toBe(null);
    expect(fb.slotLevel).toBe(3);
    expect(fb.damageType).toBe('fire');
    expect(fb.rangeFt).toBe(150);
  });

  it('a spell-attack cantrip becomes an attack action with no slot cost', () => {
    const actions = combatActions(char({
      level: 5, int: 18,
      cantrips: [{ name: 'Fire Bolt', damage: '2d10', save: 'attack', dtype: 'fire', range: 120 }],
    }));
    const fb = actions.find((a) => a.id === 'cantrip:0')!;
    expect(fb.attackExpr).toMatch(/^1d20\+/); // uses the spell-attack bonus
    expect(fb.saveId).toBeUndefined();
    expect(fb.slotLevel).toBeUndefined();
  });

  it('a healing spell becomes a heal action', () => {
    const actions = combatActions(char({
      spells: [{ name: 'Cure Wounds', level: 1, effect: 'heal', damage: '1d8+3', range: 5 }],
    }));
    const cw = actions.find((a) => a.id === 'spell:0')!;
    expect(cw.effect).toBe('heal');
    expect(cw.amountExpr).toBe('1d8+3');
    expect(cw.saveId).toBeUndefined();
  });

  it('a concentration spell carries the concentration flag + name', () => {
    const actions = combatActions(char({
      spells: [{ name: 'Hold Person', level: 2, damage: '0', save: 'wis', conc: true, range: 60 }],
    }));
    // "0" is a placeholder (no dice, no real amount), so it is not an action.
    expect(actions.find((a) => a.id === 'spell:0')).toBeUndefined();

    const withDmg = combatActions(char({
      spells: [{ name: 'Flame Blade', level: 2, damage: '3d6', dtype: 'fire', conc: true, range: 5 }],
    }));
    const fb = withDmg.find((a) => a.id === 'spell:0')!;
    expect(fb.concentration).toBe(true);
    expect(fb.spellName).toBe('Flame Blade');
  });

  it('a flat-amount heal spell (Heal, 70) is a targeted heal action with its range', () => {
    const actions = combatActions(char({
      spells: [{ name: 'Heal', level: 6, effect: 'heal', damage: '70', range: 60 }],
    }));
    const heal = actions.find((a) => a.id === 'spell:0')!;
    expect(heal).toBeDefined();
    expect(heal.effect).toBe('heal');
    expect(heal.amountExpr).toBe('70');
    expect(heal.rangeFt).toBe(60);
    expect(heal.slotLevel).toBe(6);
    expect(heal.attackExpr).toBe(null);
    expect(heal.saveId).toBeUndefined(); // auto-applies, no roll gate
  });

  it('a flat-amount damage spell auto-applies (no attack roll, no save)', () => {
    const actions = combatActions(char({
      spells: [{ name: 'Static Zap', level: 1, damage: '12', dtype: 'lightning', range: 30 }],
    }));
    const zap = actions.find((a) => a.id === 'spell:0')!;
    expect(zap).toBeDefined();
    expect(zap.effect).toBe('damage');
    expect(zap.amountExpr).toBe('12');
    expect(zap.attackExpr).toBe(null);
    expect(zap.saveId).toBeUndefined();
  });

  it('a condition-only save spell (Hold Person) is a targeted hostile action', () => {
    const actions = combatActions(char({
      spells: [{ name: 'Hold Person', level: 2, save: 'wis', onSave: 'negate', condition: 'paralyzed', conc: true, range: 60 }],
    }));
    const hold = actions.find((a) => a.id === 'spell:0')!;
    expect(hold).toBeDefined();
    expect(hold.effect).toBe('damage'); // hostile: self-targeting blocked
    expect(hold.saveId).toBe('wis');
    expect(hold.onSave).toBe('negate');
    expect(hold.appliesCondition).toBe('paralyzed');
    expect(hold.amountExpr).toBe('0');
    expect(hold.rangeFt).toBe(60);
    expect(hold.concentration).toBe(true);
  });

  it('a condition-only no-save spell (Invisibility) targets like a buff', () => {
    const actions = combatActions(char({
      spells: [{ name: 'Invisibility', level: 2, condition: 'invisible', conc: true, range: 5 }],
    }));
    const inv = actions.find((a) => a.id === 'spell:0')!;
    expect(inv).toBeDefined();
    expect(inv.effect).toBe('heal'); // buff: self/ally targeting allowed
    expect(inv.saveId).toBeUndefined();
    expect(inv.appliesCondition).toBe('invisible');
  });

  it('an attack with an on-hit condition rider carries the rider save', () => {
    const actions = combatActions(char({
      attacks: [{ name: 'Ghoul Claws', bonus: 4, damage: '2d4+2', range: 5, condition: 'paralyzed', conditionSave: 'con', conditionDc: 10 }],
    }));
    const claws = actions.find((a) => a.id === 'attack:0')!;
    expect(claws.attackExpr).toMatch(/^1d20/);
    expect(claws.appliesCondition).toBe('paralyzed');
    expect(claws.conditionSaveId).toBe('con');
    expect(claws.conditionDc).toBe(10);

    // Without a rider save, the condition applies automatically on a hit.
    const grab = combatActions(char({
      attacks: [{ name: 'Constrict', bonus: 4, damage: '1d8+2', range: 5, condition: 'grappled' }],
    })).find((a) => a.id === 'attack:0')!;
    expect(grab.appliesCondition).toBe('grappled');
    expect(grab.conditionSaveId).toBeUndefined();
  });
});
