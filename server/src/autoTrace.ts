import sharp from 'sharp';
import path from 'node:path';
import { UPLOADS_DIR } from './config.js';

interface Seg { x1: number; y1: number; x2: number; y2: number }

const MAX_DIM = 1024;

/** Detect straight wall-like edges in a map background image using Sobel edge
 *  detection + Hough line transform.  Returns line segments in the original
 *  image's pixel coordinate space. */
export async function detectWalls(assetId: string, ext: string, minLengthPx: number): Promise<Seg[]> {
  const filePath = path.join(UPLOADS_DIR, `${assetId}.${ext}`);
  const meta = await sharp(filePath).metadata();
  const origW = meta.width!;
  const origH = meta.height!;
  const scale = Math.min(1, MAX_DIM / Math.max(origW, origH));
  const pw = Math.round(origW * scale);
  const ph = Math.round(origH * scale);

  const { data } = await sharp(filePath)
    .resize(pw, ph, { fit: 'fill' })
    .grayscale()
    .blur(2.0)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { mag, dir } = sobel(data, pw, ph);
  const edges = canny(mag, dir, pw, ph);
  const minLen = Math.max(12, Math.round(minLengthPx * scale));
  const segments = houghSegments(edges, pw, ph, minLen);
  const merged = mergeSegments(segments, minLen * 0.4);

  const inv = 1 / scale;
  return merged.map(s => ({
    x1: Math.round(s.x1 * inv), y1: Math.round(s.y1 * inv),
    x2: Math.round(s.x2 * inv), y2: Math.round(s.y2 * inv),
  }));
}

// --------------- Sobel gradient ---------------

function sobel(data: Buffer, w: number, h: number): { mag: Float32Array; dir: Float32Array } {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = data[(y - 1) * w + x - 1], tc = data[(y - 1) * w + x], tr = data[(y - 1) * w + x + 1];
      const ml = data[y * w + x - 1], mr = data[y * w + x + 1];
      const bl = data[(y + 1) * w + x - 1], bc = data[(y + 1) * w + x], br = data[(y + 1) * w + x + 1];
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      dir[y * w + x] = Math.atan2(gy, gx);
    }
  }
  return { mag, dir };
}

// --------------- Canny-style NMS + hysteresis ---------------

function canny(mag: Float32Array, dir: Float32Array, w: number, h: number): Uint8Array {
  // Adaptive thresholds: use top percentile of gradient magnitudes.
  const sorted = Float32Array.from(mag).sort();
  const nonZero = sorted.findIndex(v => v > 0);
  const count = sorted.length - nonZero;
  const high = sorted[Math.min(sorted.length - 1, nonZero + Math.round(count * 0.96))];
  const low = high * 0.5;

  // Non-maximum suppression along gradient direction.
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const m = mag[y * w + x];
      if (m < low) continue;
      const a = ((dir[y * w + x] * 4 / Math.PI) + 4.5) | 0;
      const d = a % 4; // 0=horiz, 1=diag, 2=vert, 3=antidiag
      let m1: number, m2: number;
      if (d === 0) { m1 = mag[y * w + x - 1]; m2 = mag[y * w + x + 1]; }
      else if (d === 1) { m1 = mag[(y - 1) * w + x + 1]; m2 = mag[(y + 1) * w + x - 1]; }
      else if (d === 2) { m1 = mag[(y - 1) * w + x]; m2 = mag[(y + 1) * w + x]; }
      else { m1 = mag[(y - 1) * w + x - 1]; m2 = mag[(y + 1) * w + x + 1]; }
      if (m >= m1 && m >= m2) nms[y * w + x] = m;
    }
  }

  // Hysteresis: strong pixels seed, weak pixels connect.
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (nms[i] >= high) { out[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (!out[ni] && nms[ni] >= low) { out[ni] = 1; stack.push(ni); }
      }
    }
  }
  return out;
}

// --------------- Hough line transform → segments ---------------

function houghSegments(edges: Uint8Array, w: number, h: number, minLen: number): Seg[] {
  const NUM_THETA = 180;
  const diag = Math.ceil(Math.sqrt(w * w + h * h));
  const NUM_RHO = 2 * diag + 1;

  const sinT = new Float64Array(NUM_THETA);
  const cosT = new Float64Array(NUM_THETA);
  for (let t = 0; t < NUM_THETA; t++) {
    const a = (t * Math.PI) / NUM_THETA;
    sinT[t] = Math.sin(a);
    cosT[t] = Math.cos(a);
  }

  // Accumulate votes.
  const acc = new Int32Array(NUM_THETA * NUM_RHO);
  const edgePts: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue;
      edgePts.push({ x, y });
      for (let t = 0; t < NUM_THETA; t++) {
        const r = Math.round(x * cosT[t] + y * sinT[t]) + diag;
        acc[t * NUM_RHO + r]++;
      }
    }
  }

  // Find peaks with non-maximum suppression in accumulator space.
  const houghThresh = Math.max(20, Math.round(minLen * 0.75));
  const peaks: Array<{ theta: number; rho: number; votes: number }> = [];
  const NMS_W = 7;
  for (let t = 0; t < NUM_THETA; t++) {
    for (let r = NMS_W; r < NUM_RHO - NMS_W; r++) {
      const v = acc[t * NUM_RHO + r];
      if (v < houghThresh) continue;
      let isMax = true;
      outer: for (let dt = -NMS_W; dt <= NMS_W && isMax; dt++) {
        for (let dr = -NMS_W; dr <= NMS_W; dr++) {
          if (dt === 0 && dr === 0) continue;
          const tt = (t + dt + NUM_THETA) % NUM_THETA;
          const rr = r + dr;
          if (rr < 0 || rr >= NUM_RHO) continue;
          if (acc[tt * NUM_RHO + rr] > v) { isMax = false; break outer; }
        }
      }
      if (isMax) peaks.push({ theta: (t * Math.PI) / NUM_THETA, rho: r - diag, votes: v });
    }
  }

  // Extract segments from each peak.
  const segments: Seg[] = [];
  const GAP = Math.max(2, Math.round(minLen * 0.1));

  for (const peak of peaks) {
    const ct = Math.cos(peak.theta), st = Math.sin(peak.theta);
    // Direction along the line.
    const dx = -st, dy = ct;
    // A point on the line closest to origin.
    const ox = peak.rho * ct, oy = peak.rho * st;

    // Project all edge points onto this line; keep those close enough.
    const projections: number[] = [];
    const BAND = 1.5;
    for (const p of edgePts) {
      const perpDist = Math.abs((p.x - ox) * ct + (p.y - oy) * st);
      if (perpDist > BAND) continue;
      const along = (p.x - ox) * dx + (p.y - oy) * dy;
      projections.push(along);
    }
    if (projections.length < 2) continue;
    projections.sort((a, b) => a - b);

    // Walk projections and extract runs (allowing small gaps).
    let runStart = projections[0];
    let runEnd = projections[0];
    for (let i = 1; i < projections.length; i++) {
      if (projections[i] - runEnd <= GAP) {
        runEnd = projections[i];
      } else {
        if (runEnd - runStart >= minLen) {
          segments.push({
            x1: Math.round(ox + runStart * dx), y1: Math.round(oy + runStart * dy),
            x2: Math.round(ox + runEnd * dx), y2: Math.round(oy + runEnd * dy),
          });
        }
        runStart = projections[i];
        runEnd = projections[i];
      }
    }
    if (runEnd - runStart >= minLen) {
      segments.push({
        x1: Math.round(ox + runStart * dx), y1: Math.round(oy + runStart * dy),
        x2: Math.round(ox + runEnd * dx), y2: Math.round(oy + runEnd * dy),
      });
    }
  }

  return segments;
}

// --------------- Merge nearby collinear segments ---------------

function mergeSegments(segs: Seg[], mergeGap: number): Seg[] {
  if (segs.length === 0) return [];
  type Keyed = Seg & { angle: number; perp: number; len: number };
  const keyed: Keyed[] = segs.map(s => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI;
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    const perp = mx * Math.cos(angle + Math.PI / 2) + my * Math.sin(angle + Math.PI / 2);
    return { ...s, angle, perp, len: Math.hypot(dx, dy) };
  });

  // Sort by angle then perp distance.
  keyed.sort((a, b) => a.angle - b.angle || a.perp - b.perp);

  const ANGLE_TOL = 5 * Math.PI / 180;
  const PERP_TOL = mergeGap;
  const used = new Uint8Array(keyed.length);
  const merged: Seg[] = [];

  for (let i = 0; i < keyed.length; i++) {
    if (used[i]) continue;
    const group = [keyed[i]];
    used[i] = 1;
    for (let j = i + 1; j < keyed.length; j++) {
      if (used[j]) continue;
      const angleDiff = Math.min(Math.abs(keyed[j].angle - keyed[i].angle), Math.PI - Math.abs(keyed[j].angle - keyed[i].angle));
      if (angleDiff > ANGLE_TOL) continue;
      if (Math.abs(keyed[j].perp - keyed[i].perp) > PERP_TOL) continue;
      // Check if projections overlap or are within mergeGap.
      const dir = { x: Math.cos(keyed[i].angle), y: Math.sin(keyed[i].angle) };
      const proj = (p: { x: number; y: number }) => p.x * dir.x + p.y * dir.y;
      const a1 = Math.min(proj({ x: keyed[i].x1, y: keyed[i].y1 }), proj({ x: keyed[i].x2, y: keyed[i].y2 }));
      const a2 = Math.max(proj({ x: keyed[i].x1, y: keyed[i].y1 }), proj({ x: keyed[i].x2, y: keyed[i].y2 }));
      const b1 = Math.min(proj({ x: keyed[j].x1, y: keyed[j].y1 }), proj({ x: keyed[j].x2, y: keyed[j].y2 }));
      const b2 = Math.max(proj({ x: keyed[j].x1, y: keyed[j].y1 }), proj({ x: keyed[j].x2, y: keyed[j].y2 }));
      if (b1 > a2 + mergeGap || a1 > b2 + mergeGap) continue;
      group.push(keyed[j]);
      used[j] = 1;
    }

    // Merge the group: fit all endpoints to the average line direction, take the full extent.
    const dir = { x: Math.cos(group[0].angle), y: Math.sin(group[0].angle) };
    const proj = (p: { x: number; y: number }) => p.x * dir.x + p.y * dir.y;
    let pMin = Infinity, pMax = -Infinity;
    let sumPerp = 0, cnt = 0;
    for (const g of group) {
      const p1 = proj({ x: g.x1, y: g.y1 }), p2 = proj({ x: g.x2, y: g.y2 });
      pMin = Math.min(pMin, p1, p2);
      pMax = Math.max(pMax, p1, p2);
      const norm = { x: -dir.y, y: dir.x };
      sumPerp += g.x1 * norm.x + g.y1 * norm.y;
      sumPerp += g.x2 * norm.x + g.y2 * norm.y;
      cnt += 2;
    }
    const avgPerp = sumPerp / cnt;
    const norm = { x: -dir.y, y: dir.x };
    merged.push({
      x1: Math.round(pMin * dir.x + avgPerp * norm.x),
      y1: Math.round(pMin * dir.y + avgPerp * norm.y),
      x2: Math.round(pMax * dir.x + avgPerp * norm.x),
      y2: Math.round(pMax * dir.y + avgPerp * norm.y),
    });
  }

  return merged;
}
