import { describe, expect, it } from 'vitest';
import { contentForSystem } from '../src/data/compendium.js';

const POWERS = contentForSystem('swade').filter((c) => c.kind === 'power');
const byName = (n: string) => POWERS.find((p) => p.name === n);

/** Rank and Power Points off the Power Summaries table, SWADE p172. */
const TABLE: Record<string, [number, string]> = {
  'Arcane Protection': [1, 'Novice'], Banish: [3, 'Veteran'], Barrier: [2, 'Seasoned'],
  Blast: [3, 'Seasoned'], Blind: [2, 'Novice'], Bolt: [1, 'Novice'],
  'Boost/Lower Trait': [2, 'Novice'], Burrow: [2, 'Novice'], Burst: [2, 'Novice'],
  Confusion: [1, 'Novice'], 'Damage Field': [4, 'Seasoned'], Darksight: [1, 'Novice'],
  Deflection: [3, 'Novice'], 'Detect/Conceal Arcana': [2, 'Novice'], Disguise: [2, 'Seasoned'],
  Dispel: [1, 'Seasoned'], Divination: [5, 'Heroic'], 'Drain Power Points': [2, 'Veteran'],
  'Elemental Manipulation': [1, 'Novice'], Empathy: [1, 'Novice'], Entangle: [2, 'Novice'],
  'Environmental Protection': [2, 'Novice'], Farsight: [2, 'Seasoned'], Fear: [2, 'Novice'],
  Fly: [3, 'Veteran'], 'Growth/Shrink': [2, 'Seasoned'], Havoc: [2, 'Novice'],
  Healing: [3, 'Novice'], Illusion: [3, 'Novice'], Intangibility: [5, 'Heroic'],
  Invisibility: [5, 'Seasoned'], 'Light/Darkness': [2, 'Novice'], 'Mind Link': [1, 'Novice'],
  'Mind Reading': [2, 'Novice'], 'Mind Wipe': [3, 'Veteran'], 'Object Reading': [2, 'Seasoned'],
  Protection: [1, 'Novice'], Puppet: [3, 'Veteran'], Relief: [1, 'Novice'],
  Resurrection: [30, 'Heroic'], 'Sloth/Speed': [2, 'Seasoned'], Slumber: [2, 'Seasoned'],
  Smite: [2, 'Novice'], 'Sound/Silence': [1, 'Novice'], 'Speak Language': [1, 'Novice'],
  Stun: [2, 'Novice'], Telekinesis: [5, 'Seasoned'], Teleport: [2, 'Seasoned'],
  'Wall Walker': [2, 'Novice'], 'Warrior\u2019s Gift': [4, 'Seasoned'], Zombie: [3, 'Veteran'],
};

describe('SWADE powers against the summary table', () => {
  it('has every power the book lists', () => {
    const missing = Object.keys(TABLE).filter((n) => !byName(n));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(TABLE))('%s costs the book’s Power Points at the book’s Rank', (name, [pp, rank]) => {
    const p = byName(name as string)!;
    expect(p.power?.level, `${name} Power Points`).toBe(pp);
    expect(p.category, `${name} Rank`).toBe(rank);
  });
});

/**
 * The book prints Area of Effect as an optional +2/+3 modifier on most powers
 * that can have one. Baking it in as the base makes a strictly better power
 * than the book's, for free — so only the handful whose BASE is a template
 * may carry one.
 */
const AOE_BY_DEFAULT = new Set(['Blast', 'Burst', 'Light/Darkness', 'Havoc', 'Silence']);

describe('area of effect is only baked in where the book bakes it in', () => {
  it('leaves it off every power that treats it as a modifier', () => {
    const baked = POWERS.filter((p) => p.power?.aoe).map((p) => p.name);
    expect([...baked].sort()).toEqual([...AOE_BY_DEFAULT].sort());
  });

  it.each(['Fear', 'Stun', 'Slumber', 'Entangle'])('%s is single-target at base', (name) => {
    expect(byName(name)?.power?.aoe).toBeUndefined();
  });
});
