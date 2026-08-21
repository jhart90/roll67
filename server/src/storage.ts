import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_PATH, UPLOADS_DIR } from './config.js';
import { db } from './db/db.js';

/**
 * What is actually on the disk this server is paying for.
 *
 * The volume holds two things — the database and the uploads — and only one of
 * them grows on its own. Nothing here guesses: every number is read off the
 * filesystem and reconciled against the `assets` table, because the failure
 * modes worth finding are precisely the ones where the two disagree.
 *
 * Three kinds of waste, in the order they are worth reclaiming:
 *
 *  - ORPHANS: a file on disk with no row pointing at it. Dead weight, safe to
 *    delete, and the residue of every asset or campaign removed before the
 *    cleanup that now runs on deletion existed.
 *  - DUPLICATES: byte-identical files stored twice, because an upload is named
 *    by a random id rather than by its contents. Re-uploading the same map to
 *    two campaigns writes it twice.
 *  - MISSING: a row whose file is gone. Costs no disk, but it is a broken
 *    image on somebody's screen, so it is reported rather than hidden.
 */
export interface StorageReport {
  dbBytes: number;
  walBytes: number;
  uploadsBytes: number;
  uploadsCount: number;
  orphanBytes: number;
  orphanCount: number;
  duplicateBytes: number;
  duplicateGroups: number;
  /** Bytes NOT spent because identical uploads already share one file. */
  sharedBytes: number;
  missingCount: number;
  /** Biggest consumers, largest first. */
  byCampaign: Array<{ campaignId: string; name: string; bytes: number; count: number }>;
  largest: Array<{ name: string; bytes: number; campaign: string }>;
  totalBytes: number;
}

const sizeOf = (p: string): number => {
  try { return fs.statSync(p).size; } catch { return 0; }
};

/** Size plus the identity that tells two names for one file apart. `shareable`
 *  is false when the platform gives no usable inode, in which case every name
 *  is treated as its own file — an overcount, never an undercount. */
function statOf(p: string): { size: number; dev: number; ino: number; shareable: boolean } {
  try {
    const st = fs.statSync(p);
    return { size: st.size, dev: st.dev, ino: st.ino, shareable: st.nlink > 1 && st.ino > 0 };
  } catch {
    return { size: 0, dev: 0, ino: 0, shareable: false };
  }
}

/** SHA-256 of a buffer — the identity an upload is deduped by. */
export function hashBytes(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Store an upload's bytes at `filename`, sharing the file if the server
 * already holds these exact bytes.
 *
 * The sharing is a hard link, which is what lets this be a two-line change
 * rather than a schema migration: every asset keeps its own `<id>.<ext>` name,
 * so nothing that builds a URL, serves a file, or exports a backup needs to
 * know. The filesystem counts the references, so deleting an asset stays a
 * plain unlink — the bytes survive until the last name for them is gone, and
 * no bookkeeping of ours can get that wrong.
 *
 * Falls back to a full copy whenever linking is refused, which costs exactly
 * what today costs.
 */
export function storeAsset(buffer: Buffer, filename: string, hash: string, excludeId?: string): { deduped: boolean } {
  const dest = path.join(UPLOADS_DIR, filename);
  const twins = db.prepare(
    'SELECT id, ext FROM assets WHERE content_hash = ? AND id != ? LIMIT 16',
  ).all(hash, excludeId ?? '') as Array<{ id: string; ext: string }>;
  for (const t of twins) {
    const src = path.join(UPLOADS_DIR, `${t.id}.${t.ext}`);
    if (!fs.existsSync(src)) continue;
    try {
      fs.linkSync(src, dest);
      return { deduped: true };
    } catch { /* cross-device, or a filesystem without links: copy instead */ }
  }
  fs.writeFileSync(dest, buffer);
  return { deduped: false };
}

/** SHA-1 of a file's contents, streamed so a 15 MB upload never lands in RAM
 *  twice. Only used to prove two files are the same, never for security. */
function hashFile(p: string): string {
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(1 << 16);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

export function storageReport(): StorageReport {
  const rows = db.prepare(
    `SELECT a.id, a.ext, a.campaign_id AS campaignId, a.filename, c.name AS campaignName
     FROM assets a LEFT JOIN campaigns c ON c.id = a.campaign_id`,
  ).all() as Array<{ id: string; ext: string; campaignId: string; filename: string; campaignName: string | null }>;

  let files: string[] = [];
  try { files = fs.readdirSync(UPLOADS_DIR); } catch { files = []; }

  const byFileName = new Map(rows.map((r) => [`${r.id}.${r.ext}`, r]));
  const onDisk = new Set(files);

  let uploadsBytes = 0;
  let orphanBytes = 0;
  let orphanCount = 0;
  let sharedBytes = 0;
  const perCampaign = new Map<string, { name: string; bytes: number; count: number }>();
  const bySize = new Map<number, string[]>();
  const largest: Array<{ name: string; bytes: number; campaign: string }> = [];

  // Files that share bytes share one inode, so the volume is charged for them
  // once and this walk must count them once too. The first name for an inode
  // is the one that carries its size — including for the per-campaign figures,
  // which is arbitrary between two campaigns sharing art but keeps every
  // number on the panel adding up to the total.
  const seenInode = new Set<string>();
  for (const f of files) {
    const st = statOf(path.join(UPLOADS_DIR, f));
    const bytes = st.size;
    if (st.shareable) {
      const key = `${st.dev}:${st.ino}`;
      if (seenInode.has(key)) {
        sharedBytes += bytes;
        continue;
      }
      seenInode.add(key);
    }
    uploadsBytes += bytes;
    const row = byFileName.get(f);
    if (!row) {
      orphanBytes += bytes;
      orphanCount++;
    } else {
      const key = row.campaignId;
      const cur = perCampaign.get(key) ?? { name: row.campaignName ?? '(deleted campaign)', bytes: 0, count: 0 };
      cur.bytes += bytes;
      cur.count++;
      perCampaign.set(key, cur);
    }
    largest.push({ name: row?.filename ?? f, bytes, campaign: row?.campaignName ?? (row ? '(deleted campaign)' : '(orphan)') });
    // Only files of identical length can be identical, so hashing is confined
    // to the candidates — on a volume of mostly-unique art that is nearly
    // nothing, and it keeps the report cheap enough to run on demand.
    const group = bySize.get(bytes) ?? [];
    group.push(f);
    bySize.set(bytes, group);
  }

  let duplicateBytes = 0;
  let duplicateGroups = 0;
  for (const [bytes, group] of bySize) {
    if (group.length < 2 || bytes === 0) continue;
    const byHash = new Map<string, number>();
    for (const f of group) {
      const h = hashFile(path.join(UPLOADS_DIR, f));
      byHash.set(h, (byHash.get(h) ?? 0) + 1);
    }
    for (const [, n] of byHash) {
      if (n > 1) { duplicateGroups++; duplicateBytes += bytes * (n - 1); }
    }
  }

  const missingCount = rows.filter((r) => !onDisk.has(`${r.id}.${r.ext}`)).length;
  const dbBytes = sizeOf(DB_PATH);
  const walBytes = sizeOf(`${DB_PATH}-wal`) + sizeOf(`${DB_PATH}-shm`);

  return {
    dbBytes,
    walBytes,
    uploadsBytes,
    uploadsCount: files.length,
    orphanBytes,
    orphanCount,
    duplicateBytes,
    duplicateGroups,
    sharedBytes,
    missingCount,
    byCampaign: [...perCampaign.entries()]
      .map(([campaignId, v]) => ({ campaignId, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 12),
    largest: largest.sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    totalBytes: dbBytes + walBytes + uploadsBytes,
  };
}

/**
 * Delete every upload with no row pointing at it, and report what that freed.
 *
 * Deliberately narrow: a file is removed only when the database has no record
 * of it at all. Anything a row still claims is left alone however orphaned it
 * looks, because the cost of deleting a file somebody's handout still points
 * at is a broken image nobody can restore, and the cost of keeping one is a
 * few megabytes.
 */
export function sweepOrphans(): { freedBytes: number; freedCount: number } {
  const rows = db.prepare('SELECT id, ext FROM assets').all() as Array<{ id: string; ext: string }>;
  const claimed = new Set(rows.map((r) => `${r.id}.${r.ext}`));
  let freedBytes = 0;
  let freedCount = 0;
  let files: string[] = [];
  try { files = fs.readdirSync(UPLOADS_DIR); } catch { return { freedBytes: 0, freedCount: 0 }; }
  for (const f of files) {
    if (claimed.has(f)) continue;
    const p = path.join(UPLOADS_DIR, f);
    const bytes = sizeOf(p);
    try {
      fs.unlinkSync(p);
      freedBytes += bytes;
      freedCount++;
    } catch { /* already gone, or held open — it will be caught next sweep */ }
  }
  console.log(`storage sweep: removed ${freedCount} orphaned upload(s), ${(freedBytes / 1048576).toFixed(1)} MB, from ${DATA_DIR}`);
  return { freedBytes, freedCount };
}
