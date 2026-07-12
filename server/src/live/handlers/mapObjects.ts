import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, hexDistance, firstFreeHex, packHex, systemFor,
  type DeleteMapObjectPayload, type OpenChestPayload, type PlaceMapObjectPayload,
  type TakeAllChestPayload, type TakeChestItemPayload,
  type TakeMapItemPayload, type UpdateMapObjectPayload,
} from 'shared';
import { campaigns, characters, chat, handouts, mapObjects, maps, tokens, worldFolders } from '../../db/repos.js';
import { campaignRoom, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { syncMapVision } from '../visionService.js';
import { centerHex, hashStr, TOKEN_COLORS } from './tokens.js';
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

function postTake(io: Server, campaignId: string, playerName: string, itemName: string): void {
  const msg = chat.add(campaignId, {
    userId: null, fromName: 'System', kind: 'system',
    text: `${playerName} has taken ${itemName}`,
    roll: null, recipients: null,
  });
  io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
}

export function registerMapObjectHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.PLACE_MAP_OBJECT, safe(socket, (payload: PlaceMapObjectPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can place map objects.'); return; }
    const map = maps.byId(payload.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    const obj = mapObjects.create(payload.mapId, payload.kind, payload.name, payload.description ?? '', payload.q, payload.r);
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
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
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
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
    mapObjects.delete(objectId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId });
    postTake(io, d.campaignId, d.username, obj.name);
  }, 'TAKE_MAP_ITEM'));

  socket.on(C2S.TAKE_CHEST_ITEM, safe(socket, ({ objectId, itemId }: TakeChestItemPayload) => {
    const d = requireCampaign(socket);
    const obj = mapObjects.byId(objectId);
    if (!obj || obj.kind !== 'chest') throw new Error('Unknown chest.');
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (d.role !== 'dm' && !playerWithinRange(d.userId, obj.mapId, obj.q, obj.r)) {
      emitError(socket, 'You are not close enough to reach that chest.'); return;
    }
    const item = obj.items.find((i: { id: string }) => i.id === itemId);
    if (!item) throw new Error('Item not in chest.');
    const remaining = obj.items.filter((i: { id: string }) => i.id !== itemId);
    mapObjects.update(objectId, { items: remaining });
    const updated = mapObjects.byId(objectId)!;
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
    postTake(io, d.campaignId, d.username, item.name);
  }, 'TAKE_CHEST_ITEM'));

  socket.on(C2S.TAKE_ALL_CHEST, safe(socket, ({ objectId }: TakeAllChestPayload) => {
    const d = requireCampaign(socket);
    const obj = mapObjects.byId(objectId);
    if (!obj || obj.kind !== 'chest') throw new Error('Unknown chest.');
    const map = maps.byId(obj.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (d.role !== 'dm' && !playerWithinRange(d.userId, obj.mapId, obj.q, obj.r)) {
      emitError(socket, 'You are not close enough to reach that chest.'); return;
    }
    if (obj.items.length === 0) return;
    for (const item of obj.items) {
      postTake(io, d.campaignId, d.username, item.name);
    }
    mapObjects.update(objectId, { items: [] });
    const updated = mapObjects.byId(objectId)!;
    io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
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
          q: hex.q, r: hex.r, layer: char.ownerUserId ? 'token' : 'gm', size: 1, shape: 'circle',
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
