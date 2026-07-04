import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, canMoveToken, firstFreeHex, inBounds, packHex, reachableAlong, systemFor,
  type Character, type CreateTokenPayload, type DeleteTokenPayload, type DragTokenPayload,
  type GridConfig, type Hex, type MoveTokenPayload, type UpdateTokenPayload,
} from 'shared';
import { characters, maps, tokens } from '../../db/repos.js';
import { dmRoom, emitError, safe, sdata } from '../hub.js';
import { socketsSeeingToken, syncMapVision } from '../visionService.js';
import { broadcastDirectory } from '../directory.js';

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
      shape: payload.shape ?? 'circle',
      color: payload.color ?? '#6c9bd2',
      vision: payload.vision ?? null,
      bar: payload.bar ?? null,
    });
    // DM sees the new token immediately; players learn via vision sync.
    const created = tokens.forMap(payload.mapId).at(-1)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: created });
    syncMapVision(io, d.campaignId, payload.mapId);
    broadcastDirectory(io, d.campaignId);
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
    broadcastDirectory(io, d.campaignId);
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
    broadcastDirectory(io, d.campaignId);
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
    // Players can't cross walls or closed doors: the token stops on the last
    // free hex in that direction (held up against the blocker). The DM moves
    // freely. Movement is straight-line collision, not auto-pathing.
    let dest = { q, r };
    if (d.role !== 'dm') {
      const stop = reachableAlong(
        { q: token.q, r: token.r },
        { q, r },
        { grid: map.grid, walls: map.walls, doors: map.doors },
      );
      if (stop.q === token.q && stop.r === token.r) return; // held up — no move
      dest = stop;
    }
    tokens.move(tokenId, dest.q, dest.r);
    const moved = tokens.byId(tokenId)!;
    // Tell everyone who could already see it where it went; vision sync
    // handles reveals/hides for everyone else (and fog for the mover).
    for (const s of socketsSeeingToken(io, d.campaignId, moved)) {
      s.emit(S2C.TOKEN_MOVED, { tokenId, q: dest.q, r: dest.r });
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

const TOKEN_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#c9c96c'];

function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

/** The map's rough center hex (odd-r offset → axial). */
function centerHex(grid: GridConfig): Hex {
  const r = Math.floor(grid.rows / 2);
  const col = Math.floor(grid.cols / 2);
  return { q: col - (r - (r & 1)) / 2, r };
}

/**
 * Relocate a character's token to a map (used when a character is dragged onto a
 * map in the world tree): remove its tokens from other maps and, unless one is
 * already on the target map, drop a fresh token at the map's spawn point (or
 * center), nudged to the nearest free hex.
 */
export function placeCharacterToken(io: Server, campaignId: string, character: Character, mapId: string): void {
  const map = maps.byId(mapId);
  if (!map || map.campaignId !== campaignId) return;

  const touchedMaps = new Set<string>();
  let onTarget = false;
  for (const t of tokens.forCharacter(character.id)) {
    if (t.mapId === mapId) { onTarget = true; continue; }
    tokens.delete(t.id);
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId: t.id });
    touchedMaps.add(t.mapId);
  }

  if (!onTarget) {
    const spawn = map.spawn ?? centerHex(map.grid);
    const occupied = new Set(tokens.forMap(mapId).map((t) => packHex({ q: t.q, r: t.r })));
    const hex = firstFreeHex(spawn, occupied, map.grid);
    const artAssetId = typeof character.sheet.tokenImageAssetId === 'string' ? character.sheet.tokenImageAssetId : null;
    const hp = systemFor(character.system).hp(character.sheet);
    const created = tokens.create({
      mapId, characterId: character.id, name: character.name, artAssetId,
      q: hex.q, r: hex.r, layer: character.ownerUserId ? 'token' : 'gm', size: 1, shape: 'circle',
      color: TOKEN_COLORS[Math.abs(hashStr(character.id)) % TOKEN_COLORS.length],
      vision: null, bar: hp.maxHp > 0 ? hp : null, light: null,
    });
    io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: created });
    touchedMaps.add(mapId);
  }

  for (const m of touchedMaps) syncMapVision(io, campaignId, m);
  broadcastDirectory(io, campaignId);
}
