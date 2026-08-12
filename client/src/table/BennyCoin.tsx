import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/game';

/**
 * The Benny coin: tossed up from below the screen, turning lazily, bouncing
 * twice, rolling on its edge and slapping flat on a random face — then coming
 * apart into gold confetti as the reason it was spent appears.
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

/**
 * The flip, in five acts. Slow on purpose: a Benny is a real cost and the
 * table should feel it land, not catch it out of the corner of an eye.
 */
const FLY_MS = 1700;     // tossed up from below, turning lazily
const BOUNCE_MS = 950;   // two diminishing bounces on the flat
const ROLL_MS = 1300;    // up on its edge, rolling, then falling flat
const SETTLE_MS = 850;   // still, so the face can actually be read
const POOF_MS = 1700;    // gold confetti, and the words
const LAND_MS = FLY_MS + BOUNCE_MS + ROLL_MS;
const REST_MS = LAND_MS + SETTLE_MS;
const TOTAL_MS = REST_MS + POOF_MS;

/** How many turns the coin makes on the way up and over. Low: it should read
 *  as a heavy coin turning, not a spinning token. */
const FLY_TURNS = 3.25;

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
    const CONFETTI = 220;
    const motes: Mote[] = Array.from({ length: CONFETTI }, (_, i) => ({
      a: (i / CONFETTI) * Math.PI * 2 + (i % 11) * 0.29,
      speed: 0.55 + ((i * 13) % 11) / 11,
      size: 0.7 + ((i * 5) % 6) / 4,
      drift: ((i * 3) % 7) / 7,
      spin: ((i * 17) % 6) - 2,
    }));

    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);

      const faceUp = flip.face === 'csb' ? Math.PI : 0;

      if (t < FLY_MS) {
        // Tossed up from below the screen: a high, slow arc that peaks above
        // where it will land, so it falls INTO place rather than sliding in.
        const k = t / FLY_MS;
        // Straight run from below the screen up to where it lands, plus a
        // hop over the top of that line. Written this way so the ends are
        // exact by construction: it starts off screen and finishes ON the
        // resting spot, which the bounce that follows depends on.
        const startY = h + R;
        const ease = 1 - Math.pow(1 - k, 2);   // decelerating, as gravity does
        const y = startY + (restY - startY) * ease - Math.sin(k * Math.PI) * R * 2.1;
        const x = restX - R * 1.6 + R * 1.6 * ease;
        // Turning lazily, easing as it rises — a heavy coin, not a top.
        const spin = FLY_TURNS * Math.PI * 2 * (1 - Math.pow(1 - k, 2.2));
        drawCoin(ctx, x, y, R, spin + faceUp);
        raf = requestAnimationFrame(frame);
        return;
      }

      if (t < FLY_MS + BOUNCE_MS) {
        // Two diminishing bounces. Each one is a half-turn, so it keeps
        // showing alternating faces as it settles.
        const k = (t - FLY_MS) / BOUNCE_MS;
        const bounces = 2;
        const seg = Math.min(bounces - 0.001, k * bounces);
        const within = seg % 1;
        const damp = Math.pow(0.42, Math.floor(seg));
        const hop = Math.sin(within * Math.PI) * R * 1.5 * damp;
        const spin = FLY_TURNS * Math.PI * 2 + seg * Math.PI * 0.5;
        drawCoin(ctx, restX + R * 0.25 * k, restY - hop, R, spin + faceUp);
        raf = requestAnimationFrame(frame);
        return;
      }

      if (t < LAND_MS) {
        // Up on its edge and rolling — a small circle, tightening, the way a
        // spun coin does before it slaps flat. `lean` tips it toward the
        // viewer over the last stretch so it falls onto the winning face.
        const k = Math.min(1, (t - FLY_MS - BOUNCE_MS) / ROLL_MS);
        const fall = Math.max(0, (k - 0.62) / 0.38);
        const radius = R * 0.85 * (1 - k) * (1 - fall);
        const around = k * Math.PI * 3.1;
        const x = restX + R * 0.25 + Math.cos(around) * radius;
        const y = restY + Math.sin(around) * radius * 0.35;
        // Edge-on is spin = π/2; easing back to the face as it drops flat.
        const lean = Math.PI / 2 * (1 - Math.pow(fall, 1.7));
        drawCoin(ctx, x, y, R, faceUp + lean);
        raf = requestAnimationFrame(frame);
        return;
      }

      if (t < REST_MS) {
        drawCoin(ctx, restX + R * 0.25, restY, R, faceUp);
        raf = requestAnimationFrame(frame);
        return;
      }

      const poof = Math.min(1, (t - REST_MS) / POOF_MS);
      drawDust(ctx, restX + R * 0.25, restY, R, poof, motes);
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
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, spin: number,
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

/**
 * The coin coming apart into gold confetti.
 *
 * Same motion as the Confetti Ace — fired outward, then tumbling about its
 * own axis and fluttering down and off the bottom — but in the coin's own
 * metals rather than party colours, and a great deal more of it: this is a
 * whole coin coming apart, not a die announcing itself.
 */
function drawDust(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, phase: number, motes: Mote[],
): void {
  // The coin thins out as the confetti leaves it, so it comes APART rather
  // than vanishing and being replaced by something else.
  const left = Math.max(0, 1 - phase * 2.4);
  if (left > 0) {
    ctx.globalAlpha = left;
    drawCoin(ctx, cx, cy, R * (1 - phase * 0.12), 0);
    ctx.globalAlpha = 1;
  }

  const burst = 1 - Math.pow(1 - Math.min(1, phase / 0.16), 3);
  const fallT = Math.max(0, (phase - 0.1) / 0.9);
  // Starts from rest and settles to a drift, the way a light flake reaches
  // terminal velocity within a few feet.
  const fall = (fallT * fallT * 0.34 + fallT * 0.66) * R * 16;

  for (const m of motes) {
    const reach = R * (0.5 + m.speed * 1.9);
    const sway = Math.sin(phase * (2.6 + m.speed * 2.4) * Math.PI + m.a) * R * (0.18 + m.drift * 0.2);
    const x = cx + Math.cos(m.a) * reach * burst + sway + Math.cos(m.a) * fall * 0.1;
    const y = cy + Math.sin(m.a) * reach * burst * 0.8 + fall;

    // Tumbling: cos() of the spin squashes each flake to nothing twice a
    // turn, which is what makes it read as a sheet turning edge-on rather
    // than a brick rotating.
    const turn = phase * (4.5 + m.spin * 1.4) * Math.PI + m.a;
    const flat = Math.cos(turn);
    const wf = R * 0.075 * m.size;
    const hf = R * 0.05 * m.size;

    ctx.globalAlpha = Math.min(1, (1 - phase) * 3.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(turn * 0.5) * 0.9 + m.a * 0.15);
    // A flake catches the light on one side of its turn and is in shadow on
    // the other — the same trick the coin's own face uses, in miniature.
    ctx.fillStyle = flat > 0.35 ? GOLD_LIT : flat > -0.2 ? GOLD : GOLD_DEEP;
    ctx.fillRect(-wf / 2, (-hf / 2) * flat, wf, Math.max(0.6, hf * Math.abs(flat)));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
