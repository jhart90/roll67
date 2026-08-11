// Software-3D dice: real polyhedron models for d2–d20 (+d100), tumbled with
// quaternions and rendered onto a 2D canvas with flat shading — no WebGL or
// three.js. Each die rolls in from offscreen with a decaying spin that ends
// EXACTLY on the orientation that shows the rolled face (number upright),
// bouncing on the "table" (the screen plane) as it settles near the middle.

import { ACE_STYLE_DEFAULT, type AceStyle, type DieRoll } from 'shared';

// ---------- tiny vector / quaternion math ----------

export type Vec3 = { x: number; y: number; z: number };
type Quat = { w: number; x: number; y: number; z: number };

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, s: number) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3) => { const l = len(a) || 1; return scale(a, 1 / l); };

const qIdent: Quat = { w: 1, x: 0, y: 0, z: 0 };

function qAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  const a = norm(axis);
  return { w: Math.cos(h), x: a.x * s, y: a.y * s, z: a.z * s };
}

function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function qRotate(q: Quat, p: Vec3): Vec3 {
  // v' = v + 2 q.w (q.xyz × v) + 2 q.xyz × (q.xyz × v)
  const u = v3(q.x, q.y, q.z);
  const t = scale(cross(u, p), 2);
  return add(add(p, scale(t, q.w)), cross(u, t));
}

/** The rotation carrying unit vector `a` onto unit vector `b`. */
function qBetween(a: Vec3, b: Vec3): Quat {
  const c = dot(a, b);
  if (c > 0.9999) return qIdent;
  if (c < -0.9999) {
    // Opposite: rotate 180° about any axis ⊥ a.
    const axis = Math.abs(a.x) < 0.9 ? cross(a, v3(1, 0, 0)) : cross(a, v3(0, 1, 0));
    return qAxisAngle(axis, Math.PI);
  }
  const axis = cross(a, b);
  return qAxisAngle(axis, Math.acos(Math.max(-1, Math.min(1, c))));
}

// ---------- polyhedron geometry ----------

interface Face {
  verts: Vec3[];       // in model space, circumradius ≈ 1
  label: string | null; // the number painted on this face (null = blank rim)
  normal: Vec3;
  center: Vec3;
  u: Vec3;             // text-right direction, in the face plane
  v: Vec3;             // text-down direction, in the face plane
  textSize: number;    // label height relative to model units
}

interface DieGeometry {
  faces: Face[];
  /** Indices into faces for value 1..N, in order. */
  valueFaces: number[];
}

function makeFace(verts: Vec3[], label: string | null, textSize: number, edgeAlignedBasis = false): Face {
  const center = scale(verts.reduce(add, v3(0, 0, 0)), 1 / verts.length);
  // Newell's method: a well-defined average normal even for the slightly
  // non-planar kite faces of the d10 trapezohedron.
  let n = v3(0, 0, 0);
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    n = add(n, v3((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)));
  }
  let normal = norm(n);
  let ordered = verts;
  // Outward winding: for convex solids centred on the origin the normal must
  // point away from the origin.
  if (dot(normal, center) < 0) {
    ordered = [...verts].reverse();
    normal = scale(normal, -1);
  }
  // Text basis, orthogonalized against the normal so the label sits flat in
  // the face plane (matters for the non-planar kites). For a square face
  // (the cube), center-to-vertex points at a corner, and settling with that
  // aligned to screen-right leaves the square rotated 45° -- a "diamond"
  // resting on a pointy corner instead of a flat edge. Center-to-edge-midpoint
  // is axis-aligned with the square's own sides, so the settled face reads as
  // a plain, flat-sided square instead.
  const uRaw = edgeAlignedBasis
    ? sub(scale(add(ordered[0], ordered[1]), 0.5), center)
    : sub(ordered[0], center);
  const u = norm(sub(uRaw, scale(normal, dot(uRaw, normal))));
  const v = norm(cross(normal, u));
  return { verts: ordered, label, normal, center, u, v, textSize };
}

function buildDie(rawFaces: Vec3[][], labelled: number, textSize: number, edgeAlignedBasis = false): DieGeometry {
  const faces = rawFaces.map((verts, i) => makeFace(verts, i < labelled ? String(i + 1) : null, textSize, edgeAlignedBasis));
  return { faces, valueFaces: faces.map((_, i) => i).filter((i) => faces[i].label !== null) };
}

function coin(): DieGeometry {
  const N = 14, R = 1, H = 0.16;
  const top: Vec3[] = [], bottom: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    top.push(v3(Math.cos(a) * R, Math.sin(a) * R, H));
    bottom.push(v3(Math.cos(a) * R, Math.sin(a) * R, -H));
  }
  const rawFaces: Vec3[][] = [top, [...bottom].reverse()];
  for (let i = 0; i < N; i++) {
    rawFaces.push([top[i], top[(i + 1) % N], bottom[(i + 1) % N], bottom[i]]);
  }
  return buildDie(rawFaces, 2, 0.85);
}

function tetrahedron(): DieGeometry {
  const s = 1 / Math.sqrt(3);
  const p = [v3(s, s, s), v3(s, -s, -s), v3(-s, s, -s), v3(-s, -s, s)];
  return buildDie([[p[0], p[1], p[2]], [p[0], p[3], p[1]], [p[0], p[2], p[3]], [p[1], p[3], p[2]]], 4, 0.5);
}

function cube(): DieGeometry {
  const s = 1 / Math.sqrt(3);
  const c = (x: number, y: number, z: number) => v3(x * s, y * s, z * s);
  return buildDie([
    [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
    [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)],
    [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)],
    [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
    [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
    [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)],
  ], 6, 0.62, true);
}

function octahedron(): DieGeometry {
  const px = v3(1, 0, 0), nx = v3(-1, 0, 0), py = v3(0, 1, 0), ny = v3(0, -1, 0), pz = v3(0, 0, 1), nz = v3(0, 0, -1);
  return buildDie([
    [px, py, pz], [py, nx, pz], [nx, ny, pz], [ny, px, pz],
    [py, px, nz], [nx, py, nz], [ny, nx, nz], [px, ny, nz],
  ], 8, 0.42);
}

function trapezohedron(): DieGeometry {
  // d10: two poles + two offset rings of 5; kite-shaped faces.
  const T = v3(0, 0, 1.05), B = v3(0, 0, -1.05);
  const up: Vec3[] = [], lo: Vec3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = a + Math.PI / 5;
    up.push(v3(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.22));
    lo.push(v3(Math.cos(b) * 0.95, Math.sin(b) * 0.95, -0.22));
  }
  const rawFaces: Vec3[][] = [];
  for (let i = 0; i < 5; i++) rawFaces.push([T, up[i], lo[i], up[(i + 1) % 5]]);
  for (let i = 0; i < 5; i++) rawFaces.push([B, lo[i], up[(i + 1) % 5], lo[(i + 1) % 5]]);
  return buildDie(rawFaces, 10, 0.34);
}

function zocchihedron(): DieGeometry {
  // A real d100 is a Zocchihedron — a near-sphere of 100 small faces, not the
  // d10 kite this used to borrow. Approximated as a 10x10 UV sphere: eight
  // bands of quads with a ring of triangles at each pole, which comes to
  // exactly 100 faces and reads as the golf ball people recognise.
  const LON = 10, LAT = 10, R = 1.02;
  const ringAt = (lat: number): Vec3[] => {
    const phi = (lat / LAT) * Math.PI;
    const z = Math.cos(phi) * R, rad = Math.sin(phi) * R;
    return Array.from({ length: LON }, (_, i) => {
      const a = (i / LON) * Math.PI * 2;
      return v3(Math.cos(a) * rad, Math.sin(a) * rad, z);
    });
  };
  const rings = Array.from({ length: LAT + 1 }, (_, lat) => ringAt(lat));
  const north = v3(0, 0, R), south = v3(0, 0, -R);
  const rawFaces: Vec3[][] = [];
  for (let lat = 0; lat < LAT; lat++) {
    const a = rings[lat], b = rings[lat + 1];
    for (let i = 0; i < LON; i++) {
      const j = (i + 1) % LON;
      // The polar rings collapse to a point, so those bands are triangles.
      if (lat === 0) rawFaces.push([north, b[i], b[j]]);
      else if (lat === LAT - 1) rawFaces.push([south, a[j], a[i]]);
      else rawFaces.push([a[i], a[j], b[j], b[i]]);
    }
  }
  // 100 faces on a unit sphere leaves each about a third of a radius across,
  // so the label has to be small — a real d100's numbers are tiny too.
  return buildDie(rawFaces, 100, 0.17);
}

function icosahedronFaces(): Vec3[][] {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    v3(-1, t, 0), v3(1, t, 0), v3(-1, -t, 0), v3(1, -t, 0),
    v3(0, -1, t), v3(0, 1, t), v3(0, -1, -t), v3(0, 1, -t),
    v3(t, 0, -1), v3(t, 0, 1), v3(-t, 0, -1), v3(-t, 0, 1),
  ].map(norm);
  // Faces = all vertex triples at mutual edge distance (the minimum).
  let minD = Infinity;
  for (let i = 0; i < raw.length; i++) for (let j = i + 1; j < raw.length; j++) {
    minD = Math.min(minD, len(sub(raw[i], raw[j])));
  }
  const edge = (a: Vec3, b: Vec3) => Math.abs(len(sub(a, b)) - minD) < 1e-6;
  const out: Vec3[][] = [];
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      if (!edge(raw[i], raw[j])) continue;
      for (let k = j + 1; k < raw.length; k++) {
        if (edge(raw[i], raw[k]) && edge(raw[j], raw[k])) out.push([raw[i], raw[j], raw[k]]);
      }
    }
  }
  return out; // 20 triangles
}

function icosahedron(): DieGeometry {
  return buildDie(icosahedronFaces(), 20, 0.38);
}

function dodecahedron(): DieGeometry {
  // Dual of the icosahedron: pentagon faces around each icosahedron vertex,
  // built from the surrounding face centers ordered by angle.
  const tris = icosahedronFaces();
  const centers = tris.map((f) => norm(scale(f.reduce(add, v3(0, 0, 0)), 1 / 3)));
  const verts: Vec3[] = [];
  const seen = new Set<string>();
  for (const f of tris) for (const p of f) {
    const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
    if (!seen.has(key)) { seen.add(key); verts.push(p); }
  }
  const rawFaces: Vec3[][] = verts.map((vert) => {
    const ring = tris
      .map((f, i) => ({ f, c: centers[i] }))
      .filter(({ f }) => f.some((p) => len(sub(p, vert)) < 1e-6))
      .map(({ c }) => c);
    // Order the 5 centers by angle around the vertex direction.
    const n = norm(vert);
    const u = norm(sub(ring[0], scale(n, dot(ring[0], n))));
    const w = cross(n, u);
    return ring.sort((a, b) =>
      Math.atan2(dot(a, w), dot(a, u)) - Math.atan2(dot(b, w), dot(b, u)));
  });
  return buildDie(rawFaces, 12, 0.4);
}

const GEOMS: Record<number, DieGeometry> = {
  2: coin(), 4: tetrahedron(), 6: cube(), 8: octahedron(),
  10: trapezohedron(), 12: dodecahedron(), 20: icosahedron(), 100: zocchihedron(),
};

export function geometryFor(sides: number): DieGeometry {
  return GEOMS[sides] ?? GEOMS[20];
}

// ---------- target orientation ----------

function targetFaceIndex(geom: DieGeometry, value: number): number {
  return geom.valueFaces[(Math.max(1, value) - 1) % geom.valueFaces.length];
}

/** Orientation that presents the value's face to the camera, number upright. */
function targetOrientation(geom: DieGeometry, value: number): Quat {
  const face = geom.faces[targetFaceIndex(geom, value)];
  // 1. Face normal → +Z (toward the camera).
  const q1 = qBetween(face.normal, v3(0, 0, 1));
  // 2. Roll about Z so the face's text-right axis lines up with screen-right.
  const u2 = qRotate(q1, face.u);
  const angle = Math.atan2(u2.y, u2.x);
  return qMul(qAxisAngle(v3(0, 0, 1), -angle), q1);
}

// ---------- colors ----------

// Bold, tropical-bright per-size palette — dice should read from across the
// table, not blend into the felt. Pip colour stays luminance-picked, so the
// hot yellows get dark ink and the deep blues get white.
export const DEFAULT_DIE_COLORS: Record<number, string> = {
  2: '#ffc93c', 4: '#ff3d57', 6: '#0aa8ff', 8: '#2fe04a',
  // d100 is white: its old yellow was a shade off the d2's, and two dice you
  // cannot tell apart at a glance defeats the point of a per-size palette.
  10: '#00e5d0', 12: '#b444ff', 20: '#ff8a00', 100: '#ffffff',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function shade(rgb: [number, number, number], k: number): string {
  return `rgb(${Math.round(rgb[0] * k)}, ${Math.round(rgb[1] * k)}, ${Math.round(rgb[2] * k)})`;
}

function luminance(rgb: [number, number, number]): number {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

// ---------- simulation ----------

interface DieSim {
  die: DieRoll;
  geom: DieGeometry;
  targetFace: Face;
  rgb: [number, number, number];
  textColor: string;
  size: number;
  start: { x: number; y: number };
  target: { x: number; y: number };
  delay: number;
  dur: number;
  /** ms at which this die starts greying out; Infinity for one that never does. */
  fadeAt: number;
  qTarget: Quat;
  spinAxis: Vec3;
  spinTotal: number;
  bounceH: number;
  /** How this die celebrates if it aced — the ROLLER's chosen style. */
  aceStyle: AceStyle;
  /** Set once its ace effect has fired its sound, so a per-frame draw
   *  does not retrigger the clip sixty times a second. */
  aceSounded?: boolean;
  /** Wall-bounce: the point on a wall this die caroms off on its way to
   *  `target`. Absent for a die that flies straight there. */
  via?: { x: number; y: number };
  /** Where in the flight (0..1 of eased progress) it meets that wall. */
  viaAt?: number;
}

/** The walls dice carom off: the playable map, not the whole window. */
export interface PlayBounds { left: number; right: number; top: number; bottom: number }


const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** How long an aced die sits flashing before its bonus die is thrown. */
export const ACE_FLASH_MS = 750;
/**
 * Quiet beat after the flash finishes, before the next die in a chain is
 * thrown. The die is settled and motionless here so the table can actually
 * read what it rolled instead of the next throw stealing their attention.
 */
export const ACE_READ_PAUSE_MS = 500;
/** Total gap between one chained die landing and the next being thrown. */
export const ACE_GAP_MS = ACE_FLASH_MS + ACE_READ_PAUSE_MS;

/**
 * How long a style's visual gets to finish, which is NOT the same as how long
 * the table waits. Pacing is ACE_GAP_MS for every style; this only decides
 * when to stop drawing. Confetti has to cross the whole screen to land, so it
 * keeps fluttering while the next die is already in the air — which is what
 * real confetti does.
 */
function aceEffectMs(style: AceStyle): number {
  return style === 'confetti' ? 2800 : ACE_FLASH_MS;
}
/** Stagger between dice thrown in the same wave. */
const WAVE_STAGGER_MS = 110;
/**
 * SWADE colours dice by their role in the roll instead of by die size, because
 * the arms of a `best(trait!, wild!)` have to be told apart while they are
 * still bouncing. Defaults below; each slot is overridable per player.
 * Trait black is a shade off pure black so bevels and shadow still read.
 */
/** Raise dice are ALWAYS this green with white pips — a raise should look
 *  identical at every table, so it is not player-customisable. */
export const RAISE_GREEN = '#0de323'; // rgb(13,227,35)
export const DICE_ROLE_DEFAULTS = { trait: '#ffffff', wild: '#8b5cf6', raise: RAISE_GREEN };
export type DicePalette = { trait: string; wild: string; raise: string };

/** How long the grey-out takes, and how far down it goes. */
const FADE_MS = 400;
const DROPPED_ALPHA = 0.45;

/**
 * When each die should begin greying out, or Infinity for one that never does.
 *
 * A die that loses a `best()` must not fade the moment it lands: `kept` is
 * decided by dice that may not have been thrown yet, so fading early announces
 * the result in advance. Nor should it stay bright to the end. The honest
 * moment is when its own arm has stopped acing *and* another arm has already
 * passed it — from then on nothing can change the outcome, so saying so gives
 * nothing away.
 *
 * Comparisons use raw dice sums, ignoring any modifier inside an arm. SWADE's
 * arms carry the same modifier as each other (`best(1d4!-2, 1d6!-2)`), so the
 * comparison is exact for every expression this actually sees.
 */
function fadeTimes(dice: DieRoll[], settleAt: number[]): number[] {
  const out = dice.map(() => Infinity);
  const arms = new Map<number, number[]>();
  dice.forEach((d, i) => {
    if (d.arm === undefined) return;
    const list = arms.get(d.arm);
    if (list) list.push(i); else arms.set(d.arm, [i]);
  });
  if (arms.size < 2) return out; // nothing to lose to
  const latest = Math.max(...settleAt);
  // Earliest time one arm's running total strictly passes `x`. A still-acing
  // arm only ever grows, so passing is permanent.
  const passesAt = (idxs: number[], x: number): number => {
    let sum = 0;
    for (const i of [...idxs].sort((a, b) => settleAt[a] - settleAt[b])) {
      sum += dice[i].value;
      if (sum > x) return settleAt[i];
    }
    return Infinity;
  };
  for (const [arm, idxs] of arms) {
    if (dice[idxs[0]].kept) continue; // this arm won
    const mine = idxs.reduce((s, i) => s + dice[i].value, 0);
    const stoppedAt = Math.max(...idxs.map((i) => settleAt[i]));
    let passed = Infinity;
    for (const [other, oIdxs] of arms) {
      if (other !== arm) passed = Math.min(passed, passesAt(oIdxs, mine));
    }
    // A tie is never strictly passed, so fall back to the end of the throw.
    const at = Math.max(stoppedAt, Number.isFinite(passed) ? passed : latest);
    for (const i of idxs) out[i] = at;
  }
  return out;
}

/**
 * Scatter landing spots around the middle of the screen, no two dice touching.
 *
 * Dart-throwing: try random points, keep the first that clears every spot
 * already taken. A crowded board can run out of room, so each die gets a
 * budget of attempts and then settles for the roomiest of its candidates —
 * a slightly tight pair beats hanging the animation looking for perfection.
 * The scatter area grows with the number of dice so a big handful spreads out
 * instead of jamming into the same small patch.
 */
function scatterTargets(n: number, w: number, h: number): Array<{ x: number; y: number }> {
  const cx = w / 2, cy = h / 2;
  const minGap = 92; // a touch over the widest die, so nothing overlaps
  // Random packing wastes a lot of space, so the box is ~1.6x the naive
  // sqrt(n) side. Simulated over every die count up to the 12 the overlay
  // shows: below about 1.5 a full handful overlaps almost every time.
  const needed = Math.sqrt(n) * minGap * 1.6;
  const spreadX = Math.min(Math.max(needed, minGap), w * 0.8) / 2;
  const spreadY = Math.min(Math.max(needed, minGap), h * 0.62) / 2;
  const placed: Array<{ x: number; y: number }> = [];
  const nearest = (p: { x: number; y: number }) =>
    placed.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), Infinity);
  for (let i = 0; i < n; i++) {
    let best = { x: cx, y: cy };
    let bestGap = -1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = {
        x: cx + (Math.random() * 2 - 1) * spreadX,
        y: cy + (Math.random() * 2 - 1) * spreadY,
      };
      const gap = nearest(p);
      if (gap >= minGap) { best = p; bestGap = gap; break; }
      if (gap > bestGap) { best = p; bestGap = gap; }
    }
    placed.push(best);
  }
  return placed;
}

/** The two 1s of a Critical Failure wear this instead of their role colour —
 *  a deep arterial red no player palette can be mistaken for. */
export const CRIT_FAIL_DIE_COLOR = '#8d0f14';

/**
 * Pick the wall this die caroms off, and where on it. Only walls the die is
 * already travelling toward are eligible — a die entering from the left edge
 * cannot plausibly bounce off the left wall — except the floor, which a die
 * thrown low can skip off on its way up to rest.
 *
 * Returns the contact point plus how far through the flight it happens, so
 * both legs are covered at roughly one speed rather than the die crawling
 * along the long one.
 */
function pickWallBounce(
  start: { x: number; y: number }, target: { x: number; y: number },
  b: PlayBounds, halfDie: number,
): { via: { x: number; y: number }; viaAt: number } | null {
  const lerp = (a: number, z: number, t: number) => a + (z - a) * t;
  // Where along the free axis it strikes — biased past the midpoint so the
  // deflection is visible rather than a tap right next to the resting spot.
  const along = () => 0.55 + Math.random() * 0.35;
  const walls: Array<{ x: number; y: number }> = [
    // The side wall it is already heading for.
    start.x < target.x
      ? { x: b.right - halfDie, y: lerp(start.y, target.y, along()) }
      : { x: b.left + halfDie, y: lerp(start.y, target.y, along()) },
    // Dice always travel upward from their entry, so the ceiling is always on.
    { x: lerp(start.x, target.x, along()), y: b.top + halfDie },
    // ...and the floor is reachable by dipping first, which reads as a skip.
    { x: lerp(start.x, target.x, along()), y: b.bottom - halfDie },
  ].filter((p) => p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom);
  if (walls.length === 0) return null;
  const via = walls[Math.floor(Math.random() * walls.length)];
  const legA = Math.hypot(via.x - start.x, via.y - start.y);
  const legB = Math.hypot(target.x - via.x, target.y - via.y);
  if (legA + legB <= 0) return null;
  // Clamped so neither leg collapses to a jump.
  const viaAt = Math.max(0.18, Math.min(0.82, legA / (legA + legB)));
  return { via, viaAt };
}

export function buildSims(
  dice: DieRoll[], w: number, h: number, customColor: string | null, customTextColor: string | null = null,
  palette: DicePalette | null = null, critFail = false, bounds: PlayBounds | null = null,
  /** Share of dice that carom off a wall, 0-100 — the ROLLER's own setting. */
  bouncePct = 0,
  /** How aced dice celebrate — also the ROLLER's own setting. */
  aceStyle: AceStyle = ACE_STYLE_DEFAULT,
): DieSim[] {
  const bounceChance = Math.max(0, Math.min(100, bouncePct)) / 100;
  const n = dice.length;
  const cx = w / 2, cy = h / 2;
  const targets = scatterTargets(n, w, h);
  // Timing: ordinary dice are thrown together in one quick staggered wave.
  // An exploding die's bonus die instead waits for the die that spawned it to
  // land, finish flashing, and then sit readable for a beat, so a chain of aces
  // plays out as roll → flash → read → roll with the earlier dice sitting still.
  // Chains only serialise against themselves, so several dice acing at once
  // still resolve side by side rather than queueing up behind each other.
  const settleAt: number[] = [];
  let waveDelay = 0;
  const timing = dice.map((_, i) => {
    const dur = 1450 + Math.random() * 250;
    const continuesAnAce = i > 0 && dice[i - 1].ace === true;
    const delay = continuesAnAce ? settleAt[i - 1] + ACE_GAP_MS : (waveDelay += i === 0 ? 0 : WAVE_STAGGER_MS);
    settleAt[i] = delay + dur;
    return { delay, dur };
  });
  const fade = fadeTimes(dice, settleAt);
  return dice.map((die, i) => {
    const target = targets[i];
    // Enter from the left or right edge, biased low, like a real throw.
    const fromLeft = target.x < cx ? Math.random() < 0.8 : Math.random() < 0.2;
    const start = {
      x: fromLeft ? -80 : w + 80,
      y: target.y + 120 + Math.random() * 160,
    };
    const geom = geometryFor(die.sides);
    // With a role palette (SWADE) dice are told apart by hue: raise, Wild Die,
    // and trait each get their own colour. Never by dimming the losing arm —
    // `kept` is only known once every arm has finished acing, so fading it
    // would announce the result of dice that have not been thrown yet.
    // Without a palette, every other system keeps the by-size colours and the
    // player's own single-colour override.
    // On a Critical Failure the guilty dice — the 1s themselves — go blood
    // red, so the reason is legible on the felt rather than only in the
    // banner. Every other die in the roll keeps its own colour.
    const damning = critFail && die.value === 1 && !die.raise;
    const rgb = hexToRgb(damning ? CRIT_FAIL_DIE_COLOR : palette
      ? (die.raise ? palette.raise : die.wild ? palette.wild : palette.trait)
      : (customColor ?? DEFAULT_DIE_COLORS[die.sides] ?? '#9aa1b3'));
    // Pips have to stay legible against whatever colour the player picked.
    const contrasting = luminance(rgb) > 0.45 ? '#10131a' : '#f4f6fb';
    const size = die.sides === 20 ? 44 : die.sides === 2 ? 38 : 41;
    // Every die takes its own chance, so a handful scatters off different
    // walls rather than the whole throw behaving as one.
    const wall = Math.random() < bounceChance
      ? pickWallBounce(start, target, bounds ?? { left: 0, right: w, top: 0, bottom: h }, size / 2)
      : null;
    return {
      die, geom, rgb,
      targetFace: geom.faces[targetFaceIndex(geom, die.value)],
      textColor: die.raise ? '#ffffff' : palette ? contrasting : (customTextColor ?? contrasting),
      size,
      start, target,
      ...(wall ? { via: wall.via, viaAt: wall.viaAt } : {}),
      delay: timing[i].delay,
      dur: timing[i].dur,
      fadeAt: fade[i],
      qTarget: targetOrientation(geom, die.value),
      spinAxis: norm(v3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)),
      spinTotal: (Math.PI * 2) * (2.2 + Math.random() * 1.6) * (fromLeft ? 1 : -1),
      bounceH: 170 + Math.random() * 90,
      aceStyle,
    };
  });
}

export function simsSettleTime(sims: DieSim[]): number {
  const landed = Math.max(...sims.map((s) => s.delay + s.dur));
  // A losing arm's grey-out can begin as late as the final landing, so the
  // roll isn't finished until that fade has played out too.
  const faded = sims.reduce((m, s) => (s.fadeAt === Infinity ? m : Math.max(m, s.fadeAt + FADE_MS)), 0);
  return Math.max(landed, faded);
}

/**
 * Upper bound on how long a roll's animation will run, using the same
 * schedule buildSims does but assuming the longest possible throw. Callers
 * that must not get ahead of the dice (holding the chat entry back until
 * every die — including a chain of aces — has landed) use this.
 */
export function estimateDiceAnimMs(dice: DieRoll[]): number {
  if (dice.length === 0) return 0;
  const MAX_DUR = 1700;
  const settleAt: number[] = [];
  let waveDelay = 0;
  let latest = 0;
  dice.forEach((_, i) => {
    const continuesAnAce = i > 0 && dice[i - 1].ace === true;
    const delay = continuesAnAce ? settleAt[i - 1] + ACE_GAP_MS : (waveDelay += i === 0 ? 0 : WAVE_STAGGER_MS);
    settleAt[i] = delay + MAX_DUR;
    latest = Math.max(latest, settleAt[i]);
  });
  latest += FADE_MS; // a losing arm's grey-out can start at the last landing
  // However wild the chain, never leave the chat waiting on the dice forever.
  // The read pause makes long chains slower, so the ceiling has room to match.
  return Math.min(latest, 20000);
}

// ---------- rendering ----------

const LIGHT = norm(v3(0.35, -0.55, 0.75));

// Traditional d6 pip layout (dot positions in units of the 24px-font-scaled
// face-local grid drawDie's affine transform sets up), rather than a painted
// numeral -- a d6 face is a plain square, so there's no orientation to get
// wrong the way a numeral could render upside down.
const PIP_LAYOUT: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
const PIP_SPACING = 8;
const PIP_RADIUS = 3.6;

function drawPips(ctx: CanvasRenderingContext2D, value: number, color: string): void {
  ctx.fillStyle = color;
  for (const [px, py] of PIP_LAYOUT[value] ?? []) {
    ctx.beginPath();
    ctx.arc(px * PIP_SPACING, py * PIP_SPACING, PIP_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * What an aced die does while the table waits for its bonus die. Every style
 * gets the same contract: one call, a 0..1 phase, and the die's centre and
 * size — so they stay interchangeable and none of them can outlive the pause
 * before the next die is thrown.
 *
 * `phase` runs 0 → 1 across ACE_FLASH_MS. Fading out by the end is each
 * style's own job; the caller restores alpha afterwards either way.
 */
function drawAceEffect(
  ctx: CanvasRenderingContext2D, style: AceStyle, phase: number, cx: number, cy: number, size: number,
): void {
  const fade = 1 - phase;

  if (style === 'explosion') {
    // A movie fireball going off BEHIND the die (this whole function draws
    // before the die's own faces, so the die stays silhouetted against it).
    // Layered the way a real one reads: white flash, boiling fireball, black
    // smoke rolling off the top of it, shockwave, then the debris.

    // 1. The flash — enormous, white, and over almost before you see it.
    const flash = 1 - Math.min(1, phase * 5);
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.95;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 5.2 * (0.4 + phase * 3));
      g.addColorStop(0, 'rgba(255, 255, 255, 1)');
      g.addColorStop(0.35, 'rgba(255, 244, 190, 0.9)');
      g.addColorStop(1, 'rgba(255, 180, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 5.2 * (0.4 + phase * 3), 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. The fireball: overlapping blobs at their own radii and speeds, so the
    // edge boils instead of expanding as one clean circle.
    const grow = 1 - Math.pow(1 - phase, 2.2); // fast out, then settling
    for (let b = 0; b < 11; b++) {
      const ang = (b / 11) * Math.PI * 2 + b * 1.31;
      const lean = size * (0.25 + (b % 4) * 0.32) * grow * 2.6;
      const bx = cx + Math.cos(ang) * lean;
      // Fireballs climb as they burn out.
      const by = cy + Math.sin(ang) * lean * 0.78 - grow * size * 0.85;
      const br = size * (1.15 + (b % 3) * 0.42) * (0.45 + grow * 1.35);
      // Cools from white-hot through orange to a dull red as it dies.
      const heat = Math.max(0, 1 - phase * 1.35);
      ctx.globalAlpha = Math.min(1, fade * 1.5) * 0.72;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(255, ${170 + 80 * heat}, ${60 + 120 * heat}, ${0.55 + 0.45 * heat})`);
      g.addColorStop(0.55, `rgba(${230 + 25 * heat}, ${90 + 70 * heat}, 24, ${0.5 + 0.3 * heat})`);
      g.addColorStop(1, 'rgba(90, 22, 6, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Black smoke rolling off the fireball as it burns down.
    const sooty = Math.max(0, (phase - 0.28) / 0.72);
    if (sooty > 0) {
      for (let s = 0; s < 7; s++) {
        const ang = (s / 7) * Math.PI * 2 + s * 0.9;
        const d = size * (1.1 + sooty * 2.4);
        const sx = cx + Math.cos(ang) * d * 0.85;
        const sy = cy + Math.sin(ang) * d * 0.6 - sooty * size * 1.5;
        const sr = size * (0.75 + sooty * 1.5);
        ctx.globalAlpha = sooty * fade * 0.75;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        g.addColorStop(0, 'rgba(38, 32, 30, 0.9)');
        g.addColorStop(1, 'rgba(30, 26, 24, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Shockwave: a thin bright ring outrunning the fire.
    const ring = size * (0.6 + phase * 5.5);
    ctx.globalAlpha = fade * fade * 0.85;
    ctx.strokeStyle = 'rgba(255, 226, 150, 0.95)';
    ctx.lineWidth = Math.max(0.6, size * 0.16 * fade);
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();

    // 5. Debris and sparks thrown clear, pulled down as they fly.
    for (let s = 0; s < 18; s++) {
      const ang = (s / 18) * Math.PI * 2 + s * 0.61;
      const speed = 0.75 + ((s * 13) % 7) / 7 * 1.5;
      const d = size * (0.7 + phase * 4.4 * speed);
      const gravity = size * 2.2 * phase * phase;
      const ember = s % 3 === 0;
      ctx.globalAlpha = fade * (ember ? 1 : 0.85);
      ctx.fillStyle = ember ? 'rgba(255, 214, 128, 0.95)' : 'rgba(58, 42, 34, 0.9)';
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(ang) * d,
        cy + Math.sin(ang) * d * 0.8 - size * 0.5 + gravity,
        Math.max(0.5, size * (ember ? 0.07 : 0.1) * fade), 0, Math.PI * 2,
      );
      ctx.fill();
    }
    return;
  }

  if (style === 'flames') {
    // The die is engulfed, not merely singed. Three shells of fire radiating
    // in EVERY direction, each with its own colour, reach, tongue count and
    // clock — and each beating a third of a cycle behind the one outside it,
    // so they rise and fall in succession rather than pulsing as one blob.
    //
    // Additive: where two tongues cross they run to white, which is how fire
    // actually reads and what makes the core look hot rather than painted.
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const LAYERS = [
      // reach  tongues  width  flicker  spin   root colour        tip colour
      { len: 2.20, n: 10, w: 0.34, flick: 5.0, spin: 1.30, hot: '255, 78, 8', tip: '255, 146, 34' },
      { len: 1.55, n: 8, w: 0.42, flick: 6.8, spin: -1.05, hot: '255, 142, 20', tip: '255, 210, 92' },
      { len: 0.95, n: 6, w: 0.54, flick: 8.6, spin: 1.75, hot: '255, 220, 130', tip: '255, 252, 228' },
    ];
    LAYERS.forEach((L, li) => {
      // Each shell trails the last by a third of the beat — the successive
      // rise and fall, rather than three shells breathing together.
      const beat = 0.6 + 0.4 * Math.sin((phase * 2.2 - li / 3) * Math.PI * 2);
      for (let f = 0; f < L.n; f++) {
        const ang = (f / L.n) * Math.PI * 2 + phase * L.spin + li * 0.6;
        const flick = 0.72 + 0.28 * Math.sin(phase * L.flick * Math.PI * 2 + f * 2.3 + li);
        const len = size * L.len * beat * flick * (0.55 + fade * 0.65);
        const w = size * L.w;
        // Tongues curl off true rather than pointing dead outward.
        const sway = Math.sin(phase * 9 + f * 1.7 + li * 2.1) * w * 0.55;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, `rgba(${L.hot}, 0)`);
        g.addColorStop(0.28, `rgba(${L.hot}, ${0.8 * fade})`);
        g.addColorStop(0.78, `rgba(${L.tip}, ${0.72 * fade})`);
        g.addColorStop(1, 'rgba(255, 250, 236, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -w * 0.5);
        ctx.quadraticCurveTo(len * 0.55, -w * 0.7 + sway, len, sway * 0.45);
        ctx.quadraticCurveTo(len * 0.55, w * 0.7 + sway, 0, w * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    // A hot core so the die sits inside the fire rather than in front of it.
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.15);
    core.addColorStop(0, `rgba(255, 236, 190, ${0.5 * fade})`);
    core.addColorStop(0.5, `rgba(255, 140, 36, ${0.32 * fade})`);
    core.addColorStop(1, 'rgba(255, 90, 10, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 1.15, 0, Math.PI * 2);
    ctx.fill();
    // Embers thrown clear on every bearing, not just off the top. The golden
    // angle keeps successive ones from lining up into visible spokes.
    ctx.globalAlpha = fade * 0.9;
    for (let e = 0; e < 14; e++) {
      const t = (phase * 1.7 + e * 0.071) % 1;
      const a = e * 2.399963 + phase * 1.4;
      const d = size * (0.55 + t * 2.2);
      ctx.fillStyle = t < 0.5 ? 'rgba(255, 232, 164, 0.95)' : 'rgba(255, 132, 48, 0.9)';
      ctx.beginPath();
      // Drifting up as they cool, whichever way they were thrown.
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d - t * t * size * 0.7, Math.max(0.4, size * 0.075 * (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = prevOp;
    return;
  }

  if (style === 'disco') {
    // The die IS the mirror ball: a slow turn throwing dots of coloured light
    // out across the room around it. The sparkles carry this one — the beams
    // are just the haze they travel through — so there are a lot of them, and
    // the whole rig turns lazily rather than spinning.
    const spin = phase * Math.PI * 0.55;

    // Faint beams, wide and soft, to hint at light in the air.
    ctx.globalAlpha = fade * 0.28;
    for (let b = 0; b < 10; b++) {
      const ang = spin + (b / 10) * Math.PI * 2;
      const hue = (b * 36 + phase * 40) % 360;
      const reach = size * 3.6;
      const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * reach, cy + Math.sin(ang) * reach);
      g.addColorStop(0, `hsla(${hue}, 95%, 74%, 0.7)`);
      g.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, reach, ang - 0.2, ang + 0.2);
      ctx.closePath();
      ctx.fill();
    }

    // The dots themselves: three rings at different radii, each turning at a
    // slightly different rate so the field never looks like one rigid wheel.
    // Each dot twinkles on its own clock, the way a facet catches the light
    // only when it comes round to the right angle.
    for (let ring = 0; ring < 3; ring++) {
      const count = 14 + ring * 4;
      const radius = size * (1.35 + ring * 0.95);
      const rate = 1 + ring * 0.22;
      for (let s = 0; s < count; s++) {
        const ang = spin * rate + (s / count) * Math.PI * 2 + ring * 0.7;
        // Squashed vertically so the dots read as scattered around a room
        // rather than pinned to a flat circle.
        const px = cx + Math.cos(ang) * radius;
        const py = cy + Math.sin(ang) * radius * 0.62;
        const twinkle = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(phase * 6 + s * 1.7 + ring)), 2);
        ctx.globalAlpha = fade * twinkle;
        ctx.fillStyle = `hsla(${(s * 47 + ring * 90 + phase * 60) % 360}, 100%, ${68 + 12 * twinkle}%, 1)`;
        const r = size * (0.05 + 0.045 * twinkle);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // A tight bright core, so the ball itself looks lit rather than lighting
    // everything else from nowhere.
    ctx.globalAlpha = fade * 0.4;
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.25);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    core.addColorStop(1, 'rgba(200, 220, 255, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 1.25, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (style === 'rainbow') {
    // A real rainbow standing around the die: seven fixed bands, red on the
    // outside through to violet on the inside, the way one actually appears.
    // It draws itself on around the circle, holds, then fades — it does NOT
    // travel outward, so the die stays inside its own arc rather than sitting
    // at the centre of a ripple.
    const BANDS = ['#ff2f2f', '#ff8b1f', '#ffe234', '#3fd24b', '#28b6ff', '#3a5bd9', '#8b3fd6'];
    const band = Math.max(1.2, size * 0.13);
    const inner = size * 1.15;
    // Sweep on over the first third, hold, then fade over the last third.
    const sweep = Math.min(1, phase / 0.34);
    const hold = phase < 0.62 ? 1 : 1 - (phase - 0.62) / 0.38;
    // Starts at the top and comes round clockwise, like an arc being painted.
    const from = -Math.PI / 2;
    ctx.lineCap = 'butt';
    for (let b = 0; b < BANDS.length; b++) {
      // Outermost band is red, so walk the radius DOWN through the list.
      const radius = inner + (BANDS.length - 1 - b) * band;
      ctx.globalAlpha = Math.max(0, hold) * 0.92;
      ctx.strokeStyle = BANDS[b];
      ctx.lineWidth = band;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, from, from + Math.PI * 2 * sweep);
      ctx.stroke();
    }
    // A soft white bloom just inside the violet, so the ring reads as light
    // rather than seven flat hoops.
    ctx.globalAlpha = Math.max(0, hold) * 0.28;
    const g = ctx.createRadialGradient(cx, cy, inner * 0.5, cx, cy, inner);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0.85)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (style === 'confetti') {
    // A party popper going off inside the die: every piece is fired outward on
    // its own heading, then gravity takes it and it flutters all the way down
    // and off the bottom of the screen. Three things sell it as paper rather
    // than as sparks — the outward push dies fast, each piece tumbles about
    // its own axis (drawn as a rectangle squashed by the cosine of its spin,
    // so it presents edge-on and flat by turns), and the fall is a slow sway
    // rather than a straight drop.
    const COLORS = [
      '#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff',
      '#ff8fab', '#ffe66d', '#43e97b', '#5bc0eb', '#f72585',
    ];
    const PIECES = 74;
    // How far down the piece still has to travel. Measured from the die to
    // past the bottom edge, so they leave the screen rather than piling up on
    // an invisible floor.
    const fallDist = Math.max(ctx.canvas.height - cy, ctx.canvas.height * 0.5) + size * 6;

    // The push outward is over almost at once; everything after it is falling.
    const burst = easeOutCubic(Math.min(1, phase / 0.13));
    const fallT = Math.max(0, (phase - 0.08) / 0.92);
    // Starts from rest and settles to a near-constant drift, the way a light
    // sheet of paper reaches terminal velocity within a few feet.
    const fall = fallDist * (fallT * fallT * 0.34 + fallT * 0.66);

    ctx.lineCap = 'butt';
    for (let p = 0; p < PIECES; p++) {
      // Deterministic per-piece jitter: same die, same confetti, every frame.
      const a = (p / PIECES) * Math.PI * 2 + ((p * 37) % 13) * 0.11;
      const spread = 0.55 + ((p * 17) % 9) / 9 * 0.9;
      const reach = size * (1.6 + spread * 3.4);

      // Sideways drift keeps going long after the burst, and each piece sways
      // on its own clock — that scatter is what stops it reading as a fan.
      const swayRate = 3.4 + ((p * 7) % 5) * 0.9;
      const swayPhase = ((p * 23) % 17) * 0.37;
      const sway = Math.sin(phase * swayRate * Math.PI + swayPhase) * size * (0.5 + ((p * 3) % 4) * 0.22);

      const px = cx + Math.cos(a) * reach * burst + sway + Math.cos(a) * fall * 0.09;
      // Pieces fired upward get to rise before gravity wins, so the cloud
      // opens up before it comes down.
      const py = cy + Math.sin(a) * reach * burst * 0.85 + fall;
      if (py > ctx.canvas.height + size * 2) continue;   // already gone

      // Tumble. cos() of the spin squashes the rectangle to nothing twice a
      // turn, which is the whole trick: it looks like a flat sheet turning
      // edge-on rather than a spinning brick.
      const spin = phase * (5.5 + ((p * 11) % 6) * 1.7) * Math.PI + p;
      const w = size * 0.30;
      const h = size * 0.19;
      const flat = Math.cos(spin);
      // Only fade at the very end, and only for stragglers still on screen —
      // confetti leaves by falling out of frame, not by dissolving.
      ctx.globalAlpha = Math.min(1, (1 - phase) * 4) * (0.85 + 0.15 * Math.abs(flat));

      ctx.save();
      ctx.translate(px, py);
      // Lean into the direction of travel so it flutters rather than slides.
      ctx.rotate(Math.sin(spin * 0.5) * 0.9 + a * 0.15);
      ctx.fillStyle = COLORS[p % COLORS.length];
      ctx.fillRect(-w / 2, (-h / 2) * flat, w, Math.max(0.7, h * Math.abs(flat)));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (style === 'smoke') {
    // A dense bank of smoke bursting off the die in every direction, not a
    // wisp rising off the top. Three passes, back to front: a wide base cloud
    // that swallows the die, billows rolling outward on all sides, then a
    // lighter crown drifting up off the whole thing.

    // The die sits in the middle of it, so the cloud has to be opaque enough
    // to actually read against the map — hence alphas near 1 rather than the
    // faint 0.4 this had, and a full-strength hold before it thins out.
    const thin = Math.max(0, (phase - 0.55) / 0.45); // only starts clearing late
    const body = 1 - thin;

    // 1. Base cloud: one big soft mass centred on the die.
    {
      const r = size * (1.1 + 2.5 * Math.min(1, phase * 1.6));
      ctx.globalAlpha = body * 0.82;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(150, 150, 158, 0.95)');
      g.addColorStop(0.55, 'rgba(122, 122, 130, 0.7)');
      g.addColorStop(1, 'rgba(96, 96, 104, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Billows: 18 puffs pushed out evenly on every side, each on its own
    // clock and its own size so the edge churns instead of scaling.
    for (let p = 0; p < 18; p++) {
      const ang = (p / 18) * Math.PI * 2 + p * 0.83;
      const t = Math.min(1, phase * (0.85 + ((p * 11) % 7) / 7 * 0.6));
      const push = size * (0.5 + t * 2.7) * (0.75 + ((p * 5) % 4) / 4 * 0.5);
      // Smoke still rises, so the whole cloud leans upward as it spreads.
      const px = cx + Math.cos(ang) * push;
      const py = cy + Math.sin(ang) * push * 0.85 - t * size * 0.7;
      const r = size * (0.55 + t * 1.25);
      const shade = 128 + ((p * 29) % 54);
      ctx.globalAlpha = body * (0.55 + 0.4 * Math.sin(Math.min(1, t) * Math.PI));
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${shade}, ${shade}, ${shade + 8}, 0.98)`);
      g.addColorStop(0.5, `rgba(${shade - 24}, ${shade - 24}, ${shade - 16}, 0.72)`);
      g.addColorStop(1, 'rgba(84, 84, 92, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Crown: paler smoke lifting off the top of the bank.
    for (let c = 0; c < 6; c++) {
      const t = (phase * 1.3 + c * 0.16) % 1;
      const px = cx + Math.sin(t * 4 + c * 2.3) * size * 0.9;
      const py = cy - size * (0.8 + t * 2.6);
      const r = size * (0.5 + t * 1.1);
      ctx.globalAlpha = body * (1 - t) * 0.6;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(178, 178, 186, 0.9)');
      g.addColorStop(1, 'rgba(150, 150, 158, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (style === 'water') {
    // A splash: ripples spreading on the surface the die landed on, a short
    // crown of water thrown up around it, and droplets arcing back down.
    for (let r = 0; r < 3; r++) {
      const t = (phase * 1.25 + r / 3) % 1;
      ctx.globalAlpha = (1 - t) * fade * 0.75;
      ctx.strokeStyle = 'rgba(120, 206, 255, 0.95)';
      ctx.lineWidth = Math.max(0.7, size * 0.1 * (1 - t));
      ctx.beginPath();
      // Flattened, because a ripple is read on the ground plane, not facing us.
      ctx.ellipse(cx, cy + size * 0.5, size * (0.6 + t * 2.5), size * (0.22 + t * 0.9), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The crown — a ring of short sheets of water thrown up, collapsing fast.
    const crown = 1 - Math.min(1, phase * 2.2);
    if (crown > 0) {
      ctx.globalAlpha = crown * 0.7;
      ctx.fillStyle = 'rgba(150, 220, 255, 0.9)';
      for (let s = 0; s < 10; s++) {
        const ang = (s / 10) * Math.PI * 2;
        const spread = size * (0.75 + (1 - crown) * 0.7);
        const px = cx + Math.cos(ang) * spread;
        const py = cy + size * 0.5 + Math.sin(ang) * spread * 0.36;
        const hgt = size * 0.55 * crown;
        ctx.beginPath();
        ctx.moveTo(px - size * 0.07, py);
        ctx.lineTo(px, py - hgt);
        ctx.lineTo(px + size * 0.07, py);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Droplets thrown clear, pulled back down by gravity as they go.
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(180, 232, 255, 0.95)';
    for (let d = 0; d < 8; d++) {
      const ang = (d / 8) * Math.PI * 2 + 0.4;
      const out = size * (0.7 + phase * 2.4);
      const gravity = size * 2.6 * phase * phase;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(ang) * out,
        cy - size * 0.9 + Math.sin(ang) * out * 0.4 + gravity,
        Math.max(0.5, size * 0.085 * fade), 0, Math.PI * 2,
      );
      ctx.fill();
    }
    return;
  }

  // 'flash' — the original: a golden halo pulsing while the bonus die is
  // readied, with a few sparks thrown off the die as it goes.
  const pulse = Math.sin(phase * Math.PI * 3) * 0.5 + 0.5;
  ctx.globalAlpha = (0.30 + 0.45 * pulse) * fade;
  const glow = ctx.createRadialGradient(cx, cy, size * 0.4, cx, cy, size * (1.7 + 0.5 * pulse));
  glow.addColorStop(0, 'rgba(255, 226, 138, 0.95)');
  glow.addColorStop(0.55, 'rgba(255, 186, 60, 0.45)');
  glow.addColorStop(1, 'rgba(255, 170, 40, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * (1.7 + 0.5 * pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = fade * 0.9;
  ctx.fillStyle = 'rgba(255, 236, 170, 0.95)';
  for (let s = 0; s < 6; s++) {
    const ang = (s / 6) * Math.PI * 2 + phase * 2.2;
    const dist = size * (0.9 + phase * 1.5);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, Math.max(0.4, 2.6 * fade), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDie(ctx: CanvasRenderingContext2D, sim: DieSim, tMs: number, onAce?: (style: AceStyle) => void): void {
  const te = Math.max(0, Math.min(1, (tMs - sim.delay) / sim.dur));
  if (tMs < sim.delay - 1) return;
  const ease = easeOutCubic(te);
  // A die that takes a wall travels start → contact → rest as two straight
  // legs; one that doesn't goes straight there, exactly as before.
  let x: number;
  let y: number;
  if (sim.via && sim.viaAt !== undefined) {
    const k = sim.viaAt;
    if (ease <= k) {
      const u = ease / k;
      x = sim.start.x + (sim.via.x - sim.start.x) * u;
      y = sim.start.y + (sim.via.y - sim.start.y) * u;
    } else {
      const u = (ease - k) / (1 - k);
      x = sim.via.x + (sim.target.x - sim.via.x) * u;
      y = sim.via.y + (sim.target.y - sim.via.y) * u;
    }
  } else {
    x = sim.start.x + (sim.target.x - sim.start.x) * ease;
    y = sim.start.y + (sim.target.y - sim.start.y) * ease;
  }
  const height = te >= 1 ? 0 : sim.bounceH * Math.abs(Math.cos(te * Math.PI * 2.3)) * Math.pow(1 - te, 1.6);
  const q = qMul(sim.qTarget, qAxisAngle(sim.spinAxis, sim.spinTotal * (1 - ease)));

  // Post-settle pop: a brief scale pulse right as the die lands.
  const sinceSettle = tMs - (sim.delay + sim.dur);
  const pop = sinceSettle > 0 && sinceSettle < 260 ? 1 + 0.14 * Math.sin((sinceSettle / 260) * Math.PI) : 1;
  const size = sim.size * pop;

  // A losing arm greys out, but only from the moment it is beyond saving —
  // see fadeTimes(). Until then it renders at full strength, so nothing about
  // dice still to be thrown is given away.
  const fadeT = sim.fadeAt === Infinity ? 0 : Math.max(0, Math.min(1, (tMs - sim.fadeAt) / FADE_MS));
  const dieAlpha = 1 - (1 - DROPPED_ALPHA) * fadeT;
  ctx.globalAlpha = dieAlpha;

  // An aced die announces itself the moment it lands: a bright halo that
  // pulses while the bonus die is being readied, so the table can see
  // exactly which die exploded and why another is about to be thrown.
  const aceMs = aceEffectMs(sim.aceStyle);
  const acePhase = sim.die.ace && sinceSettle > 0 && sinceSettle < aceMs
    ? sinceSettle / aceMs
    : null;
  if (acePhase !== null) {
    // Announce the ace once, on the first frame of its effect — the caller
    // owns what that means (a sound), this only says when.
    if (!sim.aceSounded) { sim.aceSounded = true; onAce?.(sim.aceStyle); }
    ctx.save();
    drawAceEffect(ctx, sim.aceStyle, acePhase, x, y - height * 0.85, size);
    ctx.restore();
    ctx.globalAlpha = dieAlpha; // restore after the effect's own fades
  }

  // Ground shadow, tied to the table position (not the airborne die).
  const shrink = Math.max(0.35, 1 - height / 320);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.32 * shrink})`;
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.66, size * 0.85 * shrink, size * 0.32 * shrink, 0, 0, Math.PI * 2);
  ctx.fill();

  const cx = x, cy = y - height * 0.85;

  // Rotate, project (weak perspective), collect visible faces.
  const faces = sim.geom.faces
    .map((f) => {
      const normal = qRotate(q, f.normal);
      if (normal.z <= 0.02) return null;
      const pts = f.verts.map((p) => {
        const r = qRotate(q, p);
        const persp = 1 + r.z * 0.16;
        return { x: cx + r.x * size * persp, y: cy + r.y * size * persp, z: r.z };
      });
      return { f, normal, pts, depth: pts.reduce((s, p) => s + p.z, 0) / pts.length };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => a.depth - b.depth);

  for (const { f, normal, pts } of faces) {
    const lambert = 0.52 + 0.48 * Math.max(0, dot(normal, LIGHT));
    ctx.fillStyle = shade(sim.rgb, lambert);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Paint the number in the face plane via an affine transform of the
    // face's (text-right, text-down) basis — it foreshortens with the face.
    if (f.label && normal.z > 0.3) {
      const c3 = qRotate(q, f.center);
      const persp = 1 + c3.z * 0.16;
      const c2 = { x: cx + c3.x * size * persp, y: cy + c3.y * size * persp };
      const u3 = qRotate(q, f.u);
      const v3r = qRotate(q, f.v);
      const k = (f.textSize * size) / 24; // 24px font drawn in face units
      ctx.save();
      // Post-multiply so the canvas's own DPR scaling stays in effect.
      ctx.transform(u3.x * k, u3.y * k, v3r.x * k, v3r.y * k, c2.x, c2.y);
      if (sim.die.sides === 6) {
        drawPips(ctx, Number(f.label), sim.textColor);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // A d100 reads as a percentile die (00–90) while tumbling; only the
        // landing face carries the exact rolled value.
        let label = f.label;
        if (sim.die.sides === 100) {
          label = f === sim.targetFace ? String(sim.die.value) : String((Number(f.label) % 10) * 10).padStart(2, '0');
        }
        ctx.font = `800 ${label.length >= 3 ? 18 : 24}px system-ui, sans-serif`;
        ctx.fillStyle = sim.textColor;
        ctx.fillText(label, 0, 1.5);
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/** Draw one animation frame; returns true while anything is still moving. */
export function drawFrame(
  ctx: CanvasRenderingContext2D, sims: DieSim[], tMs: number, w: number, h: number,
  onAce?: (style: AceStyle) => void,
): boolean {
  ctx.clearRect(0, 0, w, h);
  for (const sim of sims) drawDie(ctx, sim, tMs, onAce);
  return tMs < simsSettleTime(sims) + 400;
}
