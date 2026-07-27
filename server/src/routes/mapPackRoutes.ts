import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from '../config.js';
import { requireAuth, type AuthedRequest } from '../auth.js';
import { assets, campaigns, maps } from '../db/repos.js';

/**
 * .r67 map packs — a map moved between campaigns, and between game systems.
 *
 * A pack is JSON (image inlined as base64) rather than a zip: one file, no
 * archive dependency, and readable enough to diff when something goes wrong.
 *
 * It carries only what a map is physically made of — the background image,
 * grid, walls, doors, lights, spawn point and rough terrain. Everything that
 * belongs to a particular table's game stays behind: no characters, no tokens,
 * no handouts, and no loot or chests. That's what makes a pack safe to hand to
 * another DM, and what makes it system-agnostic — none of it references rules.
 */
const FORMAT_VERSION = 1;
const PACK_KIND = 'roll67.map';
/** Generous, but a bound: a pack is one image plus a little JSON. */
const MAX_PACK_BYTES = 64 * 1024 * 1024;

interface MapPack {
  formatVersion: number;
  kind: typeof PACK_KIND;
  exportedAt: number;
  map: {
    name: string;
    grid: unknown;
    walls: unknown[];
    doors: unknown[];
    lights: unknown[];
    spawn: unknown;
    terrain: number[];
  };
  image: { ext: string; mime: string; dataB64: string } | null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PACK_BYTES } });

export const mapPackRouter = Router();

/** Only the campaign's DM may take a map out of it, or bring one in. */
function isDmOf(req: AuthedRequest, campaignId: string): boolean {
  return campaigns.memberRole(campaignId, req.user!.id) === 'dm';
}

mapPackRouter.get('/maps/:mapId/export', requireAuth, (req, res) => {
  const areq = req as AuthedRequest;
  const map = maps.byId(req.params.mapId);
  if (!map) return res.status(404).json({ error: 'No such map.' });
  if (!isDmOf(areq, map.campaignId)) return res.status(403).json({ error: 'DM only.' });

  let image: MapPack['image'] = null;
  if (map.bgAssetId) {
    const asset = assets.byId(map.bgAssetId);
    const file = asset ? path.join(UPLOADS_DIR, `${asset.id}.${asset.ext}`) : null;
    // A map whose background file has gone missing still exports — the
    // geometry is the laborious part and is worth rescuing on its own.
    if (asset && file && fs.existsSync(file)) {
      image = { ext: asset.ext, mime: asset.mime, dataB64: fs.readFileSync(file).toString('base64') };
    }
  }

  const pack: MapPack = {
    formatVersion: FORMAT_VERSION,
    kind: PACK_KIND,
    exportedAt: Date.now(),
    map: {
      name: map.name,
      grid: map.grid,
      walls: map.walls,
      doors: map.doors,
      lights: map.lights,
      spawn: map.spawn,
      terrain: map.terrain,
    },
    image,
  };

  const safeName = map.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'map';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.r67"`);
  return res.send(JSON.stringify(pack));
});

mapPackRouter.post('/maps/import', requireAuth, upload.single('file'), (req, res) => {
  const areq = req as AuthedRequest;
  const campaignId = String(req.body?.campaignId ?? '');
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required.' });
  if (!isDmOf(areq, campaignId)) return res.status(403).json({ error: 'DM only.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  let pack: MapPack;
  try {
    pack = JSON.parse(req.file.buffer.toString('utf-8')) as MapPack;
  } catch {
    return res.status(400).json({ error: "That doesn't look like a .r67 map pack." });
  }
  if (pack?.kind !== PACK_KIND) return res.status(400).json({ error: 'Not a Roll67 map pack.' });
  // Refuse a pack from the future rather than silently dropping what it holds.
  if (!(pack.formatVersion <= FORMAT_VERSION)) {
    return res.status(400).json({ error: `That pack is version ${pack.formatVersion}; this server reads up to ${FORMAT_VERSION}.` });
  }

  // Every id is minted fresh — reusing one from the source campaign would
  // collide with whatever already holds it here.
  const map = maps.create(campaignId, pack.map?.name?.trim() || 'Imported map');
  if (pack.map?.grid) maps.setGrid(map.id, pack.map.grid as never);
  maps.setWalls(map.id, (pack.map?.walls ?? []) as never);
  maps.setDoors(map.id, (pack.map?.doors ?? []) as never);
  maps.setLights(map.id, (pack.map?.lights ?? []) as never);
  maps.setTerrain(map.id, pack.map?.terrain ?? []);
  if (pack.map?.spawn) maps.setSpawn(map.id, pack.map.spawn as { q: number; r: number });

  if (pack.image?.dataB64) {
    const buf = Buffer.from(pack.image.dataB64, 'base64');
    const asset = assets.create({
      campaign_id: campaignId,
      uploaderId: areq.user!.id,
      kind: 'map',
      filename: `${map.name}.${pack.image.ext}`,
      ext: pack.image.ext,
      mime: pack.image.mime,
      bytes: buf.length,
      width: 0,
      height: 0,
      title: map.name,
    });
    fs.writeFileSync(path.join(UPLOADS_DIR, `${asset.id}.${asset.ext}`), buf);
    maps.update(map.id, { bgAssetId: asset.id });
  }

  return res.json({ mapId: map.id, name: map.name });
});
