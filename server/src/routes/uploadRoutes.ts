import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { UPLOADS_DIR, UPLOAD_LIMIT_BYTES } from '../config.js';
import { requireAuth, type AuthedRequest } from '../auth.js';
import { assets, campaigns } from '../db/repos.js';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMIT_BYTES },
});

export const uploadRouter = Router();

uploadRouter.post('/upload', requireAuth, upload.single('file'), (req: AuthedRequest, res) => {
  const file = req.file;
  const { campaignId, kind } = req.body ?? {};
  if (!file) {
    res.status(400).json({ error: 'No file provided.' });
    return;
  }
  const ext = MIME_EXT[file.mimetype];
  if (!ext) {
    res.status(400).json({ error: 'Only PNG, JPEG, WebP and GIF images are allowed.' });
    return;
  }
  if (kind !== 'map' && kind !== 'token' && kind !== 'handout') {
    res.status(400).json({ error: 'kind must be map, token or handout.' });
    return;
  }
  const role = typeof campaignId === 'string' ? campaigns.memberRole(campaignId, req.user!.id) : undefined;
  if (!role) {
    res.status(403).json({ error: 'Not a member of that campaign.' });
    return;
  }

  let width = 0;
  let height = 0;
  try {
    const dims = imageSize(file.buffer);
    width = dims.width ?? 0;
    height = dims.height ?? 0;
  } catch {
    res.status(400).json({ error: 'Could not read image dimensions.' });
    return;
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
  });
  fs.writeFileSync(path.join(UPLOADS_DIR, `${asset.id}.${ext}`), file.buffer);
  res.json({ assetId: asset.id, url: `/uploads/${asset.id}.${ext}`, width, height });
});
