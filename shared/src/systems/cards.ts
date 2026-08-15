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
 * A character's card back: a pattern, a border, and the colors they wear.
 *
 * The STRUCTURE lives here because the server speaks it — a back rides with
 * every deal so the whole table sees whose card is whose while it is still
 * face down, and the server has to be able to say "this is a back" without
 * trusting the client. What a pattern or border LOOKS like is CSS, which the
 * server has no more use for than it has for a die's color.
 *
 * A pattern names its own default colors, so picking one always looks like
 * something; the player then repaints it — one primary, up to two secondary
 * colors, and a border that follows the primary unless told otherwise. That
 * is the whole grammar, and it is enough for a table where no two backs need
 * ever match.
 */
export interface CardBackSpec {
  /** One of CARD_BACK_PATTERNS. */
  pattern: string;
  /** One of CARD_BORDERS. */
  border: string;
  /** #rrggbb. */
  primary: string;
  secondary: string;
  accent: string;
  /** #rrggbb, or '' — empty means "follow the primary", live, so repainting
   *  the pattern repaints an untouched border with it. */
  borderColor: string;
}

/**
 * The seven pattern GEOMETRIES — the shapes a back can be woven in. A spec's
 * `pattern` is always one of these.
 *
 * Deliberately few. Sixteen distinct tilings meant sixteen thin variations on
 * wallpaper; seven geometries, each drawn richly with all three colors, leave
 * room for the sixteen DESIGNS below to be sixteen actual looks — the same
 * loom producing tartans and rose windows depending on the thread.
 */
export const CARD_BACK_GEOMETRIES = ['stripes', 'plaid', 'dots', 'medallion', 'rays', 'harlequin', 'sweep'] as const;

/**
 * The sixteen pre-built designs: a geometry plus the palette it wears out of
 * the box. Several share a geometry — a Highland plaid and an Oxford plaid
 * are one weave in two wardrobes — which is the point: fewer patterns, more
 * designs. The ids are stable (they are what old sheets stored), so the set
 * can be re-dressed without stranding anyone's saved back.
 */
export const CARD_BACK_PATTERNS = [
  { id: 'classic', label: 'Classic Red', pattern: 'stripes', primary: '#7c1f28', secondary: '#641820', accent: '#e8c86a' },
  { id: 'midnight', label: 'Midnight Stripe', pattern: 'stripes', primary: '#1d2c52', secondary: '#162240', accent: '#7fa8e0' },
  { id: 'forest', label: 'Highland Plaid', pattern: 'plaid', primary: '#1f4d2c', secondary: '#0e2e18', accent: '#d8b23a' },
  { id: 'steel', label: 'Oxford Plaid', pattern: 'plaid', primary: '#39404a', secondary: '#232830', accent: '#9fb4cc' },
  { id: 'ember', label: 'Firewatch Plaid', pattern: 'plaid', primary: '#7a2d0c', secondary: '#3c1404', accent: '#ffaa3c' },
  { id: 'royal', label: 'Royal Dots', pattern: 'dots', primary: '#4a2170', secondary: '#e4d3f0', accent: '#c89b3c' },
  { id: 'ivory', label: 'Ivory Pearls', pattern: 'dots', primary: '#ede3cc', secondary: '#947c50', accent: '#b8a988' },
  { id: 'ocean', label: 'Ocean Medallion', pattern: 'medallion', primary: '#14536b', secondary: '#0c3a4d', accent: '#7fd4c8' },
  { id: 'rose', label: 'Rose Window', pattern: 'medallion', primary: '#6e1530', secondary: '#480e1f', accent: '#e0b64a' },
  { id: 'goldfil', label: 'Gilt Medallion', pattern: 'medallion', primary: '#5a4210', secondary: '#3c2c08', accent: '#f0d06e' },
  { id: 'onyx', label: 'Black Sun', pattern: 'rays', primary: '#14141c', secondary: '#26262f', accent: '#d8b23a' },
  { id: 'neon', label: 'Neon Burst', pattern: 'rays', primary: '#101024', secondary: '#1c1c40', accent: '#00ffd6' },
  { id: 'blood', label: 'Blood Diamonds', pattern: 'harlequin', primary: '#5c0e16', secondary: '#8c1b26', accent: '#e7cdd0' },
  { id: 'jade', label: 'Jade Court', pattern: 'harlequin', primary: '#14624a', secondary: '#0f5340', accent: '#e8c86a' },
  { id: 'aurora', label: 'Aurora', pattern: 'sweep', primary: '#123c46', secondary: '#1c6b57', accent: '#57306e' },
  { id: 'copper', label: 'Copper Dusk', pattern: 'sweep', primary: '#7a4a24', secondary: '#a86a34', accent: '#2c1a10' },
] as const;

/** The sixteen borders. Geometry only — the color is the spec's business. */
export const CARD_BORDERS = [
  { id: 'clean', label: 'Clean' },
  { id: 'hairline', label: 'Hairline' },
  { id: 'heavy', label: 'Heavy' },
  { id: 'double', label: 'Double' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'ridge', label: 'Ridge' },
  { id: 'groove', label: 'Groove' },
  { id: 'frame', label: 'Inner Frame' },
  { id: 'twinframe', label: 'Twin Frame' },
  { id: 'glow', label: 'Glow' },
  { id: 'bevel', label: 'Bevel' },
  { id: 'stitched', label: 'Stitched' },
  { id: 'deco', label: 'Art Deco' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'sharp', label: 'Sharp' },
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The back every card has always worn: what an untouched sheet keeps. */
export function defaultCardBack(): CardBackSpec {
  return patternDefaults('classic');
}

/**
 * The spec a freshly-picked design starts at: its geometry, its own colors,
 * the border kept. Takes a design id OR a bare geometry id (a spec stored by
 * an earlier version may hold either) — a design resolves to its geometry and
 * palette; a bare geometry keeps the first design that weaves it, so nothing
 * ever renders unpainted.
 */
export function patternDefaults(id: string, border = 'clean'): CardBackSpec {
  const design = CARD_BACK_PATTERNS.find((x) => x.id === id)
    ?? CARD_BACK_PATTERNS.find((x) => x.pattern === id)
    ?? CARD_BACK_PATTERNS[0];
  return { pattern: design.pattern, border, primary: design.primary, secondary: design.secondary, accent: design.accent, borderColor: '' };
}

/**
 * Whatever is on the sheet (or the wire), as a spec that is safe to render.
 *
 * Three shapes arrive here: nothing (never customised — the classic), a bare
 * pattern id (the first version of this feature stored strings), and the full
 * object. Colors are clamped to #rrggbb because they end up inside CSS on
 * every client at the table — a color field is not a place to smuggle
 * anything with meaning.
 */
export function normalizeCardBack(v: unknown): CardBackSpec {
  if (typeof v === 'string') return patternDefaults(v);
  if (!v || typeof v !== 'object') return defaultCardBack();
  const o = v as Record<string, unknown>;
  const base = patternDefaults(typeof o.pattern === 'string' ? o.pattern : 'classic');
  const color = (x: unknown, fallback: string): string => (typeof x === 'string' && HEX.test(x) ? x : fallback);
  return {
    pattern: base.pattern,
    border: CARD_BORDERS.some((b) => b.id === o.border) ? o.border as string : 'clean',
    primary: color(o.primary, base.primary),
    secondary: color(o.secondary, base.secondary),
    accent: color(o.accent, base.accent),
    borderColor: typeof o.borderColor === 'string' && HEX.test(o.borderColor) ? o.borderColor : '',
  };
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
