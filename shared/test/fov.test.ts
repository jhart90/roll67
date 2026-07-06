import { describe, expect, it } from 'vitest';
import type { Door, GridConfig, Hex, Light, VisionStats, Wall } from '../src/types.js';
import { computeFov, computeUnionFovBands, inBounds, litHexes, MAX_VISION_RADIUS } from '../src/vision/fov.js';
import { packHex } from '../src/hex/pack.js';
import { hexToPixel } from '../src/hex/pixel.js';
import { hexDistance, hexRange } from '../src/hex/coords.js';

const GRID: GridConfig = {
  hexSize: 10, originX: 0, originY: 0, cols: 40, rows: 40,
  gridEnabled: true, lighting: 'light', feetPerHex: 5,
};

const DARK_GRID: GridConfig = { ...GRID, lighting: 'dark' };
const DIM_GRID: GridConfig = { ...GRID, lighting: 'dim' };

const EYES: VisionStats = { visionRange: 10, darkvision: 0 };
const VIEWER: Hex = { q: 4, r: 10 };

function fov(opts: {
  grid?: GridConfig; walls?: Wall[]; doors?: Door[]; lights?: Light[];
  viewer?: Hex; stats?: VisionStats;
}) {
  return computeFov(
    opts.viewer ?? VIEWER,
    opts.stats ?? EYES,
    { grid: opts.grid ?? GRID, walls: opts.walls ?? [], doors: opts.doors ?? [], lights: opts.lights ?? [] },
  );
}

describe('inBounds (odd-r offset)', () => {
  it('accepts hexes inside and rejects outside', () => {
    expect(inBounds({ q: 0, r: 0 }, GRID)).toBe(true);
    expect(inBounds({ q: 4, r: 10 }, GRID)).toBe(true);
    expect(inBounds({ q: -1, r: 0 }, GRID)).toBe(false);
    expect(inBounds({ q: 0, r: 40 }, GRID)).toBe(false);
    expect(inBounds({ q: 40, r: 0 }, GRID)).toBe(false);
  });
});

describe('open-field FOV', () => {
  it('under global daylight, sight ignores visionRange entirely -- bounded only by MAX_VISION_RADIUS', () => {
    const visible = fov({}); // EYES has visionRange 10, but the grid is lit
    for (const h of hexRange(VIEWER, MAX_VISION_RADIUS + 2)) {
      if (!inBounds(h, GRID)) continue;
      const d = hexDistance(VIEWER, h);
      expect(visible.has(packHex(h)), `hex ${h.q},${h.r} dist ${d}`).toBe(d <= MAX_VISION_RADIUS);
    }
  });

  it('a personal visionRange still applies once lighting is anything other than full daylight', () => {
    const visible = fov({ grid: DARK_GRID, stats: { visionRange: 10, darkvision: 10 } });
    for (const h of hexRange(VIEWER, 12)) {
      if (!inBounds(h, DARK_GRID)) continue;
      const d = hexDistance(VIEWER, h);
      expect(visible.has(packHex(h)), `hex ${h.q},${h.r} dist ${d}`).toBe(d <= 10);
    }
  });

  it('always sees own hex', () => {
    expect(fov({ stats: { visionRange: 0, darkvision: 0 } }).has(packHex(VIEWER))).toBe(true);
  });
});

describe('walls', () => {
  // Long vertical wall at x=190 between the viewer (px x≈156) and targets beyond.
  const wall: Wall = { id: 'w1', points: [{ x: 190, y: 100 }, { x: 190, y: 200 }] };

  it('blocks hexes behind the wall, not hexes beside it', () => {
    const visible = fov({ walls: [wall] });
    expect(visible.has(packHex({ q: 8, r: 10 }))).toBe(false); // behind (px x≈225, y=150)
    expect(visible.has(packHex({ q: 4, r: 8 }))).toBe(true); // same side (px x≈139)
    expect(visible.has(packHex({ q: 5, r: 10 }))).toBe(true); // in front of wall (px x≈173)
  });

  it('a small pillar shadows only the hexes directly behind it', () => {
    const pillar: Wall = { id: 'p', points: [{ x: 180, y: 145 }, { x: 180, y: 155 }] };
    const visible = fov({ walls: [pillar] });
    expect(visible.has(packHex({ q: 8, r: 10 }))).toBe(false); // dead behind
    expect(visible.has(packHex({ q: 8, r: 9 }))).toBe(true); // offset row slips past
  });
});

describe('wall types', () => {
  const behind = packHex({ q: 8, r: 10 }); // right of the x=190 wall
  const wallLine = [{ x: 190, y: 100 }, { x: 190, y: 200 }];

  it('a window wall is transparent to sight', () => {
    const solid: Wall = { id: 'w', points: wallLine, type: 'solid' };
    const window: Wall = { id: 'w', points: wallLine, type: 'window' };
    expect(fov({ walls: [solid] }).has(behind)).toBe(false);
    expect(fov({ walls: [window] }).has(behind)).toBe(true);
  });

  it('a one-way wall blocks sight from only one side', () => {
    // Viewer at (4,10) is on the LEFT of the segment.
    const oneway: Wall = { id: 'w', points: wallLine, type: 'oneway', flip: false };
    const onewayFlipped: Wall = { id: 'w', points: wallLine, type: 'oneway', flip: true };
    // Default: left side sees through, right side is blocked.
    expect(fov({ walls: [oneway] }).has(behind)).toBe(true);
    // Flipped: left side is now the blocked side.
    expect(fov({ walls: [onewayFlipped] }).has(behind)).toBe(false);
  });
});

describe('doors', () => {
  const doorClosed: Door = { id: 'd1', a: { x: 190, y: 100 }, b: { x: 190, y: 200 }, open: false };

  it('closed door blocks like a wall; open door does not', () => {
    const behind = packHex({ q: 8, r: 10 });
    expect(fov({ doors: [doorClosed] }).has(behind)).toBe(false);
    expect(fov({ doors: [{ ...doorClosed, open: true }] }).has(behind)).toBe(true);
  });

  it('a gate never blocks sight, open or closed (movement blocking is covered in movement.test.ts)', () => {
    const behind = packHex({ q: 8, r: 10 });
    const gateClosed: Door = { ...doorClosed, type: 'gate' };
    expect(fov({ doors: [gateClosed] }).has(behind)).toBe(true);
    expect(fov({ doors: [{ ...gateClosed, open: true }] }).has(behind)).toBe(true);
  });
});

describe('fov bands (fade rim)', () => {
  // These bands are a function of a viewer's own personal vision reach, so
  // they're only meaningful once lighting is less than full daylight (under
  // 'light' there's no personal limit at all -- see the "open-field FOV"
  // block above). Darkvision under 'dark' still has a real per-viewer edge.
  it('full covers the vision radius, fade is exactly the +1 rim, nothing past +2', () => {
    const { full, fade } = computeUnionFovBands(
      [{ hex: VIEWER, stats: { visionRange: 0, darkvision: 6 } }],
      { grid: DARK_GRID, walls: [], doors: [], lights: [] },
    );
    for (const h of hexRange(VIEWER, 9)) {
      if (!inBounds(h, DARK_GRID)) continue;
      const d = hexDistance(VIEWER, h);
      expect(full.has(packHex(h)), `full ${h.q},${h.r} d${d}`).toBe(d <= 6);
      expect(fade.has(packHex(h)), `fade ${h.q},${h.r} d${d}`).toBe(d === 7);
    }
  });

  it('a hex fully visible to one viewer counts as full even if another viewer only reaches it at fade range', () => {
    const near: Hex = { q: 4, r: 10 }; // darkvision 6 reaches (4,16) at distance 6
    const far: Hex = { q: 4, r: 23 }; // darkvision 6 only reaches (4,16) at distance 7 (fade)
    const target = packHex({ q: 4, r: 16 });
    const { full, fade } = computeUnionFovBands(
      [
        { hex: near, stats: { visionRange: 0, darkvision: 6 } },
        { hex: far, stats: { visionRange: 0, darkvision: 6 } },
      ],
      { grid: DARK_GRID, walls: [], doors: [], lights: [] },
    );
    expect(full.has(target)).toBe(true);
    expect(fade.has(target)).toBe(false);
  });

  it('walls still block sight under global daylight, despite the unlimited range', () => {
    const wall: Wall = { id: 'w', points: [{ x: 190, y: 100 }, { x: 190, y: 200 }] };
    const { full, fade } = computeUnionFovBands(
      [{ hex: VIEWER, stats: EYES }],
      { grid: GRID, walls: [wall], doors: [], lights: [] },
    );
    const behind = packHex({ q: 8, r: 10 });
    expect(full.has(behind)).toBe(false);
    expect(fade.has(behind)).toBe(false);
  });

  it('there is no fade rim under global daylight -- full already reaches MAX_VISION_RADIUS regardless of EYES', () => {
    const { full, fade } = computeUnionFovBands(
      [{ hex: VIEWER, stats: EYES }],
      { grid: GRID, walls: [], doors: [], lights: [] },
    );
    for (const h of hexRange(VIEWER, MAX_VISION_RADIUS + 2)) {
      if (!inBounds(h, GRID)) continue;
      const d = hexDistance(VIEWER, h);
      expect(full.has(packHex(h)), `full ${h.q},${h.r} d${d}`).toBe(d <= MAX_VISION_RADIUS);
    }
    expect(fade.size).toBe(0);
  });
});

describe('lighting', () => {
  it('total darkness: only own hex visible', () => {
    const visible = fov({ grid: DARK_GRID });
    expect(visible.size).toBe(1);
    expect(visible.has(packHex(VIEWER))).toBe(true);
  });

  it('darkvision sees exactly its radius in the dark', () => {
    const visible = fov({ grid: DARK_GRID, stats: { visionRange: 10, darkvision: 3 } });
    for (const h of hexRange(VIEWER, 5)) {
      if (!inBounds(h, DARK_GRID)) continue;
      expect(visible.has(packHex(h)), `hex ${h.q},${h.r}`).toBe(hexDistance(VIEWER, h) <= 3);
    }
  });

  it('a torch lights its surroundings (with LOS from the torch)', () => {
    const torchHex: Hex = { q: 10, r: 10 };
    const torchPx = hexToPixel(torchHex, DARK_GRID);
    const torch: Light = { id: 't', x: torchPx.x, y: torchPx.y, brightRadius: 1, dimRadius: 2 };
    const visible = fov({ grid: DARK_GRID, lights: [torch], stats: { visionRange: 20, darkvision: 0 } });
    expect(visible.has(packHex(torchHex))).toBe(true);
    expect(visible.has(packHex({ q: 10, r: 11 }))).toBe(true); // 1 from torch
    expect(visible.has(packHex({ q: 4, r: 12 }))).toBe(false); // far from torch, unlit
  });

  it('lit hexes beyond visionRange stay invisible', () => {
    const torchHex: Hex = { q: 10, r: 10 }; // 6 hexes from viewer
    const torchPx = hexToPixel(torchHex, DARK_GRID);
    const torch: Light = { id: 't', x: torchPx.x, y: torchPx.y, brightRadius: 2, dimRadius: 2 };
    const visible = fov({ grid: DARK_GRID, lights: [torch], stats: { visionRange: 3, darkvision: 0 } });
    expect(visible.has(packHex(torchHex))).toBe(false);
  });

  it('walls block light: a torch behind a wall lights nothing on our side', () => {
    const torchHex: Hex = { q: 10, r: 10 };
    const torchPx = hexToPixel(torchHex, DARK_GRID);
    const torch: Light = { id: 't', x: torchPx.x, y: torchPx.y, brightRadius: 3, dimRadius: 3 };
    // Wall between torch and the hexes to its left.
    const wall: Wall = { id: 'w', points: [{ x: 250, y: 0 }, { x: 250, y: 400 }] };
    const lit = litHexes({ grid: DARK_GRID, walls: [wall], doors: [], lights: [torch] });
    expect(lit.has(packHex({ q: 8, r: 10 }))).toBe(false); // left of wall (px x≈225)
    expect(lit.has(packHex({ q: 11, r: 10 }))).toBe(true); // torch side
  });

  it('dim lighting: sees an ambient radius around itself with no light source or darkvision', () => {
    const visible = fov({ grid: DIM_GRID });
    for (const h of hexRange(VIEWER, 5)) {
      if (!inBounds(h, DIM_GRID)) continue;
      expect(visible.has(packHex(h)), `hex ${h.q},${h.r}`).toBe(hexDistance(VIEWER, h) <= 2);
    }
  });

  it('dim lighting still lets a torch or darkvision see further than the ambient radius', () => {
    const torchHex: Hex = { q: 10, r: 10 };
    const torchPx = hexToPixel(torchHex, DIM_GRID);
    const torch: Light = { id: 't', x: torchPx.x, y: torchPx.y, brightRadius: 1, dimRadius: 2 };
    const visible = fov({ grid: DIM_GRID, lights: [torch], stats: { visionRange: 20, darkvision: 0 } });
    expect(visible.has(packHex(torchHex))).toBe(true);
    const withDarkvision = fov({ grid: DIM_GRID, stats: { visionRange: 10, darkvision: 4 } });
    expect(withDarkvision.has(packHex({ q: 4, r: 6 }))).toBe(true); // 4 hexes away, past the dim ambient radius
  });
});
