import { describe, expect, it } from 'vitest';
import { statEntriesFromDice, summarizeRollStats, type RollStatRow } from '../src/systems/rollStats.js';
import type { DieRoll } from '../src/types.js';

const die = (sides: number, value: number): DieRoll => ({ sides, value, kept: true });

describe('statEntriesFromDice', () => {
  it('a 2d4 roll is two d4 entries and one 2d4 entry', () => {
    const entries = statEntriesFromDice([die(4, 3), die(4, 1)]);
    expect(entries).toContainEqual({ kind: 'die', key: 'd4', value: 3 });
    expect(entries).toContainEqual({ kind: 'die', key: 'd4', value: 1 });
    expect(entries).toContainEqual({ kind: 'expr', key: '2d4', value: 4 });
    expect(entries).toHaveLength(3);
  });

  it('mixed sizes split into separate amount groups', () => {
    const entries = statEntriesFromDice([die(8, 5), die(6, 6), die(6, 2)]);
    expect(entries).toContainEqual({ kind: 'expr', key: '1d8', value: 5 });
    expect(entries).toContainEqual({ kind: 'expr', key: '2d6', value: 8 });
  });

  it('ignores zero-sided placeholder dice', () => {
    expect(statEntriesFromDice([die(0, 0)])).toEqual([]);
  });
});

describe('summarizeRollStats', () => {
  const rows: RollStatRow[] = [
    { kind: 'die', key: 'd20', value: 20, count: 2 },
    { kind: 'die', key: 'd20', value: 1, count: 1 },
    { kind: 'die', key: 'd20', value: 10, count: 1 },
    { kind: 'die', key: 'd4', value: 4, count: 3 },
    { kind: 'expr', key: '2d4', value: 8, count: 2 },
    { kind: 'expr', key: '2d4', value: 3, count: 1 },
  ];

  it('lifetime counts individual dice; luck is pips over max pips', () => {
    const s = summarizeRollStats(rows);
    expect(s.lifetime).toBe(7); // 4 d20s + 3 d4s
    // pips: 40+1+10 + 12 = 63; max: 80 + 12 = 92
    expect(s.luck).toBeCloseTo((63 / 92) * 100, 5);
  });

  it('per-size summaries carry mean, mode, luck, and a sorted histogram', () => {
    const s = summarizeRollStats(rows);
    const d20 = s.bySize.find((k) => k.key === 'd20')!;
    expect(d20.count).toBe(4);
    expect(d20.mean).toBeCloseTo(51 / 4);
    expect(d20.mode).toBe(20);
    expect(d20.luck).toBeCloseTo((51 / 80) * 100);
    expect(d20.hist.map((h) => h.value)).toEqual([1, 10, 20]);
    const d4 = s.bySize.find((k) => k.key === 'd4')!;
    expect(d4.luck).toBe(100); // every d4 came up max
    // Big dice sort first.
    expect(s.bySize[0].key).toBe('d20');
  });

  it('amount summaries scale luck to n×sides', () => {
    const s = summarizeRollStats(rows);
    const two = s.byAmount.find((k) => k.key === '2d4')!;
    expect(two.count).toBe(3);
    expect(two.mode).toBe(8);
    expect(two.luck).toBeCloseTo((19 / 24) * 100);
  });

  it('empty rows summarize to zeros', () => {
    const s = summarizeRollStats([]);
    expect(s.lifetime).toBe(0);
    expect(s.luck).toBe(0);
    expect(s.bySize).toEqual([]);
  });
});
