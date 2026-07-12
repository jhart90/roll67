import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, applyEntry, contentById, firstFreeHex, normalizeCurrency, packHex, systemFor,
  type BuyItemPayload, type CreateCustomItemPayload, type CreateLocationPayload, type CreateShopPayload,
  type CreateWorldFolderPayload, type DeleteCustomItemPayload, type DeleteLocationPayload, type DeleteShopPayload,
  type DeleteWorldFolderPayload, type DropFolderOnCharacterPayload, type DropFolderOnMapPayload, type DropShopOnMapPayload, type GameSystem,
  type PresentShopPayload,
  type SheetData, type Shop, type ShopItem, type UpdateCustomItemPayload, type UpdateLocationPayload, type UpdateShopPayload,
  type UpdateWorldFolderPayload,
} from 'shared';
import { campaigns, characters, chat, customItems, locations, mapObjects, maps, shops, tokens, worldFolders } from '../../db/repos.js';
import { db } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { broadcastDirectory } from '../directory.js';
import { syncMapVision } from '../visionService.js';
import { broadcastPresence, sendMapStateToUser } from './session.js';
import { centerHex, hashStr, TOKEN_COLORS } from './tokens.js';

function campaignSystem(campaignId: string): string {
  return campaigns.byId(campaignId)?.system ?? 'dnd5e';
}

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

// ---------- shop presentation (in-memory per campaign) ----------

interface Presentation { shopId: string; userIds: string[] | 'all'; }
const presentations = new Map<string, Presentation>();

function isPresentedTo(campaignId: string, shopId: string, userId: string): boolean {
  const p = presentations.get(campaignId);
  if (!p || p.shopId !== shopId) return false;
  return p.userIds === 'all' || p.userIds.includes(userId);
}

function presentedShopIdForUser(campaignId: string, userId: string, isDm: boolean): string | null {
  const p = presentations.get(campaignId);
  if (!p) return null;
  if (isDm) return p.shopId;
  return p.userIds === 'all' || p.userIds.includes(userId) ? p.shopId : null;
}

/** Shops a viewer receives: DM all; players see open shops + any presented to them. */
export function shopsForUser(campaignId: string, userId: string, isDm: boolean): Shop[] {
  const all = shops.forCampaign(campaignId);
  if (isDm) return all;
  return all.filter((s) => s.playersCanBuy || isPresentedTo(campaignId, s.id, userId));
}

export function broadcastShops(io: Server, campaignId: string): void {
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    socket.emit(S2C.SHOPS, { shops: shopsForUser(campaignId, d.userId, d.role === 'dm') });
  }
}

export function broadcastShopPresentation(io: Server, campaignId: string): void {
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    socket.emit(S2C.SHOP_PRESENTATION, { shopId: presentedShopIdForUser(campaignId, d.userId, d.role === 'dm') });
  }
}

/** Sent on join so a (re)connecting player re-opens an active storefront. */
export function sendShopPresentationTo(socket: Socket): void {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) return;
  socket.emit(S2C.SHOP_PRESENTATION, { shopId: presentedShopIdForUser(d.campaignId, d.userId, d.role === 'dm') });
}

export function broadcastLocations(io: Server, campaignId: string): void {
  const all = locations.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const isDm = sdata(socket).role === 'dm';
    socket.emit(S2C.LOCATIONS, { locations: isDm ? all : all.filter((l) => l.visibleToPlayers) });
  }
}

/** Folders are pure organization (no secrecy toggle) — everyone gets the full set. */
export function broadcastWorldFolders(io: Server, campaignId: string): void {
  const all = worldFolders.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    socket.emit(S2C.WORLD_FOLDERS, { folders: all });
  }
}

export function registerWorldHandlers(io: Server, socket: Socket): void {
  // ----- shops -----

  socket.on(C2S.CREATE_SHOP, safe(socket, ({ name }: CreateShopPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM creates shops.'); return; }
    const campaign = campaignSystem(d.campaignId);
    shops.create(d.campaignId, name?.trim() || 'New shop', normalizeCurrency(campaign as GameSystem, undefined));
    broadcastShops(io, d.campaignId);
  }, 'CREATE_SHOP'));

  socket.on(C2S.UPDATE_SHOP, safe(socket, ({ shopId, ...fields }: UpdateShopPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const s = shops.byId(shopId);
    if (!s || s.campaignId !== d.campaignId) return;
    const items: ShopItem[] | undefined = fields.items?.map((it) => ({
      name: String(it.name ?? '').trim(),
      price: Math.max(0, Math.floor(it.price ?? 0)),
      qty: it.qty === undefined ? -1 : Math.floor(it.qty),
      notes: String(it.notes ?? ''),
      ...(it.contentId ? { contentId: String(it.contentId) } : {}),
      ...(it.effect === 'heal' || it.effect === 'damage' ? { effect: it.effect } : {}),
      ...(it.amount ? { amount: String(it.amount) } : {}),
      ...(it.range !== undefined ? { range: Math.max(0, Math.floor(it.range)) } : {}),
    })).filter((it) => it.name);
    shops.update(shopId, { ...fields, items });
    broadcastShops(io, d.campaignId);
  }, 'UPDATE_SHOP'));

  socket.on(C2S.DELETE_SHOP, safe(socket, ({ shopId }: DeleteShopPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const s = shops.byId(shopId);
    if (!s || s.campaignId !== d.campaignId) return;
    shops.delete(shopId);
    // Stop presenting a deleted shop.
    if (presentations.get(d.campaignId)?.shopId === shopId) {
      presentations.delete(d.campaignId);
      broadcastShopPresentation(io, d.campaignId);
    }
    broadcastShops(io, d.campaignId);
  }, 'DELETE_SHOP'));

  socket.on(C2S.PRESENT_SHOP, safe(socket, ({ shopId, userIds }: PresentShopPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can show shops.'); return; }
    const s = shops.byId(shopId);
    if (!s || s.campaignId !== d.campaignId) throw new Error('Unknown shop.');
    presentations.set(d.campaignId, { shopId, userIds: userIds === 'all' ? 'all' : [...userIds] });
    // Targeted players now receive the shop data, then the storefront pops.
    broadcastShops(io, d.campaignId);
    broadcastShopPresentation(io, d.campaignId);
  }, 'PRESENT_SHOP'));

  socket.on(C2S.DISMISS_SHOP, safe(socket, () => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    presentations.delete(d.campaignId);
    broadcastShops(io, d.campaignId);
    broadcastShopPresentation(io, d.campaignId);
  }, 'DISMISS_SHOP'));

  socket.on(C2S.BUY_ITEM, safe(socket, ({ shopId, itemIndex, characterId }: BuyItemPayload) => {
    const d = requireCampaign(socket);
    const shop = shops.byId(shopId);
    if (!shop || shop.campaignId !== d.campaignId) throw new Error('Unknown shop.');
    // Players may buy from open shops OR any shop currently presented to them.
    if (d.role !== 'dm' && !shop.playersCanBuy && !isPresentedTo(d.campaignId, shopId, d.userId)) {
      emitError(socket, 'This shop is not open to you.');
      return;
    }
    const item = shop.items[itemIndex];
    if (!item) throw new Error('Unknown item.');
    if (item.qty === 0) { emitError(socket, `${item.name} is sold out.`); return; }

    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && character.ownerUserId !== d.userId) { emitError(socket, 'You can only buy for your own character.'); return; }

    const system = character.system as GameSystem;
    const currencyField = normalizeCurrency(system, shop.currency);
    const purse = Number((character.sheet as Record<string, unknown>)[currencyField]) || 0;
    if (purse < item.price) { emitError(socket, `Not enough ${currencyField}: needs ${item.price}, has ${purse}.`); return; }

    // Deduct currency + transfer the item's logic to the buyer's sheet. A
    // compendium-backed item (contentId) applies its full entry — a weapon
    // becomes the buyer's attack, a potion becomes a usable item — while a
    // plain/custom item just lands in inventory (carrying any usable effect).
    const sheet = character.sheet as SheetData;
    const entry = item.contentId ? contentById(item.contentId) : undefined;
    const applied = entry ? applyEntry(entry, sheet) : null;
    const listId = applied?.listId ?? 'inventory';
    const row = applied?.row ?? {
      name: item.name,
      ...(system === 'swn' ? { qty: 1, enc: 1 } : { qty: 1, weight: 0 }),
      ...(item.effect ? { effect: item.effect, amount: item.amount ?? '', range: item.range ?? 5 } : {}),
      notes: item.notes || 'purchased',
    };
    const list = Array.isArray(sheet[listId]) ? [...(sheet[listId] as SheetData[])] : [];
    list.push(row as SheetData);
    characters.update(characterId, undefined, { ...sheet, [currencyField]: purse - item.price, [listId]: list });
    const updated = characters.byId(characterId)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
    if (updated.ownerUserId) io.to(userRoom(updated.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });

    // Decrement finite stock.
    if (item.qty > 0) {
      const items = shop.items.map((it, i) => (i === itemIndex ? { ...it, qty: it.qty - 1 } : it));
      shops.update(shopId, { items });
      broadcastShops(io, d.campaignId);
    }

    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, kind: 'system',
      text: `${character.name} bought ${item.name} for ${item.price} ${shop.currency}.`,
      roll: null, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    broadcastDirectory(io, d.campaignId);
  }, 'BUY_ITEM'));

  // ----- locations -----

  socket.on(C2S.CREATE_LOCATION, safe(socket, ({ name, parentId }: CreateLocationPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM manages locations.'); return; }
    locations.create(d.campaignId, name?.trim() || 'New location', parentId ?? null);
    broadcastLocations(io, d.campaignId);
  }, 'CREATE_LOCATION'));

  socket.on(C2S.UPDATE_LOCATION, safe(socket, ({ locationId, ...fields }: UpdateLocationPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const l = locations.byId(locationId);
    if (!l || l.campaignId !== d.campaignId) return;
    locations.update(locationId, fields);
    broadcastLocations(io, d.campaignId);
  }, 'UPDATE_LOCATION'));

  socket.on(C2S.DELETE_LOCATION, safe(socket, ({ locationId }: DeleteLocationPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const l = locations.byId(locationId);
    if (!l || l.campaignId !== d.campaignId) return;
    locations.delete(locationId);
    broadcastLocations(io, d.campaignId);
  }, 'DELETE_LOCATION'));

  // ----- world-tree folders -----

  socket.on(C2S.CREATE_WORLD_FOLDER, safe(socket, ({ name, parentId, displayKind, items }: CreateWorldFolderPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM manages folders.'); return; }
    worldFolders.create(d.campaignId, name?.trim() || 'New folder', parentId ?? null, { displayKind, items });
    broadcastWorldFolders(io, d.campaignId);
  }, 'CREATE_WORLD_FOLDER'));

  socket.on(C2S.UPDATE_WORLD_FOLDER, safe(socket, ({ folderId, ...fields }: UpdateWorldFolderPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const f = worldFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    worldFolders.update(folderId, fields);
    broadcastWorldFolders(io, d.campaignId);
  }, 'UPDATE_WORLD_FOLDER'));

  socket.on(C2S.DELETE_WORLD_FOLDER, safe(socket, ({ folderId }: DeleteWorldFolderPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const f = worldFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    worldFolders.delete(folderId);
    broadcastWorldFolders(io, d.campaignId);
  }, 'DELETE_WORLD_FOLDER'));

  socket.on(C2S.DROP_FOLDER_ON_MAP, safe(socket, ({ folderId, mapId, q, r }: DropFolderOnMapPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const f = worldFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;

    // 1. Reparent the folder under the map + mark as chest.
    worldFolders.update(folderId, { parentId: mapId, displayKind: 'chest' });

    // 1b. Create a chest MapObject linked to this folder (if one doesn't already exist).
    const existingObjs = mapObjects.forMap(mapId);
    const alreadyLinked = existingObjs.find((o) => o.worldFolderId === folderId);
    if (!alreadyLinked) {
      const spawn = map.spawn ?? centerHex(map.grid);
      const occupied = new Set(existingObjs.map((o) => packHex({ q: o.q, r: o.r })));
      const hex = (q != null && r != null) ? { q, r } : firstFreeHex(spawn, occupied, map.grid);
      const obj = mapObjects.create(mapId, 'chest', f.name, '', hex.q, hex.r, { worldFolderId: folderId });
      io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
    }

    // 2. Collect all character descendants recursively.
    const allChars = characters.forCampaign(d.campaignId);
    const allFolders = worldFolders.forCampaign(d.campaignId);
    const folderIds = new Set<string>();
    function collectFolders(id: string) {
      folderIds.add(id);
      for (const sub of allFolders) if (sub.parentId === id) collectFolders(sub.id);
    }
    collectFolders(folderId);
    const charList = allChars.filter((c) => c.parentId && folderIds.has(c.parentId));
    if (charList.length === 0) {
      broadcastWorldFolders(io, d.campaignId);
      broadcastDirectory(io, d.campaignId);
      return;
    }

    // 3. Place tokens: relocate existing or create new, with shared occupancy tracking.
    const spawn = map.spawn ?? centerHex(map.grid);
    const occupied = new Set(tokens.forMap(mapId).map((t) => packHex({ q: t.q, r: t.r })));
    const touchedMaps = new Set<string>();
    const removedTokenIds: string[] = [];
    const upsertedTokens: ReturnType<typeof tokens.byId>[] = [];

    db.transaction(() => {
      for (const char of charList) {
        const existing = tokens.forCharacter(char.id);
        const onTarget = existing.find((t) => t.mapId === mapId);
        const onOther = existing.filter((t) => t.mapId !== mapId);

        if (onTarget) {
          // Already on this map — keep it, remove from other maps.
          occupied.add(packHex({ q: onTarget.q, r: onTarget.r }));
          for (const t of onOther) {
            tokens.delete(t.id);
            removedTokenIds.push(t.id);
            touchedMaps.add(t.mapId);
          }
        } else if (onOther.length > 0) {
          // Has a token on another map — relocate the first one (preserving size/hp/etc), delete extras.
          const primary = onOther[0];
          const hex = firstFreeHex(spawn, occupied, map.grid);
          occupied.add(packHex(hex));
          tokens.relocate(primary.id, mapId, hex.q, hex.r);
          touchedMaps.add(primary.mapId);
          touchedMaps.add(mapId);
          upsertedTokens.push(tokens.byId(primary.id)!);
          // Remove duplicates on other maps.
          for (let i = 1; i < onOther.length; i++) {
            tokens.delete(onOther[i].id);
            removedTokenIds.push(onOther[i].id);
            touchedMaps.add(onOther[i].mapId);
          }
        } else {
          // No token anywhere — create a new one.
          const hex = firstFreeHex(spawn, occupied, map.grid);
          occupied.add(packHex(hex));
          const artAssetId = typeof char.sheet.tokenImageAssetId === 'string' ? char.sheet.tokenImageAssetId : null;
          const hp = systemFor(char.system).hp(char.sheet);
          const created = tokens.create({
            mapId, characterId: char.id, name: char.name, artAssetId,
            q: hex.q, r: hex.r, layer: char.ownerUserId ? 'token' : 'gm', size: 1, shape: 'circle',
            color: TOKEN_COLORS[Math.abs(hashStr(char.id)) % TOKEN_COLORS.length],
            vision: null, bar: hp.maxHp > 0 ? hp : null, light: null,
          });
          touchedMaps.add(mapId);
          upsertedTokens.push(created);
        }
      }
    })();

    // Broadcast changes.
    for (const id of removedTokenIds) io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId: id });
    for (const t of upsertedTokens) if (t) io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: t });

    // Pull player-owned characters' owners onto this map.
    for (const char of charList) {
      if (char.ownerUserId && campaigns.viewMapIdFor(d.campaignId, char.ownerUserId) !== mapId) {
        campaigns.setMemberMap(d.campaignId, char.ownerUserId, mapId);
        sendMapStateToUser(io, d.campaignId, char.ownerUserId);
        broadcastPresence(io, d.campaignId);
      }
    }

    for (const m of touchedMaps) syncMapVision(io, d.campaignId, m);
    broadcastWorldFolders(io, d.campaignId);
    broadcastDirectory(io, d.campaignId);
  }, 'DROP_FOLDER_ON_MAP'));

  // ---------- drop folder on character (carried loot) ----------

  socket.on(C2S.DROP_FOLDER_ON_CHARACTER, safe(socket, ({ folderId, characterId }: DropFolderOnCharacterPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const f = worldFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    const char = characters.byId(characterId);
    if (!char || char.campaignId !== d.campaignId) return;

    worldFolders.update(folderId, { parentId: characterId, displayKind: 'chest' });
    broadcastWorldFolders(io, d.campaignId);
    broadcastDirectory(io, d.campaignId);
  }, 'DROP_FOLDER_ON_CHARACTER'));

  // ---------- drop shop on map ----------

  socket.on(C2S.DROP_SHOP_ON_MAP, safe(socket, ({ shopId, mapId, q, r }: DropShopOnMapPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const shop = shops.byId(shopId);
    if (!shop || shop.campaignId !== d.campaignId) return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;

    const existing = mapObjects.forMap(mapId);
    const alreadyLinked = existing.find((o) => o.shopId === shopId);
    if (!alreadyLinked) {
      const spawn = map.spawn ?? centerHex(map.grid);
      const occupied = new Set(existing.map((o) => packHex({ q: o.q, r: o.r })));
      const hex = (q != null && r != null) ? { q, r } : firstFreeHex(spawn, occupied, map.grid);
      const obj = mapObjects.create(mapId, 'shop', shop.name, shop.description ?? '', hex.q, hex.r, { shopId });
      io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
    }
  }, 'DROP_SHOP_ON_MAP'));

  // ---------- custom compendium items ----------

  socket.on(C2S.CREATE_CUSTOM_ITEM, safe(socket, ({ entryJson }: CreateCustomItemPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM can create custom items.'); return; }
    customItems.create(d.campaignId, entryJson);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CUSTOM_ITEMS, { items: customItems.forCampaign(d.campaignId) });
  }, 'CREATE_CUSTOM_ITEM'));

  socket.on(C2S.UPDATE_CUSTOM_ITEM, safe(socket, ({ itemId, entryJson }: UpdateCustomItemPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const item = customItems.byId(itemId);
    if (!item || item.campaignId !== d.campaignId) return;
    customItems.update(itemId, entryJson);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CUSTOM_ITEMS, { items: customItems.forCampaign(d.campaignId) });
  }, 'UPDATE_CUSTOM_ITEM'));

  socket.on(C2S.DELETE_CUSTOM_ITEM, safe(socket, ({ itemId }: DeleteCustomItemPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const item = customItems.byId(itemId);
    if (!item || item.campaignId !== d.campaignId) return;
    customItems.delete(itemId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.CUSTOM_ITEMS, { items: customItems.forCampaign(d.campaignId) });
  }, 'DELETE_CUSTOM_ITEM'));
}
