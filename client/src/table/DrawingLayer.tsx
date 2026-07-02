import { useEffect, useState } from 'react';
import type { Drawing, Point } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, useStage } from '../util/stage';

export const DRAW_COLORS = ['#e8d27b', '#d26c6c', '#7ed28a', '#6c9bd2', '#ffffff'];

function pathFor(shape: Drawing['shape']): string {
  if (shape.kind === 'line') return `M ${shape.a.x} ${shape.a.y} L ${shape.b.x} ${shape.b.y}`;
  const pts = shape.points;
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  if (shape.kind === 'poly') d += ' Z';
  return d;
}

/** Freehand drawings + the draw/erase interactions for them. */
export function DrawingLayer() {
  const stage = useStage();
  const map = useGameStore((s) => s.map)!;
  const tool = useGameStore((s) => s.tool);
  const isDm = useGameStore((s) => s.isDm());
  const drawingList = useGameStore((s) => s.drawingList);
  const drawColor = useGameStore((s) => s.drawColor);
  const drawLayer = useGameStore((s) => s.drawLayer);

  const [draft, setDraft] = useState<Point[] | null>(null);
  const { width, height } = mapPixelSize(map);

  useEffect(() => setDraft(null), [tool, map.id]);

  function onPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0 || tool !== 'draw') return;
    e.stopPropagation();
    try {
      (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
    } catch {
      // capture can fail for exotic pointers; drawing still works via bubbling
    }
    const p = stage.toMap(e.clientX, e.clientY);
    setDraft([p]);
  }

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!draft) return;
    const p = stage.toMap(e.clientX, e.clientY);
    const last = draft[draft.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 3) setDraft([...draft, p]);
  }

  function onPointerUp() {
    if (draft && draft.length > 1) {
      intents.draw(map.id, isDm ? drawLayer : 'map', {
        kind: 'free', points: draft, color: drawColor, width: 3,
      });
    }
    setDraft(null);
  }

  const capturing = tool === 'draw';

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
      {drawingList.map((d) => (
        <path
          key={d.id}
          d={pathFor(d.shape)}
          fill="none"
          stroke={d.shape.color}
          strokeWidth={d.shape.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={d.layer === 'gm' ? 0.6 : 0.9}
          strokeDasharray={d.layer === 'gm' ? '8 5' : undefined}
          style={{ pointerEvents: tool === 'erase' ? 'stroke' : 'none', cursor: 'pointer' }}
          onPointerDown={(e) => {
            if (tool === 'erase') {
              e.stopPropagation();
              intents.eraseDrawing(d.id);
            }
          }}
        />
      ))}
    </svg>
  );
}
