import { describe, expect, it } from 'vitest';
import { swadeStowedRollable, systemFor } from '../src/index.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';

const swade = systemFor('swade');

const sheet = (attacks: Record<string, unknown>[]) => ({ ...swade.defaultSheet(), attacks });

describe('weapon rolls follow the weapon', () => {
  const s = sheet([
    { name: 'Knife', skill: 'Fighting', damage: '1d4!', range: 5, wielded: true },
    { name: 'Winchester', skill: 'Shooting', damage: '2d8!', range: 120, wielded: false },
  ]);

  it('greys both the attack and the damage roll of a stowed weapon', () => {
    expect(swadeStowedRollable(s, 'attack_1')).toBe(true);
    expect(swadeStowedRollable(s, 'damage_1')).toBe(true);
  });

  it('leaves the wielded weapon’s rolls alone', () => {
    expect(swadeStowedRollable(s, 'attack_0')).toBe(false);
    expect(swadeStowedRollable(s, 'damage_0')).toBe(false);
  });

  // Attributes, skills, the running die — none of these are weapons.
  it.each(['fighting', 'notice', 'runningDie', 'spirit', '', 'attack_', 'attack_x'])(
    'never stows the non-weapon roll %s', (id) => {
      expect(swadeStowedRollable(s, id)).toBe(false);
    },
  );

  it('shrugs off an index that no longer has a row', () => {
    expect(swadeStowedRollable(s, 'attack_99')).toBe(false);
  });
});

describe('the rolls column agrees with the action pane', () => {
  // Both lists are built off the same rows, so a disagreement would mean one
  // of them lets you use a weapon the other says you are not holding.
  it('greys exactly the rows the action pane greys', () => {
    const attacks = [
      { name: 'A', skill: 'Fighting', damage: '1d6!', range: 5, wielded: true },
      { name: 'B', skill: 'Shooting', damage: '2d6!', range: 60, wielded: false },
      { name: 'C', skill: 'Fighting', damage: '1d8!', range: 5, notes: 'Natural weapon', wielded: false },
      { name: 'D', skill: 'Fighting', damage: '1d4!', range: 5 },
    ];
    const s = sheet(attacks);
    const stowed = attacks.map((_, i) => swadeStowedRollable(s, `attack_${i}`));
    expect(stowed).toEqual([false, true, false, false]);
  });
});

describe('no creature loses its own attack rolls', () => {
  it('leaves every bestiary weapon roll live', () => {
    const stuck: string[] = [];
    for (const npc of NPCS_SWADE) {
      const s = { ...swade.defaultSheet(), ...npc.sheet };
      for (const r of swade.rollables(s)) {
        if (swadeStowedRollable(s, r.id)) stuck.push(`${npc.name}: ${r.label}`);
      }
    }
    expect(stuck).toEqual([]);
  });
});
