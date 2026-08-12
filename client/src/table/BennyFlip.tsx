import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/game';
import { playAceSound } from './DiceOverlay';
import {
  BENNY_FADE_MS, BENNY_FLIP_MS, BENNY_INK, BENNY_LAND_MS, buildBennySim, drawFrame,
} from './dice3d';

/**
 * The Benny coin: a Benny being spent, shown on every screen at the table.
 *
 * It is thrown with the dice's own renderer rather than an animation of its
 * own — the d2 in that set is already a coin, so a Benny gets the same arc in
 * from off screen, the same tumble decaying onto the face that landed, the
 * same bounce, shadow and landing pop the dice get. It differs only in scale,
 * in flipping end over end instead of tumbling about a random axis, and in
 * the devices struck on its two faces, which are drawn here.
 *
 * Sharing the renderer is the point: the coin obeys the same physics as
 * everything else that lands on this table, and the shared aced-die flash
 * fires as it settles, so a Benny goes off in gold for free.
 */
export function BennyFlip() {
  const flip = useGameStore((s) => s.bennyFlip);
  if (!flip) return null;
  // Keyed on the flip id: a second Benny spent while this one is still in the
  // air restarts the throw rather than resuming the first one's clock.
  return <BennyCanvas key={flip.id} name={flip.name} reason={flip.reason} face={flip.face} />;
}

function BennyCanvas({ name, reason, face }: { name: string; reason: string; face: 'benny' | 'csb' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    // The toss. One of the single-die rattles: a coin hitting the table is
    // the same kind of sound, and it keeps the throw from being silent.
    // Autoplay may be blocked before the user's first interaction — ignore.
    const audio = new Audio(`/sounds/dice_${1 + Math.floor(Math.random() * 3)}.mp3`);
    const s = useGameStore.getState();
    audio.volume = 0.6 * s.localSfxVolume * (s.clientMuted ? 0 : 1);
    audio.play().catch(() => undefined);

    const sims = buildBennySim(w, h, face, drawDevice);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0;
      drawFrame(ctx, sims, t, w, h, playAceSound);
      // Driven purely by the clock: the coin sits at rest under the words for
      // a beat after the dice renderer has stopped having anything to move.
      if (t < BENNY_FLIP_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A new flip remounts this component (key on flip id), so run-once is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The words arrive as the coin lands, not with the throw: the coin is the
  // event, the text is what it meant. CSS reads both times off the same
  // constants the throw does, so the two can't drift apart.
  const timings = {
    '--benny-land': `${BENNY_LAND_MS}ms`,
    '--benny-fade': `${BENNY_FADE_MS}ms`,
    '--benny-total': `${BENNY_FLIP_MS}ms`,
  } as React.CSSProperties;
  return (
    <div className="benny-flip" style={timings}>
      <canvas ref={canvasRef} className="benny-flip-canvas" />
      <div className="benny-flip-text">
        <div className="bf-name">{name} used a Benny</div>
        <div className="bf-reason">{reason}</div>
      </div>
    </div>
  );
}

/**
 * The device struck on a face, drawn in the die renderer's face-plane space:
 * `r` is the face's own radius there, so everything is sized off it and the
 * art foreshortens with the coin as it turns. Face 1 is the plain side, face
 * 2 the Bureau's.
 */
function drawDevice(ctx: CanvasRenderingContext2D, value: number, r: number): void {
  if (value === 1) drawBennyDevice(ctx, r);
  else drawCsbDevice(ctx, r);
}

/** The plain side: a struck "B", with the lit upper lip a relief catches. */
function drawBennyDevice(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = BENNY_INK;
  ctx.font = `700 ${Math.round(r * 1.15)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('B', 0, r * 0.04);
  ctx.fillStyle = 'rgba(255, 250, 220, 0.55)';
  ctx.fillText('B', -r * 0.02, 0);
}

/**
 * The Bureau side: the badge reduced to what survives being stamped into a
 * coin at this size — a star behind, the hourglass, and the banner. A faithful
 * copy of the full crest would be mud at a hundred pixels across.
 */
function drawCsbDevice(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = 'rgba(92, 67, 11, 0.55)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r * 0.82 : r * 0.36;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const fn = i === 0 ? 'moveTo' : 'lineTo';
    ctx[fn](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = BENNY_INK;
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  const hw = r * 0.3;
  const hh = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh); ctx.lineTo(hw, -hh);
  ctx.lineTo(-hw * 0.12, 0); ctx.lineTo(hw, hh);
  ctx.lineTo(-hw, hh); ctx.lineTo(hw * 0.12, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = BENNY_INK;
  ctx.font = `700 ${Math.round(r * 0.34)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CSB', 0, r * 0.66);
}
