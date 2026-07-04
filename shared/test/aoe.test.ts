import { describe, expect, it } from 'vitest';
import { pointInAoe, pxPerFoot, tokensInAoe } from '../src/hex/aoe.js';
import { hexToPixel } from '../src/hex/pixel.js';
import type { AoeSpec, GridConfig } from '../src/types.js';

const GRID: GridConfig = {
  hexSize: 40, originX: 0, originY: 0, cols: 100, rows: 100, gridEnabled: true, lighting: 'dark', feetPerHex: 5,
};

describe('pointInAoe', () => {
  const origin = { x: 0, y: 0 };

  it('sphere: inside at center and radius edge, outside just past it', () => {
    const pxPerFt = pxPerFoot(GRID);
    const spec: AoeSpec = { shape: 'sphere', sizeFt: 20 };
    const aim = { x: 500, y: 0 };
    expect(pointInAoe(aim, spec, { originPx: origin, aimPx: aim }, pxPerFt)).toBe(true);
    expect(pointInAoe({ x: aim.x + 20 * pxPerFt, y: 0 }, spec, { originPx: origin, aimPx: aim }, pxPerFt)).toBe(true);
    expect(pointInAoe({ x: aim.x + 21 * pxPerFt, y: 0 }, spec, { originPx: origin, aimPx: aim }, pxPerFt)).toBe(false);
  });

  it('cone: hits directly ahead, misses directly behind and to the side', () => {
    const pxPerFt = pxPerFoot(GRID);
    const spec: AoeSpec = { shape: 'cone', sizeFt: 15 };
    const geo = { originPx: origin, aimPx: { x: 100, y: 0 } }; // aiming along +x
    expect(pointInAoe({ x: 10 * pxPerFt, y: 0 }, spec, geo, pxPerFt)).toBe(true); // straight ahead
    expect(pointInAoe({ x: -10 * pxPerFt, y: 0 }, spec, geo, pxPerFt)).toBe(false); // straight behind
    expect(pointInAoe({ x: 5 * pxPerFt, y: 10 * pxPerFt }, spec, geo, pxPerFt)).toBe(false); // steep side angle
  });

  it('line: hits along the axis within length+width, misses beyond length or off to the side', () => {
    const pxPerFt = pxPerFoot(GRID);
    const spec: AoeSpec = { shape: 'line', sizeFt: 100, widthFt: 5 };
    const geo = { originPx: origin, aimPx: { x: 100, y: 0 } };
    expect(pointInAoe({ x: 50 * pxPerFt, y: 0 }, spec, geo, pxPerFt)).toBe(true); // on-axis, within length
    expect(pointInAoe({ x: 50 * pxPerFt, y: 2 * pxPerFt }, spec, geo, pxPerFt)).toBe(true); // within half-width (2.5ft)
    expect(pointInAoe({ x: 50 * pxPerFt, y: 10 * pxPerFt }, spec, geo, pxPerFt)).toBe(false); // outside width
    expect(pointInAoe({ x: 150 * pxPerFt, y: 0 }, spec, geo, pxPerFt)).toBe(false); // beyond length
    expect(pointInAoe({ x: -5 * pxPerFt, y: 0 }, spec, geo, pxPerFt)).toBe(false); // behind the origin
  });

  it('cube: a square extending from the origin toward the aim direction', () => {
    const pxPerFt = pxPerFoot(GRID);
    const spec: AoeSpec = { shape: 'cube', sizeFt: 15 };
    const geo = { originPx: origin, aimPx: { x: 100, y: 0 } };
    expect(pointInAoe({ x: 7 * pxPerFt, y: 7 * pxPerFt }, spec, geo, pxPerFt)).toBe(true); // within the 15ft square
    expect(pointInAoe({ x: 7 * pxPerFt, y: 9 * pxPerFt }, spec, geo, pxPerFt)).toBe(false); // past half-width
  });

  it('cone/line/cube never include the caster\'s own point of origin (PHB 204)', () => {
    const pxPerFt = pxPerFoot(GRID);
    const geo = { originPx: origin, aimPx: { x: 100, y: 0 } };
    expect(pointInAoe(origin, { shape: 'cone', sizeFt: 15 }, geo, pxPerFt)).toBe(false);
    expect(pointInAoe(origin, { shape: 'line', sizeFt: 100, widthFt: 5 }, geo, pxPerFt)).toBe(false);
    expect(pointInAoe(origin, { shape: 'cube', sizeFt: 15 }, geo, pxPerFt)).toBe(false);
    // A sphere/cylinder is unaffected by this rule — it's centered on the aim
    // point, not the caster, so the caster standing at the origin has nothing
    // to do with whether their own square is inside it.
    expect(pointInAoe(origin, { shape: 'sphere', sizeFt: 15 }, { originPx: origin, aimPx: origin }, pxPerFt)).toBe(true);
  });
});

describe('tokensInAoe', () => {
  it('resolves hex-positioned tokens through the full hex-to-pixel pipeline', () => {
    const spec: AoeSpec = { shape: 'sphere', sizeFt: 20 }; // 4 hexes at 5 ft/hex
    const originHex = { q: 0, r: 0 };
    const aimHex = { q: 5, r: 0 };
    const tokens = [
      { id: 'center', q: 5, r: 0 }, // exactly at the sphere's center
      { id: 'edge', q: 9, r: 0 }, // 4 hexes from center = 20 ft, on the boundary
      { id: 'outside', q: 10, r: 0 }, // 5 hexes from center = 25 ft
      { id: 'caster', q: 0, r: 0 }, // far from the blast, near the caster
    ];
    const hit = tokensInAoe(spec, originHex, aimHex, GRID, tokens);
    expect(hit).toContain('center');
    expect(hit).toContain('edge');
    expect(hit).not.toContain('outside');
    expect(hit).not.toContain('caster');
  });

  it('cone originates at the caster, not the aim point', () => {
    const spec: AoeSpec = { shape: 'cone', sizeFt: 15 }; // 3 hexes
    const originHex = { q: 0, r: 0 };
    const aimHex = { q: 5, r: 0 };
    const tokens = [
      { id: 'inCone', q: 2, r: 0 }, // between caster and aim direction
      { id: 'behindCaster', q: -2, r: 0 },
    ];
    const hit = tokensInAoe(spec, originHex, aimHex, GRID, tokens);
    expect(hit).toContain('inCone');
    expect(hit).not.toContain('behindCaster');
  });

  it('feet-to-pixel scale respects the grid\'s feetPerHex', () => {
    const fine: GridConfig = { ...GRID, feetPerHex: 1 };
    const coarse: GridConfig = { ...GRID, feetPerHex: 10 };
    // The same physical hexSize covers fewer real feet per hex when feetPerHex is small,
    // so a fixed-size AoE (in feet) should cover proportionally more hexes on the finer grid.
    expect(pxPerFoot(fine)).toBeGreaterThan(pxPerFoot(coarse));
  });
});
