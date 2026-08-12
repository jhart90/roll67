import { useEffect, useRef } from 'react';
import { blastAceStyle } from 'shared';
import type { AceStyle } from 'shared';
import { aceEffectMs, drawAceEffect } from './dice3d';
import type { AoeBurstState } from './aoeBurstFx';

/**
 * A blast template drawn with the dice's own Ace animation.
 *
 * A grenade going off on the map and an aced die going off in the tray are
 * the same event to look at, so rather than keep two drawings that would
 * drift apart, this runs the very same function — `drawAceEffect` — over the
 * map. Improving one now improves both by construction.
 *
 * The Ace effect is canvas 2D while the rest of the map is SVG, so this is a
 * canvas positioned over the template rather than another shape inside it.
 */

/**
 * The Ace effect is drawn relative to a DIE, and spreads to roughly this
 * multiple of the size it is handed. Dividing the template's radius by it is
 * what makes a Small Blast look small and a Large Blast fill its circle.
 */
const ACE_SPREAD = 4.2;

/** Slower than a die's flash: a template is bigger, and reads better with room to breathe. */
const MAP_SLOWDOWN = 1.6;

export function AoeBurstAce({ burst, radiusPx, style }: {
  burst: AoeBurstState; radiusPx: number; style: AceStyle;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const lifeMs = aceEffectMs(style) * MAP_SLOWDOWN;
    // The template only goes off once the projectile has visibly landed.
    const startAt = performance.now() + burst.flightMs;
    let raf = 0;

    const frame = (now: number) => {
      const phase = (now - startAt) / lifeMs;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (phase >= 0 && phase < 1) {
        ctx.save();
        drawAceEffect(ctx, style, phase, canvas.width / 2, canvas.height / 2, radiusPx / ACE_SPREAD);
        ctx.restore();
      }
      if (phase < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [burst.flightMs, radiusPx, style]);

  // Sized generously around the template: the explosion's flash and debris
  // reach well past the radius that actually deals damage, and clipping them
  // at the blast's edge would look like a circle being wiped rather than
  // something going off. The caller's foreignObject is offset to match, so
  // the canvas's own centre lands on the blast's centre.
  const side = Math.ceil(radiusPx * 3);
  return (
    <canvas
      ref={canvasRef}
      width={side}
      height={side}
      className="aoe-burst-ace"
      style={{ width: side, height: side, display: 'block', pointerEvents: 'none' }}
    />
  );
}

/** The Ace style a burst should use, if any. Narrowed here so callers don't
 *  have to know that the shared helper returns a plain string. */
export function aceStyleForBurst(burst: AoeBurstState): AceStyle | null {
  if (burst.shape !== 'sphere' && burst.shape !== 'cylinder') return null;
  return (blastAceStyle(burst.sizeHexes, burst.damageType) as AceStyle | null) ?? null;
}
