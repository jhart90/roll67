import { useEffect, useMemo, useState } from 'react';
import type { Hex } from 'shared';
import { hexCorners, hexToPixel, packHex, pixelToHex } from 'shared';
import { intents, sightGeometry, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';
import { shortestPath, type ReachOpts } from '../util/moveReach';

/**
 * The move planner (M): point at a hex, see the cheapest walk there and
 * what it costs, click to take it.
 *
 * Same shape as aiming — a mode you enter, a thing under the pointer, one
 * click to commit — and for the same reason: a drag is a straight line and
 * tells you what it cost only after the fact. This routes round walls and
 * through rough ground at its double rate (shared/moveReach, the server's
 * own arithmetic) and says the number first. In a fight the number is read
 * against what is left of the turn's Pace; out of one it is just a distance.
 *
 * The walk is sent hex by hex along the route, so the server charges the
 * route actually taken and a wall the client did not know about stops it
 * where it should, not a step later.
 */
export function MovePlanLayer() {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const plan = useGameStore((s) => s.movePlan);
  const token = useGameStore((s) => (s.movePlan ? s.tokens[s.movePlan.tokenId] : undefined));
  const predicted = useGameStore((s) => (s.movePlan ? s.predictedMoves[s.movePlan.tokenId] : undefined));
  const budget = useGameStore((s) => (s.movePlan && s.initiativeState.active ? s.moveBudgets[s.movePlan.tokenId] : undefined));
  const tool = useGameStore((s) => s.tool);
  const targeting = useGameStore((s) => !!s.targeting || !!s.aoeTargeting);
  // Subscribed so the route re-plans when a door opens or a wall is learned.
  const knownWalls = useGameStore((s) => s.knownWalls);
  const knownDoors = useGameStore((s) => s.knownDoors);
  const dmGeometry = useGameStore((s) => s.dmGeometry);
  const textScale = useGameStore((s) => Math.round(Math.min(2.5, Math.max(1, 1 / s.camera.scale)) * 20) / 20);
  const [hover, setHover] = useState<Hex | null>(null);
  const { width, height } = mapPixelSize(map);

  // The plan belongs to this map, this tool and this token: any of them
  // changing under it ends it.
  useEffect(() => {
    if (plan && (tool !== 'select' || targeting || !token || token.mapId !== map.id)) useGameStore.getState().cancelMovePlan();
  }, [plan, tool, targeting, token, map.id]);
  useEffect(() => { if (!plan) setHover(null); }, [plan]);

  const fromQ = predicted?.q ?? token?.q;
  const fromR = predicted?.r ?? token?.r;
  const route = useMemo(() => {
    if (!plan || fromQ === undefined || fromR === undefined || !hover) return null;
    const opts: ReachOpts = {
      grid: map.grid, terrain: map.terrain, blocked: map.blocked ?? [], crawling: budget?.crawling,
      sight: sightGeometry(),
    };
    return shortestPath({ q: fromQ, r: fromR }, hover, opts);
    // knownWalls/knownDoors/dmGeometry feed sightGeometry() — listed so a
    // door opening re-plans the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, fromQ, fromR, hover, map.grid, map.terrain, map.blocked, budget?.crawling, knownWalls, knownDoors, dmGeometry]);

  if (!plan || !token || fromQ === undefined || fromR === undefined) return null;
  const from = { q: fromQ, r: fromR };

  const feet = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
  // What the turn can still afford from where the token stands now — the
  // provisional walk already made counts, since this route starts from it.
  const left = budget ? Math.max(0, budget.pace + (budget.runBonus ?? 0) - budget.moved - budget.provisional) : null;
  const runLeft = budget ? Math.max(0, budget.runMax) : 0;
  const cost = route?.cost ?? null;
  const verdict: { text: string; tone: 'ok' | 'run' | 'no' } | null = cost === null ? null
    : left === null ? { text: '', tone: 'ok' }
      : cost <= left ? { text: `${left - cost}″ left after`, tone: 'ok' }
        : budget?.runBonus === null && cost <= left + runLeft ? { text: 'needs a run', tone: 'run' }
          : { text: 'out of reach this turn', tone: 'no' };
  const color = !verdict ? '#8a93a6' : verdict.tone === 'ok' ? '#7ed28a' : verdict.tone === 'run' ? '#e8d27b' : '#d26c6c';

  function walk() {
    if (!route || !token || route.path.length < 2) return;
    if (verdict?.tone === 'no') {
      useGameStore.getState().toast(budget?.runBonus !== null
        ? `Too far — ${cost}″ and only ${left}″ of movement left this turn.`
        : `Too far — ${cost}″, and ${(left ?? 0) + runLeft}″ is everything this turn has, even running.`);
      return;
    }
    // Hex by hex. In a fight, past what Pace covers the server asks about
    // running: the first step over the line is sent so it asks exactly
    // once, and the rest wait for the answer (press M again to finish).
    const rough = budget?.crawling ? new Set<number>() : new Set(map.terrain);
    let spent = 0;
    for (const h of route.path.slice(1)) {
      spent += rough.has(packHex(h)) ? 2 : 1;
      intents.moveToken(token.id, h.q, h.r);
      if (left !== null && spent > left) break;
    }
    useGameStore.getState().cancelMovePlan();
  }

  const origin = hexToPixel(from, map.grid);
  const dest = hover ? hexToPixel(hover, map.grid) : null;
  const pts = route ? route.path.map((h) => hexToPixel(h, map.grid)) : [];
  const points = pts.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <rect
        x={0} y={0} width={width} height={height} fill="transparent"
        style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
        onPointerMove={(e) => {
          const h = pixelToHex(stage.toMap(e.clientX, e.clientY), map.grid);
          setHover((cur) => (cur && cur.q === h.q && cur.r === h.r ? cur : h));
        }}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button === 0) walk();
          else if (e.button === 2) useGameStore.getState().cancelMovePlan();
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      />
      {/* Where the walk starts: a ring, so the route has a visible origin
          even when it is one hex long. */}
      <circle cx={origin.x} cy={origin.y} r={map.grid.hexSize * 0.5} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" />
      {pts.length > 1 && (
        <>
          <polyline points={points} fill="none" stroke="#10131a" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />
          <polyline points={points} fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" />
          {pts.slice(1, -1).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} stroke="#10131a" strokeWidth={1} />)}
        </>
      )}
      {hover && (
        <polygon
          points={hexCorners(hover, map.grid).map((c) => `${c.x},${c.y}`).join(' ')}
          fill={route ? `${color}33` : 'rgba(210,108,108,0.2)'} stroke={route ? color : '#d26c6c'} strokeWidth={2.5}
        />
      )}
      {dest && (
        <text
          x={dest.x} y={dest.y - map.grid.hexSize * 1.15}
          textAnchor="middle" fontSize={13 * textScale} fontWeight={700} fill="#f4f6fb"
          stroke="#10131a" strokeWidth={3.5 * textScale} paintOrder="stroke" strokeLinejoin="round"
          style={{ userSelect: 'none' }}
        >
          {cost === null ? 'No way through' : `${cost}″ · ${cost * feet} ft${verdict?.text ? ` — ${verdict.text}` : ''}`}
        </text>
      )}
    </svg>
  );
}
