import { useEffect, useState } from 'react';
import type { Hex } from 'shared';
import { hexDistance, hexToPixel, pixelToHex, rayBlocked, sightSegments, swadeRangeBand } from 'shared';
import { sightGeometry, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

/**
 * While a SWADE shooter is picking a target — or a thrower is placing a blast
 * — a ruler runs from their token to the cursor, colored by the range band
 * it currently falls in, with the distance, the band, and the penalty at its
 * tip. The bands come from shared/systems/swadeRange.ts, the same function
 * the server uses to score the shot, so the ruler can never promise a
 * modifier the roll won't apply.
 *
 * The layer never takes pointer events: clicking a token is how a target gets
 * chosen, so the cursor is followed with a window listener instead of an
 * overlay that would swallow the click.
 */
const BAND_COLOR: Record<string, string> = {
  short: '#4cc47e',
  medium: '#e0b64a',
  long: '#e08a3c',
  extreme: '#d2564f',
  out: '#8a93a6',
};

export function RangeRulerLayer() {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const tokens = useGameStore((s) => s.tokens);
  const system = useGameStore((s) => s.campaign?.system);
  const targeting = useGameStore((s) => s.targeting);
  const aoe = useGameStore((s) => s.aoeTargeting);
  const [cursor, setCursor] = useState<Hex | null>(null);

  const active = targeting ?? aoe;
  const wantCursor = !!targeting && !aoe;

  useEffect(() => {
    if (!wantCursor) { setCursor(null); return; }
    const onMove = (e: PointerEvent) => setCursor(pixelToHex(stage.toMap(e.clientX, e.clientY), map.grid));
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [wantCursor, stage, map.grid]);

  if (system !== 'swade' || !active) return null;
  const action = active.action;
  // Melee swings and self-range actions have no band worth drawing.
  if (!action.ranged || action.rangeFt <= 0) return null;

  const src = tokens[active.sourceTokenId];
  if (!src) return null;
  const aim: Hex | null = aoe ? aoe.aimHex : cursor;
  if (!aim) return null;

  const { width, height } = mapPixelSize(map);
  const grid = map.grid;
  const feetPerHex = grid.feetPerHex > 0 ? grid.feetPerHex : 5;
  const shortHexes = Math.max(1, Math.ceil(action.rangeFt / feetPerHex));
  const dist = hexDistance({ q: src.q, r: src.r }, aim);
  if (dist === 0) return null;

  const reading = swadeRangeBand(dist, shortHexes, {
    aiming: active.adv === 'adv',
    thrown: action.thrown === true,
  });
  const from = hexToPixel({ q: src.q, r: src.r }, grid);
  const to = hexToPixel(aim, grid);
  // A wall ends the conversation before the range band gets a say: the server
  // refuses a shot it cannot see, so the ruler says so at the tip rather than
  // quoting a penalty for a shot that will never be rolled.
  const geo = sightGeometry();
  const blocked = !!geo && rayBlocked(from, to, sightSegments(geo.walls, geo.doors, from));
  const color = blocked ? BAND_COLOR.out : BAND_COLOR[reading.band] ?? BAND_COLOR.out;

  // The roll this action actually makes, so the penalty names the right skill.
  const skillName = action.thrown ? 'Athletics (Throwing)' : 'Shooting';
  const lines = blocked
    ? [`${dist} ${dist === 1 ? 'tile' : 'tiles'} / ${dist * feetPerHex} ft`, 'No line of sight', 'A wall is in the way']
    : [
      `${dist} ${dist === 1 ? 'tile' : 'tiles'} / ${dist * feetPerHex} ft`,
      reading.label,
      ...(reading.penalty !== 0 ? [`${reading.penalty} to ${skillName}`] : []),
      ...(!reading.reachable ? [reading.reason ?? 'Out of range'] : []),
    ];

  // Keep the label clear of the ruler's tip and on the far side from the
  // shooter, so it never sits under the cursor.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const offset = grid.hexSize * 0.9;
  const lx = to.x + (dx / len) * offset;
  const ly = to.y + (dy / len) * offset;
  const anchor = dx >= 0 ? 'start' : 'end';
  const fs = Math.max(9, grid.hexSize * 0.55);

  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <line
        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
        stroke="#10131a" strokeWidth={5} strokeLinecap="round" opacity={0.55}
      />
      <line
        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
        stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={reading.reachable ? undefined : '7 5'}
      />
      <circle cx={to.x} cy={to.y} r={grid.hexSize * 0.22} fill="none" stroke={color} strokeWidth={2.5} />
      {lines.map((text, i) => (
        <text
          key={i}
          x={lx} y={ly + i * (fs * 1.25) - (lines.length - 1) * (fs * 0.6)}
          textAnchor={anchor} fontSize={fs} fontWeight={i === 0 ? 700 : 600}
          fill={i === 0 ? '#e6e8ee' : color}
          stroke="#10131a" strokeWidth={3} paintOrder="stroke"
        >
          {text}
        </text>
      ))}
    </svg>
  );
}
