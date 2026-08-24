import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, SPEAKING_RANGE_HEXES, acquirePatch, firstFreeHex, hexDistance, normalizeCurrency, packHex, shopBelongsTo, systemFor,
  type BuyItemPayload, type CreateCustomItemPayload, type CreateLocationPayload, type CreateShopPayload,
  type CreateWorldFolderPayload, type DeleteCustomItemPayload, type DeleteLocationPayload, type DeleteShopPayload,
  type DeleteWorldFolderPayload, type DropFolderOnCharacterPayload, type DropFolderOnMapPayload, type DropShopOnMapPayload, type GameSystem,
  type PresentShopPayload, type ShopAtTokenPayload,
  type SheetData, type Shop, type ShopItem, type UpdateCustomItemPayload, type UpdateLocationPayload, type UpdateShopPayload,
  type UpdateWorldFolderPayload, type WorldReorderPayload,
} from 'shared';
import { campaigns, characters, chat, customItems, handouts, locations, mapObjects, maps, rollableTables, shops, tokens, worldFolders, worldSort, worldVis } from '../../db/repos.js';
import { db } from '../../db/db.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom, viewerFor } from '../hub.js';
import { broadcastDirectory, setFolderBroadcaster } from '../directory.js';
import { mapObjectsVisibleTo, socketsSeeingHex, syncMapVision } from '../visionService.js';
import { broadcastPresence, sendMapStateToUser } from './session.js';
import { centerHex, hashStr, tokenLookFor, TOKEN_COLORS } from './tokens.js';

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

/**
 * The boxes on the ground that stand for a world folder.
 *
 * A chest is one thing wearing two records: a folder in the world tree, which
 * is what holds its contents, and a map object, which is where it stands and
 * what it is locked with. Anything that happens to one of them — a rename, a
 * deletion — has to happen to the other, or the tree and the map start
 * describing different chests.
 */
function linkedChests(campaignId: string, folderId: string) {
  return maps.forCampaign(campaignId)
    .flatMap((m) => mapObjects.forMap(m.id))
    .filter((o) => o.kind === 'chest' && o.worldFolderId === folderId);
}

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
    const v = viewerFor(sdata(socket));
    socket.emit(S2C.SHOPS, { shops: shopsForUser(campaignId, v.userId, v.isDm) });
  }
}

export function broadcastShopPresentation(io: Server, campaignId: string): void {
  for (const socket of campaignSockets(io, campaignId)) {
    const v = viewerFor(sdata(socket));
    socket.emit(S2C.SHOP_PRESENTATION, { shopId: presentedShopIdForUser(campaignId, v.userId, v.isDm) });
  }
}

/** Sent on join so a (re)connecting player re-opens an active storefront. */
export function sendShopPresentationTo(socket: Socket): void {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) return;
  const v = viewerFor(d);
  socket.emit(S2C.SHOP_PRESENTATION, { shopId: presentedShopIdForUser(d.campaignId, v.userId, v.isDm) });
}

export function broadcastLocations(io: Server, campaignId: string): void {
  const all = locations.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const { isDm } = viewerFor(sdata(socket));
    socket.emit(S2C.LOCATIONS, { locations: isDm ? all : all.filter((l) => l.visibleToPlayers) });
  }
}

/**
 * Folders a player may know about: only those that (transitively) hold
 * something they can already see. A folder is DM scaffolding until then, and
 * a chest-folder's `items` are its literal contents — sending the whole set
 * to everyone let a player enumerate unrevealed treasure from the world tab.
 * The DM always gets the full set.
 */
export function foldersVisibleTo(campaignId: string, userId: string): ReturnType<typeof worldFolders.forCampaign> {
  const all = worldFolders.forCampaign(campaignId);
  const byId = new Map(all.map((f) => [f.id, f]));
  // Seed with the parent of every non-folder thing this player can see. Each
  // collection is filtered exactly as its own broadcast filters it.
  const disc = worldVis.discovered(campaignId, userId);
  const ov = worldVis.overrides(campaignId);
  // Same rule the world directory uses: discovered unless force-hidden,
  // hidden unless force-revealed.
  const shows = (kind: string, key: string, base: boolean): boolean => {
    const o = ov.get(`${kind}:${key}`);
    return o ? o === 'reveal' : base;
  };
  const seeds: Array<string | null | undefined> = [];
  for (const c of characters.forCampaign(campaignId)) {
    if (shows('character', c.id, c.ownerUserId === userId || disc.has(`character:${c.id}`))) seeds.push(c.parentId);
  }
  for (const s of shopsForUser(campaignId, userId, false)) seeds.push(s.parentId);
  for (const t of rollableTables.forCampaign(campaignId)) if (t.playersCanRoll) seeds.push(t.parentId);
  for (const l of locations.forCampaign(campaignId)) if (l.visibleToPlayers) seeds.push(l.parentId);
  for (const h of handouts.forCampaign(campaignId)) {
    if (h.sharedAll || h.sharedWith.includes(userId)) seeds.push(h.parentId);
  }
  for (const m of maps.forCampaign(campaignId)) {
    if (shows('map', m.id, disc.has(`map:${m.id}`))) seeds.push(m.parentId);
    // A chest-folder standing on ground the player has seen reveals itself.
    for (const o of mapObjectsVisibleTo(userId, false, m.id, mapObjects.forMap(m.id))) {
      if (o.worldFolderId) seeds.push(o.worldFolderId);
    }
  }
  const keep = new Set<string>();
  for (const seed of seeds) {
    let cur = seed ?? null;
    while (cur && byId.has(cur) && !keep.has(cur)) {
      keep.add(cur);
      cur = byId.get(cur)!.parentId ?? null;
    }
  }
  return all.filter((f) => keep.has(f.id));
}

export function broadcastWorldFolders(io: Server, campaignId: string): void {
  const all = worldFolders.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const v = viewerFor(sdata(socket));
    socket.emit(S2C.WORLD_FOLDERS, {
      folders: v.isDm ? all : foldersVisibleTo(campaignId, v.userId),
    });
  }
}

// A fresh discovery refreshes the directory; folders must follow it, since
// meeting a character can reveal the folder they are filed under.
setFolderBroadcaster(broadcastWorldFolders);

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
    // The marker on the map is not the shop -- it POINTS at one, across a
    // plain text column with no foreign key to drag it along. Left standing it
    // is a storefront that opens onto nothing.
    for (const o of mapObjects.forCampaign(d.campaignId)) {
      if (o.shopId !== shopId) continue;
      mapObjects.delete(o.id);
      io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId: o.id });
    }
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

    // Money out and goods in, in a single write — never a state where the
    // purse is lighter but the item never arrived. Shared with the chest-take
    // path (see acquirePatch), so bought and looted items land identically.
    const sheet = character.sheet as SheetData;
    const gained = acquirePatch(sheet, system, {
      name: item.name, contentId: item.contentId, notes: item.notes || 'purchased',
      effect: item.effect, amount: item.amount, range: item.range,
    });
    characters.update(characterId, undefined, { ...sheet, [currencyField]: purse - item.price, ...gained });
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
    // The chest on the ground wears this folder's name — they are one thing to
    // everyone looking at them, so a rename in either place is a rename in both.
    if (typeof fields.name === 'string' && fields.name.trim()) {
      for (const obj of linkedChests(d.campaignId, folderId)) {
        mapObjects.update(obj.id, { name: fields.name.trim() });
        const updated = mapObjects.byId(obj.id)!;
        for (const s2 of socketsSeeingHex(io, d.campaignId, updated.mapId, updated.q, updated.r)) {
          s2.emit(S2C.MAP_OBJECT_UPSERTED, { object: updated });
        }
      }
    }
    broadcastWorldFolders(io, d.campaignId);
  }, 'UPDATE_WORLD_FOLDER'));

  socket.on(C2S.DELETE_WORLD_FOLDER, safe(socket, ({ folderId }: DeleteWorldFolderPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const f = worldFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    // Deleting the folder takes its box on the ground with it. Left behind, a
    // linked chest is a lid over nothing: opening it looks for a folder that
    // is not there any more, and no row in the tree admits it exists.
    for (const obj of linkedChests(d.campaignId, folderId)) {
      mapObjects.delete(obj.id);
      io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId: obj.id });
    }
    worldFolders.delete(folderId);
    broadcastWorldFolders(io, d.campaignId);
  }, 'DELETE_WORLD_FOLDER'));

  // DM re-ordered one parent's children by hand: rank the given keys 0..n−1.
  // Ordering isn't secret — everyone gets it so player trees keep the same
  // relative order for whatever subset they can see.
  socket.on(C2S.WORLD_REORDER, safe(socket, ({ keys }: WorldReorderPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const clean = (Array.isArray(keys) ? keys : [])
      .filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 200)
      .slice(0, 1000);
    if (clean.length === 0) return;
    worldSort.set(d.campaignId, clean);
    io.to(campaignRoom(d.campaignId)).emit(S2C.WORLD_SORT, { orders: worldSort.forCampaign(d.campaignId) });
  }, 'WORLD_REORDER'));

  socket.on(C2S.DROP_FOLDER_ON_MAP, safe(socket, ({ folderId, mapId, q, r }: DropFolderOnMapPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const f = worldFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;

    // 1. Reparent the folder under the map. Only LOOT becomes a chest on the
    // ground — a folder that is already a chest, or one carrying items. A
    // folder of characters is a marching order, not treasure, so deploying it
    // must not mint a chest object nobody asked for.
    const isLoot = f.displayKind === 'chest' || f.items.length > 0;
    worldFolders.update(folderId, { parentId: mapId, ...(isLoot ? { displayKind: 'chest' as const } : {}) });

    // 1b. The box on the ground. A chest already has one — dropping it on a
    // second map CARRIES it there rather than minting a copy, or the first map
    // would be left with a lid over a folder that has gone somewhere else.
    const existingObjs = mapObjects.forMap(mapId);
    const linked = linkedChests(d.campaignId, folderId);
    if (isLoot) {
      const spawn = map.spawn ?? centerHex(map.grid);
      const occupied = new Set(existingObjs.map((o) => packHex({ q: o.q, r: o.r })));
      const hex = (q != null && r != null) ? { q, r } : firstFreeHex(spawn, occupied, map.grid);
      const already = linked.find((o) => o.mapId === mapId);
      if (already) {
        // Already on this map: just put it where it was dropped.
        if (q != null && r != null) {
          mapObjects.update(already.id, { q, r });
          const moved = mapObjects.byId(already.id)!;
          for (const s of socketsSeeingHex(io, d.campaignId, moved.mapId, moved.q, moved.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: moved });
        }
      } else if (linked.length > 0) {
        const carried = linked[0];
        mapObjects.update(carried.id, { mapId, q: hex.q, r: hex.r });
        io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId: carried.id });
        const moved = mapObjects.byId(carried.id)!;
        for (const s of socketsSeeingHex(io, d.campaignId, moved.mapId, moved.q, moved.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: moved });
        // Any further copies from before this rule existed are tidied away.
        for (const stray of linked.slice(1)) {
          mapObjects.delete(stray.id);
          io.to(campaignRoom(d.campaignId)).emit(S2C.MAP_OBJECT_REMOVED, { objectId: stray.id });
        }
      } else {
        const obj = mapObjects.create(mapId, 'chest', f.name, '', hex.q, hex.r, { worldFolderId: folderId });
        for (const s of socketsSeeingHex(io, d.campaignId, obj.mapId, obj.q, obj.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
      }
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
            q: hex.q, r: hex.r, layer: char.ownerUserId ? 'token' : 'gm', ...tokenLookFor(char),
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
      for (const s of socketsSeeingHex(io, d.campaignId, obj.mapId, obj.q, obj.r)) s.emit(S2C.MAP_OBJECT_UPSERTED, { object: obj });
    }
  }, 'DROP_SHOP_ON_MAP'));

  /**
   * A player clicked a token and wants to trade with whoever it is.
   *
   * Answered here rather than in the browser because the client genuinely
   * cannot know: a carried shop is filtered out of what players are sent (it
   * is pinned to whatever hex it was linked at, which may be somewhere they
   * have never been), so the token is the only handle they have on it.
   *
   * Silent when there is nothing to sell. Clicking an NPC is an ordinary
   * thing to do and "no shop here" on every one of them would be noise; the
   * only refusal worth voicing is the one a player can act on, which is
   * standing too far away.
   */
  socket.on(C2S.SHOP_AT_TOKEN, safe(socket, ({ tokenId }: ShopAtTokenPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token || !token.characterId) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) return;

    // Read off the SHOP rather than off a marker: a walking merchant is linked
    // to their character whether or not anybody ever dropped a storefront on
    // the map, and it is the link the world tree already shows.
    //
    // shopsForUser, not shops.forCampaign, so the existing rule about which
    // shops a player may walk into at all carries over untouched: open to
    // players, or being shown to them by the DM. A shop they cannot see is
    // answered with the same silence as no shop, since the difference is not
    // theirs to learn.
    const shop = shopsForUser(d.campaignId, d.userId, d.role === 'dm')
      .find((sh) => shopBelongsTo(sh, token.characterId));
    if (!shop) return;

    if (d.role !== 'dm') {
      const mine = characters.forCampaign(d.campaignId)
        .filter((c) => c.ownerUserId === d.userId).map((c) => c.id);
      const near = tokens.forMap(token.mapId).some((t) => t.characterId
        && mine.includes(t.characterId)
        && hexDistance({ q: t.q, r: t.r }, { q: token.q, r: token.r }) <= SPEAKING_RANGE_HEXES);
      if (!near) {
        emitError(socket, `You are too far away to talk to ${token.name}.`);
        return;
      }
    }
    socket.emit(S2C.OPEN_SHOP, { shopId: shop.id });
  }, 'SHOP_AT_TOKEN'));

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
