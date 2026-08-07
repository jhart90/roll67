import type { Server, Socket } from 'socket.io';
import { C2S, S2C, type Counter, type CounterUpdatePayload } from 'shared';
import { counters, maps } from '../../db/repos.js';
import { campaignSockets, emitError, safe, sdata } from '../hub.js';

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

/** Push one map's counters to everyone: DM gets all, players only visible. */
function broadcastCounters(io: Server, campaignId: string, mapId: string): void {
  const all = counters.forMap(mapId);
  const visible = all.filter((c) => c.visible);
  for (const socket of campaignSockets(io, campaignId)) {
    socket.emit(S2C.COUNTERS, { mapId, counters: sdata(socket).role === 'dm' ? all : visible });
  }
}

export function registerCounterHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.COUNTERS_GET, safe(socket, ({ mapId }: { mapId: string }) => {
    const d = requireCampaign(socket);
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) return;
    const all = counters.forMap(mapId);
    socket.emit(S2C.COUNTERS, { mapId, counters: d.role === 'dm' ? all : all.filter((c) => c.visible) });
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
    if (patch.position === 'top' || patch.position === 'bottom') clean.position = patch.position;
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
