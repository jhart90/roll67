import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
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

export const uploadRouter = Router();

uploadRouter.post('/upload', requireAuth, upload.single('file'), (req: AuthedRequest, res) => {
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
  if (!isAudio) {
    try {
      const dims = imageSize(file.buffer);
      width = dims.width ?? 0;
      height = dims.height ?? 0;
    } catch {
      res.status(400).json({ error: 'Could not read image dimensions.' });
      return;
    }
  }

  const asset = assets.create({
    campaign_id: campaignId,
    uploaderId: req.user!.id,
    kind,
    filename: file.originalname,
    ext,
    mime: file.mimetype,
    bytes: file.size,
    width,
    height,
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    folderId: typeof folderId === 'string' && folderId ? folderId : null,
  });
  fs.writeFileSync(path.join(UPLOADS_DIR, `${asset.id}.${ext}`), file.buffer);
  res.json({ assetId: asset.id, url: `/uploads/${asset.id}.${ext}`, width, height });
});
