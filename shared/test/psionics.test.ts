import { describe, expect, it } from 'vitest';
import { swn } from '../src/systems/swn.js';
import { combatActions } from '../src/systems/combat.js';
import { bestPsychicSkillLevel, effortMaxFor, hasDiscipline, isPsychicMishap } from '../src/systems/swn.js';

function char(sheet: Record<string, unknown>) {
  return { id: 'c1', campaignId: 'x', ownerUserId: 'u', name: 'Psi', system: 'swn' as const, sheet: { ...swn.defaultSheet(), ...sheet } };
}

describe('SWN Effort + discipline gating', () => {
  it('untrained psychic (no discipline skill) falls back to the better of WIS/CON mod', () => {
    // wis 14 -> +1 mod, con 8 -> 0 mod; no discipline skills at all.
    expect(effortMaxFor({ wis: 14, con: 8 })).toBe(2); // 1 + max(-1, 1, 0)
    expect(bestPsychicSkillLevel({})).toBe(-1);
    expect(hasDiscipline({}, 'Telepathy')).toBe(false);
  });

  it('a trained discipline skill can beat WIS/CON when it is higher', () => {
    const sheet = { wis: 10, con: 10, skills: [{ name: 'Telepathy', level: 3, attr: 'wis' }] };
    expect(bestPsychicSkillLevel(sheet)).toBe(3);
    expect(hasDiscipline(sheet, 'Telepathy')).toBe(true);
    expect(hasDiscipline(sheet, 'Biopsionics')).toBe(false);
    expect(effortMaxFor(sheet)).toBe(4); // 1 + max(3, 0, 0)
  });

  it('takes the best of several trained disciplines', () => {
    const sheet = { skills: [{ name: 'Telepathy', level: 0 }, { name: 'Metapsionics', level: 2 }] };
    expect(bestPsychicSkillLevel(sheet)).toBe(2);
  });

  it('snake-eyes on the activation check (both d6 show 1) is a mishap, nothing else is', () => {
    expect(isPsychicMishap([1, 1])).toBe(true);
    expect(isPsychicMishap([1, 2])).toBe(false);
    expect(isPsychicMishap([2, 2])).toBe(false);
    expect(isPsychicMishap([1])).toBe(false);
  });
});

describe('psychic powers as targeted combat actions', () => {
  it('a damage power in a trained discipline becomes a targeted action costing Effort', () => {
    const actions = combatActions(char({
      skills: [{ name: 'Telekinesis', level: 1, attr: 'wis' }],
      powers: [{ name: 'Telekinetic Ram', discipline: 'Telekinesis', level: 3, damage: '2d8', dtype: 'kinetic', range: 60 }],
    }));
    const ram = actions.find((a) => a.id === 'power:0')!;
    expect(ram).toBeDefined();
    expect(ram.source).toBe('power');
    expect(ram.effect).toBe('damage');
    expect(ram.effortCost).toBe(3); // falls back to the power's level
    expect(ram.disciplineId).toBe('Telekinesis');
    expect(ram.damageType).toBe('kinetic');
    expect(ram.rangeFt).toBe(60);
    expect(ram.attackExpr).toBeNull(); // powers don't roll to-hit vs AC
  });

  it('an explicit Effort column overrides the level-based default', () => {
    const actions = combatActions(char({
      skills: [{ name: 'Telekinesis', level: 1 }],
      powers: [{ name: 'Cheap Push', discipline: 'Telekinesis', level: 4, effort: 1, damage: '1d6' }],
    }));
    expect(actions.find((a) => a.id === 'power:0')!.effortCost).toBe(1);
  });

  it('a power in a discipline the character has not trained is not usable', () => {
    const actions = combatActions(char({
      skills: [{ name: 'Telepathy', level: 0 }],
      powers: [{ name: 'Telekinetic Ram', discipline: 'Telekinesis', level: 3, damage: '2d8' }],
    }));
    expect(actions.find((a) => a.id === 'power:0')).toBeUndefined();
  });

  it('a save-based power sets saveId/onSave using SWN save ids', () => {
    const actions = combatActions(char({
      skills: [{ name: 'Metapsionics', level: 2 }],
      powers: [{ name: 'Psionic Assault', discipline: 'Metapsionics', level: 3, damage: '3d6', save: 'mental', dtype: 'psychic' }],
    }));
    const assault = actions.find((a) => a.id === 'power:0')!;
    expect(assault.saveId).toBe('mental');
    expect(assault.onSave).toBe('half');
  });

  it('a healing power becomes a heal action', () => {
    const actions = combatActions(char({
      skills: [{ name: 'Biopsionics', level: 1 }],
      powers: [{ name: 'Healing Touch', discipline: 'Biopsionics', level: 1, effect: 'heal', damage: '2d6+2', range: 5 }],
    }));
    const heal = actions.find((a) => a.id === 'power:0')!;
    expect(heal.effect).toBe('heal');
    expect(heal.amountExpr).toBe('2d6+2');
  });
});
