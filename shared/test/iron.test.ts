import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ironMessage, ironRng } from '../src/dice/iron.js';
import { roll, setRollRngProvider } from '../src/dice/roller.js';

const seed = Buffer.from('a'.repeat(64), 'hex');
const digestFor = (idx: number) => (block: number): Uint8Array =>
  createHmac('sha256', seed).update(ironMessage(idx, block)).digest();

describe('IronDice keystream', () => {
  afterEach(() => setRollRngProvider(null));

  it('is deterministic: same seed + index → identical rolls', () => {
    const a = roll('4d6!+2d20', ironRng(digestFor(7)));
    const b = roll('4d6!+2d20', ironRng(digestFor(7)));
    expect(a.dice.map((d) => d.value)).toEqual(b.dice.map((d) => d.value));
    expect(a.total).toBe(b.total);
  });

  it('different indexes produce different streams', () => {
    const a = roll('10d20', ironRng(digestFor(1)));
    const b = roll('10d20', ironRng(digestFor(2)));
    expect(a.dice.map((d) => d.value)).not.toEqual(b.dice.map((d) => d.value));
  });

  it('crosses block boundaries cleanly (a 32-byte digest holds 5 draws)', () => {
    // 40 dice needs 8 digest blocks; every value must stay in range.
    const br = roll('40d6', ironRng(digestFor(3)));
    expect(br.dice).toHaveLength(40);
    for (const d of br.dice) expect(d.value).toBeGreaterThanOrEqual(1);
    for (const d of br.dice) expect(d.value).toBeLessThanOrEqual(6);
  });

  it('values are uniform enough over a big sample', () => {
    const rng = ironRng(digestFor(4));
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += rng();
    expect(sum / 5000).toBeGreaterThan(0.47);
    expect(sum / 5000).toBeLessThan(0.53);
  });

  it('the roller provider stamps rolls with their iron tag', () => {
    setRollRngProvider(() => ({
      rng: ironRng(digestFor(42)),
      tag: { idx: 42, commit: 'deadbeef' },
    }));
    const br = roll('1d20');
    expect(br.iron).toEqual({ idx: 42, commit: 'deadbeef' });
    // An explicit rng bypasses the provider — no tag, unchanged behavior.
    const plain = roll('1d20', () => 0.5);
    expect(plain.iron).toBeUndefined();
    expect(plain.total).toBe(11);
  });
});
