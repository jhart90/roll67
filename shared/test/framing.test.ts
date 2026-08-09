import { describe, expect, it } from 'vitest';
import { sceneFrameScale } from '../src/hex/framing.js';

describe('scene camera framing', () => {
  it('fills the pane vertically, edge to edge', () => {
    // 1000x500 art in a 800x600 pane: 600/500 = 1.2 fills the height exactly.
    expect(sceneFrameScale(800, 600, 1000, 500)).toBeCloseTo(1.2);
    const scale = sceneFrameScale(800, 600, 1000, 500);
    expect(500 * scale).toBeCloseTo(600); // no letterbox above or below
  });

  it('a wide panorama keeps its height and runs off the sides', () => {
    const scale = sceneFrameScale(800, 600, 4000, 1000);
    expect(1000 * scale).toBeCloseTo(600);
    expect(4000 * scale).toBeGreaterThan(800); // cropped horizontally, as intended
  });

  it('a tall picture ends up fully visible', () => {
    // Filling the height of a narrow image already leaves its width inside.
    const scale = sceneFrameScale(800, 600, 400, 1200);
    expect(1200 * scale).toBeCloseTo(600);
    expect(400 * scale).toBeLessThanOrEqual(800);
  });

  it('scales small art UP to fill the pane rather than stranding it', () => {
    expect(sceneFrameScale(1600, 1200, 400, 300)).toBeCloseTo(4);
  });

  it('never returns zero for a pane or image that has no size yet', () => {
    // The camera multiplies by this — a zero would be unrecoverable.
    expect(sceneFrameScale(0, 0, 1000, 500)).toBe(1);
    expect(sceneFrameScale(800, 600, 0, 0)).toBe(1);
    expect(sceneFrameScale(800, 0, 1000, 500)).toBe(1);
    expect(sceneFrameScale(NaN, 600, 1000, 500)).toBe(1);
  });
});
