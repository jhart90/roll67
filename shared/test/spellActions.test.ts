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
    // "0" has no dice, so it is not exposed as an action; use a real amount.
    expect(actions.find((a) => a.id === 'spell:0')).toBeUndefined();

    const withDmg = combatActions(char({
      spells: [{ name: 'Flame Blade', level: 2, damage: '3d6', dtype: 'fire', conc: true, range: 5 }],
    }));
    const fb = withDmg.find((a) => a.id === 'spell:0')!;
    expect(fb.concentration).toBe(true);
    expect(fb.spellName).toBe('Flame Blade');
  });
});
