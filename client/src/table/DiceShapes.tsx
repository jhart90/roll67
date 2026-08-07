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
    case 10: // pentagonal trapezohedron (kite)
      return (
        <>
          <polygon points="50,2 92,44 50,100 8,44" {...f} />
          <polyline points="8,44 50,62 92,44" {...f} opacity={0.5} />
          <line x1={50} y1={62} x2={50} y2={100} {...f} opacity={0.5} />
        </>
      );
    case 100: // Zocchihedron: a ball of small facets, banded like a globe
      return (
        <>
          <circle cx={50} cy={52} r={47} {...f} />
          {/* Latitude bands, flattened by perspective toward the equator. */}
          <ellipse cx={50} cy={52} rx={47} ry={15} {...f} opacity={0.45} />
          <ellipse cx={50} cy={52} rx={40} ry={40} {...f} opacity={0.3} />
          {/* Longitude seams, so it reads as faceted rather than a plain disc. */}
          <ellipse cx={50} cy={52} rx={17} ry={47} {...f} opacity={0.45} />
          <ellipse cx={50} cy={52} rx={38} ry={47} {...f} opacity={0.3} />
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

function outline(sides: number, fillOverride?: string): React.ReactNode {
  const fill = fillOverride ?? DIE_COLORS[sides] ?? '#9aa1b3';
  switch (sides) {
    case 2: return <circle cx={50} cy={52} r={46} fill={fill} />;
    case 4: return <polygon points="50,4 96,90 4,90" fill={fill} />;
    case 6: return <path d="M10,24 Q10,18 16,18 L26,6 Q28,4 32,4 L86,4 Q90,4 90,8 L90,70 Q90,74 86,78 L82,86 Q78,88 72,88 L16,88 Q10,88 10,82 Z" fill={fill} />;
    case 8: return <polygon points="50,3 95,52 50,99 5,52" fill={fill} />;
    case 10: return <polygon points="50,2 92,44 50,100 8,44" fill={fill} />;
    // A d100 is a Zocchihedron — effectively a faceted ball, not a big d10.
    case 100: return <circle cx={50} cy={52} r={47} fill={fill} />;
    case 12: return <polygon points="50,3 96,37 78,92 22,92 4,37" fill={fill} />;
    case 20:
    default: return <polygon points="50,2 92,27 92,77 50,102 8,77 8,27" fill={fill} />;
  }
}

/** Same ink-picking rule the 3D dice use: dark ink on light bodies, light on dark. */
function contrastInk(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#10131a';
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((c) => parseInt(c, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? '#10131a' : '#f4f6fb';
}

// Classic d6 pip layout, in offsets from the front-face centre.
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

export function DieShape({
  sides, size = 48, value, dim = false, fill, textFill,
}: {
  sides: number;
  size?: number;
  /** Optional face value rendered in the middle. */
  value?: number | string;
  dim?: boolean;
  /** Override the body colour (e.g. previewing a player's dice palette). */
  fill?: string;
  /** Override the pip/number colour; defaults to ink that contrasts the body. */
  textFill?: string;
}) {
  // d4 numbers sit lower (triangle); coin/kite slightly high-center.
  const valueY = sides === 4 ? 72 : 58;
  const ink = textFill ?? (fill ? contrastInk(fill) : '#10131a');
  // A d6 face shows real pips, like the physical die that was thrown.
  const pips = sides === 6 && typeof value === 'number' ? PIPS[value] : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 104"
      style={{ display: 'block', opacity: dim ? 0.55 : 1 }}
    >
      {outline(sides, fill)}
      {facets(sides)}
      {pips && pips.map(([px, py], i) => (
        <circle key={i} cx={44 + px * 18} cy={52 + py * 18} r={8} fill={ink} />
      ))}
      {!pips && value !== undefined && (
        <text
          x={50}
          y={valueY}
          textAnchor="middle"
          fontSize={sides >= 100 ? 30 : 38}
          fontWeight={800}
          fill={ink}
          style={{ userSelect: 'none' }}
        >
          {value}
        </text>
      )}
    </svg>
  );
}
