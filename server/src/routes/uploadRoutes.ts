import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { imageSize } from 'image-size';
import { UPLOADS_DIR, UPLOAD_LIMIT_BYTES } from '../config.js';
import { requireAuth, type AuthedRequest } from '../auth.js';
import { assets, campaigns } from '../db/repos.js';

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};

// Audio files can be much larger than images.
const AUDIO_LIMIT_BYTES = 30 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(UPLOAD_LIMIT_BYTES, AUDIO_LIMIT_BYTES) },
});

// Longest-side cap per use, in pixels -- backgrounds are viewed zoomed-in so
// get the most headroom, tokens are small on-screen so need far less.
const MAX_DIMENSION: Record<string, number> = { map: 4096, handout: 2560, token: 1024 };

/**
 * Re-encode an uploaded image to cut upload/transfer size and load time,
 * without visibly softening it: downscale only if it exceeds the kind's cap,
 * and recompress at a quality/setting that's effectively indistinguishable
 * from the source (PNG stays lossless; JPEG/WebP quality is kept high).
 * Animated GIFs are passed through untouched -- sharp would flatten them to
 * a single frame.
 */
async function processImage(buffer: Buffer, mimetype: string, kind: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (mimetype === 'image/gif') {
    const dims = imageSize(buffer);
    return { buffer, width: dims.width ?? 0, height: dims.height ?? 0 };
  }
  const maxSide = MAX_DIMENSION[kind] ?? MAX_DIMENSION.handout;
  let pipeline = sharp(buffer).rotate().resize({
    width: maxSide,
    height: maxSide,
    fit: 'inside',
    withoutEnlargement: true,
  });
  if (mimetype === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
  else if (mimetype === 'image/webp') pipeline = pipeline.webp({ quality: 88 });
  else pipeline = pipeline.png({ compressionLevel: 9 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

export const uploadRouter = Router();

uploadRouter.post('/upload', requireAuth, upload.single('file'), async (req: AuthedRequest, res) => {
  const file = req.file;
  const { campaignId, kind, title, folderId } = req.body ?? {};
  if (!file) {
    res.status(400).json({ error: 'No file provided.' });
    return;
  }
  const isAudio = kind === 'audio';
  const ext = isAudio ? AUDIO_EXT[file.mimetype] : IMAGE_EXT[file.mimetype];
  if (!ext) {
    res.status(400).json({ error: isAudio ? 'Only MP3, OGG, WAV, WebM or M4A audio is allowed.' : 'Only PNG, JPEG, WebP and GIF images are allowed.' });
    return;
  }
  if (kind !== 'map' && kind !== 'token' && kind !== 'handout' && kind !== 'audio') {
    res.status(400).json({ error: 'kind must be map, token, handout or audio.' });
    return;
  }
  if (isAudio && file.size > AUDIO_LIMIT_BYTES) {
    res.status(400).json({ error: 'Audio file too large (30 MB max).' });
    return;
  }
  const role = typeof campaignId === 'string' ? campaigns.memberRole(campaignId, req.user!.id) : undefined;
  if (!role) {
    res.status(403).json({ error: 'Not a member of that campaign.' });
    return;
  }

  let width = 0;
  let height = 0;
  let outBuffer = file.buffer;
  if (!isAudio) {
    try {
      const processed = await processImage(file.buffer, file.mimetype, kind);
      outBuffer = processed.buffer;
      width = processed.width;
      height = processed.height;
    } catch {
      res.status(400).json({ error: 'Could not process image.' });
      return;
    }
  }

  let assetId: string | null = null;
  try {
    const asset = assets.create({
      campaign_id: campaignId,
      uploaderId: req.user!.id,
      kind,
      filename: file.originalname,
      ext,
      mime: file.mimetype,
      bytes: outBuffer.length,
      width,
      height,
      title: typeof title === 'string' && title.trim() ? title.trim() : null,
      folderId: typeof folderId === 'string' && folderId ? folderId : null,
    });
    assetId = asset.id;
    fs.writeFileSync(path.join(UPLOADS_DIR, `${asset.id}.${ext}`), outBuffer);
    res.json({ assetId: asset.id, url: `/uploads/${asset.id}.${ext}`, width, height });
  } catch (err) {
    console.error('Upload failed:', err);
    // A failed disk write must not leave a row pointing at a file that never
    // landed -- every later read of that asset would 404.
    if (assetId) {
      try { assets.delete(assetId); } catch { /* best effort */ }
    }
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});
