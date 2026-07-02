import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type ClearDrawingsPayload, type CreateHandoutPayload, type DeleteHandoutPayload,
  type DrawPayload, type EraseDrawingPayload, type MeasurePayload, type PingPayload,
  type ShareHandoutPayload, type UpdateHandoutPayload,
} from 'shared';
import { campaigns, drawings, handouts, maps } from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata } from '../hub.js';

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
  }));

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
  }));

  socket.on(C2S.CLEAR_DRAWINGS, safe(socket, ({ mapId, layer }: ClearDrawingsPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    drawings.clearLayer(mapId, layer);
    io.to(campaignRoom(d.campaignId)).emit(S2C.DRAWINGS_CLEARED, { mapId, layer });
  }));

  // ----- pings & measurement -----

  socket.on(C2S.PING, safe(socket, ({ x, y }: PingPayload) => {
    const d = requireCampaign(socket);
    io.to(campaignRoom(d.campaignId)).emit(S2C.PING_SHOWN, {
      x, y, color: colorFor(d.userId), byName: d.username,
    });
  }));

  socket.on(C2S.MEASURE, safe(socket, ({ from, to, active }: MeasurePayload) => {
    const d = requireCampaign(socket);
    io.to(campaignRoom(d.campaignId)).emit(S2C.MEASURE_SHOWN, {
      userId: d.userId, from, to, active: !!active, byName: d.username, color: colorFor(d.userId),
    });
  }));

  // ----- handouts -----

  socket.on(C2S.CREATE_HANDOUT, safe(socket, ({ title, bodyMd, assetId }: CreateHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM creates handouts.');
      return;
    }
    handouts.create(d.campaignId, title?.trim() || 'Untitled', bodyMd ?? '', assetId ?? null);
    broadcastHandouts(io, d.campaignId);
  }));

  socket.on(C2S.UPDATE_HANDOUT, safe(socket, ({ handoutId, title, bodyMd, assetId }: UpdateHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const h = handouts.byId(handoutId);
    if (!h) return;
    handouts.update(handoutId, { title, bodyMd, assetId });
    broadcastHandouts(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_HANDOUT, safe(socket, ({ handoutId }: DeleteHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    handouts.delete(handoutId);
    broadcastHandouts(io, d.campaignId);
  }));

  socket.on(C2S.SHARE_HANDOUT, safe(socket, ({ handoutId, to }: ShareHandoutPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    handouts.share(handoutId, to);
    broadcastHandouts(io, d.campaignId);
  }));
}
