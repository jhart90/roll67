import { describe, expect, it } from 'vitest';
import { glossaryCoverage, termDesc } from '../src/systems/glossary.js';
import { ATTRIBUTES_SWADE } from '../src/systems/swade.js';

describe('rules-term glossary', () => {
  it('covers every SWADE skill and ancestry and every SWN skill and species', () => {
    const { missingSwade, missingSwn } = glossaryCoverage();
    expect(missingSwade).toEqual([]);
    expect(missingSwn).toEqual([]);
  });

  it('covers every SWADE attribute and the core concepts the wizards name', () => {
    for (const a of ATTRIBUTES_SWADE) expect(termDesc('swade', a.label), a.label).toBeTruthy();
    for (const term of ['Wild Card', 'Wild Die', 'Benny', 'Bennies', 'Hindrance', 'Edge', 'Trait', 'Pace', 'Parry', 'Toughness', 'Ancestry', 'Starting funds']) {
      expect(termDesc('swade', term), term).toBeTruthy();
    }
  });

  it('covers every SWN attribute and the core concepts the wizard names', () => {
    for (const a of ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']) {
      expect(termDesc('swn', a), a).toBeTruthy();
    }
    for (const term of ['Class', 'Background', 'Focus', 'Skill points', 'Attributes', 'HP', 'AC', 'Equipment package', 'Credits', 'Homeworld', 'Species']) {
      expect(termDesc('swn', term), term).toBeTruthy();
    }
  });

  it('lookup is case-insensitive and returns undefined for unknown terms', () => {
    expect(termDesc('swade', 'fighting')).toBe(termDesc('swade', 'Fighting'));
    expect(termDesc('swn', 'PILOT')).toBe(termDesc('swn', 'Pilot'));
    expect(termDesc('swade', 'Not A Real Term')).toBeUndefined();
  });
});
