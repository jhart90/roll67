import type { GridConfig, Hex } from 'shared';
import { hexCorners, hexDistance, hexToPixel } from 'shared';
import { mapPixelSize } from '../util/stage';
import { useGameStore } from '../store/game';

/**
 * Clouds on the map — smoke, for now.
 *
 * Drawn as a soft grey wash over the tiles the template covered, with the
 * rounds it has left written in the middle of it. Not a wall and not painted
 * like one: SWADE smoke does not stop anyone seeing through it, it makes
 * seeing through it harder, and something that looked solid would be
 * promising a protection it does not give.
 *
 * Public. Hiding the cloud from the people standing in it would be hiding the
 * reason their shots keep missing.
 */
export function ZoneLayer({ grid }: { grid: GridConfig }) {
  const map = useGameStore((s) => s.map);
  const zones = map?.zones ?? [];
  if (!map || zones.length === 0) return null;
  const { width, height } = mapPixelSize(map);

  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {zones.map((z) => {
        // The same membership test the penalty uses: every tile within the
        // template's reach of its centre. Drawing it any other way would be a
        // second opinion about where the smoke is.
        const tiles: Hex[] = [];
        for (let dq = -z.radius; dq <= z.radius; dq++) {
          for (let dr = -z.radius; dr <= z.radius; dr++) {
            const h = { q: z.hex.q + dq, r: z.hex.r + dr };
            if (hexDistance(z.hex, h) <= z.radius) tiles.push(h);
          }
        }
        const centre = hexToPixel(z.hex, grid);
        return (
          <g key={z.id}>
            {tiles.map((h, i) => (
              <polygon
                key={i}
                points={hexCorners(h, grid).map((p) => `${p.x},${p.y}`).join(' ')}
                fill="rgba(196, 200, 208, 0.30)"
              />
            ))}
            <text
              x={centre.x} y={centre.y}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={Math.max(10, grid.hexSize * 0.7)} fontWeight={700}
              fill="#e6e8ee" stroke="#10131a" strokeWidth={3} paintOrder="stroke"
            >
              {z.label} · {z.roundsLeft}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
