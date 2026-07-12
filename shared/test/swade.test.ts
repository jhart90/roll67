import { describe, expect, it } from 'vitest';
import { dieSides, swade, swadeParry, swadeToughness, traitExpr, woundPenalty } from '../src/systems/swade.js';
import { combatActions } from '../src/systems/combat.js';
import { combatResources, conditionsFor } from '../src/systems/effects.js';
import { generateNpc } from '../src/data/npcGen.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import { applyEntry, contentForSystem } from '../src/data/compendium.js';
import { roll, seededRng } from '../src/dice/roller.js';
import type { Character } from '../src/types.js';

describe('SWADE sheet', () => {
  it('default sheet starts with the five core skills at d4 and Wild Card on', () => {
    const sheet = swade.defaultSheet();
    expect(sheet.wildCard).toBe(true);
    expect(sheet.bennies).toBe(3);
    const skills = sheet.skills as Array<{ name: string; die: string }>;
    expect(skills.map((s) => s.name)).toEqual(['Athletics', 'Common Knowledge', 'Notice', 'Persuasion', 'Stealth']);
    expect(skills.every((s) => s.die === 'd4')).toBe(true);
  });

  it('dieSides parses trait dice', () => {
    expect(dieSides('d4')).toBe(4);
    expect(dieSides('D12')).toBe(12);
    expect(dieSides('')).toBe(0);
    expect(dieSides('nope')).toBe(0);
  });

  it('Parry = 2 + half Fighting die + shields; 2 flat when untrained', () => {
    const untrained = swade.defaultSheet();
    expect(swadeParry(untrained)).toBe(2);
    const fighter = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Fighting', die: 'd8' }],
      armor: [{ name: 'Medium Shield', armor: 0, parryBonus: 2, equipped: true }],
    };
    expect(swadeParry(fighter)).toBe(2 + 4 + 2);
  });

  it('Toughness = 2 + half Vigor die + equipped armor', () => {
    const sheet = {
      ...swade.defaultSheet(), vigor: 'd10',
      armor: [
        { name: 'Chain Mail', armor: 3, parryBonus: 0, equipped: true },
        { name: 'Stashed Plate', armor: 4, parryBonus: 0, equipped: false },
      ],
    };
    expect(swadeToughness(sheet)).toBe(2 + 5 + 3);
  });

  it('derived ac is Parry (the combat engine targets it)', () => {
    const sheet = { ...swade.defaultSheet(), skills: [{ name: 'Fighting', die: 'd10' }] };
    expect(swade.derive(sheet).ac).toBe(7);
    expect(swade.derive(sheet).parry).toBe(7);
  });

  it('Wild Card trait rolls use best(trait!, wild d6!); Extras roll the trait die alone', () => {
    const wild = { ...swade.defaultSheet(), agility: 'd8' };
    expect(traitExpr(wild, 8)).toBe('best(1d8!, 1d6!)');
    const extra = { ...swade.defaultSheet(), wildCard: false };
    expect(traitExpr(extra, 8)).toBe('1d8!');
  });

  it('wounds and fatigue subtract from every trait roll', () => {
    const hurt = { ...swade.defaultSheet(), wounds: 2, fatigue: 1 };
    expect(woundPenalty(hurt)).toBe(-3);
    expect(traitExpr(hurt, 8)).toBe('best(1d8!, 1d6!)-3');
    const rolls = swade.rollables(hurt);
    expect(rolls.find((r) => r.id === 'trait_agility')?.expr).toContain('-3');
  });

  it('unskilled rolls are d4−2', () => {
    expect(traitExpr(swade.defaultSheet(), 0)).toBe('1d4!-2');
  });

  it('weapon attacks roll the linked skill; damage is the typed expression', () => {
    const sheet = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Fighting', die: 'd8' }, { name: 'Shooting', die: 'd6' }],
      attacks: [
        { name: 'Long Sword', skill: 'Fighting', damage: '1d8!+1d8!', dtype: 'slashing', range: 5 },
        { name: '9mm Pistol', skill: 'Shooting', damage: '2d6!', dtype: 'kinetic', range: 72 },
      ],
    };
    const rolls = swade.rollables(sheet);
    expect(rolls.find((r) => r.id === 'attack_0')?.expr).toBe('best(1d8!, 1d6!)');
    expect(rolls.find((r) => r.id === 'damage_0')?.expr).toBe('1d8!+1d8!');
    expect(rolls.find((r) => r.id === 'attack_1')?.expr).toBe('best(1d6!, 1d6!)');
    // Every trait roll expression actually parses and rolls.
    for (const r of rolls) expect(() => roll(r.expr, seededRng(1))).not.toThrow();
  });

  it('weapons become targeted combat actions with attack + damage', () => {
    const character = {
      id: 'c1', campaignId: 'x', ownerUserId: null, name: 'Test', system: 'swade',
      sheet: {
        ...swade.defaultSheet(),
        skills: [{ name: 'Fighting', die: 'd8' }],
        attacks: [{ name: 'Long Sword', skill: 'Fighting', damage: '1d8!+1d6!', dtype: 'slashing', range: 5 }],
      },
    } as unknown as Character;
    const actions = combatActions(character);
    const sword = actions.find((a) => a.id === 'attack:0');
    expect(sword).toBeDefined();
    expect(sword?.attackExpr).toBe('best(1d8!, 1d6!)');
    expect(sword?.amountExpr).toBe('1d8!+1d6!');
    expect(sword?.ranged).toBe(false);
  });

  it('saveCheck is a trait roll vs a fixed target number of 4', () => {
    const sheet = { ...swade.defaultSheet(), vigor: 'd10' };
    const sc = swade.saveCheck(sheet, 'vigor', 15); // dc ignored
    expect(sc.threshold).toBe(4);
    expect(sc.expr).toBe('best(1d10!, 1d6!)');
    expect(sc.label).toBe('Vigor roll');
  });

  it('initiative draws from the 54-card action deck stand-in', () => {
    expect(swade.initiativeExpr(swade.defaultSheet())).toBe('1d54');
  });

  it('powers roll the arcane skill for activation', () => {
    const sheet = {
      ...swade.defaultSheet(), arcaneSkill: 'Spellcasting',
      skills: [{ name: 'Spellcasting', die: 'd10' }],
      powers: [{ name: 'Bolt', cost: 1, effect: 'damage', damage: '2d6!', range: 288 }],
    };
    const rolls = swade.rollables(sheet);
    expect(rolls.find((r) => r.id === 'power_0')?.expr).toBe('best(1d10!, 1d6!)');
    expect(rolls.find((r) => r.id === 'powerDamage_0')?.expr).toBe('2d6!');
  });

  it('conditions include SWADE states; combat resources expose Bennies', () => {
    const ids = conditionsFor('swade').map((c) => c.id);
    for (const id of ['shaken', 'distracted', 'vulnerable', 'stunned', 'prone', 'dead']) {
      expect(ids).toContain(id);
    }
    const res = combatResources('swade', { ...swade.defaultSheet(), res_bennies: 1 });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 'bennies', max: 3, used: 1, remaining: 2 });
  });
});

describe('SWADE library & compendium', () => {
  it('prebuilt NPC sheets produce rollables that all parse', () => {
    for (const npc of NPCS_SWADE) {
      for (const r of swade.rollables(npc.sheet)) {
        if (r.expr !== '0') expect(() => roll(r.expr, seededRng(3))).not.toThrow();
      }
    }
  });

  it('melee weapons from the compendium compose Str die + weapon die', () => {
    const sword = contentForSystem('swade').find((c) => c.name === 'Long Sword')!;
    const applied = applyEntry(sword, { ...swade.defaultSheet(), strength: 'd10' })!;
    expect(applied.listId).toBe('attacks');
    expect(applied.row.damage).toBe('1d10!+1d8!');
    expect(applied.row.skill).toBe('Fighting');
  });

  it('ranged weapons keep their own dice and range', () => {
    const rifle = contentForSystem('swade').find((c) => c.name === 'Hunting Rifle')!;
    const applied = applyEntry(rifle, swade.defaultSheet())!;
    expect(applied.row.damage).toBe('2d8!');
    expect(applied.row.skill).toBe('Shooting');
    expect(applied.row.range).toBe(144);
  });

  it('shields add Parry, body armor adds Armor', () => {
    const entries = contentForSystem('swade');
    const shield = applyEntry(entries.find((c) => c.name === 'Medium Shield')!, swade.defaultSheet())!;
    expect(shield.row).toMatchObject({ armor: 0, parryBonus: 2 });
    const mail = applyEntry(entries.find((c) => c.name === 'Chain Mail')!, swade.defaultSheet())!;
    expect(mail.row).toMatchObject({ armor: 3, parryBonus: 0 });
  });

  it('random SWADE NPCs have trait dice, core skills, and a working attack', () => {
    const npc = generateNpc('swade', seededRng(12));
    expect(String(npc.sheet.agility)).toMatch(/^d\d+$/);
    expect(npc.sheet.wildCard).toBe(false);
    const rolls = swade.rollables(npc.sheet);
    expect(rolls.find((r) => r.id === 'attack_0')).toBeDefined();
    for (const r of rolls) expect(() => roll(r.expr, seededRng(4))).not.toThrow();
  });
});
