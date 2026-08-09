import type { Character, GameSystem, SheetData, TokenNameplate } from '../types.js';
import { num, str } from './types.js';
import { rankForAdvances } from './swadeAdvancement.js';



/**
 * The public face of a character: what anyone at the table may see about a
 * token they don't control. Deliberately a small, fixed shape rather than the
 * sheet itself — players only ever receive their own sheets, so this is
 * computed server-side and travels attached to the token.
 *
 * The picture is the TOKEN's art: the nameplate labels the piece on the map,
 * so it should show the same face — the token's own art, or the token image
 * set on the sheet, and only failing both the detail portrait. The colour is
 * simply the token's colour — one setting, not two that can disagree.
 */
export function nameplateFor(character: Character, tokenColor: string, tokenArtUrl: string | null): TokenNameplate {
  const sheet = character.sheet;
  return {
    name: character.name,
    portraitUrl: tokenArtUrl
      || str(sheet, 'tokenImage', '').trim()
      || str(sheet, 'detailImage', '').trim()
      || null,
    color: tokenColor,
    lines: linesFor(character.system, sheet).filter((l) => l.length > 0),
  };
}

function linesFor(system: GameSystem, sheet: SheetData): string[] {
  const join = (...parts: string[]) => parts.filter((p) => p).join(' ');
  if (system === 'swade') {
    const advances = num(sheet, 'advances', 0);
    return [
      join(rankForAdvances(advances), advances > 0 ? `(${advances} advances)` : ''),
      str(sheet, 'concept', '').trim(),
      str(sheet, 'ancestry', '').trim(),
    ];
  }
  if (system === 'swn') {
    return [
      join('Level', String(num(sheet, 'level', 1)), str(sheet, 'class', '').trim()),
      str(sheet, 'homeworld', '').trim(),
      str(sheet, 'background', '').trim(),
    ];
  }
  return [
    join('Level', String(num(sheet, 'level', 1)), str(sheet, 'class', '').trim()),
    str(sheet, 'race', '').trim(),
    str(sheet, 'background', '').trim(),
  ];
}
