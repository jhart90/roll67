import type { GridConfig } from 'shared';
import { hexToPixel } from 'shared';
import { useGameStore } from '../store/game';
import type { HpFloat, Projectile as ProjectileState } from '../store/game';
import { mapPixelSize } from '../util/stage';
import { AoeBurst } from './aoeBurstFx';
import { ImpactAnimation, impactColor, Projectile, projectileShape } from './impactFx';

/** One in-flight ranged shot. Subscribes only to its own two endpoint tokens,
 *  so an unrelated token moving elsewhere on the map doesn't re-render it (or
 *  force the parent layer to hold the whole `tokens` map just to look these
 *  two up). */
function ProjectileFx({ proj, grid }: { proj: ProjectileState; grid: GridConfig }) {
  const from = useGameStore((s) => s.tokens[proj.fromTokenId]);
  const to = useGameStore((s) => s.tokens[proj.toTokenId]);
  if (!from || !to) return null;
  const a = hexToPixel({ q: from.q, r: from.r }, grid);
  const b = hexToPixel({ q: to.q, r: to.r }, grid);
  const color = impactColor('ranged', proj.damageType);
  const shape = projectileShape(proj.damageType);
  return (
    <g transform={`translate(${a.x}, ${a.y})`}>
      <Projectile dx={b.x - a.x} dy={b.y - a.y} color={color} flightMs={proj.flightMs} shape={shape} />
    </g>
  );
}

/** One floating +/-HP number plus its impact ring. Subscribes only to its own
 *  token, for the same reason as ProjectileFx above. */
function FloatFx({ f, grid }: { f: HpFloat; grid: GridConfig }) {
  const t = useGameStore((s) => s.tokens[f.tokenId]);
  if (!t) return null;
  const p = hexToPixel({ q: t.q, r: t.r }, grid);
  const radius = grid.hexSize * 0.72 * t.size;
  const heal = f.delta > 0;
  const fontSize = Math.max(16, grid.hexSize * 0.85);
  const color = impactColor(f.kind, f.damageType);
  return (
    <g>
      <g transform={`translate(${p.x}, ${p.y})`}>
        <ImpactAnimation kind={f.kind} radius={radius} color={color} />
      </g>
      <g transform={`translate(${p.x}, ${p.y - radius - 6})`}>
        <g className="hp-float">
          <text
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={800}
            fill={color}
            stroke="#10131a"
            strokeWidth={fontSize * 0.14}
            paintOrder="stroke"
          >
            {heal ? `+${f.delta}` : f.delta}
          </text>
        </g>
      </g>
    </g>
  );
}

/**
 * Floating +/-HP text plus a short (1-2s) impact animation over damaged/healed
 * tokens — both keyed off the same `kind`/`damageType` hint the server sends
 * once a roll's dice have settled, so a fireball, an arrow, and a sword swing
 * each land with their own look, colored by damage type. Also renders
 * in-flight ranged shots (timed to land right as their matching float/impact
 * appears) and AoE detonations (a projectile-then-burst for sphere/cylinder
 * spells, a ripple for cones), both server-timed the same way.
 */
export function CombatTextLayer() {
  const map = useGameStore((s) => s.map)!;
  const floats = useGameStore((s) => s.floats);
  const projectiles = useGameStore((s) => s.projectiles);
  const aoeBursts = useGameStore((s) => s.aoeBursts);
  const { width, height } = mapPixelSize(map);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {projectiles.map((proj) => <ProjectileFx key={proj.id} proj={proj} grid={map.grid} />)}
      {aoeBursts.map((b) => <AoeBurst key={b.id} burst={b} grid={map.grid} />)}
      {floats.map((f) => <FloatFx key={f.id} f={f} grid={map.grid} />)}
    </svg>
  );
}
