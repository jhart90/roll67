import type { CSSProperties } from 'react';
import type { CardBackSpec } from 'shared';
import { normalizeCardBack } from 'shared';

/**
 * What a card back looks like.
 *
 * The STRUCTURE — which pattern, which border, which colors — lives in shared
 * and rides the wire with every deal, validated by the server. This file is
 * the paint: each GEOMETRY is a function of the spec's three colors, each
 * border a function of one, so the same spec renders identically on every
 * screen at the table.
 *
 * The catalogue asks for a lot of paint. The classics share seven woven
 * geometries; every themed design after them carries a painter of its own,
 * because "not one is like another" is a promise about SHAPE — a wildfire
 * and a ring of fire are not one flame in two palettes. Positions are given
 * in percentages so a design centres itself at any size (the picker minis
 * are a third of a card); feature sizes stay in pixels, which on a mini
 * reads as a bolder crop of the same design — same jacket, tighter framing.
 *
 * Every painter takes the whole palette (p ground, s mid, a highlight) and
 * every layer list ends on a ground color, so a design can be repainted into
 * any colors the player likes and still be that design.
 */
type C3 = { p: string; s: string; a: string };

/** "#rrggbb" + alpha → rgba(), so patterns can wash without a color table. */
function hexA(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
const W = (x: number) => `rgba(255, 255, 255, ${x})`;
const K = (x: number) => `rgba(0, 0, 0, ${x})`;

/* Small vocabulary the picture-painters are written in. Everything returns
   one background layer; painters join layers top-first. */
const dot = (x: string, y: string, r: number, c: string) =>
  `radial-gradient(circle at ${x} ${y}, ${c} 0 ${r}px, transparent ${r + 0.6}px) no-repeat`;
const orb = (x: string, y: string, rx: number, ry: number, c: string) =>
  `radial-gradient(${rx}px ${ry}px at ${x} ${y}, ${c} 0 62%, transparent 68%) no-repeat`;
const ring = (x: string, y: string, r0: number, r1: number, c: string) =>
  `radial-gradient(circle at ${x} ${y}, transparent 0 ${r0}px, ${c} ${r0}px ${r1}px, transparent ${r1 + 0.6}px) no-repeat`;
const eRing = (x: string, y: string, rx: number, ry: number, c: string, t0 = 72, t1 = 88) =>
  `radial-gradient(${rx}px ${ry}px at ${x} ${y}, transparent 0 ${t0}%, ${c} ${t0}% ${t1}%, transparent ${t1 + 2}%) no-repeat`;
/** A solid box, centred horizontally at `x`. */
const bar = (x: string, y: string, w: number, h: number, c: string) =>
  `linear-gradient(${c}, ${c}) ${x} ${y} / ${w}px ${h}px no-repeat`;
/** A triangle hanging point-up from its apex (opening downward). */
const wedge = (x: string, y: string, spanDeg: number, c: string) =>
  `conic-gradient(from ${180 - spanDeg / 2}deg at ${x} ${y}, ${c} 0 ${spanDeg}deg, transparent ${spanDeg}deg) no-repeat`;
/** Everything OUTSIDE radius r painted `c` — the disc-mask for planet bands. */
const outside = (x: string, y: string, r: number, c: string) =>
  `radial-gradient(circle at ${x} ${y}, transparent 0 ${r}px, ${c} ${r + 1}px 100%) no-repeat`;

const PATTERN_CSS: Record<string, (c: C3) => string> = {
  /* ---- The classic seven weaves (unchanged) ---- */
  stripes: ({ p, s, a }) =>
    `repeating-linear-gradient(45deg, transparent 0 20px, ${hexA(a, 0.85)} 20px 22px, transparent 22px 24px),`
    + ` repeating-linear-gradient(45deg, ${p} 0 6px, ${s} 6px 12px), ${p}`,
  plaid: ({ p, s, a }) =>
    `repeating-linear-gradient(0deg, transparent 0 16px, ${hexA(a, 0.8)} 16px 17px, transparent 17px 26px),`
    + ` repeating-linear-gradient(90deg, transparent 0 16px, ${hexA(a, 0.8)} 16px 17px, transparent 17px 26px),`
    + ` repeating-linear-gradient(0deg, transparent 0 4px, ${hexA(s, 0.7)} 4px 12px, transparent 12px 26px),`
    + ` repeating-linear-gradient(90deg, transparent 0 4px, ${hexA(s, 0.7)} 4px 12px, transparent 12px 26px), ${p}`,
  dots: ({ p, s, a }) =>
    `radial-gradient(circle, ${hexA(a, 0.75)} 0 1.5px, transparent 1.5px 100%) 9px 9px / 18px 18px,`
    + ` radial-gradient(circle, ${hexA(s, 0.85)} 0 3.5px, transparent 3.5px 100%) 0 0 / 18px 18px, ${p}`,
  medallion: ({ p, s, a }) =>
    `radial-gradient(circle at 50% 44%, ${a} 0 7px, transparent 7px 100%),`
    + ` radial-gradient(circle at 50% 44%, transparent 0 12px, ${hexA(a, 0.9)} 12px 14px, transparent 14px 24px, ${hexA(a, 0.55)} 24px 25px, transparent 25px 100%),`
    + ` repeating-conic-gradient(from 0deg at 50% 44%, ${hexA(a, 0.28)} 0deg 6deg, transparent 6deg 30deg),`
    + ` repeating-radial-gradient(circle at 50% 44%, ${s} 0 5px, ${p} 5px 14px), ${p}`,
  rays: ({ p, s, a }) =>
    `radial-gradient(circle at 50% 42%, transparent 0 24px, ${hexA(a, 0.9)} 24px 26px, transparent 26px 46px, ${hexA(a, 0.45)} 46px 47px, transparent 47px 100%),`
    + ` radial-gradient(circle at 50% 42%, ${a} 0 5px, transparent 5px 100%),`
    + ` repeating-conic-gradient(from 8deg at 50% 42%, ${p} 0deg 15deg, ${s} 15deg 30deg), ${p}`,
  harlequin: ({ p, s, a }) =>
    `repeating-linear-gradient(45deg, transparent 0 16px, ${hexA(a, 0.7)} 16px 17px, transparent 17px 18px),`
    + ` repeating-conic-gradient(from 45deg, ${p} 0deg 90deg, ${s} 90deg 180deg) 0 0 / 18px 18px, ${p}`,
  sweep: ({ p, s, a }) =>
    `linear-gradient(205deg, ${W(0.14)} 0%, transparent 38%),`
    + ` linear-gradient(160deg, ${p} 0%, ${s} 45%, ${a} 100%)`,

  /* ---- Elements ---- */
  // Flame tongues licking up from the bottom edge, hottest at the tips.
  'elem-fire': ({ p, s, a }) => [
    `radial-gradient(42% 58% at 22% 106%, ${a} 0 26%, ${hexA(a, 0)} 58%) no-repeat`,
    `radial-gradient(46% 66% at 50% 110%, ${hexA(a, 0.9)} 0 22%, ${hexA(a, 0)} 56%) no-repeat`,
    `radial-gradient(42% 60% at 78% 106%, ${a} 0 24%, ${hexA(a, 0)} 58%) no-repeat`,
    `radial-gradient(72% 84% at 34% 114%, ${s} 0 34%, ${hexA(s, 0)} 70%) no-repeat`,
    `radial-gradient(76% 90% at 68% 116%, ${s} 0 38%, ${hexA(s, 0)} 72%) no-repeat`,
    `linear-gradient(${p} 30%, ${hexA(s, 0.35)} 78%, ${hexA(s, 0.55)} 100%)`,
    p,
  ].join(', '),
  // Wave crests in offset ranks, fading with depth.
  'elem-water': ({ p, s, a }) => [
    `radial-gradient(circle at 8px -5px, transparent 0 10px, ${hexA(a, 0.85)} 10px 12px, transparent 12px) 0 12px / 32px 34px`,
    `radial-gradient(circle at 8px -5px, transparent 0 10px, ${hexA(a, 0.45)} 10px 12px, transparent 12px) 16px 29px / 32px 34px`,
    `linear-gradient(${hexA(s, 0.15)} 0%, ${hexA(s, 0.65)} 100%)`,
    p,
  ].join(', '),
  // Sediment strata, faint cracks, a few buried stones.
  'elem-earth': ({ p, s, a }) => [
    orb('30%', '36%', 7, 4, hexA(a, 0.9)),
    orb('72%', '62%', 5, 3, hexA(a, 0.75)),
    orb('54%', '86%', 6, 3.5, hexA(a, 0.6)),
    `repeating-linear-gradient(94deg, transparent 0 30px, ${K(0.28)} 30px 31px, transparent 31px 60px)`,
    `repeating-linear-gradient(2deg, ${s} 0 9px, ${hexA(s, 0.55)} 9px 13px, ${p} 13px 22px, ${hexA(p, 0.7)} 22px 30px)`,
    p,
  ].join(', '),
  // Three gusts fanning across an airy sky.
  'elem-wind': ({ p, s, a }) => [
    `conic-gradient(from 210deg at 30% 24%, transparent 0 70deg, ${hexA(a, 0.75)} 100deg, transparent 132deg) no-repeat`,
    `conic-gradient(from 30deg at 72% 54%, transparent 0 70deg, ${hexA(a, 0.55)} 100deg, transparent 132deg) no-repeat`,
    `conic-gradient(from 120deg at 38% 82%, transparent 0 70deg, ${hexA(s, 0.8)} 100deg, transparent 132deg) no-repeat`,
    dot('30%', '24%', 3, hexA(a, 0.9)),
    `linear-gradient(200deg, ${hexA(s, 0.55)} 0%, ${p} 70%)`,
    p,
  ].join(', '),

  /* ---- Seasons ---- */
  // Blossom rings drifting over leaf green.
  'sea-spring': ({ p, s, a }) => [
    `radial-gradient(circle at 17px 19px, ${a} 0 2.5px, transparent 3px 6.5px, ${hexA(s, 0.9)} 7px 10.5px, transparent 11px) 0 0 / 34px 38px`,
    `radial-gradient(circle at 8px 10px, ${hexA(a, 0.9)} 0 1.6px, transparent 2px 4.5px, ${hexA(s, 0.7)} 5px 7.5px, transparent 8px) 17px 19px / 34px 38px`,
    `linear-gradient(170deg, ${hexA(a, 0.18)} 0%, transparent 45%)`,
    `linear-gradient(${p} 0%, ${hexA(s, 0.25)} 130%)`,
    p,
  ].join(', '),
  // A sun on the horizon over ranked wheat.
  'sea-summer': ({ p, s, a }) => [
    dot('50%', '66%', 14, a),
    ring('50%', '66%', 14, 18, hexA(a, 0.4)),
    `repeating-linear-gradient(90deg, ${K(0.18)} 0 2px, transparent 2px 14px) 0 100% / 100% 30% no-repeat`,
    `repeating-linear-gradient(0deg, ${s} 0 5px, ${hexA(s, 0.7)} 5px 11px) 0 100% / 100% 30% no-repeat`,
    `linear-gradient(${p} 0%, ${hexA(a, 0.35)} 66%, ${hexA(a, 0.15)} 70%)`,
    p,
  ].join(', '),
  // Two-tone leaves drifting on a warm wind.
  'sea-autumn': ({ p, s, a }) => [
    `radial-gradient(7px 4px at 9px 8px, ${a} 0 60%, transparent 66%) 0 0 / 34px 42px`,
    `radial-gradient(6px 3.5px at 24px 26px, ${hexA(a, 0.8)} 0 60%, transparent 66%) 0 0 / 34px 42px`,
    `radial-gradient(7px 4px at 16px 36px, ${hexA(s, 0.9)} 0 60%, transparent 66%) 0 0 / 30px 46px`,
    `linear-gradient(160deg, ${hexA(s, 0.45)} 0%, transparent 55%)`,
    `linear-gradient(${p} 20%, ${hexA(s, 0.35)} 100%)`,
    p,
  ].join(', '),
  // Falling snow of three sizes, frost creeping in at the corners.
  'sea-winter': ({ p, s, a }) => [
    `radial-gradient(circle at 8px 10px, ${a} 0 2.2px, transparent 2.7px) 0 0 / 44px 40px`,
    `radial-gradient(circle at 30px 26px, ${hexA(a, 0.85)} 0 1.5px, transparent 2px) 0 0 / 44px 40px`,
    `radial-gradient(circle at 18px 38px, ${hexA(a, 0.65)} 0 1.1px, transparent 1.6px) 0 0 / 36px 44px`,
    `radial-gradient(circle at 0% 0%, ${hexA(a, 0.4)} 0 24px, transparent 60px) no-repeat`,
    `radial-gradient(circle at 100% 100%, ${hexA(s, 0.45)} 0 30px, transparent 72px) no-repeat`,
    `linear-gradient(${p}, ${hexA(s, 0.4)})`,
    p,
  ].join(', '),

  /* ---- Sun & moon ---- */
  // A crowned sun: disc, then rays that live only in the halo band.
  sun: ({ p, s, a }) => [
    dot('50%', '46%', 13, a),
    ring('50%', '46%', 13, 15, hexA(s, 0.9)),
    `radial-gradient(circle at 50% 46%, transparent 0 15px, ${p} 15px 20px, transparent 20px) no-repeat`,
    `radial-gradient(circle at 50% 46%, transparent 0 40px, ${hexA(p, 0.9)} 46px 100%) no-repeat`,
    `repeating-conic-gradient(from 0deg at 50% 46%, ${hexA(a, 0.9)} 0deg 5deg, transparent 5deg 15deg)`,
    `radial-gradient(circle at 50% 46%, ${hexA(s, 0.5)} 0 30px, transparent 54px) no-repeat`,
    p,
  ].join(', '),
  // A crescent over a scatter of stars.
  moon: ({ p, s, a }) => [
    dot('57%', '30%', 16, p),
    dot('50%', '34%', 18, a),
    ring('50%', '34%', 18, 21, hexA(a, 0.3)),
    dot('22%', '16%', 1.4, a),
    dot('80%', '54%', 1.2, hexA(a, 0.9)),
    dot('30%', '72%', 1.3, hexA(a, 0.8)),
    dot('66%', '86%', 1, hexA(a, 0.7)),
    dot('12%', '46%', 1.1, hexA(a, 0.75)),
    `linear-gradient(${p} 30%, ${s} 140%)`,
    p,
  ].join(', '),

  /* ---- Biomes ---- */
  // Two ranks of pines under a falling mist.
  'bio-forest': ({ p, s, a }) => [
    `conic-gradient(from 154deg at 50% 12%, ${p} 0 52deg, transparent 52deg) 9px 100% / 36px 62px repeat-x`,
    `conic-gradient(from 150deg at 50% 10%, ${hexA(s, 0.85)} 0 60deg, transparent 60deg) 0 122% / 28px 56px repeat-x`,
    `linear-gradient(${hexA(a, 0.8)} 0%, ${hexA(a, 0.2)} 40%, transparent 66%)`,
    `linear-gradient(${s} 0%, ${p} 100%)`,
    p,
  ].join(', '),
  // Dune crests under a white-hot sky.
  'bio-desert': ({ p, s, a }) => [
    `radial-gradient(90% 60% at 18% 116%, ${s} 0 55%, transparent 56%) no-repeat`,
    `radial-gradient(110% 68% at 92% 126%, ${hexA(p, 0.95)} 0 52%, transparent 53%) no-repeat`,
    `radial-gradient(150% 80% at 50% 148%, ${p} 0 55%, transparent 56%) no-repeat`,
    dot('74%', '20%', 8, W(0.85)),
    ring('74%', '20%', 8, 11, W(0.3)),
    `linear-gradient(${a} 0%, ${hexA(s, 0.5)} 90%)`,
    a,
  ].join(', '),
  // Broad leaves crowding in from the edges, flowers in the gaps.
  'bio-jungle': ({ p, s, a }) => [
    `radial-gradient(46px 60px at 0% 16%, ${hexA(s, 0.95)} 0 60%, transparent 62%) no-repeat`,
    `radial-gradient(52px 66px at 104% 34%, ${hexA(s, 0.8)} 0 60%, transparent 62%) no-repeat`,
    `radial-gradient(56px 70px at -6% 66%, ${hexA(s, 0.6)} 0 60%, transparent 62%) no-repeat`,
    `radial-gradient(60px 74px at 108% 90%, ${hexA(s, 0.45)} 0 60%, transparent 62%) no-repeat`,
    dot('34%', '44%', 3, a),
    dot('62%', '12%', 2.5, hexA(a, 0.85)),
    dot('70%', '64%', 2.6, hexA(a, 0.8)),
    `linear-gradient(160deg, ${hexA(p, 0.4)}, transparent 60%)`,
    p,
  ].join(', '),
  // Moss curtains over still water, lily pads, one rising bubble.
  'bio-swamp': ({ p, s, a }) => [
    orb('30%', '74%', 8, 2.5, hexA(a, 0.9)),
    orb('64%', '84%', 6.5, 2, hexA(a, 0.75)),
    orb('46%', '92%', 5, 1.8, hexA(a, 0.6)),
    dot('78%', '62%', 1.6, hexA(a, 0.5)),
    `repeating-linear-gradient(90deg, ${hexA(s, 0.8)} 0 3px, ${hexA(s, 0.3)} 3px 5px, transparent 5px 11px) 0 0 / 100% 26% no-repeat`,
    `repeating-linear-gradient(90deg, transparent 0 5px, ${K(0.45)} 5px 8px, transparent 8px 17px) 0 0 / 100% 15% no-repeat`,
    `linear-gradient(${s} 0%, ${p} 45%)`,
    p,
  ].join(', '),
  // A pale sun over snowfields and one ridge of pressure ice.
  'bio-tundra': ({ p, s, a }) => [
    `repeating-linear-gradient(45deg, ${hexA(s, 0.9)} 0 7px, transparent 7px 14px) 0 56% / 100% 9px no-repeat`,
    `repeating-linear-gradient(-45deg, ${hexA(s, 0.9)} 0 7px, transparent 7px 14px) 7px 63% / 100% 9px no-repeat`,
    dot('26%', '28%', 9, hexA(a, 0.8)),
    ring('26%', '28%', 9, 13, hexA(a, 0.3)),
    dot('70%', '78%', 1.4, hexA(s, 0.6)),
    dot('40%', '88%', 1.2, hexA(s, 0.5)),
    `linear-gradient(${hexA(s, 0.55)} 0%, ${p} 46%)`,
    p,
  ].join(', '),
  // Two peaks, their windward flanks lit with snow.
  'bio-mountain': ({ p, s, a }) => [
    `conic-gradient(from 158deg at 70% 42%, ${K(0.3)} 0 50deg, transparent 50deg) no-repeat`,
    `conic-gradient(from 152deg at 70% 42%, ${s} 0 56deg, transparent 56deg) no-repeat`,
    `conic-gradient(from 148deg at 32% 30%, ${s} 0 58deg, transparent 58deg) no-repeat`,
    `conic-gradient(from 144deg at 32% 30%, ${a} 0 7deg, transparent 7deg) no-repeat`,
    dot('80%', '14%', 1.3, hexA(a, 0.8)),
    dot('14%', '10%', 1.1, hexA(a, 0.7)),
    `linear-gradient(${p} 0%, ${hexA(s, 0.4)} 100%)`,
    p,
  ].join(', '),
  // Rolling grass under big sky, grain heads in the foreground.
  'bio-plains': ({ p, s, a }) => [
    orb('30%', '20%', 12, 4, hexA(a, 0.9)),
    orb('39%', '16%', 8, 3, hexA(a, 0.8)),
    orb('74%', '30%', 10, 3.5, hexA(a, 0.75)),
    `repeating-linear-gradient(92deg, ${hexA(a, 0.55)} 0 1.5px, transparent 1.5px 8px) 0 100% / 100% 18% no-repeat`,
    `radial-gradient(120% 70% at 20% 126%, ${p} 0 52%, transparent 53%) no-repeat`,
    `radial-gradient(130% 75% at 85% 132%, ${hexA(p, 0.85)} 0 55%, transparent 56%) no-repeat`,
    `linear-gradient(${s} 0%, ${hexA(a, 0.35)} 70%)`,
    s,
  ].join(', '),
  // Light shafts through shallow water onto coral heads.
  'bio-reef': ({ p, s, a }) => [
    dot('26%', '82%', 5, a),
    ring('26%', '82%', 5, 8, hexA(a, 0.45)),
    dot('38%', '90%', 4, hexA(a, 0.85)),
    dot('70%', '86%', 6, hexA(a, 0.9)),
    ring('70%', '86%', 6, 9, hexA(a, 0.35)),
    dot('56%', '94%', 5, hexA(s, 0.9)),
    `linear-gradient(115deg, transparent 0 30%, ${W(0.12)} 34% 40%, transparent 44% 58%, ${W(0.1)} 62% 66%, transparent 70%)`,
    dot('82%', '28%', 1.5, hexA(a, 0.6)),
    dot('74%', '22%', 1.2, hexA(a, 0.5)),
    `linear-gradient(${hexA(s, 0.55)} 0%, ${p} 78%)`,
    p,
  ].join(', '),

  /* ---- Planets: each a portrait, each disc dressed its own way ---- */
  // Cratered and airless.
  'pl-mercury': ({ p, s, a }) => [
    ring('44%', '38%', 4.5, 6, K(0.35)),
    ring('58%', '50%', 3, 4.2, K(0.3)),
    ring('52%', '28%', 2.2, 3.2, K(0.3)),
    `radial-gradient(circle at 46% 38%, ${hexA(a, 0.9)} 0 7px, ${s} 7px 25px, transparent 26px) no-repeat`,
    dot('16%', '80%', 1.2, hexA(a, 0.7)),
    dot('84%', '16%', 1.4, hexA(a, 0.8)),
    dot('76%', '88%', 1, hexA(a, 0.6)),
    p,
  ].join(', '),
  // Smothered in cream-colored cloud bands.
  'pl-venus': ({ p, s, a }) => [
    dot('18%', '14%', 1.3, hexA(a, 0.8)),
    dot('82%', '78%', 1.1, hexA(a, 0.7)),
    dot('70%', '10%', 1, hexA(a, 0.6)),
    outside('50%', '44%', 25, p),
    `radial-gradient(circle at 44% 38%, ${W(0.3)} 0 9px, transparent 22px) no-repeat`,
    `repeating-linear-gradient(115deg, ${hexA(a, 0.9)} 0 5px, ${hexA(s, 0.9)} 5px 12px, ${hexA(a, 0.45)} 12px 16px, ${hexA(s, 0.75)} 16px 24px)`,
    p,
  ].join(', '),
  // Ocean, continents, weather.
  'pl-earth': ({ p, s, a }) => [
    orb('44%', '36%', 9, 6, a),
    orb('57%', '50%', 7, 9, hexA(a, 0.95)),
    orb('47%', '55%', 5, 4, a),
    orb('52%', '40%', 12, 2.5, W(0.75)),
    orb('44%', '48%', 10, 2, W(0.65)),
    `radial-gradient(circle at 50% 44%, ${s} 0 24px, ${hexA(s, 0.35)} 24px 26px, transparent 27px) no-repeat`,
    dot('16%', '78%', 1.2, W(0.8)),
    dot('84%', '20%', 1.4, W(0.9)),
    dot('72%', '88%', 1, W(0.6)),
    p,
  ].join(', '),
  // The red one: maria, a polar cap, two small moons.
  'pl-mars': ({ p, s, a }) => [
    orb('50%', '38%', 8, 3, a),
    orb('44%', '48%', 8, 5, K(0.3)),
    orb('58%', '52%', 6, 4, K(0.25)),
    `radial-gradient(circle at 48% 44%, ${hexA(a, 0.35)} 0 6px, ${s} 7px 24px, transparent 25px) no-repeat`,
    dot('20%', '18%', 1.6, hexA(a, 0.9)),
    dot('78%', '80%', 1.2, hexA(a, 0.7)),
    p,
  ].join(', '),
  // Banded giant with its great red spot.
  'pl-jupiter': ({ p, s, a }) => [
    orb('58%', '52%', 6.5, 4, a),
    outside('50%', '44%', 26, p),
    `repeating-linear-gradient(180deg, ${s} 0 4px, ${W(0.5)} 4px 6px, ${hexA(s, 0.75)} 6px 10px, ${hexA(s, 0.45)} 10px 13px)`,
    dot('14%', '82%', 1.3, W(0.8)),
    dot('86%', '14%', 1.2, W(0.7)),
    p,
  ].join(', '),
  // Wearing its rings flat across the card.
  'pl-saturn': ({ p, s, a }) => [
    eRing('50%', '46%', 40, 10, hexA(a, 0.95), 76, 86),
    eRing('50%', '46%', 30, 7, hexA(a, 0.55), 70, 84),
    `radial-gradient(circle at 50% 44%, ${W(0.25)} 0 7px, ${s} 8px 17px, ${hexA(s, 0.3)} 17px 18.5px, transparent 19px) no-repeat`,
    dot('16%', '16%', 1.3, hexA(a, 0.8)),
    dot('82%', '84%', 1.1, hexA(a, 0.7)),
    dot('76%', '24%', 1, hexA(a, 0.6)),
    p,
  ].join(', '),
  // Rolled on its side, rings standing vertical.
  'pl-uranus': ({ p, s, a }) => [
    eRing('50%', '44%', 10, 34, hexA(a, 0.8), 76, 88),
    `radial-gradient(circle at 50% 44%, ${W(0.35)} 0 5px, ${s} 6px 15px, ${hexA(s, 0.3)} 15px 16.5px, transparent 17px) no-repeat`,
    dot('20%', '80%', 1.2, hexA(a, 0.7)),
    dot('80%', '18%', 1.3, hexA(a, 0.8)),
    p,
  ].join(', '),
  // Deep blue, one dark storm, wind streaks.
  'pl-neptune': ({ p, s, a }) => [
    orb('54%', '38%', 6, 4, K(0.35)),
    orb('44%', '50%', 11, 2, hexA(a, 0.8)),
    orb('56%', '56%', 9, 1.7, hexA(a, 0.6)),
    `radial-gradient(circle at 50% 44%, ${hexA(a, 0.25)} 0 8px, ${s} 9px 24px, transparent 25px) no-repeat`,
    dot('18%', '14%', 1.3, hexA(a, 0.9)),
    dot('84%', '76%', 1.1, hexA(a, 0.7)),
    p,
  ].join(', '),

  /* ---- One for each ace animation ---- */
  // The screen-flash: a white-hot core and three slashes of light.
  'ace-flash': ({ p, s, a }) => [
    `linear-gradient(64deg, transparent 0 44%, ${a} 47% 49%, transparent 52%) no-repeat`,
    `linear-gradient(118deg, transparent 0 52%, ${hexA(a, 0.8)} 55% 56.5%, transparent 60%) no-repeat`,
    `linear-gradient(150deg, transparent 0 38%, ${hexA(s, 0.9)} 41% 42.5%, transparent 46%) no-repeat`,
    `radial-gradient(circle at 50% 46%, ${a} 0 7px, ${hexA(a, 0.5)} 7px 15px, ${hexA(s, 0.35)} 15px 30px, transparent 46px) no-repeat`,
    `radial-gradient(circle at 50% 46%, transparent 0 52px, ${K(0.4)} 100%) no-repeat`,
    p,
  ].join(', '),
  // Shockwave rings and two rounds of shrapnel.
  'ace-explosion': ({ p, s, a }) => [
    `radial-gradient(circle at 50% 50%, ${a} 0 8px, ${hexA(a, 0.75)} 8px 13px, transparent 20px) no-repeat`,
    `repeating-radial-gradient(circle at 50% 50%, transparent 0 9px, ${hexA(a, 0.5)} 9px 10.5px, transparent 10.5px 22px)`,
    `repeating-conic-gradient(from 7deg at 50% 50%, ${hexA(s, 0.85)} 0deg 9deg, transparent 9deg 34deg)`,
    `repeating-conic-gradient(from 99deg at 50% 50%, ${hexA(s, 0.5)} 0deg 5deg, transparent 5deg 41deg)`,
    p,
  ].join(', '),
  // A ring of fire: uneven flame wedges alive only in the annulus.
  'ace-flames': ({ p, s, a }) => [
    dot('50%', '50%', 22, p),
    dot('26%', '14%', 1.8, hexA(a, 0.9)),
    dot('78%', '20%', 1.4, hexA(a, 0.7)),
    dot('20%', '84%', 1.5, hexA(a, 0.8)),
    dot('80%', '88%', 1.2, hexA(a, 0.6)),
    `radial-gradient(circle at 50% 50%, transparent 0 38px, ${p} 44px 100%) no-repeat`,
    `conic-gradient(from 0deg at 50% 50%, ${a} 0 14deg, ${s} 14deg 40deg, ${a} 40deg 47deg, ${s} 47deg 86deg, ${a} 86deg 107deg, ${s} 107deg 140deg, ${a} 140deg 152deg, ${s} 152deg 198deg, ${a} 198deg 214deg, ${s} 214deg 260deg, ${a} 260deg 275deg, ${s} 275deg 316deg, ${a} 316deg 330deg, ${s} 330deg 360deg)`,
    p,
  ].join(', '),
  // A mirrorball throwing beams across the floor.
  'ace-disco': ({ p, s, a }) => [
    dot('30%', '78%', 1.8, a),
    dot('72%', '66%', 1.5, hexA(a, 0.85)),
    dot('56%', '90%', 1.3, hexA(s, 0.9)),
    outside('50%', '26%', 16, hexA(p, 0)) /* keep the ball's crop soft */,
    `conic-gradient(from 150deg at 50% 26%, transparent 0 8deg, ${hexA(a, 0.28)} 8deg 20deg, transparent 20deg 40deg, ${hexA(s, 0.25)} 40deg 52deg, transparent 52deg 62deg, ${hexA(a, 0.2)} 62deg 74deg, transparent 74deg) no-repeat`,
    outside('50%', '26%', 16, p),
    `repeating-linear-gradient(0deg, ${hexA(s, 0.9)} 0 3px, transparent 3px 6px)`,
    `repeating-linear-gradient(90deg, ${hexA(a, 0.75)} 0 3px, ${hexA(s, 0.6)} 3px 6px)`,
    p,
  ].join(', '),
  // A double rainbow's worth of arcs, grounded in cloud.
  'ace-rainbow': ({ p, s, a }) => [
    `radial-gradient(circle at 50% 106%, transparent 0 46px, ${s} 46px 54px, ${a} 54px 62px, ${W(0.9)} 62px 66px, ${hexA(s, 0.5)} 66px 71px, transparent 72px) no-repeat`,
    orb('16%', '92%', 15, 7, W(0.9)),
    orb('27%', '88%', 10, 5, W(0.8)),
    orb('84%', '92%', 15, 7, W(0.9)),
    orb('73%', '88%', 10, 5, W(0.75)),
    `linear-gradient(${p} 0%, ${hexA(a, 0.25)} 100%)`,
    p,
  ].join(', '),
  // Billows climbing out of the frame — the one all-soft design.
  'ace-smoke': ({ p, s, a }) => [
    `radial-gradient(30px 26px at 36% 78%, ${hexA(a, 0.5)} 0 40%, transparent 70%) no-repeat`,
    `radial-gradient(36px 30px at 62% 58%, ${hexA(s, 0.65)} 0 45%, transparent 72%) no-repeat`,
    `radial-gradient(30px 26px at 40% 40%, ${hexA(a, 0.4)} 0 40%, transparent 70%) no-repeat`,
    `radial-gradient(26px 22px at 60% 24%, ${hexA(s, 0.5)} 0 40%, transparent 72%) no-repeat`,
    `radial-gradient(20px 18px at 44% 10%, ${hexA(a, 0.3)} 0 40%, transparent 70%) no-repeat`,
    `linear-gradient(${hexA(s, 0.25)}, ${p})`,
    p,
  ].join(', '),
  // The splash: a droplet crown over spreading rings.
  'ace-water': ({ p, s, a }) => [
    dot('50%', '14%', 2.6, a),
    dot('36%', '22%', 2.2, hexA(a, 0.9)),
    dot('64%', '22%', 2.2, hexA(a, 0.9)),
    dot('27%', '34%', 1.8, hexA(a, 0.75)),
    dot('73%', '34%', 1.8, hexA(a, 0.75)),
    eRing('50%', '44%', 24, 8, a, 74, 90),
    eRing('50%', '72%', 36, 9, hexA(a, 0.55), 80, 90),
    eRing('50%', '82%', 48, 12, hexA(a, 0.3), 82, 90),
    `linear-gradient(${hexA(s, 0.5)} 0%, ${p} 85%)`,
    p,
  ].join(', '),
  // Scraps of paper at three angles, still falling.
  'ace-confetti': ({ p, s, a }) => [
    `linear-gradient(35deg, transparent 0 42%, ${s} 42% 58%, transparent 58%) 0 0 / 19px 23px`,
    `linear-gradient(-25deg, transparent 0 44%, ${a} 44% 60%, transparent 60%) 9px 11px / 23px 27px`,
    `linear-gradient(80deg, transparent 0 43%, ${hexA(s, 0.65)} 43% 57%, transparent 57%) 5px 17px / 27px 21px`,
    `radial-gradient(circle at 9px 11px, ${hexA(a, 0.85)} 0 2px, transparent 2.5px) 0 0 / 29px 33px`,
    p,
  ].join(', '),
  // Glossy bubbles, every one wearing its highlight.
  'ace-bubblegum': ({ p, s, a }) => [
    dot('66%', '30%', 3, hexA(a, 0.95)),
    `radial-gradient(circle at 60% 36%, ${s} 0 17px, ${hexA(s, 0.4)} 17px 18.5px, transparent 19px) no-repeat`,
    dot('25%', '62%', 2, hexA(a, 0.9)),
    `radial-gradient(circle at 30% 66%, ${hexA(s, 0.95)} 0 12px, transparent 13px) no-repeat`,
    dot('74%', '73%', 1.4, hexA(a, 0.85)),
    `radial-gradient(circle at 76% 76%, ${hexA(s, 0.9)} 0 7px, transparent 8px) no-repeat`,
    dot('22%', '22%', 4, hexA(s, 0.8)),
    `linear-gradient(160deg, ${hexA(a, 0.5)} 0%, ${p} 80%)`,
    p,
  ].join(', '),

  /* ---- Fruits ---- */
  // One bold crescent, freckled the way a ripe one is.
  'fruit-banana': ({ p, s, a }) => [
    dot('63%', '30%', 2.2, a),
    dot('31%', '66%', 2.2, a),
    dot('52%', '52%', 1.1, hexA(a, 0.6)),
    dot('44%', '44%', 0.9, hexA(a, 0.5)),
    dot('40%', '42%', 20, p),
    dot('47%', '48%', 24, s),
    `linear-gradient(150deg, ${p} 0%, ${hexA(s, 0.25)} 100%)`,
    p,
  ].join(', '),
  // Seeds in ranks under a leafy crown.
  'fruit-strawberry': ({ p, s, a }) => [
    `radial-gradient(circle at 8px 0px, ${a} 0 8px, transparent 8.5px) 0 0 / 16px 100% no-repeat`,
    `radial-gradient(2.2px 3.2px at 9px 10px, ${s} 0 60%, transparent 70%) 0 12px / 18px 20px`,
    `radial-gradient(2.2px 3.2px at 0px 0px, ${hexA(s, 0.85)} 0 60%, transparent 70%) 9px 22px / 18px 20px`,
    `linear-gradient(${p} 0%, ${hexA(p, 0.75)} 60%, ${K(0.25)} 130%)`,
    p,
  ].join(', '),
  // The cluster, stem to tip, one leaf over its shoulder.
  'fruit-grape': ({ p, s, a }) => [
    bar('50%', '6%', 2, 12, hexA(a, 0.9)),
    orb('58%', '13%', 10, 5, a),
    dot('32%', '34%', 1.8, W(0.55)), dot('35%', '36%', 9.5, s),
    dot('50%', '30%', 1.8, W(0.55)), dot('53%', '32%', 9.5, hexA(s, 0.95)),
    dot('65%', '38%', 1.8, W(0.5)), dot('68%', '40%', 9.5, hexA(s, 0.9)),
    dot('39%', '52%', 1.8, W(0.5)), dot('42%', '54%', 9.5, hexA(s, 0.92)),
    dot('56%', '54%', 1.8, W(0.45)), dot('59%', '56%', 9.5, hexA(s, 0.88)),
    dot('47%', '70%', 1.8, W(0.45)), dot('50%', '72%', 9.5, hexA(s, 0.85)),
    `linear-gradient(${p}, ${hexA(p, 0.85)})`,
    p,
  ].join(', '),
  // A slice: flesh, seeds, white heart, green rind.
  'fruit-watermelon': ({ p, s, a }) => [
    `radial-gradient(3px 4.5px at 30% 40%, ${K(0.85)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(3px 4.5px at 52% 28%, ${K(0.85)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(3px 4.5px at 70% 46%, ${K(0.8)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(3px 4.5px at 42% 60%, ${K(0.8)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(3px 4.5px at 62% 68%, ${K(0.75)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(140% 60px at 50% 116%, ${s} 0 52%, transparent 53%) no-repeat`,
    `radial-gradient(140% 74px at 50% 116%, ${a} 0 55%, transparent 56%) no-repeat`,
    `linear-gradient(${hexA(p, 0.9)} 0%, ${p} 70%)`,
    p,
  ].join(', '),

  /* ---- The shelf's eleven sigils, emblazoned like their books ---- */
  // A sword point-down: blade, guard, grip, pommel.
  'sig-blade': ({ p, s, a }) => [
    dot('50%', '18%', 3, a),
    bar('50%', '24%', 5, 14, a),
    bar('50%', '31%', 26, 5, a),
    `conic-gradient(from 178deg at 50% 79%, ${s} 0 4deg, transparent 4deg) no-repeat 0 0 / 100% 92%`,
    bar('50%', '52%', 7, 52, s),
    `linear-gradient(${p}, ${hexA(p, 0.8)})`,
    p,
  ].join(', '),
  // A hat: crown over brim, banded.
  'sig-hat': ({ p, s, a }) => [
    bar('50%', '42%', 30, 4, hexA(p, 0.9)),
    `radial-gradient(17px 20px at 50% 46%, ${a} 0 62%, transparent 66%) no-repeat`,
    `radial-gradient(36px 8px at 50% 52%, ${a} 0 62%, transparent 68%) no-repeat`,
    `linear-gradient(${p} 0%, ${hexA(s, 0.5)} 130%)`,
    p,
  ].join(', '),
  // A lens catching the light, handle at rest.
  'sig-glass': ({ p, s, a }) => [
    `linear-gradient(135deg, transparent 0 58%, ${a} 58% 64%, transparent 64%) 50% 50% / 60px 70px no-repeat`,
    ring('44%', '38%', 13, 17, a),
    dot('44%', '38%', 13, hexA(s, 0.35)),
    `linear-gradient(115deg, transparent 0 36%, ${W(0.3)} 38% 42%, transparent 44%) no-repeat`,
    `linear-gradient(${p}, ${hexA(p, 0.85)})`,
    p,
  ].join(', '),
  // A column standing between its cap and base.
  'sig-column': ({ p, s, a }) => [
    bar('50%', '22%', 34, 5, a),
    bar('50%', '28%', 26, 3, hexA(a, 0.8)),
    bar('42%', '50%', 5, 40, hexA(a, 0.9)),
    bar('50%', '50%', 5, 40, a),
    bar('58%', '50%', 5, 40, hexA(a, 0.9)),
    bar('50%', '74%', 30, 4, hexA(a, 0.85)),
    bar('50%', '79%', 38, 5, a),
    `linear-gradient(${p} 0%, ${hexA(s, 0.55)} 130%)`,
    p,
  ].join(', '),
  // The wyrm's eye, slit-pupiled, ringed in scale.
  'sig-dragon': ({ p, s, a }) => [
    `radial-gradient(3px 12px at 50% 44%, ${K(0.9)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(circle at 50% 44%, ${a} 0 12px, ${hexA(a, 0.5)} 12px 14px, transparent 15px) no-repeat`,
    ring('50%', '44%', 17, 19, hexA(s, 0.9)),
    `radial-gradient(circle at 9px -4px, transparent 0 10px, ${hexA(s, 0.55)} 10px 12px, transparent 12px) 0 76% / 19px 26px repeat-x`,
    `radial-gradient(circle at 9px -4px, transparent 0 10px, ${hexA(s, 0.4)} 10px 12px, transparent 12px) 9px 88% / 19px 26px repeat-x`,
    `linear-gradient(${p}, ${hexA(s, 0.3)})`,
    p,
  ].join(', '),
  // An orbital chart: the wanderer on its dotted road.
  'sig-planet': ({ p, s, a }) => [
    dot('50%', '44%', 8, a),
    eRing('50%', '44%', 15, 5, hexA(a, 0.9), 70, 90),
    ring('50%', '44%', 26, 27, hexA(s, 0.7)),
    dot('76%', '32%', 3.5, s),
    dot('28%', '60%', 2, hexA(s, 0.8)),
    dot('20%', '18%', 1.2, hexA(a, 0.7)),
    dot('80%', '82%', 1.4, hexA(a, 0.8)),
    `linear-gradient(${p}, ${hexA(p, 0.85)})`,
    p,
  ].join(', '),
  // A marshal's star, six points inside its ring.
  'sig-star': ({ p, s, a }) => [
    dot('50%', '44%', 4, s),
    `radial-gradient(circle at 50% 44%, transparent 0 17px, ${p} 17px 100%) no-repeat`,
    `repeating-conic-gradient(from 0deg at 50% 44%, ${a} 0 24deg, ${hexA(s, 0.35)} 24deg 60deg)`,
    ring('50%', '44%', 19, 21.5, a),
    ring('50%', '44%', 24, 25, hexA(a, 0.45)),
    `linear-gradient(${p}, ${hexA(s, 0.4)})`,
    p,
  ].join(', '),
  // The kraken: dome, two pale eyes, four arms reaching down.
  'sig-kraken': ({ p, s, a }) => [
    dot('43%', '34%', 2.2, p), dot('57%', '34%', 2.2, p),
    `radial-gradient(19px 22px at 50% 32%, ${a} 0 62%, transparent 66%) no-repeat`,
    `radial-gradient(4px 26px at 30% 58%, ${hexA(a, 0.9)} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(4px 32px at 43% 62%, ${a} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(4px 32px at 57% 62%, ${a} 0 60%, transparent 70%) no-repeat`,
    `radial-gradient(4px 26px at 70% 58%, ${hexA(a, 0.9)} 0 60%, transparent 70%) no-repeat`,
    dot('30%', '74%', 2, hexA(a, 0.85)),
    dot('70%', '74%', 2, hexA(a, 0.85)),
    `linear-gradient(${p} 0%, ${hexA(s, 0.6)} 130%)`,
    p,
  ].join(', '),
  // The machine-tree: one trunk, branching traces, live pads.
  'sig-circuit': ({ p, s, a }) => [
    dot('50%', '16%', 2.5, a),
    bar('50%', '50%', 2, 74, hexA(a, 0.9)),
    bar('38%', '34%', 24, 2, hexA(a, 0.75)), dot('26%', '32%', 2.5, a),
    bar('62%', '34%', 24, 2, hexA(a, 0.75)), dot('74%', '32%', 2.5, a),
    bar('40%', '58%', 20, 2, hexA(a, 0.6)), dot('30%', '56%', 2, hexA(a, 0.85)),
    bar('60%', '58%', 20, 2, hexA(a, 0.6)), dot('70%', '56%', 2, hexA(a, 0.85)),
    dot('50%', '86%', 3, hexA(a, 0.9)),
    `linear-gradient(${p}, ${hexA(s, 0.5)})`,
    p,
  ].join(', '),
  // The trefoil: three rings closing on a common heart.
  'sig-hazard': ({ p, s, a }) => [
    dot('50%', '46%', 4.5, a),
    ring('50%', '31%', 8, 13, a),
    ring('37%', '55%', 8, 13, a),
    ring('63%', '55%', 8, 13, a),
    ring('50%', '46%', 26, 27, hexA(a, 0.3)),
    `linear-gradient(${p}, ${s})`,
    p,
  ].join(', '),
  // Six chambers around the pin — the cylinder, loaded.
  'sig-sixgun': ({ p, s, a }) => [
    dot('50%', '44%', 3, a),
    dot('50%', '27%', 4.5, a), dot('65%', '35%', 4.5, hexA(a, 0.95)),
    dot('65%', '53%', 4.5, a), dot('50%', '61%', 4.5, hexA(a, 0.95)),
    dot('35%', '53%', 4.5, a), dot('35%', '35%', 4.5, hexA(a, 0.95)),
    ring('50%', '44%', 25, 28, s),
    `linear-gradient(${p}, ${hexA(s, 0.45)})`,
    p,
  ].join(', '),

  /* ---- More cloth ---- */
  // Long lozenges with both threads through their corners.
  argyle: ({ p, s, a }) => [
    `repeating-linear-gradient(62deg, transparent 0 21px, ${hexA(a, 0.8)} 21px 22px, transparent 22px 43px)`,
    `repeating-linear-gradient(-62deg, transparent 0 21px, ${hexA(a, 0.8)} 21px 22px, transparent 22px 43px)`,
    `repeating-conic-gradient(from 45deg at 50% 50%, ${p} 0 90deg, ${s} 90deg 180deg) 0 0 / 44px 62px`,
    p,
  ].join(', '),
  // The zigzag, with a thin echo a half-step behind.
  chevron: ({ p, s, a }) => [
    `linear-gradient(45deg, ${hexA(a, 0.55)} 5%, transparent 5% 25%, ${hexA(a, 0.55)} 25% 30%, transparent 30%) 0 0 / 28px 28px`,
    `linear-gradient(135deg, ${s} 25%, transparent 25%) -14px 0 / 28px 28px`,
    `linear-gradient(225deg, ${s} 25%, transparent 25%) -14px 0 / 28px 28px`,
    `linear-gradient(315deg, ${s} 25%, transparent 25%) 0 0 / 28px 28px`,
    `linear-gradient(45deg, ${s} 25%, transparent 25%) 0 0 / 28px 28px`,
    p,
  ].join(', '),
  // A triangular mesh over slow honey.
  honeycomb: ({ p, s, a }) => [
    `repeating-linear-gradient(0deg, ${hexA(a, 0.6)} 0 1px, transparent 1px 14px)`,
    `repeating-linear-gradient(60deg, ${hexA(a, 0.55)} 0 1px, transparent 1px 14px)`,
    `repeating-linear-gradient(120deg, ${hexA(a, 0.55)} 0 1px, transparent 1px 14px)`,
    `linear-gradient(170deg, ${hexA(s, 0.6)} 0%, ${p} 90%)`,
    p,
  ].join(', '),
  // Overlapping scales, every one rimmed in gold.
  scales: ({ p, s, a }) => [
    `radial-gradient(circle at 10px -6px, transparent 0 12px, ${hexA(a, 0.85)} 12px 13px, ${s} 13px 19px, ${K(0.3)} 19px 20px, transparent 20px) 0 0 / 20px 14px`,
    `radial-gradient(circle at 10px -6px, transparent 0 12px, ${hexA(a, 0.85)} 12px 13px, ${hexA(s, 0.9)} 13px 19px, ${K(0.3)} 19px 20px, transparent 20px) 10px 7px / 20px 14px`,
    p,
  ].join(', '),
  // A garden trellis, studded at every crossing.
  lattice: ({ p, s, a }) => [
    `radial-gradient(circle at 13px 13px, ${hexA(a, 0.9)} 0 2px, transparent 2.5px) 0 0 / 26px 26px`,
    `repeating-linear-gradient(45deg, transparent 0 15px, ${hexA(s, 0.85)} 15px 20px, transparent 20px 37px)`,
    `repeating-linear-gradient(-45deg, transparent 0 15px, ${hexA(s, 0.85)} 15px 20px, transparent 20px 37px)`,
    p,
  ].join(', '),
  // A banker's suit: single and double stripes, sharply pressed.
  pinstripe: ({ p, s, a }) => [
    `repeating-linear-gradient(90deg, transparent 0 9px, ${hexA(a, 0.75)} 9px 10px, transparent 10px 13px, ${hexA(a, 0.4)} 13px 13.8px, transparent 13.8px 22px)`,
    `linear-gradient(200deg, ${W(0.06)} 0%, transparent 40%)`,
    `linear-gradient(${p}, ${hexA(s, 0.6)})`,
    p,
  ].join(', '),
  // Deco fans opening from the bottom corners under falling lines.
  decofan: ({ p, s, a }) => [
    `radial-gradient(circle at 0% 100%, transparent 0 40px, ${hexA(a, 0.5)} 40px 41.5px, transparent 41.5px 100%) no-repeat`,
    `radial-gradient(circle at 100% 100%, transparent 0 40px, ${hexA(a, 0.5)} 40px 41.5px, transparent 41.5px 100%) no-repeat`,
    `repeating-conic-gradient(from 270deg at 0% 100%, ${hexA(a, 0.85)} 0 5deg, transparent 5deg 15deg)`,
    `repeating-conic-gradient(from 0deg at 100% 100%, transparent 0 10deg, ${hexA(a, 0.85)} 10deg 15deg)`,
    `radial-gradient(circle at 0% 100%, ${hexA(s, 0.9)} 0 18px, transparent 44px) no-repeat`,
    `radial-gradient(circle at 100% 100%, ${hexA(s, 0.9)} 0 18px, transparent 44px) no-repeat`,
    `repeating-linear-gradient(90deg, transparent 0 22px, ${hexA(s, 0.6)} 22px 23px, transparent 23px 46px) 0 0 / 100% 40% no-repeat`,
    `linear-gradient(${p} 55%, ${hexA(s, 0.35)} 100%)`,
    p,
  ].join(', '),
  // Deep night: three sizes of star and one comet going somewhere.
  starfield: ({ p, s, a }) => [
    `linear-gradient(125deg, transparent 0 30%, ${hexA(a, 0.8)} 32% 32.7%, transparent 34%) no-repeat`,
    dot('24%', '26%', 1.9, a),
    bar('24%', '26%', 9, 1, hexA(a, 0.6)),
    bar('24%', '26%', 1, 9, hexA(a, 0.6)),
    dot('72%', '64%', 1.7, a),
    bar('72%', '64%', 8, 1, hexA(a, 0.5)),
    bar('72%', '64%', 1, 8, hexA(a, 0.5)),
    `radial-gradient(circle at 9px 13px, ${hexA(a, 0.9)} 0 1.1px, transparent 1.5px) 0 0 / 31px 37px`,
    `radial-gradient(circle at 22px 29px, ${hexA(a, 0.55)} 0 0.8px, transparent 1.2px) 0 0 / 27px 41px`,
    `linear-gradient(160deg, ${p} 0%, ${s} 130%)`,
    p,
  ].join(', '),
  // Traces, pads, and one chip holding court.
  circuit: ({ p, s, a }) => [
    bar('50%', '44%', 26, 18, s),
    bar('50%', '44%', 18, 10, hexA(a, 0.35)),
    `radial-gradient(circle at 15.5px 15.5px, ${hexA(a, 0.8)} 0 1.8px, transparent 2.2px) 0 0 / 31px 31px`,
    `repeating-linear-gradient(0deg, transparent 0 15px, ${hexA(a, 0.4)} 15px 16px, transparent 16px 31px)`,
    `repeating-linear-gradient(90deg, transparent 0 15px, ${hexA(a, 0.4)} 15px 16px, transparent 16px 31px)`,
    p,
  ].join(', '),
};

/** Border geometry, given its resolved color. Kept inside the same box
 *  (border-box) so a Heavy card and a Hairline card stay the same size. */
const BORDER_CSS: Record<string, (c: string) => CSSProperties> = {
  clean: (c) => ({ border: `3px solid ${c}` }),
  hairline: (c) => ({ border: `1px solid ${c}` }),
  heavy: (c) => ({ border: `6px solid ${c}` }),
  double: (c) => ({ border: `5px double ${c}` }),
  dashed: (c) => ({ border: `3px dashed ${c}` }),
  dotted: (c) => ({ border: `3px dotted ${c}` }),
  ridge: (c) => ({ border: `5px ridge ${c}` }),
  groove: (c) => ({ border: `5px groove ${c}` }),
  frame: (c) => ({ border: `2px solid ${c}`, boxShadow: `inset 0 0 0 4px transparent, inset 0 0 0 6px ${c}` }),
  twinframe: (c) => ({ border: `2px solid ${c}`, boxShadow: `inset 0 0 0 4px transparent, inset 0 0 0 5px ${c}, inset 0 0 0 9px transparent, inset 0 0 0 10px ${c}` }),
  glow: (c) => ({ border: `2px solid ${c}`, boxShadow: `0 0 10px 2px ${hexA(c, 0.75)}` }),
  bevel: (c) => ({ border: `5px outset ${c}` }),
  stitched: (c) => ({ border: `3px solid ${c}`, boxShadow: `inset 0 0 0 2px transparent, inset 0 0 0 3px ${hexA(c, 0.55)}` }),
  deco: (c) => ({ border: `3px solid ${c}`, boxShadow: `inset 0 0 0 5px transparent, inset 0 0 0 7px ${c}, inset 0 0 0 8px transparent`, borderRadius: 2 }),
  rounded: (c) => ({ border: `3px solid ${c}`, borderRadius: 18 }),
  sharp: (c) => ({ border: `3px solid ${c}`, borderRadius: 0 }),
};

/**
 * The whole look for a spec (or anything older that stood where one should
 * be). This is the ONLY place a spec becomes CSS, so the picker's minis, the
 * Bio tab's preview, the deck button and every face-down card at the table
 * can never disagree about what a back looks like.
 */
export function cardBackCss(raw: unknown): CSSProperties {
  const spec: CardBackSpec = normalizeCardBack(raw);
  const paint = PATTERN_CSS[spec.pattern] ?? PATTERN_CSS.stripes;
  const frame = BORDER_CSS[spec.border] ?? BORDER_CSS.clean;
  const borderColor = spec.borderColor || spec.primary;
  return {
    background: paint({ p: spec.primary, s: spec.secondary, a: spec.accent }),
    boxSizing: 'border-box',
    ...frame(borderColor),
  };
}

/** A face-down card wearing the given back. Extra classes ride through so the
 *  flip and deck-button styling keep working unchanged. */
export function CardBackView({ back, className }: { back?: unknown; className?: string }) {
  return <div className={className ?? 'card-back'} style={cardBackCss(back)} />;
}
