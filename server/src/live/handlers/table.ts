import type { Server, Socket } from 'socket.io';
import { MAX_HANDOUT_IMAGES,
  C2S, S2C, hexToPixel, rows, str,
  type Character, type HoloProjectPayload, type HoloStopPayload,
  type AoePreviewPayload, type ClearDrawingsPayload, type CreateHandoutPayload, type CreateTablePayload,
  type DeleteHandoutPayload, type DeleteTablePayload, type DrawPayload,
  type EraseDrawingPayload, type MeasurePayload, type PingPayload, type RollTablePayload,
  type ShareHandoutPayload, type TargetPreviewPayload, type UpdateHandoutPayload, type UpdateTablePayload,
} from 'shared';
import { assets, campaigns, characters, chat, drawings, handouts, maps, rollableTables, tokens } from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, viewerFor } from '../hub.js';
import { socketsSeeingToken } from '../visionService.js';
import { rollGate } from '../locks.js';
import { spendAction } from './combat.js';
import { emitMoveBudget } from './tokens.js';
import { postStatusLine } from '../hp.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

const PING_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#d2d26c', '#d26cb0'];

function colorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PING_COLORS[hash % PING_COLORS.length];
}

/** Players only receive tables they're allowed to roll; the DM sees all. */
export function broadcastTables(io: Server, campaignId: string): void {
  const all = rollableTables.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const { isDm } = viewerFor(sdata(socket));
    socket.emit(S2C.TABLES, { tables: isDm ? all : all.filter((t) => t.playersCanRoll) });
  }
}

/** Re-send each connected member their (role-filtered) handout list. */
export function broadcastHandouts(io: Server, campaignId: string): void {
  const all = handouts.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const v = viewerFor(sdata(socket));
    const list = v.isDm
      ? all
      : all.filter((h) => h.sharedAll || h.sharedWith.includes(v.userId)).map((h) => ({ ...h, sharedWith: [], dmNotesMd: '' }));
    socket.emit(S2C.HANDOUTS, { handouts: list });
  }
}

/**
 * The ids from a client that are real assets of THIS campaign, capped.
 *
 * These become <img> srcs on every player's screen, and a handout is a thing
 * the DM shares deliberately — not a way to point one campaign at another's
 * uploads. Returns undefined when the caller sent no list at all, which is
 * what "leave the gallery alone" looks like.
 */
function ownedAssetIds(ids: unknown, campaignId: string): string[] | undefined {
  if (!Array.isArray(ids)) return undefined;
  return ids
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => assets.byId(id)?.campaign_id === campaignId)
    .slice(0, MAX_HANDOUT_IMAGES);
}

/** The projection is twenty feet on a side, per the device. */
const HOLO_FEET = 20;
/** Hologram blue — readable on stone, obviously not ink. */
const HOLO_COLOR = '#5ad0ff';

/** Which drawing is which character's live projection, by campaign. */
const holoByCharacter = new Map<string, string>();
const holoKey = (campaignId: string, characterId: string) => `${campaignId}:${characterId}`;

/** Does this sheet actually carry the device? */
function hasHoloProjector(ch: Character): boolean {
  return rows(ch.sheet, 'inventory').some((it) => /holo-?projector/i.test(str(it, 'name', '')));
}

/**
 * Spend an action AND tell the table.
 *
 * spendAction only moves the server's ledger, which is what the Multi-Action
 * penalty counts from; the turn coach and the Pace readout learn about it
 * from the move budget, so a device that costs an action has to push one or
 * the player's screen still shows the action unspent.
 */
function spendActionVisibly(io: Server, campaignId: string, ch: Character): void {
  spendAction(campaignId, ch.id);
  // Their token wherever it stands — the projection may have been lit on a
  // map they have since walked off.
  const tok = tokens.forCharacter(ch.id)[0];
  if (tok) emitMoveBudget(io, campaignId, tok.id);
}

/** Put out whatever this character is projecting. True if there was one. */
function clearHolo(io: Server, campaignId: string, characterId: string): boolean {
  const key = holoKey(campaignId, characterId);
  const id = holoByCharacter.get(key);
  if (!id) return false;
  holoByCharacter.delete(key);
  drawings.delete(id);
  io.to(campaignRoom(campaignId)).emit(S2C.DRAWING_REMOVED, { drawingId: id });
  return true;
}

export function registerTableHandlers(io: Server, socket: Socket): void {
  // ----- drawings -----

  socket.on(C2S.DRAW, safe(socket, ({ mapId, layer, shape }: DrawPayload) => {
    const d = requireCampaign(socket);
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (layer === 'gm' && d.role !== 'dm') {
      emitError(socket, 'Only the DM draws on the GM layer.');
      return;
    }
    const drawing = drawings.add(mapId, d.userId, layer, shape);
    if (layer === 'gm') io.to(dmRoom(d.campaignId)).emit(S2C.DRAWING_ADDED, { drawing });
    else io.to(campaignRoom(d.campaignId)).emit(S2C.DRAWING_ADDED, { drawing });
  }, 'DRAW'));

  /**
   * A Holo-Projector, lit.
   *
   * The illusion is drawn as an ordinary map drawing — a filled square on the
   * shared layer — because that is exactly what it is to everyone looking at
   * the table: a thing you can see and cannot touch. Using the drawing layer
   * rather than inventing a new overlay means it renders, persists, exports
   * and erases through machinery that already works, and a player who loses
   * the device can still rub the square out with the eraser.
   *
   * The square is TWENTY FEET on the map's own scale, so it covers the same
   * ground whatever the grid is set to.
   */
  socket.on(C2S.HOLO_PROJECT, safe(socket, ({ characterId, mapId, x, y }: HoloProjectPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) {
      emitError(socket, 'That is not your character.');
      return;
    }
    if (!hasHoloProjector(ch)) {
      emitError(socket, 'No Holo-Projector in that inventory.');
      return;
    }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    const cx = Number(x); const cy = Number(y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    // One projector, one projection: lighting it again moves the image
    // rather than littering the map with squares nobody can account for.
    clearHolo(io, d.campaignId, characterId);

    const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
    const origin = hexToPixel({ q: 0, r: 0 }, map.grid);
    const step = hexToPixel({ q: 1, r: 0 }, map.grid);
    const pxPerFoot = Math.hypot(step.x - origin.x, step.y - origin.y) / feetPerHex;
    const half = (HOLO_FEET * pxPerFoot) / 2;
    const shape = {
      kind: 'poly' as const,
      points: [
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
      ],
      color: HOLO_COLOR,
      width: 2,
      fill: true,
    };
    const drawing = drawings.add(mapId, d.userId, 'map', shape);
    holoByCharacter.set(holoKey(d.campaignId, characterId), drawing.id);
    io.to(campaignRoom(d.campaignId)).emit(S2C.DRAWING_ADDED, { drawing });
    spendActionVisibly(io, d.campaignId, ch);
    postStatusLine(io, d.campaignId, `${ch.name} lights a Holo-Projector — a 20-foot image flickers into being.`);
  }, 'HOLO_PROJECT'));

  socket.on(C2S.HOLO_STOP, safe(socket, ({ characterId }: HoloStopPayload) => {
    const d = requireCampaign(socket);
    const ch = characters.byId(characterId);
    if (!ch || ch.campaignId !== d.campaignId) return;
    if (d.role !== 'dm' && ch.ownerUserId !== d.userId) return;
    if (!clearHolo(io, d.campaignId, characterId)) {
      emitError(socket, 'Nothing is being projected.');
      return;
    }
    spendActionVisibly(io, d.campaignId, ch);
    postStatusLine(io, d.campaignId, `${ch.name} kills the projection.`);
  }, 'HOLO_STOP'));

  socket.on(C2S.ERASE_DRAWING, safe(socket, ({ drawingId }: EraseDrawingPayload) => {
    const d = requireCampaign(socket);
    const drawing = drawings.byId(drawingId);
    if (!drawing) return;
    const map = maps.byId(drawing.mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    if (d.role !== 'dm' && drawing.authorId !== d.userId) {
      emitError(socket, 'You can only erase your own drawings.');
      return;
    }
    drawings.delete(drawingId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.DRAWING_REMOVED, { drawingId });
  }, 'ERASE_DRAWING'));

  socket.on(C2S.CLEAR_DRAWINGS, safe(socket, ({ mapId, layer }: ClearDrawingsPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    drawings.clearLayer(mapId, layer);
    io.to(campaignRoom(d.campaignId)).emit(S2C.DRAWINGS_CLEARED, { mapId, layer });
  }, 'CLEAR_DRAWINGS'));

  // ----- pings & measurement -----

  socket.on(C2S.PING, safe(socket, ({ x, y }: PingPayload) => {
    const d = requireCampaign(socket);
    io.to(campaignRoom(d.campaignId)).emit(S2C.PING_SHOWN, {
      x, y, color: colorFor(d.userId), byName: d.username,
    });
  }, 'PING'));

  socket.on(C2S.MEASURE, safe(socket, ({ from, to, active }: MeasurePayload) => {
    const d = requireCampaign(socket);
    io.to(campaignRoom(d.campaignId)).emit(S2C.MEASURE_SHOWN, {
      userId: d.userId, from, to, active: !!active, byName: d.username, color: colorFor(d.userId),
    });
  }, 'MEASURE'));

  // A caster's AoE template as they aim it — relayed live to whoever can
  // currently SEE the caster's token (DM always; the caster themself, since
  // they own or control it; any other player with it in their own FOV), so a
  // spell's shape/aim point never leaks to a player who couldn't otherwise
  // spot the caster before it's locked in via C2S.CAST_AOE.
  socket.on(C2S.AOE_PREVIEW, safe(socket, ({ sourceTokenId, shape, sizeFt, widthFt, originHex, aimHex, active }: AoePreviewPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(sourceTokenId);
    if (!token) return;
    for (const s of socketsSeeingToken(io, d.campaignId, token)) {
      s.emit(S2C.AOE_PREVIEW_SHOWN, {
        userId: d.userId, shape, sizeFt, widthFt, originHex, aimHex, active: !!active,
        byName: d.username, color: colorFor(d.userId),
      });
    }
  }, 'AOE_PREVIEW'));

  // A caster's single-target selection (range highlighting) relayed live, the
  // same visibility-scoped way as AOE_PREVIEW — there's no aim point to
  // update, just a begin (active:true) and an end (active:false) around the
  // click.
  socket.on(C2S.TARGET_PREVIEW, safe(socket, ({ sourceTokenId, rangeFt, effect, label, active }: TargetPreviewPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(sourceTokenId);
    if (!token) return;
    for (const s of socketsSeeingToken(io, d.campaignId, token)) {
      s.emit(S2C.TARGET_PREVIEW_SHOWN, {
        userId: d.userId, sourceTokenId, rangeFt, effect, label, active: !!active,
        byName: d.username, color: colorFor(d.userId),
      });
    }
  }, 'TARGET_PREVIEW'));

  // ----- handouts -----

  socket.on(C2S.CREATE_HANDOUT, safe(socket, ({ title, bodyMd, assetId, imageAssetIds }: CreateHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM creates handouts.');
      return;
    }
    const gallery = ownedAssetIds(imageAssetIds, d.campaignId);
    const made = handouts.create(d.campaignId, title?.trim() || 'Untitled', bodyMd ?? '', gallery?.[0] ?? assetId ?? null);
    // A handout can be uploaded to before it exists, so the rest of the
    // gallery is attached the moment it does.
    if (gallery && gallery.length > 1) handouts.update(made.id, { imageAssetIds: gallery });
    broadcastHandouts(io, d.campaignId);
  }, 'CREATE_HANDOUT'));

  socket.on(C2S.UPDATE_HANDOUT, safe(socket, ({ handoutId, title, bodyMd, dmNotesMd, assetId, parentId, imageAssetIds }: UpdateHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const h = handouts.byId(handoutId);
    if (!h) return;
    const gallery = ownedAssetIds(imageAssetIds, d.campaignId);
    handouts.update(handoutId, { title, bodyMd, dmNotesMd, assetId, parentId, ...(gallery ? { imageAssetIds: gallery } : {}) });
    broadcastHandouts(io, d.campaignId);
  }, 'UPDATE_HANDOUT'));

  socket.on(C2S.DELETE_HANDOUT, safe(socket, ({ handoutId }: DeleteHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    handouts.delete(handoutId);
    broadcastHandouts(io, d.campaignId);
  }, 'DELETE_HANDOUT'));

  socket.on(C2S.SHARE_HANDOUT, safe(socket, ({ handoutId, to }: ShareHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    handouts.share(handoutId, to);
    broadcastHandouts(io, d.campaignId);
    if (to !== 'none') {
      const h = handouts.byId(handoutId);
      if (h) {
        const payload = { handoutId, title: h.title };
        if (to === 'all') {
          io.to(campaignRoom(d.campaignId)).emit(S2C.OPEN_HANDOUT, payload);
        } else {
          for (const uid of to) {
            io.to(`user:${uid}`).emit(S2C.OPEN_HANDOUT, payload);
          }
          socket.emit(S2C.OPEN_HANDOUT, payload);
        }
      }
    }
  }, 'SHARE_HANDOUT'));

  // ----- rollable tables -----

  socket.on(C2S.CREATE_TABLE, safe(socket, ({ name }: CreateTablePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM creates tables.'); return; }
    rollableTables.create(d.campaignId, name?.trim() || 'New table');
    broadcastTables(io, d.campaignId);
  }, 'CREATE_TABLE'));

  socket.on(C2S.UPDATE_TABLE, safe(socket, ({ tableId, name, playersCanRoll, items, parentId }: UpdateTablePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const t = rollableTables.byId(tableId);
    if (!t || t.campaignId !== d.campaignId) return;
    rollableTables.update(tableId, {
      name,
      playersCanRoll,
      parentId,
      items: items?.map((it) => ({ text: String(it.text ?? ''), weight: it.weight && it.weight > 0 ? it.weight : 1 })).filter((it) => it.text.trim()),
    });
    broadcastTables(io, d.campaignId);
  }, 'UPDATE_TABLE'));

  socket.on(C2S.DELETE_TABLE, safe(socket, ({ tableId }: DeleteTablePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const t = rollableTables.byId(tableId);
    if (!t || t.campaignId !== d.campaignId) return;
    rollableTables.delete(tableId);
    broadcastTables(io, d.campaignId);
  }, 'DELETE_TABLE'));

  socket.on(C2S.ROLL_TABLE, safe(socket, ({ tableId }: RollTablePayload) => {
    if (!rollGate(socket)) return;
    const d = requireCampaign(socket);
    const t = rollableTables.byId(tableId);
    if (!t || t.campaignId !== d.campaignId) throw new Error('Unknown table.');
    if (d.role !== 'dm' && !t.playersCanRoll) { emitError(socket, 'You cannot roll that table.'); return; }
    if (t.items.length === 0) { emitError(socket, 'That table has no items.'); return; }
    // Weighted random pick.
    const total = t.items.reduce((s, it) => s + it.weight, 0);
    let pick = Math.random() * total;
    let chosen = t.items[t.items.length - 1];
    for (const it of t.items) { if (pick < it.weight) { chosen = it; break; } pick -= it.weight; }
    const text = `${t.name}: ${chosen.text}`;
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'roll',
      text, roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    // Flash the same result on-screen for everyone as a colored pill.
    io.to(campaignRoom(d.campaignId)).emit(S2C.TABLE_RESULT, { text, color: '#8a6cd2' });
  }, 'ROLL_TABLE'));
}
