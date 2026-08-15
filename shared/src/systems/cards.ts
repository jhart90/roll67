// SWADE action-deck initiative: a 54-card deck (52 + red/black jokers).
// Aces are high; jokers beat aces. Pure functions + injectable RNG so the
// server deals authoritatively and everything is unit-testable.
//
// Ties in rank break TWO different ways, on purpose, depending on the round.
//
// Round one is dealt a card at a time, each player clicking to draw their own:
// draw order is something the table watched happen, so the house rule stands
// there — whoever drew first acts first. Rounds two onward are dealt by the
// server in a loop, where "who drew first" is an implementation detail nobody
// saw and nobody agreed to, so those fall back to the book: ♠ > ♥ > ♦ > ♣.
//
// Which is why the comparator takes the rule rather than assuming one.

import type { RNG } from '../dice/roller.js';

export type CardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export interface PlayingCard {
  /** 2–14 (J=11, Q=12, K=13, A=14); jokers are 15. */
  rank: number;
  /** null for jokers. */
  suit: CardSuit | null;
  /** Which joker (display only). */
  joker?: 'red' | 'black';
}

/**
 * The sixteen card backs a player may choose from, by id.
 *
 * The ids and names live here because the SERVER speaks them: a card back
 * rides with the deal so the whole table sees whose card is whose while it is
 * still face down. What each one looks like is the client's business — a
 * pattern is CSS, and the server has no more use for it than it has for a
 * die's color.
 *
 * 'classic' is the back every card has always worn, and what any character
 * who has never opened the picker keeps.
 */
export const CARD_BACKS = [
  { id: 'classic', label: 'Classic Red' },
  { id: 'midnight', label: 'Midnight Blue' },
  { id: 'forest', label: 'Forest Lattice' },
  { id: 'royal', label: 'Royal Purple' },
  { id: 'goldfil', label: 'Gold Filigree' },
  { id: 'steel', label: 'Brushed Steel' },
  { id: 'ember', label: 'Ember Weave' },
  { id: 'ocean', label: 'Ocean Scales' },
  { id: 'rose', label: 'Rose Argyle' },
  { id: 'jade', label: 'Jade Pinstripe' },
  { id: 'onyx', label: 'Onyx Starfield' },
  { id: 'copper', label: 'Copper Herringbone' },
  { id: 'ivory', label: 'Ivory Damask' },
  { id: 'neon', label: 'Neon Grid' },
  { id: 'blood', label: 'Blood Diamonds' },
  { id: 'aurora', label: 'Aurora Sweep' },
] as const;

export type CardBackId = (typeof CARD_BACKS)[number]['id'];

export function isCardBack(v: unknown): v is CardBackId {
  return typeof v === 'string' && CARD_BACKS.some((b) => b.id === v);
}

export const SUIT_SYMBOL: Record<CardSuit, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};

export const SUIT_NAME: Record<CardSuit, string> = {
  spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs',
};

/** The book's pecking order for equal ranks: Spades high, Clubs low. */
export const SUIT_RANK: Record<CardSuit, number> = {
  spades: 4, hearts: 3, diamonds: 2, clubs: 1,
};

const RANK_NAME: Record<number, string> = {
  11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};

/** "J" / "Q" / "K" / "A" / "7" — corner text on a rendered card. */
export function rankShort(rank: number): string {
  if (rank === 15) return '🃏';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  if (rank === 14) return 'A';
  return String(rank);
}

/** "Jack of Hearts", "10 of Spades", "Red Joker". */
export function cardName(card: PlayingCard): string {
  if (card.rank === 15 || !card.suit) return card.joker === 'black' ? 'Black Joker' : 'Red Joker';
  const rank = RANK_NAME[card.rank] ?? String(card.rank);
  return `${rank} of ${SUIT_NAME[card.suit]}`;
}

/** Compact chip label: "J♥", "10♠", "🃏". */
export function cardShort(card: PlayingCard): string {
  if (card.rank === 15 || !card.suit) return '🃏';
  return `${rankShort(card.rank)}${SUIT_SYMBOL[card.suit]}`;
}

export function isRedCard(card: PlayingCard): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds' || card.joker === 'red';
}

/** A fresh, ordered 54-card deck. */
export function buildDeck(): PlayingCard[] {
  const deck: PlayingCard[] = [];
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs'] as CardSuit[]) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit });
  }
  deck.push({ rank: 15, suit: null, joker: 'red' });
  deck.push({ rank: 15, suit: null, joker: 'black' });
  return deck;
}

/** Fisher–Yates shuffle (in place; returns the same array). */
export function shuffleDeck(deck: PlayingCard[], rng: RNG = Math.random): PlayingCard[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Initiative order comparator: higher rank acts first, and equal ranks break
 * by `tieBreak` — see the note at the top of this file for why there are two.
 * Entries without a card sink to the bottom (kept stable by drawSeq fallback
 * 0), and two Jokers, having no suit between them, always fall back to draw
 * order however the ties are being settled.
 */
export function compareCardEntries(
  a: { card?: PlayingCard; drawSeq?: number },
  b: { card?: PlayingCard; drawSeq?: number },
  tieBreak: 'draw' | 'suit' = 'draw',
): number {
  const ra = a.card?.rank ?? -1;
  const rb = b.card?.rank ?? -1;
  if (rb !== ra) return rb - ra;
  if (tieBreak === 'suit') {
    const sa = a.card?.suit ? SUIT_RANK[a.card.suit] : 0;
    const sb = b.card?.suit ? SUIT_RANK[b.card.suit] : 0;
    if (sb !== sa) return sb - sa;
  }
  return (a.drawSeq ?? 0) - (b.drawSeq ?? 0);
}
