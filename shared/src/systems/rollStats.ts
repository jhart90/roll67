// Lifetime roll statistics. Every die that hits the table is folded into
// per-die-size and per-dice-amount aggregates (a 2d4 roll is two d4s for the
// size view, one "2d4" for the amount view), persisted as compact
// (kind, key, value) → count rows so histograms never grow with playtime.

import type { DieRoll } from '../types.js';

/** One unit increment: this key saw this value once. */
export interface RollStatEntry {
  kind: 'die' | 'expr';
  /** 'd20' for kind die; '2d4' for kind expr. */
  key: string;
  /** The face rolled (die) or the summed total (expr). */
  value: number;
}

/** A persisted aggregate row: entry plus how often it happened. */
export interface RollStatRow extends RollStatEntry { count: number }

export interface RollStatHistBar { value: number; count: number }

export interface RollStatKeySummary {
  key: string;
  /** Times this key was rolled. */
  count: number;
  mean: number;
  /** Most frequent result (smallest wins ties). */
  mode: number;
  /** % of the maximum possible pips: 100 = every die came up max. */
  luck: number;
  hist: RollStatHistBar[];
}

export interface RollStatsSummary {
  /** Total individual dice ever rolled (a 2d4 roll counts as two). */
  lifetime: number;
  /** Total rolls ever made (that same 2d4 roll counts once). */
  rolls: number;
  /** Luckiness across every individual die ever rolled. */
  luck: number;
  bySize: RollStatKeySummary[];
  byAmount: RollStatKeySummary[];
}

/**
 * Break one roll's dice into stat entries. Both arms of a `best(...)` and
 * every ace-chain die physically hit the table, so all of them count.
 */
export function statEntriesFromDice(dice: DieRoll[]): RollStatEntry[] {
  const real = dice.filter((d) => d.sides > 0 && Number.isFinite(d.value));
  const out: RollStatEntry[] = real.map((d) => ({ kind: 'die', key: `d${d.sides}`, value: d.value }));
  const groups = new Map<number, { n: number; sum: number }>();
  for (const d of real) {
    const g = groups.get(d.sides) ?? { n: 0, sum: 0 };
    g.n += 1;
    g.sum += d.value;
    groups.set(d.sides, g);
  }
  for (const [sides, g] of groups) out.push({ kind: 'expr', key: `${g.n}d${sides}`, value: g.sum });
  // One meta-entry per roll EVENT, so a mixed roll (best(1d8!, 1d6!) spans
  // two size-groups) still counts as a single lifetime roll.
  if (real.length > 0) out.push({ kind: 'expr', key: ROLL_META_KEY, value: 0 });
  return out;
}

/** The once-per-roll marker row — counted for `rolls`, hidden from byAmount. */
export const ROLL_META_KEY = 'roll';

/** 'd20' → {n: 1, sides: 20}; '3d6' → {n: 3, sides: 6}. */
export function parseRollKey(key: string): { n: number; sides: number } {
  const m = /^(\d*)d(\d+)$/.exec(key);
  return m ? { n: m[1] ? Number(m[1]) : 1, sides: Number(m[2]) } : { n: 1, sides: 0 };
}

function summarizeKeys(rows: RollStatRow[]): RollStatKeySummary[] {
  const byKey = new Map<string, RollStatRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.key) ?? [];
    list.push(r);
    byKey.set(r.key, list);
  }
  const out: RollStatKeySummary[] = [];
  for (const [key, list] of byKey) {
    const { n, sides } = parseRollKey(key);
    const max = n * sides;
    const count = list.reduce((a, r) => a + r.count, 0);
    const pips = list.reduce((a, r) => a + r.value * r.count, 0);
    let mode = list[0]?.value ?? 0;
    let modeCount = -1;
    for (const r of [...list].sort((a, b) => a.value - b.value)) {
      if (r.count > modeCount) { mode = r.value; modeCount = r.count; }
    }
    out.push({
      key,
      count,
      mean: count > 0 ? pips / count : 0,
      mode,
      luck: max > 0 && count > 0 ? (pips / (max * count)) * 100 : 0,
      hist: [...list].sort((a, b) => a.value - b.value).map((r) => ({ value: r.value, count: r.count })),
    });
  }
  // Big dice first (d20 above d4), then more dice first within a size.
  return out.sort((a, b) => {
    const pa = parseRollKey(a.key);
    const pb = parseRollKey(b.key);
    return pb.sides - pa.sides || pa.n - pb.n;
  });
}

export function summarizeRollStats(rows: RollStatRow[]): RollStatsSummary {
  const dieRows = rows.filter((r) => r.kind === 'die');
  const exprRows = rows.filter((r) => r.kind === 'expr' && r.key !== ROLL_META_KEY);
  const rollRows = rows.filter((r) => r.kind === 'expr' && r.key === ROLL_META_KEY);
  const lifetime = dieRows.reduce((a, r) => a + r.count, 0);
  const pips = dieRows.reduce((a, r) => a + r.value * r.count, 0);
  const maxPips = dieRows.reduce((a, r) => a + parseRollKey(r.key).sides * r.count, 0);
  return {
    lifetime,
    rolls: rollRows.reduce((a, r) => a + r.count, 0),
    luck: maxPips > 0 ? (pips / maxPips) * 100 : 0,
    bySize: summarizeKeys(dieRows),
    byAmount: summarizeKeys(exprRows),
  };
}

/** Max pips this summary's dice could possibly have shown — luck's denominator. */
export function summaryMaxPips(s: RollStatsSummary): number {
  return s.bySize.reduce((a, k) => a + parseRollKey(k.key).sides * k.count, 0);
}
