import { describe, expect, it } from 'vitest';
import {
  buildSwadeCharacterSheet, raceTraitPointTotal, skillPointCost, totalSkillPointsSpent,
  attributePointsSpent, hindrancePoints, CUSTOM_RACE_POINT_CAP, CUSTOM_RACE_TRAITS_BY_ID,
  type SwadeCreationInput,
} from '../src/systems/swadeCreation.js';
import { swadeParry, swadeToughness } from '../src/systems/swade.js';

function baseInput(overrides: Partial<SwadeCreationInput> = {}): SwadeCreationInput {
  return {
    concept: 'Drifting gunslinger',
    ancestryName: 'Human',
    ancestryIsCustom: false,
    customTraitIds: [],
    customTraitChoices: {},
    attributeSteps: { agility: 0, smarts: 0, spirit: 0, strength: 0, vigor: 0 },
    skillDice: {},
    hindranceIds: [],
    hindranceFundsSpent: 0,
    edgeIds: [],
    ...overrides,
  };
}

describe('SWADE custom race point-buy', () => {
  it('a race with no traits costs 0 points', () => {
    expect(raceTraitPointTotal([])).toBe(0);
  });

  it('drawbacks (negative-cost traits) refund points for extra benefits', () => {
    const total = raceTraitPointTotal(['attribute-increase', 'armor-plus2', 'reduced-pace', 'frail']);
    expect(total).toBe(2 + 2 - 1 - 1); // 2 net — right at the cap
    expect(total).toBeLessThanOrEqual(CUSTOM_RACE_POINT_CAP);
  });

  it('every curated trait carries a real, non-empty description', () => {
    for (const t of CUSTOM_RACE_TRAITS_BY_ID.values()) expect(t.desc.length).toBeGreaterThan(5);
  });
});

describe('SWADE attribute point-buy (5 points, d4 baseline)', () => {
  it('spends the pool across attributes and rejects nothing itself (wizard enforces the cap)', () => {
    expect(attributePointsSpent({ agility: 2, smarts: 1, spirit: 0, strength: 1, vigor: 1 })).toBe(5);
    expect(attributePointsSpent({ agility: 4, smarts: 0, spirit: 0, strength: 0, vigor: 0 })).toBe(4);
  });
});

describe('SWADE skill point-buy (12 points, attribute-linked cost)', () => {
  it('the five free skills start at d4 for 0 points; raising them costs from d6 onward', () => {
    expect(skillPointCost('Notice', 0, 'd8')).toBe(0); // d4 is already free
    expect(skillPointCost('Notice', 1, 'd8')).toBe(1); // d4->d6, within attribute
  });

  it('a non-free skill pays for its own d4 (always 1 point, since d4 is never above any attribute)', () => {
    expect(skillPointCost('Shooting', 0, 'd4')).toBe(1);
  });

  it('steps at or below the linked attribute cost 1/step; steps above cost 2/step', () => {
    // Shooting linked to Agility d8 (idx2): d4(0)->1, d6(1)->1, d8(2)->1 = 3 for reaching d8
    expect(skillPointCost('Shooting', 2, 'd8')).toBe(3);
    // Reaching d10 (idx3), one step above the d8 attribute: +2 more = 5
    expect(skillPointCost('Shooting', 3, 'd8')).toBe(5);
  });

  it('totalSkillPointsSpent sums every bought skill against its own linked attribute die', () => {
    const attrs = { agility: 'd8', smarts: 'd6', spirit: 'd4', strength: 'd4', vigor: 'd6' };
    const spent = totalSkillPointsSpent({ Shooting: 'd8', Academics: 'd6' }, attrs);
    // Shooting (agility d8): 3 points to reach d8. Academics (smarts d6): d4->1,d6->1 = 2.
    expect(spent).toBe(3 + 2);
  });
});

describe('SWADE hindrance points', () => {
  it('minor hindrances are worth 1, major worth 2', () => {
    expect(hindrancePoints([{ severity: 'Minor' }, { severity: 'Minor' }, { severity: 'Major' }])).toBe(4);
  });
});

describe('buildSwadeCharacterSheet — assembly', () => {
  it('produces Wild Card true, Novice rank, and the concept/ancestry as typed', () => {
    const sheet = buildSwadeCharacterSheet(baseInput());
    expect(sheet.wildCard).toBe(true);
    expect(sheet.rank).toBe('Novice');
    expect(sheet.concept).toBe('Drifting gunslinger');
    expect(sheet.ancestry).toBe('Human');
  });

  it('attribute steps land on the right die, starting from d4', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      attributeSteps: { agility: 2, smarts: 1, spirit: 0, strength: 1, vigor: 1 },
    }));
    expect(sheet.agility).toBe('d8'); // d4 -> d6 -> d8
    expect(sheet.smarts).toBe('d6');
    expect(sheet.spirit).toBe('d4');
    expect(sheet.strength).toBe('d6');
    expect(sheet.vigor).toBe('d6');
  });

  it('the five free skills always appear even with zero investment; bought skills add real dice', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({ skillDice: { Fighting: 'd8', Shooting: 'd6' } }));
    const skills = sheet.skills as Array<{ name: string; die: string }>;
    expect(skills.find((s) => s.name === 'Notice')?.die).toBe('d4');
    expect(skills.find((s) => s.name === 'Fighting')?.die).toBe('d8');
    expect(skills.find((s) => s.name === 'Shooting')?.die).toBe('d6');
  });

  it('a custom ancestry with Attribute Increase actually raises the chosen attribute', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Skyfolk', ancestryIsCustom: true,
      customTraitIds: ['attribute-increase', 'reduced-pace'],
      customTraitChoices: { 'attribute-increase': 'agility' },
    }));
    expect(sheet.ancestry).toBe('Skyfolk');
    expect(sheet.agility).toBe('d6'); // d4 + 1 step
    expect(sheet.pace).toBe(5); // 6 - 1 from Reduced Pace
    expect(sheet.runningDie).toBe('d4'); // d6 - 1 step
    expect(String(sheet.notes)).toContain('Attribute Increase');
  });

  it('Natural Armor and Rugged Constitution actually raise derived Toughness', () => {
    const withoutTraits = buildSwadeCharacterSheet(baseInput());
    const withTraits = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Ironhide', ancestryIsCustom: true,
      customTraitIds: ['armor-plus2', 'rugged'],
    }));
    expect(swadeToughness(withTraits)).toBe(swadeToughness(withoutTraits) + 3);
  });

  it('Low Light Vision / Infravision set darkvision; Resistant/Vulnerable set damage-type lists', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Deepwalker', ancestryIsCustom: true,
      customTraitIds: ['infravision', 'resistant', 'vulnerable-damage'],
      customTraitChoices: { resistant: 'cold', 'vulnerable-damage': 'fire' },
    }));
    expect(sheet.darkvision).toBe(24);
    expect(sheet.resist).toBe('cold');
    expect(sheet.vulnerable).toBe('fire');
  });

  it('Keen Senses grants a real +2 Notice via the equipped-gear bonus channel', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Farsight', ancestryIsCustom: true,
      customTraitIds: ['keen-senses'],
    }));
    const inv = sheet.inventory as Array<{ bonusSkill: string; bonusAmt: number; equipped: boolean }>;
    expect(inv.some((i) => i.bonusSkill === 'Notice' && i.bonusAmt === 2 && i.equipped)).toBe(true);
  });

  it('Bad Luck hindrance actually removes a starting Benny', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({ hindranceIds: ['bad-luck'] }));
    expect(sheet.bennies).toBe(2); // default 3 - 1
    const hindrances = sheet.hindrances as Array<{ name: string; severity: string }>;
    expect(hindrances[0]).toMatchObject({ name: 'Bad Luck', severity: 'Major' });
  });

  it('hindrance points spent on funds land on starting dollars; bought attribute/skill points already flow through the normal fields', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      hindranceIds: ['bad-eyes', 'ugly'], // 2 minor = 2 points earned
      hindranceFundsSpent: 1, // spent both on +$500
      attributeSteps: { agility: 0, smarts: 0, spirit: 0, strength: 0, vigor: 1 }, // e.g. a step bought some other way
    }));
    expect(sheet.vigor).toBe('d6');
    expect(sheet.dollars).toBe(500 + 500); // base $500 + 1 funds purchase ($500)
  });

  it('Humans get the free Adaptable edge automatically; custom ancestries do not', () => {
    const human = buildSwadeCharacterSheet(baseInput());
    expect((human.edges as Array<{ name: string }>).some((e) => e.name === 'Adaptable')).toBe(true);
    const custom = buildSwadeCharacterSheet(baseInput({ ancestryName: 'Skyfolk', ancestryIsCustom: true }));
    expect((custom.edges as Array<{ name: string }>).some((e) => e.name === 'Adaptable')).toBe(false);
  });

  it('purchased Edges apply their real mechanical effects: Brawny Toughness, Fleet-Footed pace, Luck bennies, Rich funds', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({ edgeIds: ['brawny', 'fleet-footed', 'luck', 'rich'] }));
    expect(sheet.pace).toBe(8); // 6 + 2
    expect(sheet.runningDie).toBe('d10');
    expect(sheet.bennies).toBe(4); // 3 + 1
    expect(sheet.dollars).toBe(500 + 1000);
    const armor = sheet.armor as Array<{ name: string; armor: number }>;
    expect(armor.some((a) => a.name === 'Brawny' && a.armor === 1)).toBe(true);
  });

  it('a fully-built character produces sane derived Parry/Toughness through the normal schema', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      skillDice: { Fighting: 'd8' },
      attributeSteps: { agility: 1, smarts: 0, spirit: 0, strength: 1, vigor: 2 },
    }));
    expect(swadeParry(sheet)).toBeGreaterThan(0);
    expect(swadeToughness(sheet)).toBeGreaterThan(0);
  });
});
