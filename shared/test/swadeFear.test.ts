import { describe, expect, it } from 'vitest';
import {
  FEAR_TABLE, PANICKED_OUTCOME, fearCheckFailure, fearCheckMod, fearTableBonus,
  fearTableRow, fearTableTotal,
} from '../src/systems/swadeFear.js';

describe('the Fear Table', () => {
  // The d20 bands exactly as the book prints them.
  it.each([
    [1, 'adrenaline'], [3, 'adrenaline'],
    [4, 'distracted'], [6, 'distracted'],
    [7, 'vulnerable'], [9, 'vulnerable'],
    [10, 'shaken'], [12, 'shaken'],
    [13, 'markOfFear'],
    [14, 'frightened'], [15, 'frightened'],
    [16, 'panicked'], [17, 'panicked'],
    [18, 'minorPhobia'], [19, 'minorPhobia'],
    [20, 'majorPhobia'], [21, 'majorPhobia'],
    [22, 'heartAttack'], [40, 'heartAttack'],
  ])('sends %i to %s', (total, id) => {
    expect(fearTableRow(total).id).toBe(id);
  });

  it('covers every number with no gaps and no overlaps', () => {
    for (let n = 1; n <= 30; n++) {
      const hits = FEAR_TABLE.filter((r) => n >= r.min && n <= r.max);
      expect(hits, `d20 total ${n}`).toHaveLength(1);
    }
  });

  it('reads worst-last, so a higher roll is always worse', () => {
    const order = FEAR_TABLE.map((r) => r.min);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('gives every row text the DM can read out', () => {
    for (const r of FEAR_TABLE) {
      expect(r.outcome.label, r.outcome.id).toBeTruthy();
      expect(r.outcome.effect, r.outcome.id).toBeTruthy();
    }
  });
});

describe('the creature’s Fear penalty', () => {
  // The book writes "Fear −2" and then says to add it as a POSITIVE to the
  // table roll — so it hurts twice, once each way.
  it('penalises the Spirit roll and pushes the table result worse', () => {
    expect(fearCheckMod(2)).toBe(-2);
    expect(fearTableBonus(2)).toBe(2);
  });

  it('reads the same whether the DM types 2 or −2', () => {
    expect(fearTableBonus(-2)).toBe(2);
    expect(fearCheckMod(-2)).toBe(-2);
  });

  it('turns a middling roll into a serious one', () => {
    expect(fearTableRow(fearTableTotal(12, 0, 'terror', false)).id).toBe('shaken');
    expect(fearTableRow(fearTableTotal(12, 4, 'terror', false)).id).toBe('panicked');
  });
});

describe('a Critical Failure', () => {
  // The +2 is printed beside the TERROR entry only. Nausea reaches the table
  // solely on a Critical Failure, so applying it there would mean it always
  // applied — which is not what the book says.
  it('adds +2 under Terror', () => {
    expect(fearTableTotal(10, 0, 'terror', true)).toBe(12);
  });

  it('adds nothing under Nausea', () => {
    expect(fearTableTotal(10, 0, 'nausea', true)).toBe(10);
  });
});

describe('failing the check', () => {
  it('leaves a Nausea victim Shaken and Fatigued, off the table', () => {
    const r = fearCheckFailure('nausea', false, true);
    expect(r.conditions).toEqual(['shaken']);
    expect(r.fatigue).toBe(1);
    expect(r.rollsTable).toBe(false);
  });

  it('sends a Nausea Critical Failure to the table as well', () => {
    expect(fearCheckFailure('nausea', true, true).rollsTable).toBe(true);
  });

  // Extras don't get the table under Terror — they are simply Panicked.
  it('panics an Extra facing Terror', () => {
    const r = fearCheckFailure('terror', false, false);
    expect(r.rollsTable).toBe(false);
    expect(r.conditions).toEqual(PANICKED_OUTCOME.conditions);
    expect(r.conditions).toContain('shaken');
  });

  it('sends a Wild Card facing Terror to the table', () => {
    const r = fearCheckFailure('terror', false, true);
    expect(r.rollsTable).toBe(true);
    expect(r.conditions).toEqual([]);
    expect(r.fatigue).toBe(0);
  });

  // Fatigue is Nausea's alone — Terror never hands it out.
  it('never fatigues someone facing Terror', () => {
    expect(fearCheckFailure('terror', true, true).fatigue).toBe(0);
    expect(fearCheckFailure('terror', true, false).fatigue).toBe(0);
  });
});

describe('the rows that touch a sheet', () => {
  const byId = (id: string) => FEAR_TABLE.find((r) => r.outcome.id === id)!.outcome;

  it('applies the conditions each row names', () => {
    expect(byId('distracted').conditions).toEqual(['distracted']);
    expect(byId('vulnerable').conditions).toEqual(['vulnerable']);
    expect(byId('shaken').conditions).toEqual(['shaken']);
    expect(byId('markOfFear').conditions).toEqual(['stunned']);
    expect(byId('panicked').conditions).toContain('shaken');
  });

  // These two branch on something the engine can't decide: initiative is
  // already dealt, and the Heart Attack forks into dying in 2d6 rounds.
  it('leaves the Joker and the Heart Attack to the table', () => {
    expect(byId('adrenaline').followUp).toBe('joker');
    expect(byId('heartAttack').followUp).toBe('vigor-heart-attack');
    expect(byId('adrenaline').conditions).toBeUndefined();
    expect(byId('heartAttack').conditions).toBeUndefined();
  });

  it('names the Hindrance the phobia rows hand out', () => {
    expect(byId('frightened').hindrance).toBe('Hesitant');
    expect(byId('minorPhobia').hindrance).toBe('Phobia (Minor)');
    expect(byId('majorPhobia').hindrance).toBe('Phobia (Major)');
  });
});
