import { describe, expect, it } from 'vitest';
import {
  CARD_BACK_PATTERNS, CARD_BORDERS, defaultCardBack, normalizeCardBack, patternDefaults,
} from '../src/systems/cards.js';

/**
 * A card back is a structured spec the server validates — it rides with every
 * deal and its colors land inside CSS on every client at the table, so
 * normalizeCardBack is a boundary, not a convenience.
 */
describe('card back patterns and borders', () => {
  it('offers sixteen of each, with unique ids', () => {
    expect(CARD_BACK_PATTERNS).toHaveLength(16);
    expect(new Set(CARD_BACK_PATTERNS.map((p) => p.id)).size).toBe(16);
    expect(CARD_BORDERS).toHaveLength(16);
    expect(new Set(CARD_BORDERS.map((b) => b.id)).size).toBe(16);
  });

  it('every pattern ships with a full set of valid default colors', () => {
    for (const p of CARD_BACK_PATTERNS) {
      expect(p.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.secondary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('normalizeCardBack', () => {
  it('turns nothing into the classic', () => {
    expect(normalizeCardBack(undefined)).toEqual(defaultCardBack());
    expect(normalizeCardBack(null)).toEqual(defaultCardBack());
  });

  it('reads the first version’s bare string ids as that pattern with its own colors', () => {
    const v = normalizeCardBack('midnight');
    expect(v.pattern).toBe('midnight');
    expect(v.primary).toBe('#1d2c52');
    expect(v.border).toBe('clean');
  });

  it('keeps a fully customised spec exactly', () => {
    const spec = {
      pattern: 'ocean', border: 'deco',
      primary: '#123456', secondary: '#abcdef', accent: '#fedcba', borderColor: '#00ff00',
    };
    expect(normalizeCardBack(spec)).toEqual(spec);
  });

  it('clamps anything that is not a hex color back to the pattern default', () => {
    const v = normalizeCardBack({
      pattern: 'ocean', border: 'clean',
      // None of these may reach a style attribute on somebody else's screen.
      primary: 'url(https://x/y.png)', secondary: 'red; background: pink', accent: 'javascript:x',
      borderColor: 'expression(alert(1))',
    });
    expect(v.primary).toBe(patternDefaults('ocean').primary);
    expect(v.secondary).toBe(patternDefaults('ocean').secondary);
    expect(v.accent).toBe(patternDefaults('ocean').accent);
    expect(v.borderColor).toBe('');
  });

  it('refuses unknown pattern and border ids rather than passing them through', () => {
    const v = normalizeCardBack({ pattern: '<img>', border: '../../etc' });
    expect(v.pattern).toBe('classic');
    expect(v.border).toBe('clean');
  });

  it('an empty borderColor means "follow the primary", and survives', () => {
    const v = normalizeCardBack({ pattern: 'jade', border: 'glow', borderColor: '' });
    expect(v.borderColor).toBe('');
  });
});
