import { describe, expect, it } from 'vitest';
import { combatActions, swadeStowed, systemFor, type Character } from '../src/index.js';
import { CONTENT_SWADE } from '../src/data/contentSwade.js';
import { applyEntry } from '../src/data/compendiumTypes.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';

const swade = systemFor('swade');
const pc = (sheet: Record<string, unknown>): Character =>
  ({ id: 'c1', campaignId: 'x', ownerUserId: 'u1', name: 'Hero', system: 'swade', sheet });

describe('a weapon that is not in hand', () => {
  it('is stowed when the box is explicitly unticked', () => {
    expect(swadeStowed({ name: 'Colt', wielded: false })).toBe(true);
  });

  it('is not stowed once it is wielded', () => {
    expect(swadeStowed({ name: 'Colt', wielded: true })).toBe(false);
  });

  // The distinction the whole rule turns on: a row with no `wielded` key is a
  // sheet that doesn't track wielding, not a weapon someone forgot to draw.
  it('leaves a row that never had the field alone', () => {
    expect(swadeStowed({ name: 'Bite' })).toBe(false);
  });

  // A claw is attached. There is nothing to pick up, so an unticked box on one
  // means nothing.
  it('never stows a natural weapon', () => {
    expect(swadeStowed({ name: 'Claws', wielded: false, notes: 'Natural weapon' })).toBe(false);
    expect(swadeStowed({ name: 'Bite', wielded: false, notes: 'natural weapon, reach 1' })).toBe(false);
  });
});

describe('the action pane', () => {
  const rifle = { name: 'Winchester', skill: 'Shooting', damage: '2d8!', range: 120, wielded: false };

  it('still lists a stowed weapon, flagged', () => {
    const actions = combatActions(pc({ ...swade.defaultSheet(), attacks: [rifle] }));
    const shot = actions.find((a) => a.label === 'Winchester');
    expect(shot, 'the weapon must not vanish from the list').toBeTruthy();
    expect(shot!.stowed).toBe(true);
  });

  it('drops the flag the moment it is wielded', () => {
    const actions = combatActions(pc({ ...swade.defaultSheet(), attacks: [{ ...rifle, wielded: true }] }));
    expect(actions.find((a) => a.label === 'Winchester')!.stowed).toBeUndefined();
  });

  // Hosing down a template needs the gun in hand as much as aiming does.
  it('stows the Suppressive Fire that comes off the same weapon', () => {
    const auto = { name: 'M-16', skill: 'Shooting', damage: '2d8!', range: 120, rof: 3, wielded: false };
    const actions = combatActions(pc({ ...swade.defaultSheet(), attacks: [auto] }));
    const suppress = actions.find((a) => a.suppressive);
    expect(suppress!.stowed).toBe(true);
  });

  it('never stows a maneuver', () => {
    const actions = combatActions(pc({ ...swade.defaultSheet(), attacks: [rifle] }));
    for (const a of actions.filter((x) => x.maneuver)) expect(a.stowed, a.label).toBeUndefined();
  });
});

describe('nothing in the bestiary greys itself out', () => {
  // 155 creatures whose attacks are teeth and claws. If any one of them came
  // through stowed, a dragon would be unable to bite.
  it('leaves every creature able to attack', () => {
    const stuck: string[] = [];
    for (const npc of NPCS_SWADE) {
      const actions = combatActions(pc({ ...swade.defaultSheet(), ...npc.sheet }));
      for (const a of actions) if (a.stowed) stuck.push(`${npc.name}: ${a.label}`);
    }
    expect(stuck).toEqual([]);
  });

  it('is checking a real bestiary, not an empty list', () => {
    expect(NPCS_SWADE.length).toBeGreaterThan(100);
  });
});

describe('a weapon taken from the compendium', () => {
  // applyEntry writes wielded: false, so a freshly bought gun starts stowed —
  // which is right: you have bought it, not drawn it.
  it('arrives stowed until the player draws it', () => {
    const colt = CONTENT_SWADE.find((e) => e.name === 'Colt Peacemaker (.45)')!;
    const added = applyEntry(colt, swade.defaultSheet());
    expect(added!.listId).toBe('attacks');
    expect(swadeStowed(added!.row)).toBe(true);
  });
});
