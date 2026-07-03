import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type BuyItemPayload, type CreateLocationPayload, type CreateShopPayload,
  type DeleteLocationPayload, type DeleteShopPayload, type ShopItem,
  type UpdateLocationPayload, type UpdateShopPayload,
} from 'shared';
import { campaigns, characters, chat, locations, shops } from '../../db/repos.js';
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

export function broadcastShops(io: Server, campaignId: string): void {
  const all = shops.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const isDm = sdata(socket).role === 'dm';
    socket.emit(S2C.SHOPS, { shops: isDm ? all : all.filter((s) => s.playersCanBuy) });
  }
}

export function broadcastLocations(io: Server, campaignId: string): void {
  const all = locations.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const isDm = sdata(socket).role === 'dm';
    socket.emit(S2C.LOCATIONS, { locations: isDm ? all : all.filter((l) => l.visibleToPlayers) });
  }
}

export function registerWorldHandlers(io: Server, socket: Socket): void {
  // ----- shops -----

  socket.on(C2S.CREATE_SHOP, safe(socket, ({ name }: CreateShopPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM creates shops.'); return; }
    const campaign = campaignSystem(d.campaignId);
    shops.create(d.campaignId, name?.trim() || 'New shop', campaign === 'swn' ? 'cr' : 'gp');
    broadcastShops(io, d.campaignId);
  }));

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
    })).filter((it) => it.name);
    shops.update(shopId, { ...fields, items });
    broadcastShops(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_SHOP, safe(socket, ({ shopId }: DeleteShopPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const s = shops.byId(shopId);
    if (!s || s.campaignId !== d.campaignId) return;
    shops.delete(shopId);
    broadcastShops(io, d.campaignId);
  }));

  socket.on(C2S.BUY_ITEM, safe(socket, ({ shopId, itemIndex, characterId }: BuyItemPayload) => {
    const d = requireCampaign(socket);
    const shop = shops.byId(shopId);
    if (!shop || shop.campaignId !== d.campaignId) throw new Error('Unknown shop.');
    if (d.role !== 'dm' && !shop.playersCanBuy) { emitError(socket, 'This shop is not open to players.'); return; }
    const item = shop.items[itemIndex];
    if (!item) throw new Error('Unknown item.');
    if (item.qty === 0) { emitError(socket, `${item.name} is sold out.`); return; }

    const character = characters.byId(characterId);
    if (!character || character.campaignId !== d.campaignId) throw new Error('Unknown character.');
    if (d.role !== 'dm' && character.ownerUserId !== d.userId) { emitError(socket, 'You can only buy for your own character.'); return; }

    const currencyField = character.system === 'swn' ? 'credits' : 'gp';
    const purse = Number((character.sheet as Record<string, unknown>)[currencyField]) || 0;
    if (purse < item.price) { emitError(socket, `Not enough ${currencyField}: needs ${item.price}, has ${purse}.`); return; }

    // Deduct currency + add to inventory.
    const inv = Array.isArray(character.sheet.inventory) ? [...(character.sheet.inventory as Array<Record<string, unknown>>)] : [];
    inv.push(character.system === 'swn'
      ? { name: item.name, qty: 1, enc: 1, notes: 'purchased' }
      : { name: item.name, qty: 1, weight: 0, notes: 'purchased' });
    characters.update(characterId, undefined, { ...character.sheet, [currencyField]: purse - item.price, inventory: inv });
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
  }));

  // ----- locations -----

  socket.on(C2S.CREATE_LOCATION, safe(socket, ({ name, parentId }: CreateLocationPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM manages locations.'); return; }
    locations.create(d.campaignId, name?.trim() || 'New location', parentId ?? null);
    broadcastLocations(io, d.campaignId);
  }));

  socket.on(C2S.UPDATE_LOCATION, safe(socket, ({ locationId, ...fields }: UpdateLocationPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const l = locations.byId(locationId);
    if (!l || l.campaignId !== d.campaignId) return;
    locations.update(locationId, fields);
    broadcastLocations(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_LOCATION, safe(socket, ({ locationId }: DeleteLocationPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') return;
    const l = locations.byId(locationId);
    if (!l || l.campaignId !== d.campaignId) return;
    locations.delete(locationId);
    broadcastLocations(io, d.campaignId);
  }));
}
