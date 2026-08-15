import { describe, expect, it } from 'vitest';
import { CARD_BACKS, isCardBack } from '../src/systems/cards.js';

/**
 * The card backs are a fixed set the server validates against — a back rides
 * with every deal, so an id has to mean the same thing on every client.
 */
describe('card backs', () => {
  it('offers exactly sixteen, with unique ids', () => {
    expect(CARD_BACKS).toHaveLength(16);
    expect(new Set(CARD_BACKS.map((b) => b.id)).size).toBe(16);
  });

  it('includes the classic, which is what an untouched sheet keeps', () => {
    expect(CARD_BACKS.some((b) => b.id === 'classic')).toBe(true);
  });

  it('validates ids and refuses everything else', () => {
    expect(isCardBack('midnight')).toBe(true);
    expect(isCardBack('classic')).toBe(true);
    // A back is not a URL, a style, or a place to smuggle markup.
    expect(isCardBack('')).toBe(false);
    expect(isCardBack('https://x/y.png')).toBe(false);
    expect(isCardBack('<img>')).toBe(false);
    expect(isCardBack(42)).toBe(false);
    expect(isCardBack(null)).toBe(false);
  });
});
