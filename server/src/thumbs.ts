import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { THUMBS_DIR, UPLOADS_DIR } from './config.js';
import { assets } from './db/repos.js';

/**
 * Small thumbnails for the art browser.
 *
 * The asset library and picker are grids of little cards, but until now each
 * card loaded the full upload — a wall of 4096-pixel map backgrounds fetched
 * to be painted 150 pixels wide. This serves a ~320px WebP instead, generated
 * the first time anyone asks and cached on the volume, which also quietly
 * covers every asset uploaded before thumbnails existed: there is no backfill
 * step, just a cache miss.
 *
 * The thumbnail is addressed by asset id and the stored bytes under an id
 * never change, so the client may cache it hard.
 */

const THUMB_SIDE = 320;

/** Lossy and low: a grid card, not artwork. At 320px nobody can tell 70 from
 *  90, and the files land in the single-digit kilobytes. */
const THUMB_QUALITY = 70;

export type ThumbResult =
  | { path: string; mime: 'image/webp' }
  /** Serve the original instead: animated GIFs (a thumbnail would freeze
   *  them) and images already smaller than the thumbnail would be. */
  | { redirect: string }
  | null;

export async function thumbFor(assetId: string): Promise<ThumbResult> {
  const row = assets.byId(assetId);
  if (!row || row.kind === 'audio') return null;
  const original = path.join(UPLOADS_DIR, `${row.id}.${row.ext}`);
  if (!fs.existsSync(original)) return null;
  if (row.ext === 'gif') return { redirect: `/uploads/${row.id}.${row.ext}` };
  if (row.width > 0 && Math.max(row.width, row.height) <= THUMB_SIDE) {
    return { redirect: `/uploads/${row.id}.${row.ext}` };
  }

  const dest = path.join(THUMBS_DIR, `${row.id}.webp`);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(THUMBS_DIR, { recursive: true });
    const buf = await sharp(original)
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    // Written beside and renamed in, so a request arriving mid-write can
    // never be served half a file. Two simultaneous first-requests race the
    // rename; whichever loses just concedes to an identical winner.
    const tmp = `${dest}.${process.pid}.${Math.floor(Math.random() * 1e9)}.tmp`;
    fs.writeFileSync(tmp, buf);
    try {
      fs.renameSync(tmp, dest);
    } catch {
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      // Windows refuses to rename over an existing file — if nobody else won
      // the race either, fall back to a plain write of the small buffer.
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
    }
  }
  return { path: dest, mime: 'image/webp' };
}

/** Delete cached thumbnails whose asset row is gone. Called from the same
 *  sweep that clears orphaned uploads. */
export function sweepThumbs(claimedIds: Set<string>): number {
  let removed = 0;
  let names: string[] = [];
  try { names = fs.readdirSync(THUMBS_DIR); } catch { return 0; }
  for (const f of names) {
    if (!f.endsWith('.webp')) continue;
    if (claimedIds.has(f.slice(0, -'.webp'.length))) continue;
    try { fs.unlinkSync(path.join(THUMBS_DIR, f)); removed++; } catch { /* next sweep */ }
  }
  return removed;
}
