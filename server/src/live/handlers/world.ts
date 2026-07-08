import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, applyEntry, contentById, normalizeCurrency,
  type BuyItemPayload, type CreateLocationPayload, type CreateShopPayload,
  type CreateWorldFolderPayload, type DeleteLocationPayload, type DeleteShopPayload,
  type DeleteWorldFolderPayload, type GameSystem, type PresentShopPayload,
  type SheetData, type Shop, type ShopItem, type UpdateLocationPayload, type UpdateShopPayload,
  type UpdateWorldFolderPayload,
} from 'shared';
import { campaigns, characters, chat, locations, shops, worldFolders } from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata, userRoom } from '../hub.js';
import { broadcastDirectory } from '../directory.js';

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
    shops.create(d.campaignId, name?.trim() || 'New shop', campaign === 'swn' ? 'credits' : 'gp');
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

  socket.on(C2S.CREATE_WORLD_FOLDER, safe(socket, ({ name, parentId }: CreateWorldFolderPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM manages folders.'); return; }
    worldFolders.create(d.campaignId, name?.trim() || 'New folder', parentId ?? null);
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
}
