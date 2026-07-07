import { describe, expect, it } from 'vitest';
import { DiceParseError, parseDice } from '../src/dice/parser.js';
import { roll, seededRng } from '../src/dice/roller.js';

describe('dice parser', () => {
  it('parses plain dice and numbers', () => {
    expect(parseDice('2d6')).toEqual({ kind: 'dice', count: 2, sides: 6, keep: null });
    expect(parseDice('d20')).toEqual({ kind: 'dice', count: 1, sides: 20, keep: null });
    expect(parseDice('7')).toEqual({ kind: 'num', value: 7 });
  });

  it('parses keep-highest / keep-lowest', () => {
    expect(parseDice('2d20kh1')).toEqual({ kind: 'dice', count: 2, sides: 20, keep: { mode: 'kh', n: 1 } });
    expect(parseDice('4d6kl3')).toEqual({ kind: 'dice', count: 4, sides: 6, keep: { mode: 'kl', n: 3 } });
  });

  it('parses adv/dis sugar', () => {
    expect(parseDice('adv')).toEqual({ kind: 'dice', count: 2, sides: 20, keep: { mode: 'kh', n: 1 } });
    expect(parseDice('dis+5')).toMatchObject({ kind: 'binop', op: '+' });
  });

  it('handles arithmetic precedence and parens', () => {
    const n = parseDice('1+2*3');
    expect(n).toMatchObject({ kind: 'binop', op: '+' });
    const withParens = parseDice('(1+2)*3');
    expect(withParens).toMatchObject({ kind: 'binop', op: '*' });
  });

  it('rejects garbage with friendly errors', () => {
    expect(() => parseDice('')).toThrow(DiceParseError);
    expect(() => parseDice('banana')).toThrow(DiceParseError);
    expect(() => parseDice('2d')).toThrow(DiceParseError);
    expect(() => parseDice('2d6kh3')).toThrow(DiceParseError); // keep > count
    expect(() => parseDice('999d6')).toThrow(DiceParseError); // too many dice
    expect(() => parseDice('1d99999')).toThrow(DiceParseError); // too many sides
    expect(() => parseDice('2d6 + ')).toThrow(DiceParseError);
  });
});

describe('dice roller', () => {
  it('is deterministic with a seeded RNG', () => {
    const a = roll('4d6kl3 + 2', seededRng(42));
    const b = roll('4d6kl3 + 2', seededRng(42));
    expect(a).toEqual(b);
  });

  it('evaluates a flat constant expression (no dice) to itself', () => {
    // Flat-amount spells (Heal's 70) roll their amount through the same
    // pipeline; a constant expression must just BE that constant.
    const r = roll('70');
    expect(r.total).toBe(70);
    expect(r.dice).toHaveLength(0);
  });

  it('totals stay in range over many rolls', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 200; i++) {
      const r = roll('2d6', rng);
      expect(r.total).toBeGreaterThanOrEqual(2);
      expect(r.total).toBeLessThanOrEqual(12);
      expect(r.dice).toHaveLength(2);
    }
  });

  it('kh keeps the highest die', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 100; i++) {
      const r = roll('2d20kh1', rng);
      const values = r.dice.map((d) => d.value);
      expect(r.total).toBe(Math.max(...values));
      expect(r.dice.filter((d) => d.kept)).toHaveLength(1);
    }
  });

  it('kl keeps the lowest die', () => {
    const rng = seededRng(2);
    for (let i = 0; i < 100; i++) {
      const r = roll('2d20kl1', rng);
      expect(r.total).toBe(Math.min(...r.dice.map((d) => d.value)));
    }
  });

  it('arithmetic combines correctly', () => {
    // With no dice, totals are exact.
    expect(roll('3+4*2').total).toBe(11);
    expect(roll('(3+4)*2').total).toBe(14);
    expect(roll('10-3-2').total).toBe(5);
  });

  it('detail string shows dropped dice in ~tildes~', () => {
    const r = roll('2d20kh1', seededRng(3));
    expect(r.detail).toMatch(/~\d+~/);
  });
});
