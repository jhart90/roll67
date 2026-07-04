// SVG silhouettes for each die type, with facet lines so a d20 reads as a
// d20 and not a cube. Used by the quick-roll panel; the roll overlay itself
// renders true 3D models (see dice3d.ts), sharing the same default palette.

import { DEFAULT_DIE_COLORS } from './dice3d';

export const DIE_COLORS = DEFAULT_DIE_COLORS;

const EDGE = 'rgba(0, 0, 0, 0.45)';

function facets(sides: number) {
  const f = { stroke: EDGE, strokeWidth: 2.5, fill: 'none', strokeLinejoin: 'round' as const };
  switch (sides) {
    case 2: // coin
      return (
        <>
          <circle cx={50} cy={52} r={46} {...f} />
          <circle cx={50} cy={52} r={36} {...f} opacity={0.5} />
        </>
      );
    case 4: // tetrahedron
      return (
        <>
          <polygon points="50,4 96,90 4,90" {...f} />
          <line x1={50} y1={4} x2={50} y2={62} {...f} opacity={0.5} />
          <line x1={4} y1={90} x2={50} y2={62} {...f} opacity={0.5} />
          <line x1={96} y1={90} x2={50} y2={62} {...f} opacity={0.5} />
        </>
      );
    case 6: // cube in slight perspective
      return (
        <>
          <rect x={10} y={18} width={68} height={68} rx={6} {...f} />
          <polyline points="14,20 26,6 90,6 90,70 82,82" {...f} opacity={0.6} />
          <line x1={78} y1={22} x2={90} y2={6} {...f} opacity={0.6} />
        </>
      );
    case 8: // octahedron
      return (
        <>
          <polygon points="50,3 95,52 50,99 5,52" {...f} />
          <line x1={5} y1={52} x2={95} y2={52} {...f} opacity={0.5} />
          <line x1={50} y1={3} x2={50} y2={52} {...f} opacity={0.35} />
        </>
      );
    case 10:
    case 100: // pentagonal trapezohedron (kite)
      return (
        <>
          <polygon points="50,2 92,44 50,100 8,44" {...f} />
          <polyline points="8,44 50,62 92,44" {...f} opacity={0.5} />
          <line x1={50} y1={62} x2={50} y2={100} {...f} opacity={0.5} />
        </>
      );
    case 12: // dodecahedron (pentagon + inner pentagon)
      return (
        <>
          <polygon points="50,3 96,37 78,92 22,92 4,37" {...f} />
          <polygon points="50,26 74,44 65,73 35,73 26,44" {...f} opacity={0.5} />
          <line x1={50} y1={3} x2={50} y2={26} {...f} opacity={0.4} />
          <line x1={96} y1={37} x2={74} y2={44} {...f} opacity={0.4} />
          <line x1={78} y1={92} x2={65} y2={73} {...f} opacity={0.4} />
          <line x1={22} y1={92} x2={35} y2={73} {...f} opacity={0.4} />
          <line x1={4} y1={37} x2={26} y2={44} {...f} opacity={0.4} />
        </>
      );
    case 20: // icosahedron (hexagon + central triangle facets)
    default:
      return (
        <>
          <polygon points="50,2 92,27 92,77 50,102 8,77 8,27" {...f} />
          <polygon points="50,20 83,72 17,72" {...f} opacity={0.6} />
          <line x1={50} y1={2} x2={50} y2={20} {...f} opacity={0.4} />
          <line x1={92} y1={27} x2={50} y2={20} {...f} opacity={0.4} />
          <line x1={8} y1={27} x2={50} y2={20} {...f} opacity={0.4} />
          <line x1={92} y1={77} x2={83} y2={72} {...f} opacity={0.4} />
          <line x1={8} y1={77} x2={17} y2={72} {...f} opacity={0.4} />
          <line x1={50} y1={102} x2={83} y2={72} {...f} opacity={0.4} />
          <line x1={50} y1={102} x2={17} y2={72} {...f} opacity={0.4} />
        </>
      );
  }
}

function outline(sides: number): React.ReactNode {
  const fill = DIE_COLORS[sides] ?? '#9aa1b3';
  switch (sides) {
    case 2: return <circle cx={50} cy={52} r={46} fill={fill} />;
    case 4: return <polygon points="50,4 96,90 4,90" fill={fill} />;
    case 6: return <path d="M10,24 Q10,18 16,18 L26,6 Q28,4 32,4 L86,4 Q90,4 90,8 L90,70 Q90,74 86,78 L82,86 Q78,88 72,88 L16,88 Q10,88 10,82 Z" fill={fill} />;
    case 8: return <polygon points="50,3 95,52 50,99 5,52" fill={fill} />;
    case 10:
    case 100: return <polygon points="50,2 92,44 50,100 8,44" fill={fill} />;
    case 12: return <polygon points="50,3 96,37 78,92 22,92 4,37" fill={fill} />;
    case 20:
    default: return <polygon points="50,2 92,27 92,77 50,102 8,77 8,27" fill={fill} />;
  }
}

export function DieShape({
  sides, size = 48, value, dim = false,
}: {
  sides: number;
  size?: number;
  /** Optional face value rendered in the middle. */
  value?: number | string;
  dim?: boolean;
}) {
  // d4 numbers sit lower (triangle); coin/kite slightly high-center.
  const valueY = sides === 4 ? 72 : 58;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 104"
      style={{ display: 'block', opacity: dim ? 0.55 : 1 }}
    >
      {outline(sides)}
      {facets(sides)}
      {value !== undefined && (
        <text
          x={50}
          y={valueY}
          textAnchor="middle"
          fontSize={sides >= 100 ? 30 : 38}
          fontWeight={800}
          fill="#10131a"
          style={{ userSelect: 'none' }}
        >
          {value}
        </text>
      )}
    </svg>
  );
}
