import type { SheetData } from '../types.js';
import type { PlayingCard } from './cards.js';
import { rows, str } from './types.js';

/**
 * How many Action Cards a combatant draws and which one they act on, once
 * their Edges and Hindrances are taken into account.
 *
 * SWADE puts four of these on the initiative deal:
 *   Quick                  — discard a card of 5 or lower, draw again.
 *   Level Headed           — draw one extra, act on the better.
 *   Improved Level Headed  — draw two extra, act on the best.
 *   Hesitant               — draw two, act on the WORSE (a Joker still counts).
 */
export interface DrawPlan {
  /** Cards to put on the table before choosing one. */
  draw: number;
  /** Which of them is acted on. */
  keep: 'best' | 'worst';
  /** Quick: any card at or below this is discarded and redrawn. 0 = never. */
  redrawAtOrBelow: number;
  /** What applied, for the chat line — so the table can see the rule fire. */
  reasons: string[];
}

/** Quick discards anything at or under a 5. */
export const QUICK_REDRAW_MAX = 5;

const has = (names: string[], want: string) =>
  names.some((n) => n.toLowerCase() === want.toLowerCase());

function traitNames(sheet: SheetData, listId: 'edges' | 'hindrances'): string[] {
  return rows(sheet, listId).map((r) => str(r, 'name', '').trim()).filter(Boolean);
}

export function cardDrawPlan(sheet: SheetData): DrawPlan {
  const edges = traitNames(sheet, 'edges');
  const hindrances = traitNames(sheet, 'hindrances');

  const improved = has(edges, 'Improved Level Headed');
  const levelHeaded = improved || has(edges, 'Level Headed');
  const hesitant = has(hindrances, 'Hesitant');
  const quick = has(edges, 'Quick');

  const reasons: string[] = [];
  let draw = 1;
  let keep: 'best' | 'worst' = 'best';

  // Hesitant and Level Headed pull in opposite directions on the same draw.
  // Rather than pick a winner, they cancel: you draw your one card like
  // everyone else. Stacking them instead would mean "draw three, keep the
  // worst", which is strictly worse than having neither and reads as a bug.
  if (hesitant && levelHeaded) {
    reasons.push('Hesitant and Level Headed cancel out');
  } else if (hesitant) {
    draw = 2;
    keep = 'worst';
    reasons.push('Hesitant — two cards, acts on the worse');
  } else if (improved) {
    draw = 3;
    reasons.push('Improved Level Headed — three cards, keeps the best');
  } else if (levelHeaded) {
    draw = 2;
    reasons.push('Level Headed — two cards, keeps the better');
  }

  if (quick) reasons.push(`Quick — discards ${QUICK_REDRAW_MAX} or lower`);

  return { draw, keep, redrawAtOrBelow: quick ? QUICK_REDRAW_MAX : 0, reasons };
}

/**
 * The card actually acted on, out of everything drawn.
 *
 * A Joker is always taken, even under Hesitant: the Hindrance says to act on
 * the worse card, but the book carves the Joker out explicitly — drawing one
 * and then being made to throw it away is the opposite of what a Joker means.
 */
export function chooseCard(cards: PlayingCard[], keep: 'best' | 'worst'): PlayingCard {
  if (cards.length === 0) throw new Error('No cards to choose from.');
  const joker = cards.find((c) => c.rank === 15);
  if (joker) return joker;
  return cards.reduce((acc, c) => {
    if (keep === 'best') return c.rank > acc.rank ? c : acc;
    return c.rank < acc.rank ? c : acc;
  });
}

/** Does Quick throw this card back? A Joker never is. */
export function quickRedraws(card: PlayingCard, redrawAtOrBelow: number): boolean {
  return redrawAtOrBelow > 0 && card.rank !== 15 && card.rank <= redrawAtOrBelow;
}
