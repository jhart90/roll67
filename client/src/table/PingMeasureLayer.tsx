import { useState } from 'react';
import type { Hex } from 'shared';
import { hexDistance, hexLine, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

/** Pings (everyone) + the measure tool with a live shared ruler. */
export function PingMeasureLayer() {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const tool = useGameStore((s) => s.tool);
  const pings = useGameStore((s) => s.pings);
  const measures = useGameStore((s) => s.measures);
  const you = useGameStore((s) => s.you);

  const [measureFrom, setMeasureFrom] = useState<Hex | null>(null);
  const [measureTo, setMeasureTo] = useState<Hex | null>(null);

  const { width, height } = mapPixelSize(map);
  const grid = map.grid;

  function onPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = stage.toMap(e.clientX, e.clientY);
    if (tool === 'ping') {
      intents.ping(p.x, p.y);
      return;
    }
    if (tool === 'measure') {
      (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
      const hex = pixelToHex(p, grid);
      setMeasureFrom(hex);
      setMeasureTo(hex);
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (tool !== 'measure' || !measureFrom) return;
    const hex = pixelToHex(stage.toMap(e.clientX, e.clientY), grid);
    if (!measureTo || hex.q !== measureTo.q || hex.r !== measureTo.r) {
      setMeasureTo(hex);
      intents.measure(measureFrom, hex, true);
    }
  }

  function onPointerUp() {
    if (measureFrom) {
      intents.measure(measureFrom, measureTo ?? measureFrom, false);
      setMeasureFrom(null);
      setMeasureTo(null);
    }
  }

  const capturing = tool === 'ping' || tool === 'measure';

  // Rulers to draw: my local one + everyone else's shared ones.
  const rulers: Array<{ key: string; from: Hex; to: Hex; color: string; label: string }> = [];
  if (measureFrom && measureTo) {
    rulers.push({ key: 'mine', from: measureFrom, to: measureTo, color: '#e8d27b', label: 'you' });
  }
  for (const [userId, m] of Object.entries(measures)) {
    if (userId === you?.userId) continue;
    rulers.push({ key: userId, from: m.from, to: m.to, color: m.color, label: m.byName });
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {capturing && (
        <rect
          x={0} y={0} width={width} height={height}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

      {rulers.map((r) => {
        const dist = hexDistance(r.from, r.to);
        const cells = hexLine(r.from, r.to);
        const a = hexToPixel(r.from, grid);
        const b = hexToPixel(r.to, grid);
        return (
          <g key={r.key} pointerEvents="none">
            {cells.map((h, i) => {
              const c = hexToPixel(h, grid);
              return <circle key={i} cx={c.x} cy={c.y} r={grid.hexSize * 0.28} fill={r.color} opacity={0.35} />;
            })}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={r.color} strokeWidth={2.5} strokeDasharray="8 6" />
            <text
              x={b.x} y={b.y - grid.hexSize * 0.8}
              textAnchor="middle"
              fontSize={Math.max(14, grid.hexSize * 0.5)}
              fontWeight={800}
              fill={r.color}
              stroke="#10131a"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {dist} hex · {dist * grid.feetPerHex} ft
            </text>
          </g>
        );
      })}

      {pings.map((p) => (
        <g key={p.id} pointerEvents="none">
          <circle cx={p.x} cy={p.y} r={grid.hexSize} fill="none" stroke={p.color} strokeWidth={4} className="ping-ring" />
          <circle cx={p.x} cy={p.y} r={6} fill={p.color} />
          <text
            x={p.x} y={p.y - grid.hexSize - 6}
            textAnchor="middle" fontSize={13} fontWeight={700}
            fill={p.color} stroke="#10131a" strokeWidth={3} paintOrder="stroke"
          >
            {p.byName}
          </text>
        </g>
      ))}
    </svg>
  );
}
