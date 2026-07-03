import { hexToPixel } from 'shared';
import { useGameStore } from '../store/game';
import { mapPixelSize } from '../util/stage';

/** Floating +/-HP combat text that rises and fades over damaged/healed tokens. */
export function CombatTextLayer() {
  const map = useGameStore((s) => s.map)!;
  const tokens = useGameStore((s) => s.tokens);
  const floats = useGameStore((s) => s.floats);
  const { width, height } = mapPixelSize(map);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {floats.map((f) => {
        const t = tokens[f.tokenId];
        if (!t) return null;
        const p = hexToPixel({ q: t.q, r: t.r }, map.grid);
        const radius = map.grid.hexSize * 0.72 * t.size;
        const heal = f.delta > 0;
        const fontSize = Math.max(16, map.grid.hexSize * 0.85);
        return (
          <g key={f.id} transform={`translate(${p.x}, ${p.y - radius - 6})`}>
            <g className="hp-float">
              <text
                textAnchor="middle"
                fontSize={fontSize}
                fontWeight={800}
                fill={heal ? '#7ee89a' : '#ff6b6b'}
                stroke="#10131a"
                strokeWidth={fontSize * 0.14}
                paintOrder="stroke"
              >
                {heal ? `+${f.delta}` : f.delta}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
