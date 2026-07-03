import type { SheetData } from '../types.js';
import { num } from './types.js';

export interface SlotLevel {
  level: number;
  total: number;
  remaining: number;
}

/**
 * Spell-slot state per level (1..9), for levels the character actually has.
 * `slots{n}` is the total; `slotsUsed{n}` is how many are expended.
 */
export function spellSlots(sheet: SheetData): SlotLevel[] {
  const out: SlotLevel[] = [];
  for (let n = 1; n <= 9; n++) {
    const total = num(sheet, `slots${n}`, 0);
    if (total <= 0) continue;
    const used = num(sheet, `slotsUsed${n}`, 0);
    out.push({ level: n, total, remaining: Math.max(0, total - used) });
  }
  return out;
}

/** Slot levels at which a spell of `minLevel` can currently be cast. */
export function castableLevels(sheet: SheetData, minLevel: number): number[] {
  return spellSlots(sheet).filter((s) => s.level >= minLevel && s.remaining > 0).map((s) => s.level);
}
