import { describe, expect, it } from 'vitest';
import {
  buildDeck, cardName, cardShort, compareCardEntries, isRedCard, rankShort, shuffleDeck,
  type PlayingCard,
} from '../src/systems/cards.js';
import { seededRng } from '../src/dice/roller.js';

describe('SWADE action deck', () => {
  it('builds a 54-card deck: 13 ranks × 4 suits + two jokers, no duplicates', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(54);
    const keys = new Set(deck.map((c) => `${c.rank}:${c.suit}:${c.joker ?? ''}`));
    expect(keys.size).toBe(54);
    expect(deck.filter((c) => c.rank === 15)).toHaveLength(2);
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs'] as const) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(13);
    }
  });

  it('shuffle keeps the same 54 cards and is deterministic under a seeded RNG', () => {
    const a = shuffleDeck(buildDeck(), seededRng(7));
    const b = shuffleDeck(buildDeck(), seededRng(7));
    expect(a).toEqual(b);
    expect(a).toHaveLength(54);
    expect(a).not.toEqual(buildDeck()); // astronomically unlikely to be ordered
  });

  it('names cards with real ranks and suits', () => {
    expect(cardName({ rank: 11, suit: 'hearts' })).toBe('Jack of Hearts');
    expect(cardName({ rank: 14, suit: 'spades' })).toBe('Ace of Spades');
    expect(cardName({ rank: 10, suit: 'clubs' })).toBe('10 of Clubs');
    expect(cardName({ rank: 15, suit: null, joker: 'red' })).toBe('Red Joker');
    expect(cardName({ rank: 15, suit: null, joker: 'black' })).toBe('Black Joker');
  });

  it('short labels use suit symbols, not numbers', () => {
    expect(cardShort({ rank: 11, suit: 'hearts' })).toBe('J♥');
    expect(cardShort({ rank: 14, suit: 'spades' })).toBe('A♠');
    expect(cardShort({ rank: 2, suit: 'diamonds' })).toBe('2♦');
    expect(cardShort({ rank: 15, suit: null, joker: 'red' })).toBe('🃏');
    expect(rankShort(13)).toBe('K');
  });

  it('colors hearts/diamonds and the red joker red', () => {
    expect(isRedCard({ rank: 5, suit: 'hearts' })).toBe(true);
    expect(isRedCard({ rank: 5, suit: 'diamonds' })).toBe(true);
    expect(isRedCard({ rank: 5, suit: 'spades' })).toBe(false);
    expect(isRedCard({ rank: 15, suit: null, joker: 'red' })).toBe(true);
    expect(isRedCard({ rank: 15, suit: null, joker: 'black' })).toBe(false);
  });

  it('orders initiative: jokers > aces > kings …, aces high', () => {
    const joker: PlayingCard = { rank: 15, suit: null, joker: 'red' };
    const ace: PlayingCard = { rank: 14, suit: 'clubs' };
    const king: PlayingCard = { rank: 13, suit: 'spades' };
    const two: PlayingCard = { rank: 2, suit: 'hearts' };
    const entries = [
      { card: two, drawSeq: 1 },
      { card: joker, drawSeq: 2 },
      { card: king, drawSeq: 3 },
      { card: ace, drawSeq: 4 },
    ].sort(compareCardEntries);
    expect(entries.map((e) => e.card.rank)).toEqual([15, 14, 13, 2]);
  });

  it('breaks rank ties by draw order in ROUND ONE — whoever drew first acts first', () => {
    const aceHearts: PlayingCard = { rank: 14, suit: 'hearts' };
    const aceSpades: PlayingCard = { rank: 14, suit: 'spades' };
    const sorted = [
      { name: 'second', card: aceSpades, drawSeq: 5 },
      { name: 'first', card: aceHearts, drawSeq: 2 },
    ].sort(compareCardEntries);
    expect(sorted.map((e) => e.name)).toEqual(['first', 'second']);
  });

  /**
   * Round one is dealt a card at a time with the table watching, so draw
   * order is something everyone saw happen. Every round after is dealt in a
   * server loop, where draw order is an implementation detail nobody agreed
   * to — so those go back to the book.
   */
  describe('rounds 2+ break ties by suit, per the book', () => {
    const ace = (suit: PlayingCard['suit']): PlayingCard => ({ rank: 14, suit });
    const bySuit = (a: Parameters<typeof compareCardEntries>[0], b: Parameters<typeof compareCardEntries>[1]) =>
      compareCardEntries(a, b, 'suit');

    it('ranks the suits Spades, Hearts, Diamonds, Clubs', () => {
      const sorted = [
        { name: 'clubs', card: ace('clubs'), drawSeq: 1 },
        { name: 'diamonds', card: ace('diamonds'), drawSeq: 2 },
        { name: 'spades', card: ace('spades'), drawSeq: 3 },
        { name: 'hearts', card: ace('hearts'), drawSeq: 4 },
      ].sort(bySuit);
      expect(sorted.map((e) => e.name)).toEqual(['spades', 'hearts', 'diamonds', 'clubs']);
    });

    it('ignores draw order entirely — the last to draw the Ace of Spades still leads', () => {
      const sorted = [
        { name: 'drewFirst', card: ace('clubs'), drawSeq: 1 },
        { name: 'drewLast', card: ace('spades'), drawSeq: 99 },
      ].sort(bySuit);
      expect(sorted.map((e) => e.name)).toEqual(['drewLast', 'drewFirst']);
    });

    it('still puts rank first: a King of Spades loses to any Ace', () => {
      const king: PlayingCard = { rank: 13, suit: 'spades' };
      const sorted = [
        { name: 'kingSpades', card: king, drawSeq: 1 },
        { name: 'aceClubs', card: ace('clubs'), drawSeq: 2 },
      ].sort(bySuit);
      expect(sorted.map((e) => e.name)).toEqual(['aceClubs', 'kingSpades']);
    });

    it('falls back to draw order for two Jokers, which have no suit between them', () => {
      const red: PlayingCard = { rank: 15, suit: null, joker: 'red' };
      const black: PlayingCard = { rank: 15, suit: null, joker: 'black' };
      const sorted = [
        { name: 'second', card: black, drawSeq: 8 },
        { name: 'first', card: red, drawSeq: 3 },
      ].sort(bySuit);
      expect(sorted.map((e) => e.name)).toEqual(['first', 'second']);
    });

    it('and the two rules genuinely disagree — which is the point of having both', () => {
      const table = [
        { name: 'clubsFirst', card: ace('clubs'), drawSeq: 1 },
        { name: 'spadesLater', card: ace('spades'), drawSeq: 2 },
      ];
      expect([...table].sort((a, b) => compareCardEntries(a, b, 'draw')).map((e) => e.name))
        .toEqual(['clubsFirst', 'spadesLater']);
      expect([...table].sort(bySuit).map((e) => e.name))
        .toEqual(['spadesLater', 'clubsFirst']);
    });
  });

  it('entries without a card sink below every carded entry', () => {
    const sorted = [
      { name: 'cardless', drawSeq: 0 },
      { name: 'lowCard', card: { rank: 2, suit: 'clubs' } as PlayingCard, drawSeq: 9 },
    ].sort(compareCardEntries);
    expect(sorted[0].name).toBe('lowCard');
  });
});
