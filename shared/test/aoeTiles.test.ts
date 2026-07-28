import { describe, expect, it } from 'vitest';
import { tokensInAoe } from '../src/hex/aoe.js';
import { applyEntry, contentForSystem } from '../src/data/compendium.js';
import { swade } from '../src/systems/swade.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import type { GridConfig } from '../src/types.js';

const grid = (feetPerHex: number): GridConfig => ({
  hexSize: 20, originX: 0, originY: 0, cols: 50, rows: 50,
  gridEnabled: true, lighting: 'light', feetPerHex,
});

describe('tile-sized blast templates', () => {
  const ring = (d: number) => ({ id: `d${d}`, q: d, r: 0 }); // hexDistance d from origin

  it('a Medium blast (sizeHexes 3) hits exactly hex distance ≤ 3', () => {
    const tokens = [0, 1, 2, 3, 4, 5, 6].map(ring);
    const hit = tokensInAoe({ shape: 'sphere', sizeFt: 0, sizeHexes: 3 }, { q: 0, r: 0 }, { q: 0, r: 0 }, grid(5), tokens);
    expect(hit).toEqual(['d0', 'd1', 'd2', 'd3']);
  });

  it('covers the same tiles whatever a hex is worth in feet', () => {
    const tokens = [0, 1, 2].map(ring);
    for (const fph of [1, 5, 10, 50]) {
      const hit = tokensInAoe({ shape: 'sphere', sizeFt: 0, sizeHexes: 1 }, { q: 0, r: 0 }, { q: 0, r: 0 }, grid(fph), tokens);
      expect(hit, `${fph} ft/hex`).toEqual(['d0', 'd1']);
    }
  });

  it('feet-based shapes still use the pixel test', () => {
    const tokens = [0, 1, 2].map(ring);
    // 5 ft/hex, hex width ≈ 6.9px/ft·5 = one hex per 5ft: an 8ft radius
    // reaches ring 1 (~34.6px at 55px radius) but not ring 2 (~69px).
    const hit = tokensInAoe({ shape: 'sphere', sizeFt: 8 }, { q: 0, r: 0 }, { q: 0, r: 0 }, grid(5), tokens);
    expect(hit).toContain('d0');
    expect(hit).not.toContain('d2');
  });
});

describe('SWADE template moves are wired mechanically', () => {
  const sheetAfter = (name: string) => {
    const entry = contentForSystem('swade').find((e) => e.name === name)!;
    return applyEntry(entry, swade.defaultSheet())!.row as Record<string, unknown>;
  };

  it('blast weapons carry a tile-sized sphere', () => {
    for (const [name, hexes] of [['Frag Grenade', 3], ['Rocket Launcher', 3], ['Grenade Launcher', 3], ['Molotov Cocktail', 1]] as const) {
      const row = sheetAfter(name);
      expect(row.aoeShape, name).toBe('sphere');
      expect(row.aoeHexes, name).toBe(hexes);
    }
  });

  it('the Flamethrower uses the Cone template', () => {
    const row = sheetAfter('Flamethrower');
    expect(row.aoeShape).toBe('cone');
    expect(row.aoeSize).toBe(54);
  });

  it('the Stun Grenade forces Vigor-or-Stunned across its blast', () => {
    const row = sheetAfter('Stun Grenade');
    expect(row.aoeShape).toBe('sphere');
    expect(row.save).toBe('vigor');
    expect(row.condition).toBe('stunned');
  });

  it('the Blast power is a Medium blast in tiles', () => {
    const row = sheetAfter('Blast');
    expect(row.aoeShape).toBe('sphere');
    expect(row.aoeHexes).toBe(3);
  });

  it('every bestiary sphere is tile-sized; cones stay in feet', () => {
    for (const npc of NPCS_SWADE) {
      for (const atk of (npc.sheet.attacks ?? []) as Array<Record<string, unknown>>) {
        if (atk.aoeShape === 'sphere') {
          expect([1, 3, 5], `${npc.name}/${atk.name}`).toContain(atk.aoeHexes);
        }
        if (atk.aoeShape === 'cone') expect(Number(atk.aoeSize), `${npc.name}/${atk.name}`).toBeGreaterThan(0);
      }
    }
  });
});
