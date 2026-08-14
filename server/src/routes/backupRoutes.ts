import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import type { Response } from 'express';
import { UPLOADS_DIR } from '../config.js';
import { requireAuth, type AuthedRequest } from '../auth.js';
import { campaigns } from '../db/repos.js';
import {
  BACKUP_KIND, campaignAssetFiles, collectCampaign, restoreCampaign, type CampaignBackup, type RestoreReport,
} from '../db/backup.js';

/**
 * The wire format for a campaign backup: `.r67campaign`.
 *
 * Not JSON, and not a zip. JSON was the obvious choice — it is what map packs
 * use — but a map pack carries ONE image and a campaign carries all of them,
 * and base64 inside a JSON string means holding the entire campaign in memory
 * as a single string, a third larger than it needs to be, to write it. A zip
 * would mean a dependency for something the format barely uses: the payload
 * is PNGs and MP3s, which are already compressed and gain nothing from being
 * compressed again.
 *
 * So: a header, the manifest gzipped (it is JSON, and JSON does compress), and
 * then the files laid end to end with their lengths in front of them. It
 * streams out a file at a time, it reads back by seeking, and it needs nothing
 * that isn't already in Node.
 *
 *   "R67CAMP\n"                    8 bytes, the last of which is the version
 *   u32le manifestLength
 *   gzip(JSON manifest)
 *   repeated to EOF:
 *     u32le nameLength, name (utf-8), u32le dataLength, data
 */
const MAGIC = Buffer.from('R67CAMP\n', 'ascii');
const MAGIC_VERSION_BYTE = 7;

/** A campaign with a lot of hand-drawn maps in it. Bounded, but generously. */
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;

/** Asset filenames are `<id>.<ext>`; anything else in an uploaded file is a
 *  path-traversal attempt, not a typo. */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9]{1,8}$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `r67restore-${crypto.randomUUID()}`),
  }),
  limits: { fileSize: MAX_BACKUP_BYTES },
});

export const backupRouter = Router();

function isDmOf(req: AuthedRequest, campaignId: string): boolean {
  return campaigns.memberRole(campaignId, req.user!.id) === 'dm';
}

/** Write to the socket, waiting when the client can't keep up. Without this a
 *  large export is buffered whole in memory, which is the thing the format
 *  exists to avoid. */
function writeTo(res: Response, buf: Buffer): Promise<void> {
  return new Promise((resolve) => { if (res.write(buf)) resolve(); else res.once('drain', () => resolve()); });
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

backupRouter.get('/campaigns/:campaignId/backup', requireAuth, async (req, res) => {
  const areq = req as AuthedRequest;
  const { campaignId } = req.params;
  if (!isDmOf(areq, campaignId)) return res.status(403).json({ error: 'DM only.' });

  let collected;
  try {
    collected = collectCampaign(campaignId);
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'No such campaign.' });
  }
  const { manifest, files } = collected;

  const slug = manifest.campaign.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'campaign';
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-${stamp}.r67campaign"`);

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(manifest), 'utf-8'));
  await writeTo(res, MAGIC);
  await writeTo(res, u32(gz.length));
  await writeTo(res, gz);

  for (let i = 0; i < files.length; i++) {
    const name = Buffer.from(manifest.files[i].name, 'utf-8');
    await writeTo(res, u32(name.length));
    await writeTo(res, name);
    const data = fs.readFileSync(files[i]);
    await writeTo(res, u32(data.length));
    await writeTo(res, data);
  }
  return res.end();
});

/** Read exactly `len` bytes at `pos`, or throw — a short read means the file
 *  is truncated, and a backup that is half there must not half-restore. */
function readExact(fd: number, pos: number, len: number): Buffer {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, buf, got, len - got, pos + got);
    if (n <= 0) throw new Error('That backup file is truncated — it stops in the middle of its contents.');
    got += n;
  }
  return buf;
}

backupRouter.post('/campaigns/restore', requireAuth, upload.single('file'), (req, res) => {
  const areq = req as AuthedRequest;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const tmp = req.file.path;
  const replace = String(req.body?.replace ?? '') === 'true';
  // Written before the database is touched, so a failure part-way leaves
  // orphaned images rather than rows pointing at pictures that aren't there.
  const written: string[] = [];
  let fd: number | null = null;

  try {
    fd = fs.openSync(tmp, 'r');
    const size = fs.statSync(tmp).size;
    if (size < MAGIC.length + 4) return res.status(400).json({ error: "That doesn't look like a Roll67 campaign backup." });

    const magic = readExact(fd, 0, MAGIC.length);
    if (magic.subarray(0, MAGIC_VERSION_BYTE).toString('ascii') !== MAGIC.subarray(0, MAGIC_VERSION_BYTE).toString('ascii')) {
      return res.status(400).json({ error: "That doesn't look like a Roll67 campaign backup." });
    }

    const manifestLen = readExact(fd, MAGIC.length, 4).readUInt32LE();
    let pos = MAGIC.length + 4;
    let manifest: CampaignBackup;
    try {
      manifest = JSON.parse(zlib.gunzipSync(readExact(fd, pos, manifestLen)).toString('utf-8')) as CampaignBackup;
    } catch {
      return res.status(400).json({ error: 'That backup’s contents list is unreadable — the file looks damaged.' });
    }
    pos += manifestLen;
    if (manifest?.kind !== BACKUP_KIND) return res.status(400).json({ error: 'That is not a Roll67 campaign backup.' });

    // What the outgoing copy owned, so a replace can tidy up after itself.
    const existing = campaigns.byId(manifest.campaign?.id ?? '');
    const oldFiles = existing ? campaignAssetFiles(existing.id) : [];

    // Unpack the images first: the restore is the risky half, and rows that
    // name a missing picture are worse than a picture nobody names.
    const incoming = new Set<string>();
    while (pos < size) {
      const nameLen = readExact(fd, pos, 4).readUInt32LE(); pos += 4;
      const name = readExact(fd, pos, nameLen).toString('utf-8'); pos += nameLen;
      const dataLen = readExact(fd, pos, 4).readUInt32LE(); pos += 4;
      if (!SAFE_FILENAME.test(name)) {
        return res.status(400).json({ error: `That backup contains an unacceptable filename (${name.slice(0, 40)}).` });
      }
      const dest = path.join(UPLOADS_DIR, name);
      // Belt and braces: the regex already forbids separators, but the file
      // came off the internet and this is the line that actually matters.
      if (path.dirname(path.resolve(dest)) !== path.resolve(UPLOADS_DIR)) {
        return res.status(400).json({ error: 'That backup tried to write outside the uploads folder.' });
      }
      const out = fs.openSync(dest, 'w');
      try {
        let left = dataLen;
        let at = pos;
        while (left > 0) {
          const chunk = readExact(fd, at, Math.min(left, 4 * 1024 * 1024));
          fs.writeSync(out, chunk);
          at += chunk.length;
          left -= chunk.length;
        }
      } finally { fs.closeSync(out); }
      written.push(name);
      incoming.add(name);
      pos += dataLen;
    }

    let report: RestoreReport;
    try {
      report = restoreCampaign(manifest, areq.user!.id, { replace });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Restore failed.' });
    }
    report.files = written.length;

    // Images the old copy had and the new one doesn't. Only ever files that
    // belonged to this same campaign, and only after the rows naming them are
    // already gone.
    let cleaned = 0;
    for (const name of oldFiles) {
      if (incoming.has(name)) continue;
      try { fs.unlinkSync(path.join(UPLOADS_DIR, name)); cleaned++; } catch { /* already gone */ }
    }
    if (cleaned > 0) report.notes.push(`${cleaned} image${cleaned === 1 ? '' : 's'} from the copy that was here are no longer referenced and were cleared away.`);

    return res.json(report);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Restore failed.' });
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to close */ } }
    try { fs.unlinkSync(tmp); } catch { /* multer's temp file already gone */ }
  }
});
