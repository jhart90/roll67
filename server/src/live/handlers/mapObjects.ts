import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, acquirePatch, conditionCombat, conditionsOf, hexDistance, firstFreeHex, packHex, systemFor,
  type Character, type DeleteMapObjectPayload, type GameSystem, type OpenChestPayload, type PlaceMapObjectPayload,
  type SheetData, type TakeAllChestPayload, type TakeChestItemPayload,
  type TakeMapItemPayload, type UpdateMapObjectPayload,
} from 'shared';
import { campaigns, characters, chat, handouts, mapObjects, maps, tokens, worldFolders } from '../../db/repos.js';
import { sheetOpens, type LockTarget } from 'shared';
import { campaignRoom, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { socketsSeeingHex, syncMapVision } from '../visionService.js';
import { centerHex, hashStr, tokenLookFor, TOKEN_COLORS } from './tokens.js';
import { broadcastWorldFolders } from './world.js';
import { broadcastHandouts } from './table.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

function playerWithinRange(userId: string, mapId: string, q: number, r: number, range = 1): boolean {
  for (const t of tokens.forMap(mapId)) {
    if (!t.characterId) continue;
    const ch = characters.byId(t.characterId);
    if (!ch || ch.ownerUserId !== userId) continue;
    if (hexDistance({ q: t.q, r: t.r }, { q, r }) <= range) return true;
  }
  return false;
}

/**
 * A chest that somebody is CARRYING — a body's pockets rather than a box on
 * the floor.
 *
 * Two things follow from being carried, and both are answered here so every
 * take path asks the same question. It has no fixed place on the map: reach
 * is measured to whoever is holding it, wherever they have walked. And it is
 * shut to the living: a player may go through the pockets only once the
 * bearer is incapacitated or dead, which is the whole of the rule — the DM,
 * as ever, is not searching anybody, they are running them.
 */
function carrierOf(obj: { linkedCharacterId?: string | null; mapId: string }): {
  character: Character; token: { q: number; r: number } | null; down: boolean;
} | null {
  if (!obj.linkedCharacterId) return null;
  const character = characters.byId(obj.linkedCharacterId);
  if (!character) return null;
  const token = tokens.forMap(obj.mapId).find((t) => t.characterId === character.id) ?? null;
  const conds = conditionsOf(character.sheet);
  const down = conditionCombat(conds).incapacitated || conds.includes('dead') || conds.includes('unconscious');
  return { character, token: token ? { q: token.q, r: token.r } : null, down };
}

/** Where a container actually IS: a carried one is wherever its bearer is. */
function containerHex(obj: { q: number; r: number; linkedCharacterId?: string | null; mapId: string }): { q: number; r: number } {
  return carrierOf(obj)?.token ?? { q: obj.q, r: obj.r };
}

/** Why this player may not go through it, or null when they may. */
function carriedBlocks(role: string, obj: { linkedCharacterId?: string | null; mapId: string; name: string }): string | null {
  if (role === 'dm') return null;
  const carrier = carrierOf(obj);
  if (!carrier) return null;
  if (carrier.down) return null;
  return `${carrier.character.name} is still on their feet — you cannot go through their pockets.`;
}

function postTake(io: Server, campaignId: string, playerName: string, itemName: string, intoName?: string): void {
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: intoName ? `${playerName} has taken ${itemName} (added to ${intoName})` : `${playerName} has taken ${itemName}`,
    roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

/**
 * Which character actually pockets the loot. A player takes with the character
 * of theirs standing closest to the container — with several tokens in reach,
 * the near one is the one whose hand is in the chest. The DM, who owns nobody
 * in particular, takes with whoever is nearest regardless of ownership.
 */
function takerFor(
  role: string, userId: string, mapId: string, q: number, r: number,
): Character | null {
  let best: { ch: Character; dist: number } | null = null;
  for (const t of tokens.forMap(mapId)) {
    if (!t.characterId) continue;
    const ch = characters.byId(t.characterId);
    if (!ch) continue;
    if (role !== 'dm' && ch.ownerUserId !== userId) continue;
    const dist = hexDistance({ q: t.q, r: t.r }, { q, r });
    if (!best || dist < best.dist) best = { ch, dist };
  }
  return best?.ch ?? null;
}

/**
 * Move one item out of a container and onto a character's sheet. Chest loot is
 * free — the price-zero end of the same acquisition path a shop purchase runs
 * through, so a looted weapon becomes a real attack row exactly as a bought one
 * does. Returns the name of who took it, or null if nobody could.
 */
function grantLoot(
  io: Server, campaignId: string, taker: Character, item: { name: string; contentId?: string; description?: string },
): string {
  const patch = acquirePatch(taker.sheet as SheetData, taker.system as GameSystem, {
    name: item.name, contentId: item.contentId, notes: item.description || 'found',
  });
  characters.update(taker.id, undefined, { ...taker.sheet, ...patch });
  const updated = characters.byId(taker.id)!;
  io.to(dmRoom(campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
  if (updated.ownerUserId) io.to(userRoom(updated.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
  return updated.name;
}

/**
 * Does any character this user owns carry an inventory item with this name?
 * Same rule as a locked door: holding the key is enough, it is not consumed,
 * and a "Key" by default means the generic one.
 */
/** A locked chest refuses everyone but the DM and whoever holds a key that
 *  fits — a named key, one cut for this chest, one for every chest on the
 *  map, or a master. */
function lockBlocks(
  role: string, userId: string, campaignId: string,
  obj: { id: string; mapId: string; locked?: boolean; keyName?: string | null },
): string | null {
  if (role === 'dm' || !obj.locked) return null;
  const key = obj.keyName?.trim() || 'Key';
  const target: LockTarget = { kind: 'chest', id: obj.id, mapId: obj.mapId, keyName: key };
  const opens = characters.forCampaign(campaignId)
    .some((c) => c.ownerUserId === userId && sheetOpens(c.sheet, target));
  if (opens) return null;
  return `It's locked. You need ${/^a |^an |^the /i.test(key) ? key : `a ${key}`} to open it.`;
}

export function registerMapObjectHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.PLACE_MAP_OBJECT, safe(socket, (payload: PlaceMapObjectPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can place map objects.'); return; }
    const map = maps.byId(payload.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    const obj = mapObjects.create(payload.mapId, payload.kind, payload.name, payload.description ?? '', payload.q, payload.r);
    for (const s of socketsSeeingHex(io, d.campaignId, obj.mapId, obj.q, obj.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
  }, 'PLACE_MAP_OBJECT'));

  socket.on(C2S.UPDATE_MAP_OBJECT, safe(socket, ({ objectId, patch }: UpdateMapObjectPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can edit map objects.'); return; }
    const obj = mapObjects.byId(objectId);
    if (!obj) return;
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map object.');
    mapObjects.update(objectId, patch);
    const updated = mapObjects.byId(objectId)!;
    for (const s of socketsSeeingHex(io, d.campaignId, updated.mapId, updated.q, updated.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
    // A chest is one thing wearing two records — the folder in the world tree
    // that holds its contents, and this box that stands on the ground. The
    // tree row reads the folder's name, so a rename here that stopped at the
    // object would rename a chest the DM could not see change.
    if (typeof patch.name === 'string' && obj.worldFolderId) {
      const folder = worldFolders.byId(obj.worldFolderId);
      if (folder && folder.campaignId === d.campaignId && folder.name !== updated.name) {
        worldFolders.update(folder.id, { name: updated.name });
        broadcastWorldFolders(io, d.campaignId);
      }
    }
  }, 'UPDATE_MAP_OBJECT'));

  socket.on(C2S.DELETE_MAP_OBJECT, safe(socket, ({ objectId }: DeleteMapObjectPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can remove map objects.'); return; }
    const obj = mapObjects.byId(objectId);
    if (!obj) return;
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map object.');
    mapObjects.delete(objectId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId });
  }, 'DELETE_MAP_OBJECT'));

  socket.on(C2S.TAKE_MAP_ITEM, safe(socket, ({ objectId }: TakeMapItemPayload) => {
    const d = requireCampaign(socket);
    const obj = mapObjects.byId(objectId);
    if (!obj || obj.kind !== 'item') throw new Error('Unknown item.');
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (d.role !== 'dm' && !playerWithinRange(d.userId, obj.mapId, obj.q, obj.r)) {
      emitError(socket, 'You are not close enough to pick that up.'); return;
    }
    const taker = takerFor(d.role, d.userId, obj.mapId, containerHex(obj).q, containerHex(obj).r);
    if (!taker) { emitError(socket, 'No character of yours is here to pick that up.'); return; }
    const into = grantLoot(io, d.campaignId, taker, { name: obj.name, description: obj.description });
    mapObjects.delete(objectId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId });
    postTake(io, d.campaignId, d.username, obj.name, into);
  }, 'TAKE_MAP_ITEM'));

  socket.on(C2S.TAKE_CHEST_ITEM, safe(socket, ({ objectId, itemId }: TakeChestItemPayload) => {
    const d = requireCampaign(socket);
    const obj = mapObjects.byId(objectId);
    if (!obj || obj.kind !== 'chest') throw new Error('Unknown chest.');
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    {
      const at = containerHex(obj);
      if (d.role !== 'dm' && !playerWithinRange(d.userId, obj.mapId, at.q, at.r)) {
        emitError(socket, 'You are not close enough to reach that chest.'); return;
      }
      const shut = carriedBlocks(d.role, obj);
      if (shut) { emitError(socket, shut); return; }
    }
    {
      const blocked = lockBlocks(d.role, d.userId, d.campaignId, obj);
      if (blocked) { emitError(socket, blocked); return; }
    }
    const item = obj.items.find((i: { id: string }) => i.id === itemId);
    if (!item) throw new Error('Item not in chest.');
    const taker = takerFor(d.role, d.userId, obj.mapId, containerHex(obj).q, containerHex(obj).r);
    if (!taker) { emitError(socket, 'No character of yours is here to take it.'); return; }
    // A pile of several hands one over and keeps the rest; a single item
    // empties its row.
    const left = Math.max(0, (item.qty ?? 1) - 1);
    const remaining = left > 0
      ? obj.items.map((i) => (i.id === itemId ? { ...i, qty: left } : i))
      : obj.items.filter((i: { id: string }) => i.id !== itemId);
    mapObjects.update(objectId, { items: remaining });
    const updated = mapObjects.byId(objectId)!;
    for (const s of socketsSeeingHex(io, d.campaignId, updated.mapId, updated.q, updated.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
    postTake(io, d.campaignId, d.username, item.name, grantLoot(io, d.campaignId, taker, item));
  }, 'TAKE_CHEST_ITEM'));

  socket.on(C2S.TAKE_ALL_CHEST, safe(socket, ({ objectId }: TakeAllChestPayload) => {
    const d = requireCampaign(socket);
    const obj = mapObjects.byId(objectId);
    if (!obj || obj.kind !== 'chest') throw new Error('Unknown chest.');
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    {
      const at = containerHex(obj);
      if (d.role !== 'dm' && !playerWithinRange(d.userId, obj.mapId, at.q, at.r)) {
        emitError(socket, 'You are not close enough to reach that chest.'); return;
      }
      const shut = carriedBlocks(d.role, obj);
      if (shut) { emitError(socket, shut); return; }
    }
    {
      const blocked = lockBlocks(d.role, d.userId, d.campaignId, obj);
      if (blocked) { emitError(socket, blocked); return; }
    }
    if (obj.items.length === 0) return;
    const taker = takerFor(d.role, d.userId, obj.mapId, containerHex(obj).q, containerHex(obj).r);
    if (!taker) { emitError(socket, 'No character of yours is here to take it.'); return; }
    for (const item of obj.items) {
      // Re-read the taker each time: every grant rewrites their sheet, and
      // stacking patches onto a stale copy would drop all but the last item.
      const fresh = characters.byId(taker.id);
      if (!fresh) break;
      for (let n = item.qty ?? 1; n > 0; n--) {
        const into = grantLoot(io, d.campaignId, characters.byId(taker.id) ?? fresh, item);
        postTake(io, d.campaignId, d.username, item.name, into);
      }
    }
    mapObjects.update(objectId, { items: [] });
    const updated = mapObjects.byId(objectId)!;
    for (const s of socketsSeeingHex(io, d.campaignId, updated.mapId, updated.q, updated.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
  }, 'TAKE_ALL_CHEST'));

  socket.on(C2S.OPEN_CHEST, safe(socket, ({ objectId }: OpenChestPayload) => {
    const d = requireCampaign(socket);
    const obj = mapObjects.byId(objectId);
    if (!obj || obj.kind !== 'chest') throw new Error('Unknown chest.');
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (d.role !== 'dm' && !playerWithinRange(d.userId, obj.mapId, obj.q, obj.r)) {
      emitError(socket, 'You are not close enough to open that chest.'); return;
    }
    const locked = lockBlocks(d.role, d.userId, d.campaignId, obj);
    if (locked) { emitError(socket, locked); return; }

    const folderId = obj.worldFolderId;
    if (!folderId) return;

    const allFolders = worldFolders.forCampaign(d.campaignId);
    const folderIds = new Set<string>();
    function collectFolders(id: string) {
      folderIds.add(id);
      for (const sub of allFolders) if (sub.parentId === id) collectFolders(sub.id);
    }
    collectFolders(folderId);

    // 1. Place character tokens on adjacent hexes.
    const allChars = characters.forCampaign(d.campaignId);
    const charList = allChars.filter((c) => c.parentId && folderIds.has(c.parentId));
    if (charList.length > 0) {
      const spawn = { q: obj.q, r: obj.r };
      const occupied = new Set(tokens.forMap(obj.mapId).map((t) => packHex({ q: t.q, r: t.r })));
      occupied.add(packHex(spawn));

      for (const char of charList) {
        const existing = tokens.forCharacter(char.id).find((t) => t.mapId === obj.mapId);
        if (existing) continue;
        const hex = firstFreeHex(spawn, occupied, map.grid);
        occupied.add(packHex(hex));
        const artAssetId = typeof char.sheet.tokenImageAssetId === 'string' ? char.sheet.tokenImageAssetId : null;
        const hp = systemFor(char.system).hp(char.sheet);
        const created = tokens.create({
          mapId: obj.mapId, characterId: char.id, name: char.name, artAssetId,
          q: hex.q, r: hex.r, layer: char.ownerUserId ? 'token' : 'gm', ...tokenLookFor(char),
          color: TOKEN_COLORS[Math.abs(hashStr(char.id)) % TOKEN_COLORS.length],
          vision: null, bar: hp.maxHp > 0 ? hp : null, light: null,
        });
        io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: created });
      }
      syncMapVision(io, d.campaignId, obj.mapId);
    }

    // 2. Share handouts with the opener and auto-open them.
    const allHandouts = handouts.forCampaign(d.campaignId);
    const chestHandouts = allHandouts.filter((h) => h.parentId && folderIds.has(h.parentId));
    let sharedAny = false;
    for (const h of chestHandouts) {
      if (!h.sharedAll && !h.sharedWith.includes(d.userId)) {
        const newList = [...h.sharedWith, d.userId];
        handouts.share(h.id, newList);
        sharedAny = true;
      }
      io.to(userRoom(d.userId)).emit(S2C.OPEN_HANDOUT, { handoutId: h.id, title: h.title });
    }
    if (sharedAny) broadcastHandouts(io, d.campaignId);

    // 3. The loot popup (item contents) is handled client-side via lootPopupId.
  }, 'OPEN_CHEST'));
}
