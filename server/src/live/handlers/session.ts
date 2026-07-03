import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type AssignPlayerMapPayload, type CampaignStatePayload, type DmViewAsPayload,
  type JoinCampaignPayload, type SwitchActiveMapPayload, type ViewMapPayload,
} from 'shared';
import { CHAT_TAIL } from '../../config.js';
import {
  campaigns, characters, chat, drawings, handouts, initiative, macros, maps, rollableTables,
} from '../../db/repos.js';
import { campaignRoom, dmRoom, emitError, onlineUsers, safe, sdata } from '../hub.js';
import { buildMapState, dropVisionCache } from '../visionService.js';
import { initiativeViewFor } from './combat.js';
import { buildDirectory } from '../directory.js';

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
    initiative: initiativeViewFor(initiative.get(campaignId), isDm),
    chatTail: chat.tailFor(campaignId, userId, username, isDm, CHAT_TAIL),
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
      online: online.has(m.userId),
      mapId: campaigns.viewMapIdFor(campaignId, m.userId),
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
    sendMapState(socket);
    broadcastPresence(io, campaignId);
  }));

  socket.on(C2S.REQUEST_DIRECTORY, safe(socket, () => {
    const d = sdata(socket);
    if (!d.campaignId || !d.role) return;
    socket.emit(S2C.DIRECTORY, buildDirectory(d.campaignId, d.role === 'dm'));
  }));

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
  }));

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
  }));

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
  }));

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
  }));

  socket.on(C2S.DM_VIEW_AS, safe(socket, ({ userId }: DmViewAsPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') {
      emitError(socket, 'Only the DM can preview player vision.');
      return;
    }
    d.viewingAs = userId ?? undefined;
    sendMapState(socket);
  }));

  socket.on('disconnect', () => {
    const d = sdata(socket);
    dropVisionCache(d.userId);
    if (d.campaignId) broadcastPresence(io, d.campaignId);
  });
}
