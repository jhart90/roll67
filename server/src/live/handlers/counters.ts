import type { Server, Socket } from 'socket.io';
import { C2S, S2C, counterSharedWith, isCounterPosition, type Counter, type CounterUpdatePayload } from 'shared';
import { campaigns, counters, maps, worldVis } from '../../db/repos.js';
import { campaignSockets, emitError, safe, sdata, viewerFor } from '../hub.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

/** A counter reaches a player only if the DM revealed it, shared it with them
 *  (or with everyone), AND the player has personally been on (or been shown)
 *  its map — 'visible' means visible at the table, not announced campaign-wide
 *  to people who were never there.
 *
 *  `sharedWith` is stripped on the way out: who else can see the doom clock is
 *  the DM's business, and shipping the list would let a player read it. */
function countersFor(campaignId: string, userId: string, list: Counter[]): Counter[] {
  const disc = worldVis.discovered(campaignId, userId);
  const ov = worldVis.overrides(campaignId);
  const knowsMap = (mapId: string) => {
    const o = ov.get(`map:${mapId}`);
    return o ? o === 'reveal' : disc.has(`map:${mapId}`);
  };
  return list
    .filter((c) => counterSharedWith(c, userId) && knowsMap(c.mapId))
    .map((c) => ({ ...c, sharedWith: null }));
}

/** Push one map's counters to everyone: DM gets all, players their own view. */
export function broadcastCounters(io: Server, campaignId: string, mapId: string): void {
  const all = counters.forMap(mapId);
  const every = counters.forCampaign(campaignId);
  for (const socket of campaignSockets(io, campaignId)) {
    const v = viewerFor(sdata(socket));
    socket.emit(S2C.COUNTERS, { mapId, counters: v.isDm ? all : countersFor(campaignId, v.userId, all) });
    // The world tree lists counters under every map, so it needs them all.
    socket.emit(S2C.COUNTERS_ALL, { counters: v.isDm ? every : countersFor(campaignId, v.userId, every) });
  }
}

export function registerCounterHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.COUNTERS_GET, safe(socket, ({ mapId }: { mapId: string }) => {
    const d = requireCampaign(socket);
    if (mapId === '*') {
      const every = counters.forCampaign(d.campaignId);
      socket.emit(S2C.COUNTERS_ALL, { counters: d.role === 'dm' ? every : countersFor(d.campaignId, d.userId, every) });
      return;
    }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    const all = counters.forMap(mapId);
    socket.emit(S2C.COUNTERS, { mapId, counters: d.role === 'dm' ? all : countersFor(d.campaignId, d.userId, all) });
  }, 'COUNTERS_GET'));

  socket.on(C2S.COUNTER_CREATE, safe(socket, ({ mapId }: { mapId: string }) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM keeps counters.'); return; }
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    counters.create(d.campaignId, mapId);
    broadcastCounters(io, d.campaignId, mapId);
  }, 'COUNTER_CREATE'));

  socket.on(C2S.COUNTER_UPDATE, safe(socket, ({ counterId, patch }: CounterUpdatePayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM keeps counters.'); return; }
    const c = counters.byId(counterId);
    if (!c || c.campaignId !== d.campaignId) return;
    // Sanitize: clamp counts, whitelist fields, verify a map move stays in-campaign.
    const clean: Partial<Counter> = {};
    if (typeof patch.name === 'string') clean.name = patch.name.trim().slice(0, 60) || 'Counter';
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) clean.color = patch.color;
    if (typeof patch.max === 'number' && Number.isFinite(patch.max)) clean.max = Math.max(1, Math.min(100, Math.round(patch.max)));
    if (typeof patch.value === 'number' && Number.isFinite(patch.value)) clean.value = Math.round(patch.value);
    if (typeof patch.visible === 'boolean') clean.visible = patch.visible;
    // Null means the whole table. A list is intersected with the campaign's
    // actual players so a stale id from a member who has since left can't sit
    // in the row forever, and so the DM never shares a counter with themselves
    // (they see everything anyway) or with an account in another campaign.
    if (patch.sharedWith === null) {
      clean.sharedWith = null;
    } else if (Array.isArray(patch.sharedWith)) {
      const players = new Set(campaigns.members(d.campaignId).filter((m) => m.role === 'player').map((m) => m.userId));
      clean.sharedWith = [...new Set(patch.sharedWith.filter((u): u is string => typeof u === 'string' && players.has(u)))];
    }
    if (isCounterPosition(patch.position)) clean.position = patch.position;
    if (typeof patch.mapId === 'string') {
      const target = maps.byId(patch.mapId);
      if (target && target.campaignId === d.campaignId) clean.mapId = patch.mapId;
    }
    const max = clean.max ?? c.max;
    if (clean.value !== undefined || clean.max !== undefined) {
      clean.value = Math.max(0, Math.min(max, clean.value ?? c.value));
    }
    counters.update(counterId, clean);
    broadcastCounters(io, d.campaignId, c.mapId);
    if (clean.mapId && clean.mapId !== c.mapId) broadcastCounters(io, d.campaignId, clean.mapId);
  }, 'COUNTER_UPDATE'));

  socket.on(C2S.COUNTER_DELETE, safe(socket, ({ counterId }: { counterId: string }) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') { emitError(socket, 'Only the DM keeps counters.'); return; }
    const c = counters.byId(counterId);
    if (!c || c.campaignId !== d.campaignId) return;
    counters.delete(counterId);
    broadcastCounters(io, d.campaignId, c.mapId);
  }, 'COUNTER_DELETE'));
}
