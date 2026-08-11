import type { SheetData } from '../types.js';
import { str } from './types.js';

/**
 * SWADE Cover, from the book's Cover Penalties table.
 *
 * Two things can say a target is behind cover and they are both right:
 *
 *   - The MAP knows. Walls between the shooter and the target are sampled
 *     around the target hex, and each blocked edge deepens the penalty.
 *   - The SHEET knows. A DM can say "he's crouched behind the bar" for cover
 *     the geometry cannot see: furniture, a crowd, a held-up shield, darkness
 *     the map does not model.
 *
 * Neither is a correction of the other, so the target keeps whichever is
 * BETTER for them — a man in medium cover by the map does not lose that
 * protection because his sheet only claims light.
 */
export const COVER_GRADES = ['none', 'light', 'medium', 'heavy', 'nearTotal'] as const;
export type CoverGrade = (typeof COVER_GRADES)[number];

export const COVER_PENALTY: Record<CoverGrade, number> = {
  none: 0,
  light: -2,
  medium: -4,
  heavy: -6,
  nearTotal: -8,
};

export const COVER_LABEL: Record<CoverGrade, string> = {
  none: 'No cover',
  light: 'Light cover',
  medium: 'Medium cover',
  heavy: 'Heavy cover',
  nearTotal: 'Near total cover',
};

/** Option list for the sheet's select, value first. */
export const COVER_OPTIONS: string[] = [...COVER_GRADES];

export function isCoverGrade(v: unknown): v is CoverGrade {
  return typeof v === 'string' && (COVER_GRADES as readonly string[]).includes(v);
}

/** The penalty a sheet's manual cover setting is claiming. 0 when unset. */
export function sheetCoverPenalty(sheet: SheetData): number {
  const g = str(sheet, 'cover', 'none');
  return isCoverGrade(g) ? COVER_PENALTY[g] : 0;
}

/** The grade a penalty corresponds to — for naming it in the chat tag. */
export function coverGradeFor(penalty: number): CoverGrade {
  const p = Math.min(0, penalty);
  if (p <= -8) return 'nearTotal';
  if (p <= -6) return 'heavy';
  if (p <= -4) return 'medium';
  if (p <= -2) return 'light';
  return 'none';
}

/**
 * The cover actually in play: the deeper of what the map sees and what the
 * sheet claims. Both are negative or zero, so "greater penalty" is the
 * smaller number.
 */
export function effectiveCover(geometryPenalty: number, sheet: SheetData): {
  penalty: number;
  grade: CoverGrade;
  /** Which source won, for the chat tag — or 'both' when they agree. */
  source: 'map' | 'sheet' | 'both';
} {
  const geo = Math.min(0, geometryPenalty);
  const manual = sheetCoverPenalty(sheet);
  const penalty = Math.min(geo, manual);
  const source = geo === manual ? 'both' : (penalty === geo ? 'map' : 'sheet');
  return { penalty, grade: coverGradeFor(penalty), source };
}
