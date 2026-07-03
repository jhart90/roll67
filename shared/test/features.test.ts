import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import {
  attacksPerAction, classResources, critRange, fightingStyleBonus, martialArtsDie,
  rageDamage, remarkableAthleteBonus, sneakAttackDice, superiorityDice,
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

describe('monk martial arts', () => {
  it('martial arts die scales 1d4/1d6/1d8/1d10', () => {
    expect(martialArtsDie(1)).toBe('1d4');
    expect(martialArtsDie(5)).toBe('1d6');
    expect(martialArtsDie(11)).toBe('1d8');
    expect(martialArtsDie(17)).toBe('1d10');
  });

  it('monk gets a DEX-based unarmed strike using the martial-arts die', () => {
    const rolls = dnd5e.rollables({ ...dnd5e.defaultSheet(), class: 'Monk', level: 5, dex: 16 });
    expect(rolls.find((r) => r.id === 'unarmed_attack')?.expr).toBe('1d20+6'); // +3 DEX +3 prof
    expect(rolls.find((r) => r.id === 'unarmed_damage')?.expr).toBe('1d6+3');
  });
});

describe('fighting styles', () => {
  it('archery adds +2 to ranged attacks; dueling adds +2 to melee damage', () => {
    expect(fightingStyleBonus('Archery', true)).toEqual({ attack: 2, damage: 0 });
    expect(fightingStyleBonus('Archery', false)).toEqual({ attack: 0, damage: 0 });
    expect(fightingStyleBonus('Dueling', false)).toEqual({ attack: 0, damage: 2 });
    expect(fightingStyleBonus('Defense', false)).toEqual({ attack: 0, damage: 0 });
  });

  it('archery/dueling flow into the attack rollables', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), class: 'Fighter', level: 3, fightingStyle: 'Archery',
      attacks: [
        { name: 'Longbow', bonus: 5, damage: '1d8+3', range: 150 },
        { name: 'Longsword', bonus: 5, damage: '1d8+3', range: 5 },
      ],
    };
    const archery = dnd5e.rollables(sheet);
    expect(archery.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+7'); // ranged +2
    expect(archery.find((r) => r.id === 'attack_1')?.expr).toBe('1d20+5'); // melee unaffected

    const dueling = dnd5e.rollables({ ...sheet, fightingStyle: 'Dueling' });
    expect(dueling.find((r) => r.id === 'damage_1')?.expr).toBe('1d8+3+2'); // melee dmg +2
    expect(dueling.find((r) => r.id === 'damage_0')?.expr).toBe('1d8+3');   // ranged unaffected
  });
});

describe('subclass mechanics', () => {
  it('Battle Master superiority dice scale in count and die size', () => {
    const bm = (level: number) => superiorityDice({ class: 'Fighter', subclass: 'Battle Master', level });
    expect(bm(2)).toBeNull();
    expect(bm(3)).toEqual({ count: 4, die: 'd8' });
    expect(bm(10)).toEqual({ count: 5, die: 'd10' });
    expect(bm(18)).toEqual({ count: 6, die: 'd12' });
    expect(superiorityDice({ class: 'Fighter', subclass: 'Champion', level: 3 })).toBeNull();
  });

  it('Battle Master gets a superiority-die roll + a tracked resource', () => {
    const sheet = { ...dnd5e.defaultSheet(), class: 'Fighter', subclass: 'Battle Master', level: 10 };
    expect(dnd5e.rollables(sheet).find((r) => r.id === 'superiority')?.expr).toBe('1d10');
    expect(classResources(sheet).find((r) => r.id === 'superiority')?.max).toBe(5);
  });

  it('Champion Improved Critical lowers the crit range', () => {
    expect(critRange({ class: 'Fighter', subclass: 'Champion', level: 3 })).toBe(19);
    expect(critRange({ class: 'Fighter', subclass: 'Champion', level: 15 })).toBe(18);
    expect(critRange({ class: 'Fighter', subclass: 'Battle Master', level: 15 })).toBe(20);
  });

  it('Champion Remarkable Athlete adds half-prof to STR/DEX/CON checks at 7+', () => {
    expect(remarkableAthleteBonus({ class: 'Fighter', subclass: 'Champion', level: 6 })).toBe(0);
    expect(remarkableAthleteBonus({ class: 'Fighter', subclass: 'Champion', level: 7 })).toBe(2); // prof 3 → ceil 3/2 = 2
    const rolls = dnd5e.rollables({ ...dnd5e.defaultSheet(), class: 'Fighter', subclass: 'Champion', level: 7, str: 14 });
    expect(rolls.find((r) => r.id === 'check_str')?.expr).toBe('1d20+4'); // +2 STR +2 remarkable
    expect(rolls.find((r) => r.id === 'check_int')?.expr).toBe('1d20+0'); // INT not boosted
  });
});
