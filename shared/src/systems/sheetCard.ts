/**
 * Cards posted from a character sheet into the chat log.
 *
 * The card is authored on the client and lands in a log everyone reads, so
 * nothing on it is trusted: the tone and theme must be values the stylesheet
 * actually has a color for, and the text is clamped so one card cannot flood
 * the log or stretch the panel.
 */
import type { SheetCard } from '../types.js';

/** Card themes the sheet uses. Anything else is dropped rather than echoed
 *  into a class name. */
export const CARD_THEMES = new Set(['card-good', 'card-bad', 'card-info']);

/** Chip tones the stylesheet has a color for (ChipTone in the sheet). */
export const CHIP_TONES = new Set([
  'damage', 'skill', 'range', 'ammo', 'bonus', 'penalty',
  'severity', 'qty', 'weight', 'use', 'flag', 'plain',
]);

export const CARD_MAX_CHIPS = 24;
export const CARD_MAX_NOTES = 8;
export const CARD_TEXT_MAX = 400;

/**
 * Trim a client-authored card down to something safe to broadcast, or null
 * when there is nothing left worth showing. A card with no name is nothing —
 * every other field is optional decoration on top of it.
 */
export function sanitizeCard(card: SheetCard | undefined | null): SheetCard | null {
  if (!card || typeof card !== 'object') return null;
  const clip = (v: unknown) => String(v ?? '').trim().slice(0, CARD_TEXT_MAX);
  const name = clip(card.name);
  if (!name) return null;
  const chips = (Array.isArray(card.chips) ? card.chips : [])
    .slice(0, CARD_MAX_CHIPS)
    .map((c) => ({ text: clip(c?.text), tone: CHIP_TONES.has(String(c?.tone)) ? String(c.tone) : 'plain' }))
    .filter((c) => c.text !== '');
  const notes = (Array.isArray(card.notes) ? card.notes : [])
    .slice(0, CARD_MAX_NOTES).map(clip).filter(Boolean);
  const theme = CARD_THEMES.has(String(card.theme)) ? String(card.theme) : undefined;
  return { name, chips, notes, ...(theme ? { theme } : {}) };
}
