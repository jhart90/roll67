import { describe, expect, it } from 'vitest';
import { NON_RULES_LABELS, glossaryCoverage, sheetTermDesc, termDesc } from '../src/systems/glossary.js';
import { ATTRIBUTES_SWADE } from '../src/systems/swade.js';
import { SYSTEMS } from '../src/systems/index.js';

/** Every label the schema renders on a character sheet, per system. */
function sheetLabels(system: 'dnd5e' | 'swn' | 'swade'): string[] {
  const out = new Set<string>();
  for (const tab of SYSTEMS[system].tabs) {
    for (const sec of tab.sections) {
      if (sec.kind === 'fields') for (const f of sec.fields) out.add(f.label);
      if (sec.kind === 'list') for (const c of sec.columns) out.add(c.label);
      if (sec.kind === 'derived') for (const i of sec.items) out.add(i.label);
    }
  }
  return [...out];
}

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

  it('every rules-bearing sheet label in all three systems has a description', () => {
    for (const system of ['dnd5e', 'swn', 'swade'] as const) {
      const missing = sheetLabels(system)
        .filter((l) => !NON_RULES_LABELS.has(l.trim().toLowerCase()))
        .filter((l) => !sheetTermDesc(system, l));
      expect(missing, `${system} labels without a glossary entry`).toEqual([]);
    }
  });

  it('sheet labels resolve through their decorated forms', () => {
    // "Toughness (incl. armor)" -> Toughness, "HP (current)" -> HP, "Max PP" -> PP
    expect(sheetTermDesc('swade', 'Toughness (incl. armor)')).toBe(termDesc('swade', 'Toughness'));
    expect(sheetTermDesc('swade', 'HP (current)')).toBe(termDesc('swade', 'HP'));
    expect(sheetTermDesc('swade', 'Max PP')).toBe(termDesc('swade', 'PP'));
    expect(sheetTermDesc('swn', 'Max Effort (1 + best of discipline skill / WIS / CON)')).toBe(termDesc('swn', 'Max Effort'));
    // An exact match always wins over the stripped form.
    expect(sheetTermDesc('swade', 'Armor (+2 Toughness)')).not.toBe(termDesc('swade', 'Armor'));
  });

  it('5e abilities, skills, and spell-slot levels are documented', () => {
    for (const a of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) expect(termDesc('dnd5e', a), a).toBeTruthy();
    for (const s of ['Acrobatics', 'Perception', 'Sleight of Hand', 'Survival']) expect(termDesc('dnd5e', s), s).toBeTruthy();
    for (let lvl = 1; lvl <= 9; lvl++) expect(termDesc('dnd5e', `L${lvl}`), `L${lvl}`).toBeTruthy();
    for (const c of ['AC', 'HP', 'Temp HP', 'Hit Dice', 'Initiative', 'Proficiency', 'Save DC', 'Inspiration']) {
      expect(termDesc('dnd5e', c), c).toBeTruthy();
    }
  });

  it('lookup is case-insensitive and returns undefined for unknown terms', () => {
    expect(termDesc('swade', 'fighting')).toBe(termDesc('swade', 'Fighting'));
    expect(termDesc('swn', 'PILOT')).toBe(termDesc('swn', 'Pilot'));
    expect(termDesc('swade', 'Not A Real Term')).toBeUndefined();
  });
});
