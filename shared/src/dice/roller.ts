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
    // Every die in a chain but the last one aced — that's what spawned its
    // successor. The client animates those in sequence with a flash between.
    chain.forEach((v, ci) => allDice.push({
      sides, value: v, kept, ...(ci < chain.length - 1 ? { ace: true } : {}),
    }));
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
      arms.forEach((arm, armIdx) => {
        for (const die of arm.dice) {
          // Arms past the first are the Wild Die in SWADE's best(trait, wild).
          // Tagging them lets the renderer tell the arms apart by color; it
          // must not lean on `kept`, which is only known once every arm has
          // finished acing and would give away rolls still to come.
          const tagged = { ...die, arm: armIdx, ...(armIdx > 0 ? { wild: true } : {}) };
          allDice.push(arm === winner ? tagged : { ...tagged, kept: false });
        }
      });
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

/**
 * When set, every roll() call with no explicit rng draws from this provider
 * instead of Math.random. The server installs IronDice here at boot: a
 * cryptographic keystream plus the {idx, commit} tag stamped onto the
 * breakdown so each card is independently verifiable.
 */
export type RollRngProvider = () => { rng: RNG; tag?: { idx: number; commit: string } };
let rngProvider: RollRngProvider | null = null;
export function setRollRngProvider(p: RollRngProvider | null): void {
  rngProvider = p;
}

/** Parse and evaluate a dice expression. Throws DiceParseError on bad input. */
export function roll(expression: string, rng?: RNG): RollBreakdown {
  const node = parseDice(expression);
  const dice: DieRoll[] = [];
  let tag: { idx: number; commit: string } | undefined;
  let r = rng;
  if (!r) {
    const p = rngProvider?.();
    if (p) { r = p.rng; tag = p.tag; } else r = Math.random;
  }
  const { total, detail } = evalNode(node, r, dice);
  return { expression: expression.trim(), total, dice, detail, ...(tag ? { iron: tag } : {}) };
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

/**
 * Fold a SWADE raise's bonus d6 into a base damage roll.
 *
 * The bonus is rolled separately rather than appended to the expression so its
 * dice can be tagged: an untagged extra die in the breakdown just looks like a
 * bug to whoever is reading chat. Tagged dice render in raise green, and the
 * detail string names where the extra die came from.
 */
export function withRaiseDie(base: RollBreakdown, bonus: RollBreakdown): RollBreakdown {
  return {
    expression: `${base.expression}+${bonus.expression}`,
    total: base.total + bonus.total,
    dice: [...base.dice, ...bonus.dice.map((d) => ({ ...d, raise: true }))],
    detail: `${base.detail} + raise ${bonus.detail}`,
    ...(base.outcome ? { outcome: base.outcome } : {}),
  };
}

/**
 * Split a chat roll argument into its dice expression and an optional label:
 * `"1d20+3 # Stealth check"` → `{ expr: '1d20+3', label: 'Stealth check' }`.
 *
 * Only the first `#` separates; later ones belong to the label, so a label may
 * contain one. A roll with no `#` keeps an empty label, which is how every
 * existing `/r` behaves.
 */
export function splitRollLabel(arg: string): { expr: string; label: string } {
  const at = arg.indexOf('#');
  if (at === -1) return { expr: arg.trim(), label: '' };
  return { expr: arg.slice(0, at).trim(), label: arg.slice(at + 1).trim() };
}
