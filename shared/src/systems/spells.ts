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

/**
 * Which slot level to actually spend when casting a spell of `minLevel`: the
 * lowest available slot at or above it (5e lets a spell be "upcast" using any
 * higher-level slot when the exact level is empty) -- e.g. a 3rd-level
 * Fireball with no 3rd-level slots left but a 5th-level slot open still casts,
 * spending the 5th-level slot. Null if nothing at or above `minLevel` remains.
 */
export function bestCastLevel(sheet: SheetData, minLevel: number): number | null {
  const levels = castableLevels(sheet, minLevel);
  return levels.length > 0 ? Math.min(...levels) : null;
}
