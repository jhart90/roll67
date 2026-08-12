import { describe, expect, it } from 'vitest';
import {
  buildSwadeCharacterSheet, raceTraitPointTotal, skillPointCost, totalSkillPointsSpent,
  attributePointsSpent, hindrancePoints, maxTakesOf, CUSTOM_RACE_POINT_CAP, CUSTOM_RACE_TRAITS_BY_ID,
  type SwadeCreationInput,
} from '../src/systems/swadeCreation.js';
import { gearTraitBonus, swade, swadePace, swadeParry, swadeToughness } from '../src/systems/swade.js';

function baseInput(overrides: Partial<SwadeCreationInput> = {}): SwadeCreationInput {
  return {
    concept: 'Drifting gunslinger',
    ancestryName: 'Human',
    ancestryIsCustom: false,
    customTraitPicks: [],
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
    // Attribute Increase (2) + Armor (1) + Toughness (1) − Reduced Pace (1)
    // − Frail (1) = 2 net, right at the cap.
    const total = raceTraitPointTotal([
      { traitId: 'attribute-increase', choice: 'agility' },
      { traitId: 'armor' },
      { traitId: 'toughness' },
      { traitId: 'reduced-pace' },
      { traitId: 'frail' },
    ]);
    expect(total).toBe(2 + 1 + 1 - 1 - 1);
    expect(total).toBeLessThanOrEqual(CUSTOM_RACE_POINT_CAP);
  });

  it('tiered abilities price by the tier chosen', () => {
    expect(raceTraitPointTotal([{ traitId: 'flight', tier: 0 }])).toBe(2);
    expect(raceTraitPointTotal([{ traitId: 'flight', tier: 1 }])).toBe(4);
    expect(raceTraitPointTotal([{ traitId: 'flight', tier: 2 }])).toBe(6);
    expect(raceTraitPointTotal([{ traitId: 'claws', tier: 2 }])).toBe(4);
    expect(raceTraitPointTotal([{ traitId: 'hindrance', tier: 1 }])).toBe(-2);
  });

  it('covers the whole Making Races table, both halves', () => {
    const all = [...CUSTOM_RACE_TRAITS_BY_ID.values()];
    const positive = all.filter((t) => t.category === 'positive');
    const negative = all.filter((t) => t.category === 'negative');
    expect(positive.length).toBeGreaterThanOrEqual(28);
    expect(negative.length).toBeGreaterThanOrEqual(13);
    for (const name of ['Adaptable', 'Additional Action', 'Construct', 'Flight', 'Regeneration', 'Wall Walker', 'Super Powers'.replace('Super Powers', 'Power')]) {
      expect(all.some((t) => t.name === name), name).toBe(true);
    }
    for (const name of ['Big', 'Cannot Speak', 'Dependency', 'Racial Enemy', 'Reduced Core Skills', 'Poor Parry']) {
      expect(all.some((t) => t.name === name), name).toBe(true);
    }
  });

  it('repeatable abilities declare their cap; one-shot ones default to a single take', () => {
    expect(maxTakesOf(CUSTOM_RACE_TRAITS_BY_ID.get('armor')!)).toBe(3);
    expect(maxTakesOf(CUSTOM_RACE_TRAITS_BY_ID.get('attribute-increase')!)).toBe(Number.POSITIVE_INFINITY);
    expect(maxTakesOf(CUSTOM_RACE_TRAITS_BY_ID.get('hardy')!)).toBe(1);
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

  it('gives a Human the Adaptable ancestry trait', () => {
    const sheet = buildSwadeCharacterSheet(baseInput());
    const traits = (sheet.racialTraits ?? []) as Array<Record<string, unknown>>;
    const adaptable = traits.find((t) => t.name === 'Adaptable (Human)');
    expect(adaptable).toBeDefined();
    expect(adaptable!.notes).toBe('Player began with a Novice Edge of their choosing.');
    // It is a flavour/record trait — the free Edge itself is a real Edge pick,
    // so this row must not also move Parry, Toughness or Pace.
    expect(adaptable!.parryBonus).toBe(0);
    expect(adaptable!.toughnessBonus).toBe(0);
    expect(adaptable!.paceBonus).toBe(0);
  });

  it('gives Adaptable only to Humans, and never to a custom ancestry', () => {
    const elf = buildSwadeCharacterSheet(baseInput({ ancestryName: 'Elf' }));
    expect(((elf.racialTraits ?? []) as Array<Record<string, unknown>>).some((t) => t.name === 'Adaptable (Human)')).toBe(false);
    // A custom race named "Human" is still a custom race — its traits are the
    // ones the player actually bought.
    const custom = buildSwadeCharacterSheet(baseInput({ ancestryName: 'Human', ancestryIsCustom: true }));
    expect(((custom.racialTraits ?? []) as Array<Record<string, unknown>>).some((t) => t.name === 'Adaptable (Human)')).toBe(false);
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
      customTraitPicks: [
        { traitId: 'attribute-increase', choice: 'agility' },
        { traitId: 'reduced-pace' },
      ],
    }));
    expect(sheet.ancestry).toBe('Skyfolk');
    expect(sheet.agility).toBe('d6'); // d4 + 1 step
    expect(swadePace(sheet)).toBe(5); // 6 - 1 from Reduced Pace
    expect(sheet.runningDie).toBe('d4'); // d6 - 1 step
  });

  it('racial abilities land in their own Ancestry Traits list, never as gear or armor', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Ironhide', ancestryIsCustom: true,
      customTraitPicks: [{ traitId: 'armor' }, { traitId: 'skill-bonus', choice: 'Notice' }],
    }));
    const traits = sheet.racialTraits as Array<{ name: string; toughnessBonus: number; bonusSkill: string }>;
    expect(traits).toHaveLength(2);
    expect(traits.some((t) => t.name.startsWith('Armor') && t.toughnessBonus === 2)).toBe(true);
    expect(traits.some((t) => t.bonusSkill === 'Notice')).toBe(true);
    // Nothing smuggled into the gear or armor lists.
    expect(sheet.inventory).toEqual([]);
    expect(sheet.armor).toEqual([]);
  });

  it('Armor and Toughness abilities raise derived Toughness through the trait rows', () => {
    const plain = buildSwadeCharacterSheet(baseInput());
    const tough = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Ironhide', ancestryIsCustom: true,
      customTraitPicks: [{ traitId: 'armor' }, { traitId: 'toughness' }],
    }));
    expect(swadeToughness(tough)).toBe(swadeToughness(plain) + 3); // +2 armor, +1 toughness
  });

  it('Parry and Poor Parry move derived Parry; Size shifts Toughness both ways', () => {
    const plain = buildSwadeCharacterSheet(baseInput());
    const nimble = buildSwadeCharacterSheet(baseInput({
      ancestryIsCustom: true, ancestryName: 'Tailed', customTraitPicks: [{ traitId: 'parry' }],
    }));
    expect(swadeParry(nimble)).toBe(swadeParry(plain) + 1);
    const clumsy = buildSwadeCharacterSheet(baseInput({
      ancestryIsCustom: true, ancestryName: 'Lumbering', customTraitPicks: [{ traitId: 'poor-parry' }],
    }));
    expect(swadeParry(clumsy)).toBe(swadeParry(plain) - 1);
    const small = buildSwadeCharacterSheet(baseInput({
      ancestryIsCustom: true, ancestryName: 'Wee', customTraitPicks: [{ traitId: 'size-minus' }],
    }));
    expect(swadeToughness(small)).toBe(swadeToughness(plain) - 1);
  });

  it('Infravision sets darkvision, and an immunity lands on the immunity list', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Deepwalker', ancestryIsCustom: true,
      customTraitPicks: [
        { traitId: 'infravision' },
        { traitId: 'immune-poison-disease', choice: 'Toxins' },
      ],
    }));
    expect(sheet.darkvision).toBe(24);
    // An immunity zeroes the damage; it is not a resistance, which only
    // shifts it by four. This used to be filed as the latter.
    expect(String(sheet.immune)).toContain('poison');
    expect(String(sheet.resist ?? '')).not.toContain('poison');
  });

  /**
   * Environmental Resistance used to write nothing but a sentence on a trait
   * row: the player paid a build point and the damage engine never heard
   * about it. The chosen environment now reaches the sheet as the damage type
   * an attack would carry, which is the only form anything can match.
   */
  it('Environmental Resistance and Weakness reach the sheet as damage types', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Emberkin', ancestryIsCustom: true,
      customTraitPicks: [
        { traitId: 'environmental-resistance', choice: 'Heat' },
        { traitId: 'environmental-weakness', choice: 'Cold' },
      ],
    }));
    expect(String(sheet.resist)).toContain('fire');
    expect(String(sheet.vulnerable)).toContain('cold');
    // The trait row still explains itself in the book's own terms.
    const traits = (sheet.racialTraits ?? []) as Array<{ name: string; notes: string }>;
    expect(traits.find((t) => t.name.startsWith('Environmental Resistance'))?.notes).toMatch(/Heat/);
  });

  it('Skill Bonus grants its +2 through the trait row, and Skill grants a starting die', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Farsight', ancestryIsCustom: true,
      customTraitPicks: [
        { traitId: 'skill-bonus', choice: 'Notice' },
        { traitId: 'skill', tier: 1, choice: 'Survival' },
      ],
    }));
    expect(gearTraitBonus(sheet, 'Notice')).toBe(2);
    const skills = sheet.skills as Array<{ name: string; die: string }>;
    expect(skills.find((s) => s.name === 'Survival')?.die).toBe('d6');
  });

  it('Bite and Claws arrive as real, rollable attacks', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryName: 'Saurian', ancestryIsCustom: true,
      attributeSteps: { agility: 0, smarts: 0, spirit: 0, strength: 2, vigor: 0 },
      customTraitPicks: [{ traitId: 'claws', tier: 2 }],
    }));
    const attacks = sheet.attacks as Array<{ name: string; damage: string; ap: number }>;
    const claws = attacks.find((a) => a.name === 'Claws')!;
    expect(claws.damage).toBe('1d8!+1d6!'); // Strength d8 + claw d6, both acing
    expect(claws.ap).toBe(2);
  });

  it('Reduced Core Skills drops a free skill from the starting five', () => {
    const sheet = buildSwadeCharacterSheet(baseInput({
      ancestryIsCustom: true, ancestryName: 'Feral',
      customTraitPicks: [{ traitId: 'reduced-core-skills', choice: 'Persuasion' }],
    }));
    const skills = sheet.skills as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'Persuasion')).toBe(false);
    expect(skills.some((s) => s.name === 'Notice')).toBe(true);
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

  it('no edge arrives unpicked — the Human free edge is a wizard-side SLOT, not an auto-add', () => {
    const human = buildSwadeCharacterSheet(baseInput());
    expect(human.edges as Array<{ name: string }>).toEqual([]);
    // The pick flows through edgeIds like any other edge.
    const withPick = buildSwadeCharacterSheet(baseInput({ edgeIds: ['alertness'] }));
    expect((withPick.edges as Array<{ name: string }>).some((e) => e.name === 'Alertness')).toBe(true);
  });

  it('purchased Edges apply their real mechanical effects: Brawny Toughness, Fleet-Footed pace, Luck bennies, Rich funds', () => {
    const plain = buildSwadeCharacterSheet(baseInput());
    const sheet = buildSwadeCharacterSheet(baseInput({ edgeIds: ['brawny', 'fleet-footed', 'luck', 'rich'] }));
    // Pace and Toughness now ride the Edge rows' own modifier columns and
    // surface through derive(), instead of mutating base fields or smuggling
    // in a phantom "Brawny" armor row.
    expect(sheet.pace).toBe(6);                       // base field untouched
    expect(swadePace(sheet)).toBe(8);                 // 6 + Fleet-Footed's +2
    expect(Number(swade.derive(sheet).pace)).toBe(8);
    expect(swadeToughness(sheet)).toBe(swadeToughness(plain) + 1); // Brawny
    expect(sheet.armor).toEqual([]);
    // Effects with no column to live in still land on their fields.
    expect(sheet.runningDie).toBe('d10');
    expect(sheet.bennies).toBe(4);                    // 3 + 1
    expect(sheet.dollars).toBe(500 + 1000);
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
