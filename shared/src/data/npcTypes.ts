import type { GameSystem, SheetData } from '../types.js';

export interface NpcEntry {
  id: string;
  system: GameSystem;
  name: string;
  category: string;
  /** Numeric challenge for sorting (5e CR, SWN hit dice/level). */
  challenge: number;
  /** Display label, e.g. "CR 1/4" or "HD 3". */
  challengeLabel: string;
  ac: number;
  hp: number;
  sheet: SheetData;
}

export function slug(system: string, name: string): string {
  return `${system}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function crToNumber(cr: string): number {
  if (cr.includes('/')) {
    const [a, b] = cr.split('/');
    return Number(a) / Number(b);
  }
  return Number(cr);
}

/** [name, toHitBonus, damageExpr, notes?] */
export type AttackRow = [string, number, string, string?];

export function attackRows(attacks: AttackRow[]): Array<Record<string, unknown>> {
  return attacks.map(([name, bonus, damage, notes]) => ({ name, bonus, damage, notes: notes ?? '' }));
}
