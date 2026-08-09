// A small picture of a map for the world tab's Map Details window.
//
// The security rule: a player must never receive pixels they have not
// explored. That masking therefore happens HERE, on the server, and the
// masked PNG is the only thing that leaves — a player is never sent the full
// background plus a mask to apply, because they could simply ignore the mask
// (or fetch /uploads/<id>.png directly).

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { hexCorners, unpackHex } from 'shared';
import { requireAuth, type AuthedRequest } from '../auth.js';
import { UPLOADS_DIR } from '../config.js';
import { assets, campaigns, fog, maps } from '../db/repos.js';

export const mapPreviewRouter = Router();

/** Longest edge of a preview, in pixels — a thumbnail, not a second table. */
const PREVIEW_MAX = 560;

mapPreviewRouter.get('/maps/:mapId/preview.png', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const map = maps.byId(req.params.mapId);
  if (!map) { res.status(404).end(); return; }
  const role = campaigns.memberRole(map.campaignId, userId);
  if (!role) { res.status(403).end(); return; }

  const asset = map.bgAssetId ? assets.byId(map.bgAssetId) : undefined;
  if (!asset) { res.status(404).json({ error: 'This map has no background image.' }); return; }
  const file = path.join(UPLOADS_DIR, `${asset.id}.${asset.ext}`);
  if (!fs.existsSync(file)) { res.status(404).end(); return; }

  // The DM sees everything. So does anyone looking at a SCENE: a scene is
  // staged to be looked at in full, which is what makes it a scene.
  const unmasked = role === 'dm' || map.isScene === true;

  try {
    const base = sharp(file).resize({
      width: PREVIEW_MAX, height: PREVIEW_MAX, fit: 'inside', withoutEnlargement: true,
    });
    if (unmasked) {
      res.type('png').send(await base.png().toBuffer());
      return;
    }

    // A player gets their own explored hexes and nothing else. Read the fog
    // this player has persisted for THIS map — not the party's, not the
    // map they happen to be standing on.
    const explored = fog.get(userId, map.id);
    if (explored.length === 0) {
      res.status(403).json({ error: 'You have not explored any of this map yet.' });
      return;
    }
    const meta = await sharp(file).metadata();
    const fullW = meta.width ?? 0;
    const fullH = meta.height ?? 0;
    if (!fullW || !fullH) { res.status(500).end(); return; }
    const scale = Math.min(PREVIEW_MAX / fullW, PREVIEW_MAX / fullH, 1);
    const outW = Math.max(1, Math.round(fullW * scale));
    const outH = Math.max(1, Math.round(fullH * scale));

    // One SVG polygon per explored hex, in preview coordinates. Overlapping
    // neighbours merge into whole rooms, so the shape reads as a floorplan
    // rather than a honeycomb.
    const polys: string[] = [];
    for (const packed of explored) {
      const pts = hexCorners(unpackHex(packed), map.grid)
        .map((p) => `${(p.x * scale).toFixed(1)},${(p.y * scale).toFixed(1)}`)
        .join(' ');
      polys.push(`<polygon points="${pts}"/>`);
    }
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}">`
      + `<g fill="#fff">${polys.join('')}</g></svg>`,
    );

    const png = await base
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    res.type('png').send(png);
  } catch {
    res.status(500).json({ error: 'Could not render that map.' });
  }
});
