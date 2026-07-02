import type { DieRoll, RollBreakdown } from '../types.js';
import { parseDice, type DiceNode } from './parser.js';

export type RNG = () => number; // [0, 1)

interface EvalResult {
  total: number;
  detail: string;
}

function rollDice(
  count: number,
  sides: number,
  keep: { mode: 'kh' | 'kl'; n: number } | null,
  rng: RNG,
  allDice: DieRoll[],
): EvalResult {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(1 + Math.floor(rng() * sides));
  }
  let keptIdx = new Set(rolls.map((_, i) => i));
  if (keep) {
    const order = rolls
      .map((v, i) => ({ v, i }))
      .sort((a, b) => (keep.mode === 'kh' ? b.v - a.v : a.v - b.v));
    keptIdx = new Set(order.slice(0, keep.n).map((x) => x.i));
  }
  let total = 0;
  const parts: string[] = [];
  rolls.forEach((v, i) => {
    const kept = keptIdx.has(i);
    if (kept) total += v;
    allDice.push({ sides, value: v, kept });
    parts.push(kept ? String(v) : `~${v}~`);
  });
  const name = `${count}d${sides}${keep ? keep.mode + keep.n : ''}`;
  return { total, detail: `${name} (${parts.join(', ')})` };
}

function evalNode(node: DiceNode, rng: RNG, allDice: DieRoll[]): EvalResult {
  switch (node.kind) {
    case 'num':
      return { total: node.value, detail: String(node.value) };
    case 'dice':
      return rollDice(node.count, node.sides, node.keep, rng, allDice);
    case 'binop': {
      const l = evalNode(node.left, rng, allDice);
      const r = evalNode(node.right, rng, allDice);
      const total = node.op === '+' ? l.total + r.total : node.op === '-' ? l.total - r.total : l.total * r.total;
      return { total, detail: `${l.detail} ${node.op} ${r.detail}` };
    }
  }
}

/** Parse and evaluate a dice expression. Throws DiceParseError on bad input. */
export function roll(expression: string, rng: RNG = Math.random): RollBreakdown {
  const node = parseDice(expression);
  const dice: DieRoll[] = [];
  const { total, detail } = evalNode(node, rng, dice);
  return { expression: expression.trim(), total, dice, detail };
}

/** Seeded RNG (mulberry32) for deterministic tests and replayable rolls. */
export function seededRng(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
