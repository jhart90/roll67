import type { Character, GameSystem, SheetData, TokenNameplate } from '../types.js';
import { num, str } from './types.js';
import { rankForAdvances } from './swadeAdvancement.js';

/** Longest quip a player may set — a one-liner, not a biography. */
export const QUIP_MAX = 80;

/**
 * The public face of a character: what anyone at the table may see about a
 * token they don't control. Deliberately a small, fixed shape rather than the
 * sheet itself — players only ever receive their own sheets, so this is
 * computed server-side and travels attached to the token.
 *
 * `concept` is SWADE's own field; 5e and SWN have no equivalent, so those fall
 * back to the free-text quip. A SWADE player who sets both gets the concept,
 * since it's the one the rules actually recognise.
 */
export function nameplateFor(character: Character, tokenColor: string, tokenArtUrl: string | null): TokenNameplate {
  const sheet = character.sheet;
  const quip = str(sheet, 'quip', '').trim().slice(0, QUIP_MAX);
  return {
    name: character.name,
    portraitUrl: str(sheet, 'detailImage', '').trim() || tokenArtUrl,
    color: str(sheet, 'nameplateColor', '').trim() || tokenColor,
    lines: linesFor(character.system, sheet, quip).filter((l) => l.length > 0),
  };
}

function linesFor(system: GameSystem, sheet: SheetData, quip: string): string[] {
  const join = (...parts: string[]) => parts.filter((p) => p).join(' ');
  if (system === 'swade') {
    const advances = num(sheet, 'advances', 0);
    return [
      join(rankForAdvances(advances), advances > 0 ? `(${advances} advances)` : ''),
      str(sheet, 'concept', '').trim() || quip,
      str(sheet, 'ancestry', '').trim(),
    ];
  }
  if (system === 'swn') {
    return [
      join('Level', String(num(sheet, 'level', 1)), str(sheet, 'class', '').trim()),
      quip,
      str(sheet, 'homeworld', '').trim(),
      str(sheet, 'background', '').trim(),
    ];
  }
  return [
    join('Level', String(num(sheet, 'level', 1)), str(sheet, 'class', '').trim()),
    quip,
    str(sheet, 'race', '').trim(),
    str(sheet, 'background', '').trim(),
  ];
}
