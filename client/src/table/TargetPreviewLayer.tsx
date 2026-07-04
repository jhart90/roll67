import { hexDistance, hexToPixel } from 'shared';
import { useGameStore } from '../store/game';
import { mapPixelSize } from '../util/stage';

/**
 * Other players'/the DM's in-progress single-target selections: a dashed
 * ring around every token their action can currently reach, plus a label at
 * their source token — mirrors what TokenLayer already shows the caster
 * themselves (see TokenLayer's own `stateFor`), so everyone sees the same
 * in-range/out-of-range picture before the caster clicks. Our own targeting
 * still renders through TokenLayer's solid rings; this layer only draws
 * everyone else's.
 */
export function TargetPreviewLayer() {
  const map = useGameStore((s) => s.map)!;
  const tokens = useGameStore((s) => s.tokens);
  const you = useGameStore((s) => s.you);
  const previews = useGameStore((s) => s.targetPreviews);
  const { width, height } = mapPixelSize(map);
  const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;

  const others = Object.entries(previews).filter(([userId]) => userId !== you?.userId);
  if (others.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {others.map(([userId, p]) => {
        const src = tokens[p.sourceTokenId];
        if (!src) return null;
        const rangeHexes = p.rangeFt <= 0 ? 0 : Math.max(1, Math.ceil(p.rangeFt / feetPerHex));
        const srcPos = hexToPixel({ q: src.q, r: src.r }, map.grid);
        const srcRadius = map.grid.hexSize * 0.72 * src.size;
        return (
          <g key={userId}>
            {Object.values(tokens).map((t) => {
              const inRange = hexDistance({ q: src.q, r: src.r }, { q: t.q, r: t.r }) <= rangeHexes;
              const selfBlocked = p.effect === 'damage' && t.id === src.id;
              if (!inRange || selfBlocked) return null;
              const pos = hexToPixel({ q: t.q, r: t.r }, map.grid);
              const radius = map.grid.hexSize * 0.72 * t.size;
              return (
                <circle
                  key={t.id} cx={pos.x} cy={pos.y} r={radius + 6}
                  fill="none" stroke={p.color} strokeWidth={2.5} strokeDasharray="5 4"
                />
              );
            })}
            <text
              x={srcPos.x} y={srcPos.y - srcRadius - 12}
              textAnchor="middle" fontSize={13} fontWeight={700}
              fill={p.color} stroke="#10131a" strokeWidth={3} paintOrder="stroke"
            >
              {p.byName} · {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
