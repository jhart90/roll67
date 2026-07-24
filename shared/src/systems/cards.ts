// SWADE action-deck initiative: a 54-card deck (52 + red/black jokers).
// Aces are high; jokers beat aces. Ties in rank break by draw order (the
// earlier draw acts first). Pure functions + injectable RNG so the server
// deals authoritatively and everything is unit-testable.

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

export const SUIT_SYMBOL: Record<CardSuit, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};

export const SUIT_NAME: Record<CardSuit, string> = {
  spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs',
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
 * Initiative order comparator: higher rank acts first; equal ranks break by
 * draw order — whoever drew EARLIER is higher. Entries without a card sink
 * to the bottom (kept stable by drawSeq fallback 0).
 */
export function compareCardEntries(
  a: { card?: PlayingCard; drawSeq?: number },
  b: { card?: PlayingCard; drawSeq?: number },
): number {
  const ra = a.card?.rank ?? -1;
  const rb = b.card?.rank ?? -1;
  if (rb !== ra) return rb - ra;
  return (a.drawSeq ?? 0) - (b.drawSeq ?? 0);
}
