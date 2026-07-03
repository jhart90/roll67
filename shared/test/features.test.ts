import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import {
  attacksPerAction, classResources, rageDamage, sneakAttackDice,
} from '../src/systems/features5e.js';

describe('martial feature math', () => {
  it('rage damage scales 2/3/4', () => {
    expect(rageDamage(1)).toBe(2);
    expect(rageDamage(9)).toBe(3);
    expect(rageDamage(16)).toBe(4);
  });

  it('sneak attack dice = ceil(level/2), rogue only', () => {
    const rogue = (lvl: number) => sneakAttackDice({ class: 'Rogue', level: lvl });
    expect(rogue(1)).toBe(1);
    expect(rogue(3)).toBe(2);
    expect(rogue(5)).toBe(3);
    expect(rogue(20)).toBe(10);
    expect(sneakAttackDice({ class: 'Fighter', level: 5 })).toBe(0);
  });

  it('extra attack counts by class + level', () => {
    expect(attacksPerAction({ class: 'Fighter', level: 4 })).toBe(1);
    expect(attacksPerAction({ class: 'Fighter', level: 5 })).toBe(2);
    expect(attacksPerAction({ class: 'Fighter', level: 11 })).toBe(3);
    expect(attacksPerAction({ class: 'Fighter', level: 20 })).toBe(4);
    expect(attacksPerAction({ class: 'Barbarian', level: 5 })).toBe(2);
    expect(attacksPerAction({ class: 'Wizard', level: 5 })).toBe(1);
  });
});

describe('class resources', () => {
  it('barbarian rage uses scale and track spent', () => {
    const res = classResources({ class: 'Barbarian', level: 3, res_rage: 1 });
    const rage = res.find((r) => r.id === 'rage')!;
    expect(rage.max).toBe(3);
    expect(rage.used).toBe(1);
    expect(rage.remaining).toBe(2);
    expect(rage.reset).toBe('long');
  });

  it('monk ki and fighter resources appear at the right levels', () => {
    expect(classResources({ class: 'Monk', level: 1 }).find((r) => r.id === 'ki')).toBeUndefined();
    expect(classResources({ class: 'Monk', level: 5 }).find((r) => r.id === 'ki')?.max).toBe(5);
    const fighter = classResources({ class: 'Fighter', level: 17 });
    expect(fighter.find((r) => r.id === 'secondWind')?.max).toBe(1);
    expect(fighter.find((r) => r.id === 'actionSurge')?.max).toBe(2);
  });
});

describe('features feed into rollables', () => {
  it('raging barbarian adds rage damage to melee weapon attacks only', () => {
    const base = {
      ...dnd5e.defaultSheet(), class: 'Barbarian', level: 5,
      attacks: [
        { name: 'Greataxe', bonus: 5, damage: '1d12+3', range: 5 },
        { name: 'Javelin', bonus: 5, damage: '1d6+3', range: 30 },
      ],
    };
    const calm = dnd5e.rollables(base).find((r) => r.id === 'damage_0');
    expect(calm?.expr).toBe('1d12+3');

    const raging = dnd5e.rollables({ ...base, rageActive: true });
    expect(raging.find((r) => r.id === 'damage_0')?.expr).toBe('1d12+3+2'); // melee: +2 rage
    expect(raging.find((r) => r.id === 'damage_1')?.expr).toBe('1d6+3');    // ranged: no rage
  });

  it('rogue gets a Sneak Attack rollable that scales', () => {
    const rolls = dnd5e.rollables({ ...dnd5e.defaultSheet(), class: 'Rogue', level: 7 });
    expect(rolls.find((r) => r.id === 'sneak')?.expr).toBe('4d6');
  });
});
