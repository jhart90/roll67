// Software-3D dice: real polyhedron models for d2–d20 (+d100), tumbled with
// quaternions and rendered onto a 2D canvas with flat shading — no WebGL or
// three.js. Each die rolls in from offscreen with a decaying spin that ends
// EXACTLY on the orientation that shows the rolled face (number upright),
// bouncing on the "table" (the screen plane) as it settles near the middle.

import type { DieRoll } from 'shared';

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

function makeFace(verts: Vec3[], label: string | null, textSize: number): Face {
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
  // the face plane (matters for the non-planar kites).
  const uRaw = sub(ordered[0], center);
  const u = norm(sub(uRaw, scale(normal, dot(uRaw, normal))));
  const v = norm(cross(normal, u));
  return { verts: ordered, label, normal, center, u, v, textSize };
}

function buildDie(rawFaces: Vec3[][], labelled: number, textSize: number): DieGeometry {
  const faces = rawFaces.map((verts, i) => makeFace(verts, i < labelled ? String(i + 1) : null, textSize));
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
  ], 6, 0.62);
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
  10: trapezohedron(), 12: dodecahedron(), 20: icosahedron(), 100: trapezohedron(),
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

export const DEFAULT_DIE_COLORS: Record<number, string> = {
  2: '#c9cfdd', 4: '#d26c6c', 6: '#6c9bd2', 8: '#7ed28a',
  10: '#6cd2c8', 12: '#b06cd2', 20: '#d2a56c', 100: '#d2d26c',
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
  qTarget: Quat;
  spinAxis: Vec3;
  spinTotal: number;
  bounceH: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function buildSims(
  dice: DieRoll[], w: number, h: number, customColor: string | null,
): DieSim[] {
  const n = dice.length;
  const cols = Math.min(n, 6);
  const rowCount = Math.ceil(n / cols);
  const spacing = 96;
  const cx = w / 2, cy = h / 2;
  return dice.map((die, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const target = {
      x: cx + (col - (inRow - 1) / 2) * spacing + (Math.random() - 0.5) * 16,
      y: cy + (row - (rowCount - 1) / 2) * spacing + (Math.random() - 0.5) * 16,
    };
    // Enter from the left or right edge, biased low, like a real throw.
    const fromLeft = target.x < cx ? Math.random() < 0.8 : Math.random() < 0.2;
    const start = {
      x: fromLeft ? -80 : w + 80,
      y: target.y + 120 + Math.random() * 160,
    };
    const geom = geometryFor(die.sides);
    const rgb = hexToRgb(customColor ?? DEFAULT_DIE_COLORS[die.sides] ?? '#9aa1b3');
    return {
      die, geom, rgb,
      targetFace: geom.faces[targetFaceIndex(geom, die.value)],
      textColor: luminance(rgb) > 0.45 ? '#10131a' : '#f4f6fb',
      size: die.sides === 20 ? 44 : die.sides === 2 ? 38 : 41,
      start, target,
      delay: i * 110,
      dur: 1450 + Math.random() * 250,
      qTarget: targetOrientation(geom, die.value),
      spinAxis: norm(v3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)),
      spinTotal: (Math.PI * 2) * (2.2 + Math.random() * 1.6) * (fromLeft ? 1 : -1),
      bounceH: 170 + Math.random() * 90,
    };
  });
}

export function simsSettleTime(sims: DieSim[]): number {
  return Math.max(...sims.map((s) => s.delay + s.dur));
}

// ---------- rendering ----------

const LIGHT = norm(v3(0.35, -0.55, 0.75));

function drawDie(ctx: CanvasRenderingContext2D, sim: DieSim, tMs: number): void {
  const te = Math.max(0, Math.min(1, (tMs - sim.delay) / sim.dur));
  if (tMs < sim.delay - 1) return;
  const ease = easeOutCubic(te);
  const x = sim.start.x + (sim.target.x - sim.start.x) * ease;
  const y = sim.start.y + (sim.target.y - sim.start.y) * ease;
  const height = te >= 1 ? 0 : sim.bounceH * Math.abs(Math.cos(te * Math.PI * 2.3)) * Math.pow(1 - te, 1.6);
  const q = qMul(sim.qTarget, qAxisAngle(sim.spinAxis, sim.spinTotal * (1 - ease)));

  // Post-settle pop: a brief scale pulse right as the die lands.
  const sinceSettle = tMs - (sim.delay + sim.dur);
  const pop = sinceSettle > 0 && sinceSettle < 260 ? 1 + 0.14 * Math.sin((sinceSettle / 260) * Math.PI) : 1;
  const size = sim.size * pop;

  const dropped = !sim.die.kept;
  ctx.globalAlpha = dropped ? 0.45 : 1;

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
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/** Draw one animation frame; returns true while anything is still moving. */
export function drawFrame(ctx: CanvasRenderingContext2D, sims: DieSim[], tMs: number, w: number, h: number): boolean {
  ctx.clearRect(0, 0, w, h);
  for (const sim of sims) drawDie(ctx, sim, tMs);
  return tMs < simsSettleTime(sims) + 400;
}
