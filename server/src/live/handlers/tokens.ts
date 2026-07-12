import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, canMoveToken, firstFreeHex, inBounds, packHex, reachableAlong, systemFor,
  type Character, type CreateTokenPayload, type DeleteTokenPayload, type DragTokenPayload,
  type GridConfig, type Hex, type MoveTokenPayload, type UpdateTokenPayload,
} from 'shared';
import { campaigns, characters, maps, tokens } from '../../db/repos.js';
import { db } from '../../db/db.js';
import { dmRoom, emitError, safe, scrubNonFinite, sdata, userRoom } from '../hub.js';
import { persistSheet } from '../hp.js';
import { socketsSeeingToken, syncMapVision } from '../visionService.js';
import { broadcastDirectory } from '../directory.js';
import { broadcastPresence, sendMapStateToUser } from './session.js';

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
  }, 'CREATE_TOKEN'));

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
  }, 'DELETE_TOKEN'));

  socket.on(C2S.UPDATE_TOKEN, safe(socket, ({ tokenId, patch: rawPatch }: UpdateTokenPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can edit tokens.');
      return;
    }
    const patch = scrubNonFinite(rawPatch);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    // For a character-linked token the SHEET is authoritative for HP: a bar
    // edit writes through to the sheet (persistSheet then mirrors the new HP
    // back onto every one of that character's token bars), so the sheet and
    // the token can never drift apart. Only unlinked tokens keep a bar of
    // their own.
    let tokenPatch = patch;
    if (patch.bar && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch) {
        persistSheet(io, d.campaignId, ch, { hp: patch.bar.hp, maxHp: patch.bar.maxHp });
        const { bar: _bar, ...rest } = patch;
        tokenPatch = rest;
        if (Object.keys(tokenPatch).length === 0) {
          broadcastDirectory(io, d.campaignId);
          return;
        }
      }
    }
    // Art sync: changing a character-linked token's art also updates the sheet.
    if (typeof tokenPatch.artAssetId === 'string' && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch) {
        characters.update(ch.id, undefined, { ...ch.sheet, tokenImageAssetId: tokenPatch.artAssetId });
        const updatedCh = characters.byId(ch.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
        if (updatedCh.ownerUserId) io.to(userRoom(updatedCh.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
      }
    }
    // Name sync: renaming a character-linked token also renames the character.
    if (typeof tokenPatch.name === 'string' && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch && ch.name !== tokenPatch.name) {
        characters.update(ch.id, tokenPatch.name, ch.sheet);
        const updatedCh = characters.byId(ch.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
        if (updatedCh.ownerUserId) io.to(userRoom(updatedCh.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
      }
    }
    tokens.update(tokenId, tokenPatch);
    const updated = tokens.byId(tokenId)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: updated });
    syncMapVision(io, d.campaignId, token.mapId);
    broadcastDirectory(io, d.campaignId);
  }, 'UPDATE_TOKEN'));

  socket.on(C2S.MOVE_TOKEN, safe(socket, ({ tokenId, q: rawQ, r: rawR }: MoveTokenPayload) => {
    const d = requireCampaign(socket);
    // Hex coordinates are integers by definition; a fractional/garbage value
    // (inBounds already rejects NaN) would otherwise persist verbatim.
    const q = Math.round(rawQ);
    const r = Math.round(rawR);
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
    const fromHex = { q: token.q, r: token.r };
    tokens.move(tokenId, dest.q, dest.r);
    const moved = tokens.byId(tokenId)!;
    // Tell everyone who could already see it where it went; vision sync
    // handles reveals/hides for everyone else (and fog for the mover).
    for (const s of socketsSeeingToken(io, d.campaignId, moved)) {
      s.emit(S2C.TOKEN_MOVED, { tokenId, q: dest.q, r: dest.r });
    }
    // A single move can only possibly change what's visible near its old or
    // new hex (plus, if it carries a light, that light's own glow radius) --
    // viewers nowhere near either spot can skip the recompute entirely. This
    // is the hot path (fired on every step of every token's movement), so
    // it's the one call site worth hinting; other, far less frequent vision
    // triggers (wall/door/light edits, etc.) keep the always-safe full sync.
    syncMapVision(io, d.campaignId, token.mapId, {
      hexes: [fromHex, dest],
      extraRadius: token.light ? Math.max(token.light.bright, token.light.dim) : 0,
    });
  }, 'MOVE_TOKEN'));

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
  }, 'DRAG_TOKEN'));
}

export const TOKEN_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#c9c96c'];

export function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

/** The map's rough center hex (odd-r offset → axial). */
export function centerHex(grid: GridConfig): Hex {
  const r = Math.floor(grid.rows / 2);
  const col = Math.floor(grid.cols / 2);
  return { q: col - (r - (r & 1)) / 2, r };
}

/**
 * Relocate a character's token to a map (used when a character is dragged onto a
 * map in the world tree, or dropped directly on the map canvas): remove its
 * tokens from other maps and place it on the target map. If `dropHex` is given
 * (an explicit drop location on the canvas) an existing token on the target map
 * is moved there and a new one is created there rather than at the spawn point;
 * otherwise a fresh token lands at the map's spawn point (or center), nudged to
 * the nearest free hex, and an existing token on the target map is left alone.
 */
export function placeCharacterToken(
  io: Server, campaignId: string, character: Character, mapId: string, dropHex?: Hex | null,
): void {
  const map = maps.byId(mapId);
  if (!map || map.campaignId !== campaignId) return;
  if (dropHex && !inBounds(dropHex, map.grid)) dropHex = null;

  // All DB mutations in ONE transaction (a crash between the old tokens'
  // deletes and the new token's create would strand the character with no
  // token anywhere); the socket broadcasts happen after the commit, so
  // clients never hear about a change that then rolled back.
  const touchedMaps = new Set<string>();
  const { removedIds, upserted } = db.transaction(() => {
    const removed: string[] = [];
    let existingOnTarget: string | null = null;
    for (const t of tokens.forCharacter(character.id)) {
      if (t.mapId === mapId) { existingOnTarget = t.id; continue; }
      tokens.delete(t.id);
      removed.push(t.id);
      touchedMaps.add(t.mapId);
    }

    if (existingOnTarget && dropHex) {
      tokens.move(existingOnTarget, dropHex.q, dropHex.r);
      touchedMaps.add(mapId);
      return { removedIds: removed, upserted: tokens.byId(existingOnTarget)! };
    }
    if (!existingOnTarget) {
      let hex = dropHex;
      if (!hex) {
        const spawn = map.spawn ?? centerHex(map.grid);
        const occupied = new Set(tokens.forMap(mapId).map((t) => packHex({ q: t.q, r: t.r })));
        hex = firstFreeHex(spawn, occupied, map.grid);
      }
      const artAssetId = typeof character.sheet.tokenImageAssetId === 'string' ? character.sheet.tokenImageAssetId : null;
      const hp = systemFor(character.system).hp(character.sheet);
      const created = tokens.create({
        mapId, characterId: character.id, name: character.name, artAssetId,
        q: hex.q, r: hex.r, layer: character.ownerUserId ? 'token' : 'gm', size: 1, shape: 'circle',
        color: TOKEN_COLORS[Math.abs(hashStr(character.id)) % TOKEN_COLORS.length],
        vision: null, bar: hp.maxHp > 0 ? hp : null, light: null,
      });
      touchedMaps.add(mapId);
      return { removedIds: removed, upserted: created };
    }
    return { removedIds: removed, upserted: null };
  })();

  for (const id of removedIds) io.to(dmRoom(campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId: id });
  if (upserted) io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: upserted });

  // A player's own token landing on a map they're not currently viewing
  // (e.g. the DM dragged their character onto a new map) pulls that player
  // onto it — the same mechanism as the DM manually assigning them a map.
  if (character.ownerUserId && campaigns.viewMapIdFor(campaignId, character.ownerUserId) !== mapId) {
    campaigns.setMemberMap(campaignId, character.ownerUserId, mapId);
    sendMapStateToUser(io, campaignId, character.ownerUserId);
    broadcastPresence(io, campaignId);
  }

  for (const m of touchedMaps) syncMapVision(io, campaignId, m);
  broadcastDirectory(io, campaignId);
}
