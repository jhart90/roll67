import { describe, expect, it } from 'vitest';
import { inkOnDark, luminance } from '../src/systems/playerColor.js';

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** The dominant channel, which is what "the hue survived" means here. */
const dominant = (hex: string) => {
  const [r, g, b] = channels(hex);
  return r > g && r > b ? 'r' : g > r && g > b ? 'g' : 'b';
};
/** How far apart the channels are — how confident the colour is about its hue. */
const chroma = (hex: string) => Math.max(...channels(hex)) - Math.min(...channels(hex));

describe('inkOnDark', () => {
  it('leaves a colour that is already legible alone', () => {
    for (const c of ['#6c9bd2', '#7ed28a', '#ffffff', '#d2d26c']) {
      expect(inkOnDark(c)).toBe(c);
    }
  });

  it('lifts a dark colour over the legibility floor', () => {
    for (const c of ['#3a0d0d', '#1a2a5a', '#0a2a10', '#2a0a3a', '#000080']) {
      expect(luminance(inkOnDark(c))).toBeGreaterThanOrEqual(0.16);
    }
  });

  // The whole reason this scales channels instead of blending toward white:
  // a dark red has to come out red, not pink-grey.
  it('keeps the hue when it lifts', () => {
    expect(dominant(inkOnDark('#3a0d0d'))).toBe('r');
    expect(dominant(inkOnDark('#0a2a10'))).toBe('g');
    expect(dominant(inkOnDark('#1a2a5a'))).toBe('b');
  });

  // A near-black's channel spread is rounding noise, not a hue. Amplifying it
  // turned the palette's black into a confident light blue (#14171d → #b0caff,
  // a spread of 79). The result has to stay visibly neutral instead.
  it('greys out black and the near-blacks rather than inventing a hue', () => {
    for (const c of ['#000000', '#14171d', '#2a2a2e']) {
      const out = inkOnDark(c);
      expect(chroma(out)).toBeLessThan(30);
      expect(luminance(out)).toBeGreaterThanOrEqual(0.16);
    }
  });

  it('passes anything that is not a six-digit hex straight through', () => {
    expect(inkOnDark('red')).toBe('red');
    expect(inkOnDark('#abc')).toBe('#abc');
  });
});
