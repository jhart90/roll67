import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type CampaignStatePayload, type DmViewAsPayload, type JoinCampaignPayload,
  type SwitchActiveMapPayload,
} from 'shared';
import { CHAT_TAIL } from '../../config.js';
import {
  campaigns, characters, chat, drawings, handouts, initiative, macros, maps,
} from '../../db/repos.js';
import { campaignRoom, dmRoom, emitError, onlineUsers, safe, sdata } from '../hub.js';
import { buildMapState, dropVisionCache } from '../visionService.js';
import { initiativeViewFor } from './combat.js';

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
    members: campaigns.members(campaignId).map((m) => ({ ...m, online: false })),
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

/** Send the full map state for the campaign's active map to one socket. */
export function sendMapState(socket: Socket): void {
  const d = sdata(socket);
  if (!d.campaignId) return;
  const campaign = campaigns.byId(d.campaignId);
  if (!campaign?.activeMapId) return;
  const map = maps.byId(campaign.activeMapId);
  if (!map) return;
  const payload = buildMapState(
    map,
    { userId: d.userId, isDm: d.role === 'dm', viewingAs: d.viewingAs },
    drawings.forMap(map.id),
  );
  socket.emit(S2C.MAP_STATE, payload);
}

export function broadcastPresence(io: Server, campaignId: string): void {
  const online = onlineUsers(io, campaignId);
  for (const m of campaigns.members(campaignId)) {
    io.to(campaignRoom(campaignId)).emit(S2C.MEMBER_PRESENCE, {
      userId: m.userId,
      online: online.has(m.userId),
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
    sendMapState(socket);
    broadcastPresence(io, campaignId);
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
    // Everyone gets a fresh full map state for the new map.
    for (const s of io.sockets.sockets.values()) {
      if (sdata(s).campaignId === d.campaignId) sendMapState(s);
    }
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
