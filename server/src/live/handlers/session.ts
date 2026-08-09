import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type AssignPlayerMapPayload, type CampaignStatePayload, type DmViewAsPayload,
  type BootPlayerPayload, type JoinCampaignPayload, type SendCreatorPayload, type SetDiceColorPayload, type SetDiceTextColorPayload, type SetDiceRoleColorPayload,
  type SetPlayerColorPayload, type SetUsernamePayload, type SwitchActiveMapPayload, type ViewMapPayload,
} from 'shared';
import { CHAT_TAIL } from '../../config.js';
import { validUsername } from '../../auth.js';
import {
  assetFolders, assets, audioTracks, campaigns, characters, chat, customItems, drawings,
  handouts, initiative, locations, macros, mapObjects, maps, rollableTables, shops, soundboard, users, worldFolders, worldSort,
} from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, onlineUsers, safe, sdata, userRoom } from '../hub.js';
import { buildMapState, dropVisionCache, mapObjectsVisibleTo } from '../visionService.js';
import { emitCustomNpcs } from './characters.js';
import { initiativeViewFor } from './combat.js';
import { buildDirectory } from '../directory.js';
import { getAudioState } from './library.js';
import { foldersVisibleTo, shopsForUser, sendShopPresentationTo } from './world.js';

function handoutsVisibleTo(campaignId: string, userId: string, isDm: boolean) {
  const all = handouts.forCampaign(campaignId);
  if (isDm) return all;
  return all
    .filter((h) => h.sharedAll || h.sharedWith.includes(userId))
    .map((h) => ({ ...h, sharedWith: [] })); // players don't see the share list
}

export function buildCampaignState(campaignId: string, userId: string, username: string, isDm: boolean): CampaignStatePayload {
  const campaign = campaigns.byId(campaignId)!;
  return {
    campaign: isDm ? campaign : { ...campaign, inviteCode: '' },
    members: campaigns.members(campaignId).map((m) => ({
      ...m,
      online: false,
      mapId: campaigns.viewMapIdFor(campaignId, m.userId),
    })),
    // Players only receive character sheets they own; the DM sees all
    // (NPC and other-player sheets stay private).
    characters: isDm
      ? characters.forCampaign(campaignId)
      : characters.forCampaign(campaignId).filter((c) => c.ownerUserId === userId),
    maps: isDm ? maps.forCampaign(campaignId) : [],
    handouts: handoutsVisibleTo(campaignId, userId, isDm),
    macros: macros.forUser(userId, campaignId),
    initiative: initiativeViewFor(initiative.get(campaignId), isDm, campaignId),
    chatTail: chat.tailFor(campaignId, userId, username, isDm, CHAT_TAIL),
    // Loot/chests across every map: the DM gets all, a player only what
    // stands on ground they have actually seen (otherwise the world tab
    // enumerates every unrevealed chest in the campaign).
    mapObjects: isDm
      ? mapObjects.forCampaign(campaignId)
      : maps.forCampaign(campaignId).flatMap((m) => mapObjectsVisibleTo(userId, false, m.id, mapObjects.forMap(m.id))),
  };
}

/**
 * Send the full map state for the viewer's current map to one socket.
 * "Current map" = the effective viewer's personal override, else the party
 * map. When the DM previews a player (view-as), the target's map is used.
 */
export function sendMapState(socket: Socket): void {
  const d = sdata(socket);
  if (!d.campaignId) return;
  const effectiveUser = d.viewingAs ?? d.userId;
  const mapId = campaigns.viewMapIdFor(d.campaignId, effectiveUser);
  if (!mapId) return;
  const map = maps.byId(mapId);
  if (!map) return;
  const payload = buildMapState(
    map,
    { userId: d.userId, isDm: d.role === 'dm', viewingAs: d.viewingAs },
    drawings.forMap(map.id),
    mapObjects.forMap(map.id),
  );
  socket.emit(S2C.MAP_STATE, payload);
}

/** Re-send map state to every connected socket of one user. */
export function sendMapStateToUser(io: Server, campaignId: string, userId: string): void {
  for (const s of io.sockets.sockets.values()) {
    const sd = sdata(s);
    if (sd.campaignId !== campaignId) continue;
    if (sd.userId === userId || sd.viewingAs === userId) sendMapState(s);
  }
}

export function broadcastPresence(io: Server, campaignId: string): void {
  const online = onlineUsers(io, campaignId);
  for (const m of campaigns.members(campaignId)) {
    io.to(campaignRoom(campaignId)).emit(S2C.MEMBER_PRESENCE, {
      userId: m.userId,
      username: m.username,
      online: online.has(m.userId),
      mapId: campaigns.viewMapIdFor(campaignId, m.userId),
      diceColor: m.diceColor,
      diceTextColor: m.diceTextColor,
      diceTraitColor: m.diceTraitColor,
      diceWildColor: m.diceWildColor,
      diceRaiseColor: m.diceRaiseColor,
      playerColor: m.playerColor,
    });
  }
}

export function registerSessionHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.JOIN_CAMPAIGN, safe(socket, ({ campaignId }: JoinCampaignPayload) => {
    const d = sdata(socket);
    const role = campaigns.memberRole(campaignId, d.userId);
    if (!role) {
      emitError(socket, 'You are not a member of this campaign.');
      return;
    }
    // Leave any previous campaign rooms.
    if (d.campaignId) {
      socket.leave(campaignRoom(d.campaignId));
      socket.leave(dmRoom(d.campaignId));
    }
    d.campaignId = campaignId;
    d.role = role;
    d.viewingAs = undefined;
    socket.join(campaignRoom(campaignId));
    if (role === 'dm') socket.join(dmRoom(campaignId));

    socket.emit(S2C.YOU_ARE, { userId: d.userId, username: d.username, role });
    socket.emit(S2C.CAMPAIGN_STATE, buildCampaignState(campaignId, d.userId, d.username, role === 'dm'));
    socket.emit(S2C.DIRECTORY, buildDirectory(campaignId, role === 'dm'));
    {
      const all = rollableTables.forCampaign(campaignId);
      socket.emit(S2C.TABLES, { tables: role === 'dm' ? all : all.filter((t) => t.playersCanRoll) });
    }
    socket.emit(S2C.AUDIO_TRACKS, { tracks: audioTracks.forCampaign(campaignId) });
    socket.emit(S2C.AUDIO_STATE, { state: getAudioState(campaignId) });
    {
      socket.emit(S2C.SHOPS, { shops: shopsForUser(campaignId, d.userId, role === 'dm') });
      sendShopPresentationTo(socket);
      const allLoc = locations.forCampaign(campaignId);
      socket.emit(S2C.LOCATIONS, { locations: role === 'dm' ? allLoc : allLoc.filter((l) => l.visibleToPlayers) });
      socket.emit(S2C.WORLD_FOLDERS, { folders: role === 'dm' ? worldFolders.forCampaign(campaignId) : foldersVisibleTo(campaignId, d.userId) });
      socket.emit(S2C.WORLD_SORT, { orders: worldSort.forCampaign(campaignId) });
      socket.emit(S2C.CUSTOM_ITEMS, { items: customItems.forCampaign(campaignId) });
    }
    if (role === 'dm') {
      socket.emit(S2C.ASSETS, { folders: assetFolders.forCampaign(campaignId), assets: assets.forCampaign(campaignId) });
      socket.emit(S2C.SOUNDBOARD, { slots: soundboard.forCampaign(campaignId) });
      const camp = campaigns.byId(campaignId);
      if (camp) emitCustomNpcs(socket, d.userId, camp.system);
    }
    sendMapState(socket);
    broadcastPresence(io, campaignId);
  }, 'JOIN_CAMPAIGN'));

  socket.on(C2S.REQUEST_DIRECTORY, safe(socket, () => {
    const d = sdata(socket);
    if (!d.campaignId || !d.role) return;
    socket.emit(S2C.DIRECTORY, buildDirectory(d.campaignId, d.role === 'dm'));
  }, 'REQUEST_DIRECTORY'));

  // Set your own 3D-dice color (a global user preference, shown to everyone).
  socket.on(C2S.SET_DICE_COLOR, safe(socket, ({ color }: SetDiceColorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const clean = color === null || /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : null;
    users.setDiceColor(d.userId, clean);
    broadcastPresence(io, d.campaignId);
  }, 'SET_DICE_COLOR'));

  // Same, for the color of the pips/numbers painted on your dice.
  socket.on(C2S.SET_DICE_TEXT_COLOR, safe(socket, ({ color }: SetDiceTextColorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const clean = color === null || /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : null;
    users.setDiceTextColor(d.userId, clean);
    broadcastPresence(io, d.campaignId);
  }, 'SET_DICE_TEXT_COLOR'));

  // SWADE colours dice by their role in the roll (trait / Wild Die / raise
  // bonus) rather than by die size, so each role gets its own slot.
  socket.on(C2S.SET_DICE_ROLE_COLOR, safe(socket, ({ role, color }: SetDiceRoleColorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    if (role !== 'trait' && role !== 'wild' && role !== 'raise') return;
    const clean = color === null || /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : null;
    users.setDiceRoleColor(d.userId, role, clean);
    broadcastPresence(io, d.campaignId);
  }, 'SET_DICE_ROLE_COLOR'));

  // Your presence-dot color, and the color your player-controlled token
  // names get bolded in in chat (client/src/panels/ChatPanel.tsx).
  socket.on(C2S.SET_PLAYER_COLOR, safe(socket, ({ color }: SetPlayerColorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const clean = color === null || /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : null;
    users.setPlayerColor(d.userId, clean);
    broadcastPresence(io, d.campaignId);
  }, 'SET_PLAYER_COLOR'));

  // Rename yourself. Username is the login key (UNIQUE COLLATE NOCASE) but
  // otherwise purely cosmetic -- update the live socket's cached name too so
  // this session's own chat/actions use it immediately, no reconnect needed.
  socket.on(C2S.SET_USERNAME, safe(socket, ({ username }: SetUsernamePayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const trimmed = String(username ?? '').trim();
    if (!validUsername(trimmed)) {
      emitError(socket, 'Name must be 2-24 characters: letters, numbers, underscore, or hyphen.');
      return;
    }
    if (trimmed.toLowerCase() !== d.username.toLowerCase()) {
      const existing = users.byUsername(trimmed);
      if (existing && existing.id !== d.userId) {
        emitError(socket, 'That name is already taken.');
        return;
      }
    }
    users.rename(d.userId, trimmed);
    d.username = trimmed;
    io.to(userRoom(d.userId)).emit(S2C.YOU_ARE, { userId: d.userId, username: trimmed, role: d.role ?? 'player' });
    broadcastPresence(io, d.campaignId);
  }, 'SET_USERNAME'));

  socket.on(C2S.LEAVE_CAMPAIGN, safe(socket, () => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const campaignId = d.campaignId;
    socket.leave(campaignRoom(campaignId));
    socket.leave(dmRoom(campaignId));
    d.campaignId = undefined;
    d.role = undefined;
    d.viewingAs = undefined;
    broadcastPresence(io, campaignId);
  }, 'LEAVE_CAMPAIGN'));

  // DM removes a player: their characters revert to DM control, their live
  // sockets are kicked out of the campaign rooms, and their membership row is
  // deleted — rejoining takes the invite code again.
  socket.on(C2S.BOOT_PLAYER, safe(socket, ({ userId }: BootPlayerPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') { emitError(socket, 'Only the DM can remove players.'); return; }
    const campaignId = d.campaignId;
    if (userId === d.userId) return;
    if (campaigns.memberRole(campaignId, userId) !== 'player') { emitError(socket, 'They are not a player in this campaign.'); return; }
    const member = campaigns.members(campaignId).find((m) => m.userId === userId);
    for (const c of characters.forCampaign(campaignId)) {
      if (c.ownerUserId !== userId) continue;
      characters.setOwner(c.id, null);
      const updated = characters.byId(c.id)!;
      io.to(dmRoom(campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updated });
    }
    campaigns.removeMember(campaignId, userId);
    for (const s of campaignSockets(io, campaignId)) {
      const sd = sdata(s);
      if (sd.userId !== userId) continue;
      s.leave(campaignRoom(campaignId));
      s.leave(dmRoom(campaignId));
      sd.campaignId = undefined;
      sd.role = undefined;
      sd.viewingAs = undefined;
    }
    io.to(userRoom(userId)).emit(S2C.BOOTED, { campaignId });
    const msg = chat.add(campaignId, {
      userId: null, fromName: 'System', kind: 'system',
      text: `${member?.username ?? 'A player'} was removed from the campaign — their characters are back under DM control.`,
      roll: null, recipients: null,
    });
    io.to(campaignRoom(campaignId)).emit(S2C.CHAT, { msg });
    broadcastPresence(io, campaignId);
  }, 'BOOT_PLAYER'));

  // DM pops the character-creator wizard open on one player's screen.
  socket.on(C2S.SEND_CREATOR, safe(socket, ({ userId }: SendCreatorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') return;
    if (campaigns.memberRole(d.campaignId, userId) !== 'player') return;
    io.to(userRoom(userId)).emit(S2C.OPEN_CREATOR, {});
  }, 'SEND_CREATOR'));

  socket.on(C2S.SWITCH_ACTIVE_MAP, safe(socket, ({ mapId }: SwitchActiveMapPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') {
      emitError(socket, 'Only the DM can switch maps.');
      return;
    }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) {
      emitError(socket, 'Unknown map.');
      return;
    }
    campaigns.setActiveMap(d.campaignId, mapId);
    io.to(campaignRoom(d.campaignId)).emit(S2C.ACTIVE_MAP, { mapId });
    // Everyone follows their own resolved map (party movers get the new one,
    // members with a personal override stay put).
    for (const s of io.sockets.sockets.values()) {
      if (sdata(s).campaignId === d.campaignId) sendMapState(s);
    }
    broadcastPresence(io, d.campaignId);
  }, 'SWITCH_ACTIVE_MAP'));

  socket.on(C2S.VIEW_MAP, safe(socket, ({ mapId }: ViewMapPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') {
      emitError(socket, 'Only the DM can view other maps.');
      return;
    }
    if (mapId !== null) {
      const map = maps.byId(mapId);
      if (!map || map.campaignId !== d.campaignId) {
        emitError(socket, 'Unknown map.');
        return;
      }
    }
    campaigns.setMemberMap(d.campaignId, d.userId, mapId);
    d.viewingAs = undefined; // working on a map exits any view-as preview
    sendMapStateToUser(io, d.campaignId, d.userId);
    broadcastPresence(io, d.campaignId);
  }, 'VIEW_MAP'));

  socket.on(C2S.ASSIGN_PLAYER_MAP, safe(socket, ({ userId, mapId }: AssignPlayerMapPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') {
      emitError(socket, 'Only the DM can move players between maps.');
      return;
    }
    if (!campaigns.memberRole(d.campaignId, userId)) {
      emitError(socket, 'That user is not in this campaign.');
      return;
    }
    if (mapId !== null) {
      const map = maps.byId(mapId);
      if (!map || map.campaignId !== d.campaignId) {
        emitError(socket, 'Unknown map.');
        return;
      }
    }
    campaigns.setMemberMap(d.campaignId, userId, mapId);
    sendMapStateToUser(io, d.campaignId, userId);
    broadcastPresence(io, d.campaignId);
  }, 'ASSIGN_PLAYER_MAP'));

  socket.on(C2S.DM_VIEW_AS, safe(socket, ({ userId }: DmViewAsPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') {
      emitError(socket, 'Only the DM can preview player vision.');
      return;
    }
    d.viewingAs = userId ?? undefined;
    sendMapState(socket);
  }, 'DM_VIEW_AS'));

  socket.on('disconnect', () => {
    const d = sdata(socket);
    dropVisionCache(d.userId);
    if (d.campaignId) broadcastPresence(io, d.campaignId);
  });
}
