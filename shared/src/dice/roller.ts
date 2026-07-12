import type { DieRoll, RollBreakdown } from '../types.js';
import { parseDice, type DiceNode } from './parser.js';

export type RNG = () => number; // [0, 1)

interface EvalResult {
  total: number;
  detail: string;
}

/** Max extra rolls a single exploding die may chain — a runaway safety cap. */
const MAX_EXPLOSIONS = 20;

function rollDice(
  count: number,
  sides: number,
  explode: boolean,
  keep: { mode: 'kh' | 'kl'; n: number } | null,
  rng: RNG,
  allDice: DieRoll[],
): EvalResult {
  // Each original die is a chain: just [v], or [max, max, v] when exploding
  // (a die that shows its max "aces" — rolls again and adds, SWADE-style).
  const chains: number[][] = [];
  for (let i = 0; i < count; i++) {
    const chain = [1 + Math.floor(rng() * sides)];
    while (explode && sides >= 2 && chain[chain.length - 1] === sides && chain.length <= MAX_EXPLOSIONS) {
      chain.push(1 + Math.floor(rng() * sides));
    }
    chains.push(chain);
  }
  const sums = chains.map((ch) => ch.reduce((a, b) => a + b, 0));
  let keptIdx = new Set(chains.map((_, i) => i));
  if (keep) {
    const order = sums
      .map((v, i) => ({ v, i }))
      .sort((a, b) => (keep.mode === 'kh' ? b.v - a.v : a.v - b.v));
    keptIdx = new Set(order.slice(0, keep.n).map((x) => x.i));
  }
  let total = 0;
  const parts: string[] = [];
  chains.forEach((chain, i) => {
    const kept = keptIdx.has(i);
    if (kept) total += sums[i];
    for (const v of chain) allDice.push({ sides, value: v, kept });
    const text = chain.length > 1 ? `${chain.join('+')}=${sums[i]}` : String(chain[0]);
    parts.push(kept ? text : `~${text}~`);
  });
  const name = `${count}d${sides}${explode ? '!' : ''}${keep ? keep.mode + keep.n : ''}`;
  return { total, detail: `${name} (${parts.join(', ')})` };
}

function evalNode(node: DiceNode, rng: RNG, allDice: DieRoll[]): EvalResult {
  switch (node.kind) {
    case 'num':
      return { total: node.value, detail: String(node.value) };
    case 'dice':
      return rollDice(node.count, node.sides, node.explode, node.keep, rng, allDice);
    case 'best': {
      // Roll every arm, keep the highest total (SWADE trait die vs wild die).
      // Losing arms' dice stay in the breakdown but are marked not-kept.
      const arms = node.args.map((arg) => {
        const dice: DieRoll[] = [];
        const res = evalNode(arg, rng, dice);
        return { ...res, dice };
      });
      const winner = arms.reduce((a, b) => (b.total > a.total ? b : a));
      for (const arm of arms) {
        for (const die of arm.dice) allDice.push(arm === winner ? die : { ...die, kept: false });
      }
      const detail = arms.map((a) => (a === winner ? a.detail : `~${a.detail}~`)).join(' | ');
      return { total: winner.total, detail: `best(${detail})` };
    }
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
