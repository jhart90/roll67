import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, canMoveToken, inBounds,
  type CreateTokenPayload, type DeleteTokenPayload, type DragTokenPayload,
  type MoveTokenPayload, type UpdateTokenPayload,
} from 'shared';
import { characters, maps, tokens } from '../../db/repos.js';
import { dmRoom, emitError, safe, sdata } from '../hub.js';
import { socketsSeeingToken, syncMapVision } from '../visionService.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

export function registerTokenHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.CREATE_TOKEN, safe(socket, (payload: CreateTokenPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can place tokens.');
      return;
    }
    const map = maps.byId(payload.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (!inBounds({ q: payload.q, r: payload.r }, map.grid)) throw new Error('Off the map.');
    const character = payload.characterId ? characters.byId(payload.characterId) : undefined;
    tokens.create({
      mapId: payload.mapId,
      characterId: character?.id ?? null,
      name: payload.name?.trim() || character?.name || 'Token',
      artAssetId: payload.artAssetId ?? null,
      q: payload.q,
      r: payload.r,
      layer: payload.layer ?? 'token',
      size: payload.size ?? 1,
      color: payload.color ?? '#6c9bd2',
      vision: payload.vision ?? null,
      bar: payload.bar ?? null,
    });
    // DM sees the new token immediately; players learn via vision sync.
    const created = tokens.forMap(payload.mapId).at(-1)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: created });
    syncMapVision(io, d.campaignId, payload.mapId);
  }));

  socket.on(C2S.DELETE_TOKEN, safe(socket, ({ tokenId }: DeleteTokenPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can remove tokens.');
      return;
    }
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    tokens.delete(tokenId);
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId });
    syncMapVision(io, d.campaignId, token.mapId);
  }));

  socket.on(C2S.UPDATE_TOKEN, safe(socket, ({ tokenId, patch }: UpdateTokenPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can edit tokens.');
      return;
    }
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    tokens.update(tokenId, patch);
    const updated = tokens.byId(tokenId)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: updated });
    syncMapVision(io, d.campaignId, token.mapId);
  }));

  socket.on(C2S.MOVE_TOKEN, safe(socket, ({ tokenId, q, r }: MoveTokenPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!canMoveToken(d.role, d.userId, token, character)) {
      emitError(socket, 'You can only move your own character.');
      return;
    }
    if (!inBounds({ q, r }, map.grid)) {
      emitError(socket, 'That is off the map.');
      return;
    }
    tokens.move(tokenId, q, r);
    const moved = tokens.byId(tokenId)!;
    // Tell everyone who could already see it where it went; vision sync
    // handles reveals/hides for everyone else (and fog for the mover).
    for (const s of socketsSeeingToken(io, d.campaignId, moved)) {
      s.emit(S2C.TOKEN_MOVED, { tokenId, q, r });
    }
    syncMapVision(io, d.campaignId, token.mapId);
  }));

  socket.on(C2S.DRAG_TOKEN, safe(socket, ({ tokenId, x, y, done }: DragTokenPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!canMoveToken(d.role, d.userId, token, character)) return;
    // Ghost positions are ephemeral: relayed only to viewers who already see
    // the token, never persisted, no vision recompute.
    for (const s of socketsSeeingToken(io, d.campaignId, token)) {
      if (s.id !== socket.id) s.emit(S2C.TOKEN_DRAG_GHOST, { tokenId, x, y, done: !!done });
    }
  }));
}
