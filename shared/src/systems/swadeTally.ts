/**
 * Who put whom out of the fight.
 *
 * Two tallies live on every character sheet: the ones this character has
 * incapacitated, and the ones who have incapacitated this character. Kept as
 * plain name → count maps on the sheet rather than in a table of their own,
 * so they travel with the character through export, copy and the world tree
 * without a migration or a join.
 *
 * Names, not ids, on purpose: an Extra is spawned, dropped and forgotten, and
 * a tally that pointed at its id would be a list of dead links a session
 * later. "Bandit ×4" is what the table actually wants to read.
 */

import type { SheetData } from '../types.js';

/** Sheet key for "people this character has dropped". */
export const KILLS_KEY = 'incapCaused';
/** Sheet key for "people who have dropped this character". */
export const DEATHS_KEY = 'incapSuffered';

export type Tally = Record<string, number>;

/** One tally off a sheet, with anything malformed dropped rather than shown. */
export function tallyOf(sheet: SheetData, key: string): Tally {
  const raw = sheet?.[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Tally = {};
  for (const [name, count] of Object.entries(raw as Record<string, unknown>)) {
    const n = Math.floor(Number(count));
    if (name.trim() !== '' && Number.isFinite(n) && n > 0) out[name] = n;
  }
  return out;
}

/** The tally with one more against `name`. Returns a new object. */
export function addTally(sheet: SheetData, key: string, name: string): Tally {
  const clean = name.trim();
  const cur = tallyOf(sheet, key);
  if (clean === '') return cur;
  return { ...cur, [clean]: (cur[clean] ?? 0) + 1 };
}

/** A tally as a display list, worst offenders first, then alphabetical. */
export function tallyRows(tally: Tally): { name: string; count: number }[] {
  return Object.entries(tally)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "Bandit ×4", or just "Bandit" when it only happened once. */
export function tallyLabel(row: { name: string; count: number }): string {
  return row.count > 1 ? `${row.name} ×${row.count}` : row.name;
}

/** Everything one side of the ledger adds up to. */
export function tallyTotal(tally: Tally): number {
  return Object.values(tally).reduce((n, c) => n + c, 0);
}
