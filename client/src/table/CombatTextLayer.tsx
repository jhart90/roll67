import { hexToPixel } from 'shared';
import { useGameStore } from '../store/game';
import { mapPixelSize } from '../util/stage';
import { ImpactAnimation, impactColor, Projectile } from './impactFx';

/**
 * Floating +/-HP text plus a short (1-2s) impact animation over damaged/healed
 * tokens — both keyed off the same `kind`/`damageType` hint the server sends
 * once a roll's dice have settled, so a fireball, an arrow, and a sword swing
 * each land with their own look, colored by damage type. Also renders
 * in-flight ranged shots, which the server times to land right as their
 * matching float/impact appears.
 */
export function CombatTextLayer() {
  const map = useGameStore((s) => s.map)!;
  const tokens = useGameStore((s) => s.tokens);
  const floats = useGameStore((s) => s.floats);
  const projectiles = useGameStore((s) => s.projectiles);
  const { width, height } = mapPixelSize(map);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {projectiles.map((proj) => {
        const from = tokens[proj.fromTokenId];
        const to = tokens[proj.toTokenId];
        if (!from || !to) return null;
        const a = hexToPixel({ q: from.q, r: from.r }, map.grid);
        const b = hexToPixel({ q: to.q, r: to.r }, map.grid);
        const color = impactColor('ranged', proj.damageType);
        return (
          <g key={proj.id} transform={`translate(${a.x}, ${a.y})`}>
            <Projectile dx={b.x - a.x} dy={b.y - a.y} color={color} flightMs={proj.flightMs} />
          </g>
        );
      })}
      {floats.map((f) => {
        const t = tokens[f.tokenId];
        if (!t) return null;
        const p = hexToPixel({ q: t.q, r: t.r }, map.grid);
        const radius = map.grid.hexSize * 0.72 * t.size;
        const heal = f.delta > 0;
        const fontSize = Math.max(16, map.grid.hexSize * 0.85);
        const color = impactColor(f.kind, f.damageType);
        return (
          <g key={f.id}>
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
      })}
    </svg>
  );
}
