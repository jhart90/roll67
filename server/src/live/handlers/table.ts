import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type AoePreviewPayload, type ClearDrawingsPayload, type CreateHandoutPayload, type CreateTablePayload,
  type DeleteHandoutPayload, type DeleteTablePayload, type DrawPayload,
  type EraseDrawingPayload, type MeasurePayload, type PingPayload, type RollTablePayload,
  type ShareHandoutPayload, type TargetPreviewPayload, type UpdateHandoutPayload, type UpdateTablePayload,
} from 'shared';
import { campaigns, chat, drawings, handouts, maps, rollableTables, tokens } from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata } from '../hub.js';
import { socketsSeeingToken } from '../visionService.js';

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
    const isDm = sdata(socket).role === 'dm';
    socket.emit(S2C.TABLES, { tables: isDm ? all : all.filter((t) => t.playersCanRoll) });
  }
}

/** Re-send each connected member their (role-filtered) handout list. */
export function broadcastHandouts(io: Server, campaignId: string): void {
  const all = handouts.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    const list = d.role === 'dm'
      ? all
      : all.filter((h) => h.sharedAll || h.sharedWith.includes(d.userId)).map((h) => ({ ...h, sharedWith: [] }));
    socket.emit(S2C.HANDOUTS, { handouts: list });
  }
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

  socket.on(C2S.CREATE_HANDOUT, safe(socket, ({ title, bodyMd, assetId }: CreateHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM creates handouts.');
      return;
    }
    handouts.create(d.campaignId, title?.trim() || 'Untitled', bodyMd ?? '', assetId ?? null);
    broadcastHandouts(io, d.campaignId);
  }, 'CREATE_HANDOUT'));

  socket.on(C2S.UPDATE_HANDOUT, safe(socket, ({ handoutId, title, bodyMd, assetId, parentId }: UpdateHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const h = handouts.byId(handoutId);
    if (!h) return;
    handouts.update(handoutId, { title, bodyMd, assetId, parentId });
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
