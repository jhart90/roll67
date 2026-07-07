import type { CSSProperties } from 'react';
import type { GridConfig, Hex } from 'shared';
import { hexToPixel } from 'shared';
import { Projectile, impactColor, projectileShape } from './impactFx';

export interface AoeBurstState {
  id: number;
  shape: 'sphere' | 'cone' | 'line' | 'cube' | 'cylinder';
  sizeFt: number;
  widthFt?: number;
  originHex: Hex;
  aimHex: Hex;
  damageType?: string;
  flightMs: number;
}

function feetToPx(grid: GridConfig): number {
  const feetPerHex = grid.feetPerHex > 0 ? grid.feetPerHex : 5;
  return (grid.hexSize * Math.sqrt(3)) / feetPerHex;
}

/** A colored circular shockwave, sized to the spell's true radius (not a
 *  token), expanding from its center out to the edge -- the sphere/cylinder
 *  half of an AoE burst. Delayed via CSS so it only starts once the
 *  preceding projectile (if any) has visibly landed. */
function BurstSphere({ radiusPx, color, delayMs }: { radiusPx: number; color: string; delayMs: number }) {
  const style = {
    ['--burst-color' as unknown as string]: color,
    ['--burst-delay' as unknown as string]: `${delayMs}ms`,
  } as CSSProperties;
  return <circle className="aoe-burst aoe-burst-sphere" style={style} r={radiusPx} />;
}

/** A colored wedge matching the cone's true angle and length, growing from
 *  the caster's own position (the apex) out to the cone's full reach -- the
 *  cone half of an AoE burst. Always plays immediately (no projectile phase;
 *  a cone always originates at the caster). */
function BurstCone({ lengthPx, aimDx, aimDy, color }: { lengthPx: number; aimDx: number; aimDy: number; color: string }) {
  const half = Math.PI / 6; // matches CONE_HALF_ANGLE in shared/src/hex/aoe.ts
  const cos = Math.cos(half);
  const sin = Math.sin(half);
  const len = Math.hypot(aimDx, aimDy) || 1;
  const ux = aimDx / len;
  const uy = aimDy / len;
  const left = { x: lengthPx * (ux * cos - uy * sin), y: lengthPx * (ux * sin + uy * cos) };
  const right = { x: lengthPx * (ux * cos + uy * sin), y: lengthPx * (-ux * sin + uy * cos) };
  const style = { ['--burst-color' as unknown as string]: color } as CSSProperties;
  return <polygon className="aoe-burst aoe-burst-cone" style={style} points={`0,0 ${left.x},${left.y} ${right.x},${right.y}`} />;
}

/**
 * One AoE spell's detonation. Point-target shapes (sphere/cylinder) fly a
 * projectile from the caster to the aim point, then burst outward from that
 * point to the template's full radius; a cone instead ripples outward from
 * the caster along its own true angle, with no projectile phase. Line/cube
 * shapes render nothing extra here -- they still get the existing small
 * per-token impact ring (see impactFx.tsx's ImpactAoe).
 */
export function AoeBurst({ burst, grid }: { burst: AoeBurstState; grid: GridConfig }) {
  const origin = hexToPixel(burst.originHex, grid);
  const aim = hexToPixel(burst.aimHex, grid);
  const color = impactColor('aoe', burst.damageType);
  const pxPerFt = feetToPx(grid);
  const sizePx = burst.sizeFt * pxPerFt;

  if (burst.shape === 'sphere' || burst.shape === 'cylinder') {
    return (
      <>
        <g transform={`translate(${origin.x}, ${origin.y})`}>
          <Projectile dx={aim.x - origin.x} dy={aim.y - origin.y} color={color} flightMs={burst.flightMs} shape={projectileShape(burst.damageType)} />
        </g>
        <g transform={`translate(${aim.x}, ${aim.y})`}>
          <BurstSphere radiusPx={sizePx} color={color} delayMs={burst.flightMs} />
        </g>
      </>
    );
  }

  if (burst.shape === 'cone') {
    return (
      <g transform={`translate(${origin.x}, ${origin.y})`}>
        <BurstCone lengthPx={sizePx} aimDx={aim.x - origin.x} aimDy={aim.y - origin.y} color={color} />
      </g>
    );
  }

  return null;
}
