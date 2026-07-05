import { useEffect, useRef, useState } from 'react';
import type { DieRoll } from 'shared';
import { useGameStore } from '../store/game';
import { buildSims, drawFrame, simsSettleTime } from './dice3d';

function DiceCanvas({ dice, byName, total, expression, color, textColor }: {
  dice: DieRoll[]; byName: string; total: number; expression: string; color: string | null; textColor: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sims = buildSims(dice, w, h, color, textColor);
    const settleAt = simsSettleTime(sims);
    const t0 = performance.now();
    let raf = 0;
    let done = false;
    const tick = (now: number) => {
      const t = now - t0;
      const moving = drawFrame(ctx, sims, t, w, h);
      if (t >= settleAt && !done) { done = true; setSettled(true); }
      if (moving) raf = requestAnimationFrame(tick);
      else drawFrame(ctx, sims, settleAt + 401, w, h); // final resting frame
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A new roll remounts this component (key on anim id), so run-once is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dice-overlay">
      <canvas ref={canvasRef} className="dice3d-canvas" />
      <div className="dice-roller-name">
        {byName} rolls {expression}{settled ? <span className="dice-total"> = {total}</span> : '…'}
      </div>
    </div>
  );
}

/** Full-screen (non-interactive) 3D dice for the latest roll in chat. */
export function DiceOverlay() {
  const anim = useGameStore((s) => s.diceAnim);
  const members = useGameStore((s) => s.members);
  if (!anim) return null;
  const member = anim.byUserId ? members.find((m) => m.userId === anim.byUserId) : undefined;
  const color = member?.diceColor ?? null;
  const textColor = member?.diceTextColor ?? null;
  return (
    <DiceCanvas
      key={anim.id}
      dice={anim.dice}
      byName={anim.byName}
      total={anim.total}
      expression={anim.expression}
      color={color}
      textColor={textColor}
    />
  );
}
