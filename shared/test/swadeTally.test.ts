import { describe, expect, it } from 'vitest';
import {
  DEATHS_KEY, KILLS_KEY, addTally, tallyLabel, tallyOf, tallyRows, tallyTotal,
} from '../src/systems/swadeTally.js';

describe('reading a tally off a sheet', () => {
  it('returns what is there', () => {
    expect(tallyOf({ [KILLS_KEY]: { Bandit: 3, Wolf: 1 } }, KILLS_KEY)).toEqual({ Bandit: 3, Wolf: 1 });
  });

  it('is empty when the character has never dropped anyone', () => {
    expect(tallyOf({}, KILLS_KEY)).toEqual({});
    expect(tallyOf({ [KILLS_KEY]: null }, KILLS_KEY)).toEqual({});
  });

  // Sheets are hand-editable and travel through export and import, so a
  // malformed tally must degrade to "nothing" rather than render as junk.
  it.each([
    ['an array', []],
    ['a string', 'nope'],
    ['a number', 7],
  ])('shrugs off %s', (_why, bad) => {
    expect(tallyOf({ [KILLS_KEY]: bad }, KILLS_KEY)).toEqual({});
  });

  it('drops entries that could not be counts', () => {
    const messy = { Bandit: 2, Ghost: 0, Blank: 'x', Neg: -3, '': 5 };
    expect(tallyOf({ [KILLS_KEY]: messy }, KILLS_KEY)).toEqual({ Bandit: 2 });
  });
});

describe('adding to a tally', () => {
  it('starts a name at one', () => {
    expect(addTally({}, KILLS_KEY, 'Bandit')).toEqual({ Bandit: 1 });
  });

  it('counts a repeat', () => {
    expect(addTally({ [KILLS_KEY]: { Bandit: 2 } }, KILLS_KEY, 'Bandit')).toEqual({ Bandit: 3 });
  });

  it('leaves the other names alone', () => {
    expect(addTally({ [KILLS_KEY]: { Wolf: 1 } }, KILLS_KEY, 'Bandit')).toEqual({ Wolf: 1, Bandit: 1 });
  });

  it('trims, so " Bandit" and "Bandit" are one entry', () => {
    expect(addTally({ [KILLS_KEY]: { Bandit: 1 } }, KILLS_KEY, '  Bandit  ')).toEqual({ Bandit: 2 });
  });

  it('refuses to record a nameless victim', () => {
    expect(addTally({ [KILLS_KEY]: { Wolf: 1 } }, KILLS_KEY, '   ')).toEqual({ Wolf: 1 });
  });

  it('does not mutate the sheet it read from', () => {
    const sheet = { [KILLS_KEY]: { Bandit: 1 } };
    addTally(sheet, KILLS_KEY, 'Bandit');
    expect(sheet[KILLS_KEY]).toEqual({ Bandit: 1 });
  });

  // The two sides of the ledger are separate keys and must not bleed.
  it('keeps the two ledgers apart', () => {
    const sheet = { [KILLS_KEY]: { Wolf: 1 }, [DEATHS_KEY]: { Dragon: 1 } };
    expect(addTally(sheet, DEATHS_KEY, 'Dragon')).toEqual({ Dragon: 2 });
    expect(tallyOf(sheet, KILLS_KEY)).toEqual({ Wolf: 1 });
  });
});

describe('showing it', () => {
  it('puts the most frequent first', () => {
    expect(tallyRows({ Wolf: 1, Bandit: 4, Rat: 2 }).map((r) => r.name))
      .toEqual(['Bandit', 'Rat', 'Wolf']);
  });

  it('breaks a tie alphabetically, so the order never jitters', () => {
    expect(tallyRows({ Wolf: 2, Bandit: 2 }).map((r) => r.name)).toEqual(['Bandit', 'Wolf']);
  });

  // A count of one is noise — the name alone says it happened.
  it('only shows a count above one', () => {
    expect(tallyLabel({ name: 'Bandit', count: 1 })).toBe('Bandit');
    expect(tallyLabel({ name: 'Bandit', count: 4 })).toBe('Bandit ×4');
  });

  it('adds up', () => {
    expect(tallyTotal({ Wolf: 1, Bandit: 4 })).toBe(5);
    expect(tallyTotal({})).toBe(0);
  });
});
