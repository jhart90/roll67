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
 * The design catalogue: every back the studio offers, each a GEOMETRY (the
 * painter the client renders it with) plus the palette it wears out of the
 * box, filed under the shelf heading the picker shows it on.
 *
 * The first sixteen are the originals and their ids and palettes are frozen
 * — they are what old sheets stored. Everything after them is a themed
 * design with a painter of its own, which is what "not one is like another"
 * costs: a fire that actually burns upward and a Saturn that actually wears
 * rings cannot be the same weave in two palettes.
 *
 * A design's colors still live in the spec's three slots, so every one of
 * these can be repainted by its player — a blue wildfire is theirs to want.
 */
export const CARD_BACK_PATTERNS = [
  // ---- Classics: the original sixteen, ids and palettes frozen ----
  { id: 'classic', label: 'Classic Red', group: 'Classics', pattern: 'stripes', primary: '#7c1f28', secondary: '#641820', accent: '#e8c86a' },
  { id: 'midnight', label: 'Midnight Stripe', group: 'Classics', pattern: 'stripes', primary: '#1d2c52', secondary: '#162240', accent: '#7fa8e0' },
  { id: 'forest', label: 'Highland Plaid', group: 'Classics', pattern: 'plaid', primary: '#1f4d2c', secondary: '#0e2e18', accent: '#d8b23a' },
  { id: 'steel', label: 'Oxford Plaid', group: 'Classics', pattern: 'plaid', primary: '#39404a', secondary: '#232830', accent: '#9fb4cc' },
  { id: 'ember', label: 'Firewatch Plaid', group: 'Classics', pattern: 'plaid', primary: '#7a2d0c', secondary: '#3c1404', accent: '#ffaa3c' },
  { id: 'royal', label: 'Royal Dots', group: 'Classics', pattern: 'dots', primary: '#4a2170', secondary: '#e4d3f0', accent: '#c89b3c' },
  { id: 'ivory', label: 'Ivory Pearls', group: 'Classics', pattern: 'dots', primary: '#ede3cc', secondary: '#947c50', accent: '#b8a988' },
  { id: 'ocean', label: 'Ocean Medallion', group: 'Classics', pattern: 'medallion', primary: '#14536b', secondary: '#0c3a4d', accent: '#7fd4c8' },
  { id: 'rose', label: 'Rose Window', group: 'Classics', pattern: 'medallion', primary: '#6e1530', secondary: '#480e1f', accent: '#e0b64a' },
  { id: 'goldfil', label: 'Gilt Medallion', group: 'Classics', pattern: 'medallion', primary: '#5a4210', secondary: '#3c2c08', accent: '#f0d06e' },
  { id: 'onyx', label: 'Black Sun', group: 'Classics', pattern: 'rays', primary: '#14141c', secondary: '#26262f', accent: '#d8b23a' },
  { id: 'neon', label: 'Neon Burst', group: 'Classics', pattern: 'rays', primary: '#101024', secondary: '#1c1c40', accent: '#00ffd6' },
  { id: 'blood', label: 'Blood Diamonds', group: 'Classics', pattern: 'harlequin', primary: '#5c0e16', secondary: '#8c1b26', accent: '#e7cdd0' },
  { id: 'jade', label: 'Jade Court', group: 'Classics', pattern: 'harlequin', primary: '#14624a', secondary: '#0f5340', accent: '#e8c86a' },
  { id: 'aurora', label: 'Aurora', group: 'Classics', pattern: 'sweep', primary: '#123c46', secondary: '#1c6b57', accent: '#57306e' },
  { id: 'copper', label: 'Copper Dusk', group: 'Classics', pattern: 'sweep', primary: '#7a4a24', secondary: '#a86a34', accent: '#2c1a10' },
  // ---- Elements ----
  { id: 'elem-fire', label: 'Wildfire', group: 'Elements', pattern: 'elem-fire', primary: '#1c0805', secondary: '#c8401a', accent: '#ffb62e' },
  { id: 'elem-water', label: 'Riptide', group: 'Elements', pattern: 'elem-water', primary: '#0a2e4a', secondary: '#1565a0', accent: '#9fe0f0' },
  { id: 'elem-earth', label: 'Bedrock', group: 'Elements', pattern: 'elem-earth', primary: '#3e2c1c', secondary: '#6b4e2e', accent: '#b89968' },
  { id: 'elem-wind', label: 'Zephyr', group: 'Elements', pattern: 'elem-wind', primary: '#2e3d4d', secondary: '#6f8ea6', accent: '#d8ecf4' },
  // ---- Seasons ----
  { id: 'sea-spring', label: 'Cherry Blossom', group: 'Seasons', pattern: 'sea-spring', primary: '#35603a', secondary: '#f2b8cc', accent: '#fff0d8' },
  { id: 'sea-summer', label: 'High Summer', group: 'Seasons', pattern: 'sea-summer', primary: '#3f8fd4', secondary: '#d8a53c', accent: '#ffd24a' },
  { id: 'sea-autumn', label: 'Autumn Drift', group: 'Seasons', pattern: 'sea-autumn', primary: '#5a2c14', secondary: '#b45a1c', accent: '#e8a832' },
  { id: 'sea-winter', label: 'First Frost', group: 'Seasons', pattern: 'sea-winter', primary: '#16324e', secondary: '#7fa8c8', accent: '#f4faff' },
  // ---- Sun & Moon ----
  { id: 'sun', label: 'Solar Crown', group: 'Sun & Moon', pattern: 'sun', primary: '#2c1608', secondary: '#c8641e', accent: '#ffd24a' },
  { id: 'moon', label: 'Moonrise', group: 'Sun & Moon', pattern: 'moon', primary: '#10182e', secondary: '#3c4a70', accent: '#e8e4d0' },
  // ---- Biomes ----
  { id: 'bio-forest', label: 'Pinewood', group: 'Biomes', pattern: 'bio-forest', primary: '#0f2c1e', secondary: '#24523a', accent: '#c2ddc8' },
  { id: 'bio-desert', label: 'Dune Sea', group: 'Biomes', pattern: 'bio-desert', primary: '#a8622a', secondary: '#d89a4c', accent: '#f6e2ac' },
  { id: 'bio-jungle', label: 'Deep Canopy', group: 'Biomes', pattern: 'bio-jungle', primary: '#0f3a20', secondary: '#1e6434', accent: '#f0c040' },
  { id: 'bio-swamp', label: 'Blackwater Fen', group: 'Biomes', pattern: 'bio-swamp', primary: '#242e1c', secondary: '#4a6034', accent: '#a0b868' },
  { id: 'bio-tundra', label: 'White Waste', group: 'Biomes', pattern: 'bio-tundra', primary: '#dce8f0', secondary: '#8fb0c8', accent: '#f8fcff' },
  { id: 'bio-mountain', label: 'High Passes', group: 'Biomes', pattern: 'bio-mountain', primary: '#2c3a52', secondary: '#55708c', accent: '#e8eef4' },
  { id: 'bio-plains', label: 'Golden Plains', group: 'Biomes', pattern: 'bio-plains', primary: '#86a83e', secondary: '#8cc8e8', accent: '#f4ecd0' },
  { id: 'bio-reef', label: 'Coral Shallows', group: 'Biomes', pattern: 'bio-reef', primary: '#0c4658', secondary: '#17879c', accent: '#ff8a5c' },
  // ---- Planets ----
  { id: 'pl-mercury', label: 'Mercury', group: 'Planets', pattern: 'pl-mercury', primary: '#191922', secondary: '#8a8a92', accent: '#d0d0d8' },
  { id: 'pl-venus', label: 'Venus', group: 'Planets', pattern: 'pl-venus', primary: '#201812', secondary: '#d8a860', accent: '#f4e0b0' },
  { id: 'pl-earth', label: 'Blue Marble', group: 'Planets', pattern: 'pl-earth', primary: '#0a1024', secondary: '#2670c8', accent: '#5cb058' },
  { id: 'pl-mars', label: 'Mars', group: 'Planets', pattern: 'pl-mars', primary: '#150e16', secondary: '#c05a30', accent: '#f0e0d0' },
  { id: 'pl-jupiter', label: 'Jupiter', group: 'Planets', pattern: 'pl-jupiter', primary: '#12101a', secondary: '#c89660', accent: '#d86848' },
  { id: 'pl-saturn', label: 'Saturn', group: 'Planets', pattern: 'pl-saturn', primary: '#0e1220', secondary: '#d8b878', accent: '#f0e0b8' },
  { id: 'pl-uranus', label: 'Uranus', group: 'Planets', pattern: 'pl-uranus', primary: '#0e1a22', secondary: '#7fd4d8', accent: '#d8f4f4' },
  { id: 'pl-neptune', label: 'Neptune', group: 'Planets', pattern: 'pl-neptune', primary: '#0a0e20', secondary: '#2850c0', accent: '#9fc0ff' },
  // ---- Ace Styles ----
  { id: 'ace-flash', label: 'Flashpoint', group: 'Ace Styles', pattern: 'ace-flash', primary: '#14142a', secondary: '#ffcf3c', accent: '#f8f8ff' },
  { id: 'ace-explosion', label: 'Shockwave', group: 'Ace Styles', pattern: 'ace-explosion', primary: '#200c08', secondary: '#ff7a1e', accent: '#ffe8a0' },
  { id: 'ace-flames', label: 'Ring of Fire', group: 'Ace Styles', pattern: 'ace-flames', primary: '#180a06', secondary: '#d84a10', accent: '#ffc22e' },
  { id: 'ace-disco', label: 'Mirrorball', group: 'Ace Styles', pattern: 'ace-disco', primary: '#180a2e', secondary: '#c0c8e0', accent: '#ff4ab8' },
  { id: 'ace-rainbow', label: 'Prism', group: 'Ace Styles', pattern: 'ace-rainbow', primary: '#4a78c8', secondary: '#ff6a5a', accent: '#ffd84a' },
  { id: 'ace-smoke', label: 'Smokescreen', group: 'Ace Styles', pattern: 'ace-smoke', primary: '#16191d', secondary: '#3c444c', accent: '#929ca6' },
  { id: 'ace-water', label: 'Splashdown', group: 'Ace Styles', pattern: 'ace-water', primary: '#0c3050', secondary: '#2a80b8', accent: '#bfe8f8' },
  { id: 'ace-confetti', label: 'Confetti', group: 'Ace Styles', pattern: 'ace-confetti', primary: '#f4ecd8', secondary: '#ff5a7a', accent: '#38b8e8' },
  { id: 'ace-bubblegum', label: 'Bubblegum', group: 'Ace Styles', pattern: 'ace-bubblegum', primary: '#ef6aa4', secondary: '#f8a8cc', accent: '#fff0f6' },
  // ---- Fruits ----
  { id: 'fruit-banana', label: 'Banana', group: 'Fruits', pattern: 'fruit-banana', primary: '#f8ecc0', secondary: '#f0c030', accent: '#7a5a1c' },
  { id: 'fruit-strawberry', label: 'Strawberry', group: 'Fruits', pattern: 'fruit-strawberry', primary: '#d83048', secondary: '#f8e0a8', accent: '#3c9048' },
  { id: 'fruit-grape', label: 'Grapevine', group: 'Fruits', pattern: 'fruit-grape', primary: '#efe6d3', secondary: '#6a3a8c', accent: '#4a8838' },
  { id: 'fruit-watermelon', label: 'Watermelon', group: 'Fruits', pattern: 'fruit-watermelon', primary: '#e04858', secondary: '#2c8a3c', accent: '#f4f0e0' },
  // ---- Shelf Sigils ----
  { id: 'sig-blade', label: 'The Blade', group: 'Shelf Sigils', pattern: 'sig-blade', primary: '#1c2a4a', secondary: '#9fb2c8', accent: '#d8b23a' },
  { id: 'sig-hat', label: 'The Outrider', group: 'Shelf Sigils', pattern: 'sig-hat', primary: '#5a3a20', secondary: '#8a5c30', accent: '#e0b06a' },
  { id: 'sig-glass', label: 'The Sleuth', group: 'Shelf Sigils', pattern: 'sig-glass', primary: '#17352a', secondary: '#7fa896', accent: '#c8a24a' },
  { id: 'sig-column', label: 'The Forum', group: 'Shelf Sigils', pattern: 'sig-column', primary: '#59281a', secondary: '#8a4a2c', accent: '#e8ddc8' },
  { id: 'sig-dragon', label: 'The Wyrm', group: 'Shelf Sigils', pattern: 'sig-dragon', primary: '#173c28', secondary: '#2c6242', accent: '#e8b23c' },
  { id: 'sig-planet', label: 'The Wanderer', group: 'Shelf Sigils', pattern: 'sig-planet', primary: '#1a2340', secondary: '#4a5c8c', accent: '#c8a858' },
  { id: 'sig-star', label: 'The Marshal', group: 'Shelf Sigils', pattern: 'sig-star', primary: '#6a4a26', secondary: '#a8814a', accent: '#e8d8a0' },
  { id: 'sig-kraken', label: 'The Kraken', group: 'Shelf Sigils', pattern: 'sig-kraken', primary: '#4a1a24', secondary: '#7a2f3c', accent: '#d8a878' },
  { id: 'sig-circuit', label: 'The Machine', group: 'Shelf Sigils', pattern: 'sig-circuit', primary: '#0f2418', secondary: '#1d4530', accent: '#6ae8a8' },
  { id: 'sig-hazard', label: 'The Contagion', group: 'Shelf Sigils', pattern: 'sig-hazard', primary: '#141414', secondary: '#2c2c2c', accent: '#d8e83c' },
  { id: 'sig-sixgun', label: 'The Sixgun', group: 'Shelf Sigils', pattern: 'sig-sixgun', primary: '#2e2018', secondary: '#57402e', accent: '#c8b898' },
  // ---- Patterns ----
  { id: 'argyle', label: 'Argyle', group: 'Patterns', pattern: 'argyle', primary: '#263c5c', secondary: '#8c2c38', accent: '#e8e0c8' },
  { id: 'chevron', label: 'Chevron', group: 'Patterns', pattern: 'chevron', primary: '#201c2c', secondary: '#3c3452', accent: '#e8c86a' },
  { id: 'honeycomb', label: 'Honeycomb', group: 'Patterns', pattern: 'honeycomb', primary: '#6a4a14', secondary: '#c89030', accent: '#f0d078' },
  { id: 'scales', label: 'Dragon Scales', group: 'Patterns', pattern: 'scales', primary: '#143c34', secondary: '#1e5c4a', accent: '#d8b23a' },
  { id: 'lattice', label: 'Trellis', group: 'Patterns', pattern: 'lattice', primary: '#33573f', secondary: '#dce8dc', accent: '#e8c86a' },
  { id: 'pinstripe', label: 'Boardroom', group: 'Patterns', pattern: 'pinstripe', primary: '#22262e', secondary: '#3a404c', accent: '#a8b0c0' },
  { id: 'decofan', label: 'Gatsby Fans', group: 'Patterns', pattern: 'decofan', primary: '#101820', secondary: '#1e3040', accent: '#d8b23a' },
  { id: 'starfield', label: 'Starfall', group: 'Patterns', pattern: 'starfield', primary: '#1a1030', secondary: '#4a3a78', accent: '#f0f0ff' },
  { id: 'circuit', label: 'Motherboard', group: 'Patterns', pattern: 'circuit', primary: '#0c2030', secondary: '#1a4058', accent: '#48c8e8' },
] as const;

/** The shelf headings, in the order the picker shows them. */
export const CARD_BACK_GROUPS = [
  'Classics', 'Elements', 'Seasons', 'Sun & Moon', 'Biomes', 'Planets',
  'Ace Styles', 'Fruits', 'Shelf Sigils', 'Patterns',
] as const;

/**
 * Every geometry a spec's `pattern` may name, derived from the catalogue so
 * the two can never drift. The classic seven survive because the first
 * sixteen designs still weave them — and because a spec stored by an early
 * version may hold a bare geometry id.
 */
export const CARD_BACK_GEOMETRIES: readonly string[] = [...new Set(CARD_BACK_PATTERNS.map((p) => p.pattern))];

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
