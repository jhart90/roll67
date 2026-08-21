import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_LIMIT_BYTES } from '../config.js';
import { requireAuth, type AuthedRequest } from '../auth.js';
import { assets, campaigns } from '../db/repos.js';
import { processAudio, processImage } from '../media.js';
import { hashBytes, storeAsset } from '../storage.js';

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
  if (typeof campaignId !== 'string' || !campaignId) {
    res.status(400).json({ error: 'campaignId is required.' });
    return;
  }
  const campaign = campaigns.byId(campaignId);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }
  const role = campaigns.memberRole(campaignId, req.user!.id);
  if (!role) {
    res.status(403).json({ error: 'Not a member of that campaign.' });
    return;
  }

  // Shrink before storing, never after: the volume should only ever see the
  // bytes we intend to keep. Both paths can decide the original was already
  // the best answer, and either may settle on a different container than the
  // one that arrived (a PNG map becomes WebP, a WAV becomes MP3), so the
  // extension and mime type are taken from the result rather than the request.
  let width = 0;
  let height = 0;
  let outBuffer = file.buffer;
  let outExt = ext;
  let outMime = file.mimetype;
  if (isAudio) {
    const processed = processAudio(file.buffer, ext);
    outBuffer = processed.buffer;
    outExt = processed.ext;
    outMime = processed.mime;
  } else {
    try {
      const processed = await processImage(file.buffer, file.mimetype, kind);
      outBuffer = processed.buffer;
      outExt = processed.ext;
      outMime = processed.mime;
      width = processed.width;
      height = processed.height;
    } catch {
      res.status(400).json({ error: 'Could not process image.' });
      return;
    }
  }
  const hash = hashBytes(outBuffer);

  let assetId: string | null = null;
  try {
    const asset = assets.create({
      campaign_id: campaignId,
      uploaderId: req.user!.id,
      kind,
      filename: file.originalname,
      ext: outExt,
      mime: outMime,
      bytes: outBuffer.length,
      content_hash: hash,
      width,
      height,
      title: typeof title === 'string' && title.trim() ? title.trim() : null,
      folderId: typeof folderId === 'string' && folderId ? folderId : null,
    });
    assetId = asset.id;
    const { deduped } = storeAsset(outBuffer, `${asset.id}.${outExt}`, hash, asset.id);
    if (deduped || outBuffer.length !== file.size) {
      const saved = deduped ? file.size : file.size - outBuffer.length;
      console.log(
        `upload ${file.originalname}: ${(file.size / 1048576).toFixed(2)} MB -> ` +
        `${(outBuffer.length / 1048576).toFixed(2)} MB${deduped ? ' (shared with an identical upload)' : ''}` +
        `, saved ${(saved / 1048576).toFixed(2)} MB`,
      );
    }
    res.json({ assetId: asset.id, url: `/uploads/${asset.id}.${outExt}`, width, height });
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
