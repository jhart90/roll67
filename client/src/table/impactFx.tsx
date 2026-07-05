import type { CSSProperties } from 'react';
import type { ImpactKind } from 'shared';

/** Color per 5e/SWN damage type — tints both the impact animation and the floating HP number. */
const DAMAGE_TYPE_COLORS: Record<string, string> = {
  fire: '#ff8a3d',
  cold: '#7ec8ff',
  lightning: '#f5e35a',
  thunder: '#9aa8ff',
  acid: '#a3e635',
  poison: '#7ed957',
  necrotic: '#8a5cff',
  radiant: '#fff2a8',
  psychic: '#ff7ad9',
  force: '#c7d2fe',
  slashing: '#e2e2e2',
  piercing: '#d8d8d8',
  bludgeoning: '#cfcfcf',
};
const DEFAULT_DAMAGE_COLOR = '#ff6b6b';
const HEAL_COLOR = '#7ee89a';

/** The color an impact animation (and its floating HP number) should use. */
export function impactColor(kind: ImpactKind | undefined, damageType: string | undefined): string {
  if (kind === 'heal') return HEAL_COLOR;
  const key = damageType?.toLowerCase().trim();
  if (key && DAMAGE_TYPE_COLORS[key]) return DAMAGE_TYPE_COLORS[key];
  return DEFAULT_DAMAGE_COLOR;
}

interface ShapeProps { radius: number; color: string }

function colorVar(color: string): CSSProperties {
  return { ['--impact-color' as unknown as string]: color } as CSSProperties;
}

/** Melee: a quick crossing slash through the token. */
function ImpactMelee({ radius, color }: ShapeProps) {
  const a = radius * 0.85;
  return (
    <g className="impact-fx impact-melee" style={colorVar(color)}>
      <line x1={-a} y1={-a * 0.4} x2={a} y2={a * 0.4} />
      <line x1={-a * 0.75} y1={a * 0.55} x2={a * 0.75} y2={-a * 0.55} />
    </g>
  );
}

/** Ranged: a small radiating impact burst, like an arrow/bolt strike. */
function ImpactRanged({ radius, color }: ShapeProps) {
  const spokes = [0, 60, 120, 180, 240, 300];
  const inner = radius * 0.25;
  const outer = radius * 0.95;
  return (
    <g className="impact-fx impact-ranged" style={colorVar(color)}>
      {spokes.map((deg) => (
        <line key={deg} transform={`rotate(${deg})`} x1={inner} y1={0} x2={outer} y2={0} />
      ))}
    </g>
  );
}

/** AoE (any shape — cone/line/cube/sphere/cylinder): an expanding shockwave ring. */
function ImpactAoe({ radius, color }: ShapeProps) {
  return <circle className="impact-fx impact-aoe" style={colorVar(color)} r={radius} />;
}

/** Heal: a soft rising ring with a few sparkle points. */
function ImpactHeal({ radius, color }: ShapeProps) {
  const points = [0, 1, 2, 3].map((i) => {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return { x: Math.cos(angle) * radius * 0.6, y: Math.sin(angle) * radius * 0.6 };
  });
  return (
    <g className="impact-fx impact-heal" style={colorVar(color)}>
      <circle r={radius * 0.7} className="impact-heal-ring" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} />)}
    </g>
  );
}

const IMPACT_SHAPES: Record<ImpactKind, (props: ShapeProps) => JSX.Element> = {
  melee: ImpactMelee, ranged: ImpactRanged, aoe: ImpactAoe, heal: ImpactHeal,
};

/** A 1-2s impact animation for a landed hit/heal, centered on the token (kind defaults to 'melee'). */
export function ImpactAnimation({ kind, radius, color }: { kind: ImpactKind | undefined; radius: number; color: string }) {
  const Shape = IMPACT_SHAPES[kind ?? 'melee'];
  return <Shape radius={radius} color={color} />;
}
