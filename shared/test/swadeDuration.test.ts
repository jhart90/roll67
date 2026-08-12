import { describe, expect, it } from 'vitest';
import { SECONDS_PER_ROUND, TIME_STEPS } from '../src/events.js';
import {
  durationLabel, durationRounds, isMaintained, tickPowers, toggleFor,
} from '../src/systems/swadeDuration.js';
import { CONTENT_SWADE } from '../src/data/contentSwade.js';

describe('reading the book’s DUR column', () => {
  it('clocks a bare round count', () => {
    expect(durationRounds('5')).toBe(5);
    expect(durationRounds('3')).toBe(3);
  });

  // Minutes and hours are real durations, but the initiative loop has nothing
  // to measure them against — so they are carried, not counted.
  it.each(['Instant', '10m', '30m', '1H', 'Special', '', undefined])(
    'leaves %s off the clock', (d) => {
      expect(durationRounds(d)).toBeUndefined();
      expect(isMaintained(d)).toBe(false);
    },
  );

  // Detect/Conceal Arcana is one entry covering two powers with two durations.
  it('takes the round-based half of a split duration', () => {
    expect(durationRounds('5 / 1H')).toBe(5);
    expect(durationLabel('5 / 1H')).toBe('5 rounds / 1 hour');
  });

  it('spells the column out for a reader', () => {
    expect(durationLabel('5')).toBe('5 rounds');
    expect(durationLabel('1')).toBe('1 round');
    expect(durationLabel('10m')).toBe('10 minutes');
    expect(durationLabel('1H')).toBe('1 hour');
    expect(durationLabel('Instant')).toBe('Instant');
    expect(durationLabel('Special')).toBe('Special');
  });
});

describe('the countdown', () => {
  it('drops every power a round and retires the ones that run out', () => {
    const { running, expired } = tickPowers([
      { name: 'Armor', rounds: 1, upkeep: 1 },
      { name: 'Fly', rounds: 5, upkeep: 3 },
    ]);
    expect(expired.map((p) => p.name)).toEqual(['Armor']);
    expect(running).toEqual([{ name: 'Fly', rounds: 4, upkeep: 3 }]);
  });

  it('never leaves a power sitting at zero', () => {
    const { running, expired } = tickPowers([{ name: 'Smite', rounds: 1, upkeep: 2 }]);
    expect(running).toEqual([]);
    expect(expired[0]!.rounds).toBe(0);
  });

  it('does nothing to an empty list', () => {
    expect(tickPowers([])).toEqual({ running: [], expired: [] });
  });
});

describe('the four self-buffs drive a sheet toggle', () => {
  it.each([
    ['Armor', 'armorActive'],
    ['Protection', 'protectionActive'],
    ['Deflection', 'deflectionActive'],
    ['Smite', 'smiteActive'],
  ])('%s clears %s when it lapses', (name, toggle) => {
    expect(toggleFor(name)).toBe(toggle);
  });

  it('leaves powers with no live stat effect alone', () => {
    expect(toggleFor('Fly')).toBeUndefined();
    expect(toggleFor('Bolt')).toBeUndefined();
  });
});

describe('every SWADE power carries a duration', () => {
  const powers = CONTENT_SWADE.filter((e) => e.kind === 'power');

  it('leaves none of them blank', () => {
    const blank = powers.filter((p) => !p.power?.duration).map((p) => p.name);
    expect(blank).toEqual([]);
  });

  // The bucket that matters: these are the ones costing a Power Point a round.
  it('puts the expected set on the initiative clock', () => {
    const clocked = powers.filter((p) => isMaintained(p.power?.duration)).map((p) => p.name);
    expect(clocked).toEqual([
      'Arcane Protection', 'Armor', 'Boost/Lower Trait', 'Burrow', 'Deflection',
      'Detect/Conceal Arcana', 'Empathy', 'Fly', 'Illusion', 'Invisibility',
      'Protection', 'Puppet', 'Smite', 'Speed', 'Telekinesis', 'Barrier',
      'Damage Field', 'Detect Life', 'Elemental Manipulation', 'Farsight',
      'Growth/Shrink', 'Intangibility', 'Sanctuary', 'Shape Change', 'Silence',
      'Slow', 'Sound/Silence', 'Summon Ally', 'Wall Walker', 'Warrior’s Gift',
      'Sloth/Speed',
    ]);
  });

  it('leaves the instant ones off it', () => {
    const bolt = powers.find((p) => p.name === 'Bolt');
    expect(bolt?.power?.duration).toBe('Instant');
    expect(isMaintained(bolt?.power?.duration)).toBe(false);
  });
});

/**
 * The GM's clock. A SWADE round is six seconds and ten rounds make a minute —
 * the book's own figures — so every step is a whole number of rounds and the
 * whole clock stays in one unit.
 */
describe('the time controls', () => {
  const step = (id: string) => TIME_STEPS.find((t) => t.id === id)!;

  it('makes a round six seconds', () => {
    expect(SECONDS_PER_ROUND).toBe(6);
    expect(step('round').seconds).toBe(6);
  });

  it('makes a minute ten rounds', () => {
    expect(step('minute').seconds / SECONDS_PER_ROUND).toBe(10);
  });

  it('nests hour and day exactly', () => {
    expect(step('hour').seconds).toBe(60 * step('minute').seconds);
    expect(step('day').seconds).toBe(24 * step('hour').seconds);
  });

  it('keeps every step a whole number of rounds', () => {
    for (const t of TIME_STEPS) expect(t.seconds % SECONDS_PER_ROUND).toBe(0);
  });
});
