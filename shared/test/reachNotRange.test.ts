import { describe, expect, it } from 'vitest';
import type { Character } from '../src/types.js';
import { combatActions } from '../src/systems/combat.js';
import { swade } from '../src/systems/swade.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';

/**
 * Reach is not range.
 *
 * A Robo T-Rex's bite is listed at 10 feet because its head is ten feet from
 * where it stands. `rangeFt > 5` read that as a SHOT — range bands, Recoil,
 * no Gang Up, the ranged shield on the target's armor, all applied to a set
 * of jaws. What decides is the roll the attack makes.
 */
const beast = (sheet: Record<string, unknown>): Character =>
  ({ id: 'n1', campaignId: 'x', ownerUserId: null, name: 'Thing', system: 'swade', sheet });

describe('a long-reach melee attack', () => {
  it('stays melee, however far it reaches', () => {
    const a = combatActions(beast({
      ...swade.defaultSheet(), Fighting: 'd12',
      attacks: [{ name: 'Hydraulic Bite', skill: 'Fighting', damage: '2d10!', range: 10 }],
    }))[0];
    expect(a.ranged).toBe(false);
    expect(a.rangeFt).toBe(10);   // the reach itself is untouched
    expect(a.skillName).toBe('Fighting');
  });

  it('…while a gun at the same distance is still a shot', () => {
    const a = combatActions(beast({
      ...swade.defaultSheet(), Shooting: 'd10',
      attacks: [{ name: 'Holdout Pistol', skill: 'Shooting', damage: '2d6!', range: 10 }],
    }))[0];
    expect(a.ranged).toBe(true);
    expect(a.skillName).toBe('Shooting');
  });

  it('leaves an ordinary arm-length attack exactly as it was', () => {
    const a = combatActions(beast({
      ...swade.defaultSheet(), Fighting: 'd8',
      attacks: [{ name: 'Claw', skill: 'Fighting', damage: '1d6!', range: 5 }],
    }))[0];
    expect(a.ranged).toBe(false);
  });
});

/**
 * And the creature that prompted it: the bestiary has always said Fighting
 * for both of these, so a sheet reading otherwise is a stale copy rather than
 * bad data.
 */
describe('the Robo T-Rex as the bestiary writes it', () => {
  const rex = NPCS_SWADE.find((n) => n.name === 'Robo T-Rex')!;
  const actions = combatActions(beast(rex.sheet));

  it('bites with Fighting, and the bite is melee', () => {
    const bite = actions.find((a) => a.label === 'Hydraulic Bite')!;
    expect(bite.skillName).toBe('Fighting');
    expect(bite.ranged).toBe(false);
  });

  it('sweeps its tail with Fighting, not Shooting', () => {
    const tail = actions.find((a) => a.label === 'Tail Sweep')!;
    expect(tail.skillName).toBe('Fighting');
    expect(tail.ranged).toBe(false);
    expect(tail.aoe).toBeDefined();
  });

  it('and only the missile pod is actually a shot', () => {
    const pod = actions.find((a) => a.label === 'Missile Pod')!;
    expect(pod.skillName).toBe('Shooting');
    expect(pod.ranged).toBe(true);
  });
});
