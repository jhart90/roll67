import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { SNAPSHOT_DIR } from '../config.js';
import { db } from './db.js';

/**
 * Automatic safety copies of the database, taken by the server itself.
 *
 * The campaign backup a DM downloads is the off-site copy; this is the one
 * nobody has to remember. The database is the only part of the volume that
 * cannot be reassembled from anywhere else — uploads are plain files, but the
 * campaigns, sheets, chat and fog live in one SQLite file that a bad
 * migration or a fat-fingered delete can ruin in a moment (and nearly did
 * once). So the server keeps a short history of that file, on the volume,
 * refreshed daily and rotated so it can never grow without bound.
 *
 * `db.backup()` rather than copying the file: better-sqlite3's backup API
 * produces a consistent snapshot while the server is live and mid-WAL,
 * which a plain copy of an open database does not.
 *
 * To restore one: stop the server, gunzip the chosen file from
 * <DATA_DIR>/backups over <DATA_DIR>/roll67.db (removing any leftover
 * roll67.db-wal / roll67.db-shm), and start the server again.
 */

/** How many snapshots to keep. Two weeks of daily copies covers "the mistake
 *  was noticed a session or two later", which is the failure this exists for. */
const KEEP = Math.max(1, Number(process.env.SNAPSHOT_KEEP ?? 14));

/** A snapshot younger than this means none is due. Twenty hours rather than
 *  twenty-four, so a restart that drifts earlier each day still snapshots
 *  daily instead of skipping one. */
const DUE_MS = 20 * 60 * 60 * 1000;

/** How often to look at the clock. Cheap: almost every look concludes
 *  "not yet". */
const CHECK_MS = 60 * 60 * 1000;

const SNAPSHOT_NAME = /^roll67-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db\.gz$/;

/** Existing snapshots, newest first. The stamp in the name sorts correctly as
 *  text, and the name rather than mtime is what rotation trusts — a file's
 *  mtime is whatever the filesystem last did to it. */
function listSnapshots(): string[] {
  let names: string[] = [];
  try { names = fs.readdirSync(SNAPSHOT_DIR); } catch { return []; }
  return names.filter((n) => SNAPSHOT_NAME.test(n)).sort().reverse();
}

function prune(): void {
  for (const name of listSnapshots().slice(KEEP)) {
    try { fs.unlinkSync(path.join(SNAPSHOT_DIR, name)); } catch { /* next pass */ }
  }
}

export async function snapshotNow(): Promise<{ file: string; bytes: number }> {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const raw = path.join(SNAPSHOT_DIR, `.roll67-${stamp}.db.tmp`);
  const dest = path.join(SNAPSHOT_DIR, `roll67-${stamp}.db.gz`);
  try {
    await db.backup(raw);
    // Streamed, not gzipSync: the production database is tens of megabytes,
    // and a synchronous gzip would stall every socket at whatever hour the
    // snapshot happens to land.
    await pipeline(fs.createReadStream(raw), zlib.createGzip(), fs.createWriteStream(dest));
  } catch (err) {
    try { fs.unlinkSync(dest); } catch { /* never leave a half-written snapshot */ }
    throw err;
  } finally {
    try { fs.unlinkSync(raw); } catch { /* already gone */ }
  }
  prune();
  return { file: dest, bytes: fs.statSync(dest).size };
}

function due(): boolean {
  const newest = listSnapshots()[0];
  if (!newest) return true;
  // The stamp is UTC, minus its colons.
  const iso = newest.slice('roll67-'.length, -'.db.gz'.length);
  const when = Date.parse(`${iso.slice(0, 13)}:${iso.slice(14, 16)}:${iso.slice(17, 19)}Z`);
  return !Number.isFinite(when) || Date.now() - when > DUE_MS;
}

/** Take a snapshot now if one is due, then keep checking hourly. The timer is
 *  unref'd so a script that imports the server can still exit on its own. */
export function startSnapshotSchedule(): void {
  const tick = async (): Promise<void> => {
    if (!due()) return;
    try {
      const { file, bytes } = await snapshotNow();
      console.log(`snapshot: wrote ${path.basename(file)} (${(bytes / 1048576).toFixed(2)} MB), keeping the newest ${KEEP}`);
    } catch (err) {
      console.error('snapshot failed (will retry on the next hourly check):', err);
    }
  };
  void tick();
  setInterval(() => { void tick(); }, CHECK_MS).unref();
}
