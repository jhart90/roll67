import { Router } from 'express';
import { thumbFor } from '../thumbs.js';

/**
 * GET /api/thumb/:assetId — the small preview of an uploaded image.
 *
 * Unauthenticated on purpose, to match /uploads exactly: both are reachable
 * only by unguessable asset ids, and a thumbnail must not be better guarded
 * than the full-size image it shrinks. Any failure is a 404 and the client
 * falls back to the original, so this endpoint can never make an image
 * LESS visible than before thumbnails existed.
 */
export const thumbRouter = Router();

thumbRouter.get('/thumb/:assetId', async (req, res) => {
  try {
    const t = await thumbFor(req.params.assetId);
    if (!t) return res.status(404).end();
    if ('redirect' in t) return res.redirect(302, t.redirect);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.type(t.mime);
    return res.sendFile(t.path);
  } catch {
    return res.status(404).end();
  }
});
