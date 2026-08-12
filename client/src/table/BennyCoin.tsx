import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/game';

/**
 * The Benny coin: flipped in from off screen, tumbling, landing on a random
 * face, then bursting into metallic dust as the reason it was spent appears.
 *
 * Canvas rather than CSS because the point of the thing is the METAL — a
 * highlight that sweeps across the face as it turns, an edge that catches the
 * light at the rim, and a specular flash at the moments the coin is flat-on
 * to the light. None of that survives being approximated with a gradient that
 * rotates with the element.
 *
 * The light sits just off overhead, so the brightest band is always slightly
 * above the coin's centre and the underside stays in shadow.
 */

/** Coin radius as a fraction of the smaller screen dimension. */
const RADIUS_FRAC = 0.13;
/** Where the light is, relative to the coin's centre: up and a little left. */
const LIGHT = { x: -0.25, y: -0.85 };

const FLY_MS = 900;     // arcing in from off screen, tumbling
const SETTLE_MS = 700;  // sitting still so the face can be read
const POOF_MS = 1100;   // dust, and the text
const TOTAL_MS = FLY_MS + SETTLE_MS + POOF_MS;

const GOLD_LIT = '#fff3c4';
const GOLD = '#e8b73a';
const GOLD_DEEP = '#8a6512';
const GOLD_EDGE = '#5c430b';

interface Mote { a: number; speed: number; size: number; drift: number; spin: number }

export function BennyCoin() {
  const flip = useGameStore((s) => s.bennyFlip);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!flip) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    const R = Math.min(w, h) * RADIUS_FRAC;
    const restX = w / 2;
    const restY = h * 0.42;
    // Deterministic per-flip dust, so it does not reshuffle every frame.
    const motes: Mote[] = Array.from({ length: 90 }, (_, i) => ({
      a: (i / 90) * Math.PI * 2 + (i % 7) * 0.31,
      speed: 0.7 + ((i * 13) % 9) / 9,
      size: 1 + ((i * 5) % 4),
      drift: -0.4 + ((i * 3) % 7) / 7,
      spin: ((i * 11) % 5) - 2,
    }));

    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);

      if (t < FLY_MS + SETTLE_MS) {
        const flying = Math.min(1, t / FLY_MS);
        // Thrown in from the left, arcing up and settling — eased so it slows
        // into place rather than stopping dead.
        const ease = 1 - Math.pow(1 - flying, 3);
        const x = -R * 2 + (restX + R * 2) * ease;
        const arc = Math.sin(flying * Math.PI) * h * 0.18;
        const y = restY - arc * (1 - flying * 0.35);
        // Tumbling: many turns on the way in, easing to a stop. The landing
        // face is the server's, so every screen sees the same side.
        const turns = 7.5 * ease;
        const spin = flying < 1 ? turns * Math.PI * 2 : Math.round(turns) * Math.PI * 2;
        const faceUp = flip.face === 'csb' ? Math.PI : 0;
        drawCoin(ctx, x, y, R, spin + faceUp, flip.face);
        raf = requestAnimationFrame(frame);
        return;
      }

      const poof = Math.min(1, (t - FLY_MS - SETTLE_MS) / POOF_MS);
      drawDust(ctx, restX, restY, R, poof, motes);
      if (t < TOTAL_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [flip]);

  if (!flip) return null;
  // The words arrive with the dust, not with the coin: the coin is the event,
  // the text is what it meant.
  return (
    <div className="benny-flip" key={flip.id}>
      <canvas ref={canvasRef} className="benny-flip-canvas" style={{ width: '100%', height: '100%' }} />
      <div className="benny-flip-text">
        <div className="bf-name">{flip.name} used a Benny</div>
        <div className="bf-reason">{flip.reason}</div>
      </div>
    </div>
  );
}

/** One face of the coin, plus its thickness, lit from just off overhead. */
function drawCoin(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, spin: number, face: 'benny' | 'csb',
): void {
  // A coin seen edge-on is a line: squashing the width by cos(spin) is the
  // whole illusion of it turning. Which face you can see flips with the sign.
  const squash = Math.cos(spin);
  const showing: 'benny' | 'csb' = squash >= 0 ? 'benny' : 'csb';
  const halfW = Math.abs(squash) * R;
  const thickness = R * 0.13;

  ctx.save();
  ctx.translate(cx, cy);

  // The milled edge, drawn first so the face sits on top of it.
  ctx.fillStyle = GOLD_EDGE;
  ctx.beginPath();
  ctx.ellipse(0, thickness / 2, Math.max(halfW, thickness * 0.5), R, 0, 0, Math.PI * 2);
  ctx.fill();

  // The face. The gradient runs along the LIGHT, not along the coin, so the
  // highlight sweeps across as it turns instead of riding around with it.
  const g = ctx.createLinearGradient(LIGHT.x * halfW, LIGHT.y * R, -LIGHT.x * halfW, -LIGHT.y * R);
  g.addColorStop(0, GOLD_LIT);
  g.addColorStop(0.35, GOLD);
  g.addColorStop(0.75, GOLD_DEEP);
  g.addColorStop(1, GOLD_EDGE);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(halfW, 0.5), R, 0, 0, Math.PI * 2);
  ctx.fill();

  // Specular flash: brightest when the coin is flat-on to the light, gone
  // when it is edge-on. This is what makes it read as polished metal.
  const flat = Math.abs(squash);
  if (flat > 0.15) {
    const s = ctx.createRadialGradient(
      LIGHT.x * halfW * 0.6, LIGHT.y * R * 0.5, 0,
      LIGHT.x * halfW * 0.6, LIGHT.y * R * 0.5, R * 0.9,
    );
    s.addColorStop(0, `rgba(255, 255, 245, ${0.75 * Math.pow(flat, 3)})`);
    s.addColorStop(1, 'rgba(255, 255, 245, 0)');
    ctx.fillStyle = s;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(halfW, 0.5), R, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rim, then the device — both squashed with the face so they turn with it.
  ctx.strokeStyle = GOLD_EDGE;
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(halfW - ctx.lineWidth, 0.5), R - ctx.lineWidth, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (flat > 0.25) {
    ctx.save();
    ctx.scale(Math.max(Math.abs(squash), 0.001), 1);
    ctx.globalAlpha = Math.min(1, (flat - 0.25) / 0.35);
    if (showing === 'benny') drawBennyDevice(ctx, R);
    else drawCsbDevice(ctx, R);
    ctx.restore();
  }
  ctx.restore();
  void face;
}

/** The plain side: a struck "B". */
function drawBennyDevice(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.fillStyle = GOLD_EDGE;
  ctx.font = `700 ${Math.round(R * 1.15)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('B', 0, R * 0.04);
  // A struck letter has a lit upper lip where the light catches the relief.
  ctx.fillStyle = 'rgba(255, 250, 220, 0.55)';
  ctx.fillText('B', -R * 0.02, R * 0.0);
}

/**
 * The Bureau side: the badge reduced to what survives being stamped into a
 * coin at this size — the ring of text, a star behind, and the hourglass.
 * A faithful copy of the full crest would be mud at 100px across.
 */
function drawCsbDevice(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.save();
  // Star behind.
  ctx.fillStyle = 'rgba(92, 67, 11, 0.55)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R * 0.82 : R * 0.36;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const fn = i === 0 ? 'moveTo' : 'lineTo';
    ctx[fn](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();

  // Hourglass.
  ctx.strokeStyle = GOLD_EDGE;
  ctx.lineWidth = Math.max(1.5, R * 0.07);
  const hw = R * 0.3;
  const hh = R * 0.42;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh); ctx.lineTo(hw, -hh);
  ctx.lineTo(-hw * 0.12, 0); ctx.lineTo(hw, hh);
  ctx.lineTo(-hw, hh); ctx.lineTo(hw * 0.12, 0);
  ctx.closePath();
  ctx.stroke();

  // "CSB" across the middle, the way the badge's banner reads.
  ctx.fillStyle = GOLD_EDGE;
  ctx.font = `700 ${Math.round(R * 0.34)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CSB', 0, R * 0.66);
  ctx.restore();
}

/** The coin coming apart into metallic dust that blows off screen. */
function drawDust(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, phase: number, motes: Mote[],
): void {
  // The coin fades as the dust leaves it, so it comes apart rather than
  // vanishing and being replaced.
  const left = Math.max(0, 1 - phase * 2.2);
  if (left > 0) {
    ctx.globalAlpha = left;
    drawCoin(ctx, cx, cy, R * (1 - phase * 0.15), 0, 'benny');
    ctx.globalAlpha = 1;
  }
  for (const m of motes) {
    const travel = phase * R * 9 * m.speed;
    const x = cx + Math.cos(m.a) * travel + travel * 0.55;   // blown to the right
    const y = cy + Math.sin(m.a) * travel * 0.55 - travel * 0.18 * m.drift;
    const alpha = Math.max(0, 1 - phase * 1.25);
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    // Each mote is a chip of metal, so it glints rather than glowing.
    ctx.fillStyle = (m.spin + 2) % 3 === 0 ? GOLD_LIT : GOLD;
    ctx.fillRect(x, y, m.size * (1 - phase * 0.4), m.size * 0.6 * (1 - phase * 0.4));
  }
  ctx.globalAlpha = 1;
}
