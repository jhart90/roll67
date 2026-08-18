import { describe, expect, it } from 'vitest';
import {
  CARD_BACK_GEOMETRIES, CARD_BACK_GROUPS, CARD_BACK_PATTERNS, CARD_BORDERS, defaultCardBack, normalizeCardBack, patternDefaults,
} from '../src/systems/cards.js';

/**
 * A card back is a structured spec the server validates — it rides with every
 * deal and its colors land inside CSS on every client at the table, so
 * normalizeCardBack is a boundary, not a convenience.
 */
describe('card back designs and borders', () => {
  it('offers the full 75-design catalogue and sixteen borders, all ids unique', () => {
    expect(CARD_BACK_PATTERNS).toHaveLength(75);
    expect(new Set(CARD_BACK_PATTERNS.map((p) => p.id)).size).toBe(75);
    expect(new Set(CARD_BACK_PATTERNS.map((p) => p.label)).size).toBe(75);
    expect(CARD_BORDERS).toHaveLength(16);
    expect(new Set(CARD_BORDERS.map((b) => b.id)).size).toBe(16);
  });

  it('no two designs are alike: every (geometry, palette) pairing is one of a kind', () => {
    const looks = CARD_BACK_PATTERNS.map((p) => `${p.pattern}|${p.primary}|${p.secondary}|${p.accent}`);
    expect(new Set(looks).size).toBe(75);
  });

  it('every design sits under a real shelf heading, and no heading is empty', () => {
    for (const p of CARD_BACK_PATTERNS) expect(CARD_BACK_GROUPS).toContain(p.group);
    for (const g of CARD_BACK_GROUPS) {
      expect(CARD_BACK_PATTERNS.some((p) => p.group === g)).toBe(true);
    }
  });

  it('the geometry list is exactly the geometries the catalogue wears', () => {
    const used = new Set(CARD_BACK_PATTERNS.map((p) => p.pattern));
    expect(new Set(CARD_BACK_GEOMETRIES)).toEqual(used);
    expect(CARD_BACK_GEOMETRIES).toHaveLength(used.size);
    // The classic seven survive: an early spec may hold a bare geometry id.
    for (const g of ['stripes', 'plaid', 'dots', 'medallion', 'rays', 'harlequin', 'sweep']) {
      expect(CARD_BACK_GEOMETRIES).toContain(g);
    }
  });

  it('the original sixteen keep their ids, geometries and palettes — old sheets still render', () => {
    const frozen: Array<[string, string, string]> = [
      ['classic', 'stripes', '#7c1f28'], ['midnight', 'stripes', '#1d2c52'],
      ['forest', 'plaid', '#1f4d2c'], ['steel', 'plaid', '#39404a'],
      ['ember', 'plaid', '#7a2d0c'], ['royal', 'dots', '#4a2170'],
      ['ivory', 'dots', '#ede3cc'], ['ocean', 'medallion', '#14536b'],
      ['rose', 'medallion', '#6e1530'], ['goldfil', 'medallion', '#5a4210'],
      ['onyx', 'rays', '#14141c'], ['neon', 'rays', '#101024'],
      ['blood', 'harlequin', '#5c0e16'], ['jade', 'harlequin', '#14624a'],
      ['aurora', 'sweep', '#123c46'], ['copper', 'sweep', '#7a4a24'],
    ];
    frozen.forEach(([id, geometry, primary], i) => {
      const d = CARD_BACK_PATTERNS[i];
      expect(d.id).toBe(id);
      expect(d.pattern).toBe(geometry);
      expect(d.primary).toBe(primary);
    });
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

  it('reads the first version’s bare string ids as that design in its own colors', () => {
    const v = normalizeCardBack('midnight');
    expect(v.pattern).toBe('stripes');   // the design's geometry
    expect(v.primary).toBe('#1d2c52');   // the design's own palette
    expect(v.border).toBe('clean');
  });

  it('keeps a fully customised spec exactly, with a design id resolved to its geometry', () => {
    const spec = {
      pattern: 'ocean', border: 'deco',
      primary: '#123456', secondary: '#abcdef', accent: '#fedcba', borderColor: '#00ff00',
    };
    expect(normalizeCardBack(spec)).toEqual({ ...spec, pattern: 'medallion' });
    // A spec already speaking geometry passes through untouched.
    expect(normalizeCardBack({ ...spec, pattern: 'plaid' })).toEqual({ ...spec, pattern: 'plaid' });
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
    expect(v.pattern).toBe('stripes');   // the classic design's geometry
    expect(v.border).toBe('clean');
  });

  it('an empty borderColor means "follow the primary", and survives', () => {
    const v = normalizeCardBack({ pattern: 'jade', border: 'glow', borderColor: '' });
    expect(v.borderColor).toBe('');
  });
});
