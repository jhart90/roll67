import type { Character, GameSystem, NameplateLine, NameplatePill, SheetData, TokenNameplate } from '../types.js';
import { CONCEPT_MAX_LEN } from '../types.js';
import { num, rows, str } from './types.js';
import { rankForAdvances } from './swadeAdvancement.js';



/**
 * The public face of a character: what anyone at the table may see about a
 * token they don't control. Deliberately a small, fixed shape rather than the
 * sheet itself — players only ever receive their own sheets, so this is
 * computed server-side and travels attached to the token.
 *
 * The picture is the TOKEN's art: the nameplate labels the piece on the map,
 * so it should show the same face — the token's own art, or the token image
 * set on the sheet, and only failing both the detail portrait. The color is
 * simply the token's color — one setting, not two that can disagree.
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
    lines: linesFor(character.system, sheet).filter((l) => l.text.length > 0),
    pills: pillsFor(character.system, sheet),
    ...(character.system === 'swade' ? { wildCard: sheet.wildCard !== false } : {}),
  };
}

/**
 * Edges and Hindrances as pills. SWADE only, for the same reason the Wild Card
 * badge is: it is the system whose characters are actually defined by them.
 * 5e feats and SWN foci would be the obvious extension, but they are neither
 * two-sided nor as load-bearing across the table, so they stay off the card.
 *
 * The name is public; the description rides along for the hover popover only.
 */
function pillsFor(system: GameSystem, sheet: SheetData): NameplatePill[] {
  if (system !== 'swade') return [];
  const pills: NameplatePill[] = [];
  for (const row of rows(sheet, 'edges')) {
    const name = str(row, 'name', '').trim();
    if (name) pills.push({ name, desc: str(row, 'notes', '').trim(), kind: 'edge' });
  }
  for (const row of rows(sheet, 'hindrances')) {
    const name = str(row, 'name', '').trim();
    if (!name) continue;
    // Major/Minor is half of what a Hindrance means, so it belongs on the
    // face of the pill rather than buried in the hover text.
    const severity = str(row, 'severity', '').trim();
    pills.push({
      name: severity ? `${name} (${severity})` : name,
      desc: str(row, 'notes', '').trim(),
      kind: 'hindrance',
    });
  }
  return pills;
}

function clampConcept(text: string): string {
  if (text.length <= CONCEPT_MAX_LEN) return text;
  return `${text.slice(0, CONCEPT_MAX_LEN - 1).trimEnd()}…`;
}

function linesFor(system: GameSystem, sheet: SheetData): NameplateLine[] {
  const join = (...parts: string[]) => parts.filter((p) => p).join(' ');
  const rank = (text: string): NameplateLine => ({ text, kind: 'rank' });
  const status = (text: string): NameplateLine => ({ text, kind: 'status' });
  const concept = (text: string): NameplateLine => ({ text, kind: 'concept' });
  const origin = (text: string): NameplateLine => ({ text, kind: 'origin' });
  if (system === 'swade') {
    const advances = num(sheet, 'advances', 0);
    return [
      rank(join(rankForAdvances(advances), advances > 0 ? `(${advances} advances)` : '')),
      // Wild Card vs Extra is the single most load-bearing fact about a SWADE
      // combatant — three wounds and a Wild Die, or one hit and gone. Only
      // SWADE has the distinction, so only SWADE shows the badge.
      status(sheet.wildCard === false ? 'Extra' : 'Wild Card'),
      // Truncated here as well as capped at the input, so a sheet that
      // acquired a longer concept by any other route still can't overrun the
      // three lines the card gives it.
      concept(clampConcept(str(sheet, 'concept', '').trim())),
      origin(str(sheet, 'ancestry', '').trim()),
    ];
  }
  if (system === 'swn') {
    return [
      rank(join('Level', String(num(sheet, 'level', 1)), str(sheet, 'class', '').trim())),
      origin(str(sheet, 'homeworld', '').trim()),
      origin(str(sheet, 'background', '').trim()),
    ];
  }
  return [
    rank(join('Level', String(num(sheet, 'level', 1)), str(sheet, 'class', '').trim())),
    origin(str(sheet, 'race', '').trim()),
    origin(str(sheet, 'background', '').trim()),
  ];
}
