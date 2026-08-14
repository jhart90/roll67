import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, isAceStyle,
  type AssignPlayerMapPayload, type CampaignStatePayload, type DmViewAsPayload,
  type BootPlayerPayload, type ForgetKnowledgePayload, type JoinCampaignPayload, type SendCreatorPayload, type SetDiceColorPayload, type SetDiceTextColorPayload, type SetDiceRoleColorPayload,
  type SetDiceAceStylePayload, type SetTurnGuidePayload, type SetDiceBouncePayload,
  type SetPlayerColorPayload, type SetUsernamePayload, type SetVolumesPayload, type SwitchActiveMapPayload, type ViewMapPayload,
} from 'shared';
import { CHAT_TAIL } from '../../config.js';
import { validUsername } from '../../auth.js';
import {
  assetFolders, assets, audioTracks, campaigns, characters, chat, customItems, drawings,
  handouts, initiative, locations, macros, mapObjects, maps, rollableTables, shops, soundboard, users, worldFolders, worldSort, worldVis,
} from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, onlineUsers, safe, sdata, userRoom, viewerFor } from '../hub.js';
import { buildMapState, dropVisionCache, mapObjectsVisibleTo } from '../visionService.js';
import { emitCustomNpcs } from './characters.js';
import { initiativeViewFor } from './combat.js';
import { broadcastCounters } from './counters.js';
import { buildDirectory, broadcastDirectory } from '../directory.js';
import { getAudioState } from './library.js';
import { foldersVisibleTo, shopsForUser, sendShopPresentationTo } from './world.js';

function handoutsVisibleTo(campaignId: string, userId: string, isDm: boolean) {
  const all = handouts.forCampaign(campaignId);
  if (isDm) return all;
  return all
    .filter((h) => h.sharedAll || h.sharedWith.includes(userId))
    .map((h) => ({ ...h, sharedWith: [] })); // players don't see the share list
}

/**
 * Every per-viewer payload the world tab is assembled from, scoped through
 * viewerFor so a DM previewing a player gets that player's tree rather than
 * the omniscient one. Sent on join and again whenever the preview is switched,
 * which is what makes "View as" honest beyond the map.
 */
export function sendWorldViewTo(socket: Socket): void {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) return;
  const campaignId = d.campaignId;
  const v = viewerFor(d);
  socket.emit(S2C.DIRECTORY, buildDirectory(campaignId, v.isDm, v.userId));
  const allTables = rollableTables.forCampaign(campaignId);
  socket.emit(S2C.TABLES, { tables: v.isDm ? allTables : allTables.filter((t) => t.playersCanRoll) });
  socket.emit(S2C.SHOPS, { shops: shopsForUser(campaignId, v.userId, v.isDm) });
  sendShopPresentationTo(socket);
  const allLoc = locations.forCampaign(campaignId);
  socket.emit(S2C.LOCATIONS, { locations: v.isDm ? allLoc : allLoc.filter((l) => l.visibleToPlayers) });
  socket.emit(S2C.WORLD_FOLDERS, {
    folders: v.isDm ? worldFolders.forCampaign(campaignId) : foldersVisibleTo(campaignId, v.userId),
  });
  socket.emit(S2C.HANDOUTS, { handouts: handoutsVisibleTo(campaignId, v.userId, v.isDm) });
  socket.emit(S2C.WORLD_SORT, { orders: worldSort.forCampaign(campaignId) });
  socket.emit(S2C.CUSTOM_ITEMS, { items: customItems.forCampaign(campaignId) });
  // Pinned pills belong to a person, so the preview shows the previewed
  // player's — the DM's own row of macros is not what that player sees.
  socket.emit(S2C.MACROS, { macros: macros.forUser(v.userId, campaignId) });
}

export function buildCampaignState(campaignId: string, userId: string, username: string, isDm: boolean): CampaignStatePayload {
  const campaign = campaigns.byId(campaignId)!;
  return {
    campaign: isDm ? campaign : { ...campaign, inviteCode: '' },
    members: campaigns.members(campaignId).map((m) => ({
      ...m,
      online: false,
      mapId: campaigns.viewMapIdFor(campaignId, m.userId),
      // Never chosen means ON — see the presence build below.
      turnGuide: m.turnGuide !== 0,
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
    clockSeconds: campaigns.clockSeconds(campaignId),
    // The GM's own Benny pool. Sent to everyone in the payload's shape but
    // only meaningful to the DM, who is the only one with a chip showing it.
    gmBennies: campaigns.gmBennies(campaignId),
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

/**
 * Send the campaign's whole membership as ONE authoritative roster.
 *
 * This used to emit a separate upsert per member, which could only ever
 * update someone the client already knew about: a member who joined after you
 * loaded never appeared (your client had no row to update), and a member who
 * was removed never disappeared (the loop iterates CURRENT members, so nothing
 * was ever emitted about them again). A whole-roster replace can't drift in
 * either direction.
 */
export function broadcastPresence(io: Server, campaignId: string): void {
  const online = onlineUsers(io, campaignId);
  const members = campaigns.members(campaignId).map((m) => ({
    userId: m.userId,
    username: m.username,
    role: m.role,
    online: online.has(m.userId),
    mapId: campaigns.viewMapIdFor(campaignId, m.userId),
    diceColor: m.diceColor,
    diceTextColor: m.diceTextColor,
    diceTraitColor: m.diceTraitColor,
    diceWildColor: m.diceWildColor,
    diceRaiseColor: m.diceRaiseColor,
    playerColor: m.playerColor,
    diceBouncePct: m.diceBouncePct,
    diceAceStyle: m.diceAceStyle,
    // Never chosen means ON: a guide you have to go and switch on is a
    // guide the person who needed it never saw.
    turnGuide: m.turnGuide !== 0,
  }));
  io.to(campaignRoom(campaignId)).emit(S2C.MEMBER_PRESENCE, { members });
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

    {
      const vol = users.volumes(d.userId);
      socket.emit(S2C.YOU_ARE, {
        userId: d.userId, username: d.username, role,
        musicVolume: vol.music, sfxVolume: vol.sfx,
      });
    }
    socket.emit(S2C.CAMPAIGN_STATE, buildCampaignState(campaignId, d.userId, d.username, role === 'dm'));
    socket.emit(S2C.AUDIO_TRACKS, { tracks: audioTracks.forCampaign(campaignId) });
    socket.emit(S2C.AUDIO_STATE, { state: getAudioState(campaignId) });
    sendWorldViewTo(socket);
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
    // viewerFor, not d.role: while the DM is previewing a player this must
    // answer as that player. Reading the raw role handed the previewing DM the
    // whole campaign's atlas, so "View as" showed maps the player had never
    // discovered — the preview disagreeing with reality in the one direction
    // that makes it useless.
    const v = viewerFor(d);
    socket.emit(S2C.DIRECTORY, buildDirectory(d.campaignId, v.isDm, v.userId));
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

  // SWADE colors dice by their role in the roll (trait / Wild Die / raise
  // bonus) rather than by die size, so each role gets its own slot.
  socket.on(C2S.SET_DICE_ROLE_COLOR, safe(socket, ({ role, color }: SetDiceRoleColorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    if (role !== 'trait' && role !== 'wild' && role !== 'raise') return;
    const clean = color === null || /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : null;
    users.setDiceRoleColor(d.userId, role, clean);
    broadcastPresence(io, d.campaignId);
  }, 'SET_DICE_ROLE_COLOR'));

  // How often YOUR dice carom off a wall. Stored on the account and sent with
  // presence, so a player's dice throw the same way on every screen at the
  // table rather than each watcher seeing their own preference applied.
  socket.on(C2S.SET_DICE_BOUNCE, safe(socket, ({ pct }: SetDiceBouncePayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const clean = pct === null || !Number.isFinite(pct)
      ? null
      : Math.max(0, Math.min(100, Math.round(pct)));
    users.setDiceBouncePct(d.userId, clean);
    broadcastPresence(io, d.campaignId);
  }, 'SET_DICE_BOUNCE'));

  // How YOUR aced dice celebrate. Stored on the account and sent with presence
  // for the same reason the colors and the bounce share are: an ace should
  // look the same on every screen at the table, not however each watcher
  // happens to like other people's dice.
  // The combat turn guide is a teaching aid, so it is the LEARNER's setting:
  // it travels with presence, and a DM viewing as them sees it their way.
  socket.on(C2S.SET_TURN_GUIDE, safe(socket, ({ on }: SetTurnGuidePayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    users.setTurnGuide(d.userId, on === true);
    broadcastPresence(io, d.campaignId);
  }, 'SET_TURN_GUIDE'));

  socket.on(C2S.SET_DICE_ACE_STYLE, safe(socket, ({ style }: SetDiceAceStylePayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    users.setDiceAceStyle(d.userId, isAceStyle(style) ? style : null);
    broadcastPresence(io, d.campaignId);
  }, 'SET_DICE_ACE_STYLE'));

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

  // A player's own audio mix, saved to their account so it follows them to
  // any device / future session rather than living in one browser only.
  socket.on(C2S.SET_VOLUMES, safe(socket, ({ music, sfx }: SetVolumesPayload) => {
    const d = sdata(socket);
    users.setVolumes(d.userId, Number(music), Number(sfx));
  }, 'SET_VOLUMES'));

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
  // A player's world memory belongs to their ACCOUNT, so a fresh character
  // doesn't forget what they already scouted — and campaigns that predate
  // per-player tracking seeded everyone with the party's shared history.
  // This hands the DM the eraser.
  socket.on(C2S.FORGET_KNOWLEDGE, safe(socket, ({ userId }: ForgetKnowledgePayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') { emitError(socket, 'Only the DM can reset world knowledge.'); return; }
    const campaignId = d.campaignId;
    const removed = worldVis.forget(campaignId, userId);
    // Everything keyed off discovery has to be recomputed and re-sent.
    for (const s of campaignSockets(io, campaignId)) {
      const sd = sdata(s);
      if (sd.role === 'dm' || (userId && sd.userId !== userId)) continue;
      sendMapState(s);
    }
    broadcastDirectory(io, campaignId);
    // Counters are gated on knowing their map, so they have to be re-judged.
    for (const m of maps.forCampaign(campaignId)) broadcastCounters(io, campaignId, m.id);
    const who = userId
      ? campaigns.members(campaignId).find((m) => m.userId === userId)?.username ?? 'that player'
      : 'every player';
    emitError(socket, `Reset world knowledge for ${who} — ${removed} remembered thing${removed === 1 ? '' : 's'} forgotten.`);
  }, 'FORGET_KNOWLEDGE'));

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
    // The preview is not just the map: re-send every per-viewer payload the
    // world tab is built from, so switching to a player swaps the whole tree
    // to their knowledge and switching back restores omniscience.
    sendWorldViewTo(socket);
  }, 'DM_VIEW_AS'));

  socket.on('disconnect', () => {
    const d = sdata(socket);
    dropVisionCache(d.userId);
    if (d.campaignId) broadcastPresence(io, d.campaignId);
  });
}
