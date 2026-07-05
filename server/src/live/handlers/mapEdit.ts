import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C,
  type CreateMapPayload, type DeleteMapPayload, type DeleteDoorPayload,
  type DeleteLightPayload, type DeleteWallPayload, type MapEditedPayload,
  type SetGridConfigPayload, type SetSpawnPayload, type ToggleDoorPayload, type UpdateMapPayload,
  type UpsertDoorPayload, type UpsertLightPayload, type UpsertWallPayload,
} from 'shared';
import { assets, campaigns, fog, maps } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, dmRoom, emitError, safe, sdata } from '../hub.js';
import { canReachDoor, dropMapVisionCaches, syncMapVision } from '../visionService.js';
import { broadcastPresence, sendMapState } from './session.js';
import { broadcastDirectory } from '../directory.js';

function requireDmMap(socket: Socket, mapId: string) {
  const d = sdata(socket);
  if (!d.campaignId || d.role !== 'dm') throw new Error('Only the DM can edit the map.');
  const map = maps.byId(mapId);
  if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
  return { d, map };
}

export function registerMapEditHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.CREATE_MAP, safe(socket, ({ name }: CreateMapPayload) => {
    const d = sdata(socket);
    if (!d.campaignId || d.role !== 'dm') {
      emitError(socket, 'Only the DM can create maps.');
      return;
    }
    const map = maps.create(d.campaignId, name?.trim() || 'New map');
    const campaign = campaigns.byId(d.campaignId)!;
    if (!campaign.activeMapId) campaigns.setActiveMap(d.campaignId, map.id);
    io.to(dmRoom(d.campaignId)).emit(S2C.MAP_LIST, { maps: maps.forCampaign(d.campaignId) });
    if (!campaign.activeMapId) {
      for (const s of io.sockets.sockets.values()) {
        if (sdata(s).campaignId === d.campaignId) sendMapState(s);
      }
    }
    broadcastDirectory(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_MAP, safe(socket, ({ mapId }: DeleteMapPayload) => {
    const { d } = requireDmMap(socket, mapId);
    const campaign = campaigns.byId(d.campaignId!)!;
    maps.delete(mapId);
    fog.clearMap(mapId);
    dropMapVisionCaches(mapId);
    // Anyone assigned to this map falls back to the party map.
    campaigns.clearMapAssignments(mapId);
    if (campaign.activeMapId === mapId) {
      const remaining = maps.forCampaign(d.campaignId!);
      const next = remaining[0]?.id ?? null;
      campaigns.setActiveMap(d.campaignId!, next);
      io.to(campaignRoom(d.campaignId!)).emit(S2C.ACTIVE_MAP, { mapId: next });
    }
    for (const s of io.sockets.sockets.values()) {
      if (sdata(s).campaignId === d.campaignId) sendMapState(s);
    }
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_LIST, { maps: maps.forCampaign(d.campaignId!) });
    broadcastPresence(io, d.campaignId!);
  }));

  socket.on(C2S.UPDATE_MAP, safe(socket, (payload: UpdateMapPayload) => {
    const { d, map } = requireDmMap(socket, payload.mapId);
    maps.update(map.id, { name: payload.name, bgAssetId: payload.bgAssetId, parentId: payload.parentId });
    const updated = maps.byId(map.id)!;
    const edit: MapEditedPayload = {
      mapId: map.id,
      name: updated.name,
      bgUrl: updated.bgUrl,
      bgWidth: updated.bgWidth,
      bgHeight: updated.bgHeight,
    };
    io.to(campaignRoom(d.campaignId!)).emit(S2C.MAP_EDITED, edit);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_LIST, { maps: maps.forCampaign(d.campaignId!) });
  }));

  socket.on(C2S.SET_GRID_CONFIG, safe(socket, ({ mapId, grid }: SetGridConfigPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const merged = { ...map.grid, ...grid };
    merged.hexSize = Math.max(8, Math.min(300, merged.hexSize));
    merged.cols = Math.max(1, Math.min(400, merged.cols));
    merged.rows = Math.max(1, Math.min(400, merged.rows));
    maps.setGrid(mapId, merged);
    io.to(campaignRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, grid: merged });
    syncMapVision(io, d.campaignId!, mapId);
  }));

  socket.on(C2S.SET_SPAWN, safe(socket, ({ mapId, q, r }: SetSpawnPayload) => {
    const { d } = requireDmMap(socket, mapId);
    const spawn = { q: Math.round(q), r: Math.round(r) };
    maps.setSpawn(mapId, spawn);
    io.to(campaignRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, spawn });
  }));

  // ----- walls -----

  socket.on(C2S.UPSERT_WALL, safe(socket, ({ mapId, wall }: UpsertWallPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    if (!Array.isArray(wall.points) || wall.points.length < 2) throw new Error('A wall needs at least 2 points.');
    const walls = [...map.walls];
    const id = wall.id ?? newId();
    const idx = walls.findIndex((w) => w.id === id);
    const next = { id, points: wall.points, type: wall.type ?? 'solid', flip: !!wall.flip };
    if (idx >= 0) walls[idx] = next;
    else walls.push(next);
    maps.setWalls(mapId, walls);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, walls });
    syncMapVision(io, d.campaignId!, mapId);
  }));

  socket.on(C2S.DELETE_WALL, safe(socket, ({ mapId, wallId }: DeleteWallPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const walls = map.walls.filter((w) => w.id !== wallId);
    maps.setWalls(mapId, walls);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, walls });
    syncMapVision(io, d.campaignId!, mapId);
  }));

  // ----- doors -----

  socket.on(C2S.UPSERT_DOOR, safe(socket, ({ mapId, door }: UpsertDoorPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const doors = [...map.doors];
    const id = door.id ?? newId();
    const idx = doors.findIndex((x) => x.id === id);
    const next = { id, a: door.a, b: door.b, open: door.open ?? false, type: door.type === 'gate' ? 'gate' as const : 'door' as const };
    if (idx >= 0) doors[idx] = next;
    else doors.push(next);
    maps.setDoors(mapId, doors);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, doors });
    syncMapVision(io, d.campaignId!, mapId);
  }));

  socket.on(C2S.DELETE_DOOR, safe(socket, ({ mapId, doorId }: DeleteDoorPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const doors = map.doors.filter((x) => x.id !== doorId);
    maps.setDoors(mapId, doors);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, doors });
    syncMapVision(io, d.campaignId!, mapId);
  }));

  socket.on(C2S.TOGGLE_DOOR, safe(socket, ({ mapId, doorId }: ToggleDoorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    const door = map.doors.find((x) => x.id === doorId);
    if (!door) throw new Error('Unknown door.');
    if (d.role !== 'dm' && !canReachDoor(d.userId, map, door)) {
      throw new Error('You need a token within 2 hexes to use that door.');
    }
    door.open = !door.open;
    maps.setDoors(mapId, map.doors);
    // Everyone who knows the door hears its state change; vision sync reveals
    // (or hides) what lies beyond.
    io.to(campaignRoom(d.campaignId)).emit(S2C.DOOR_STATE, { mapId, doorId, open: door.open });
    syncMapVision(io, d.campaignId, mapId);
  }));

  // ----- lights -----

  socket.on(C2S.UPSERT_LIGHT, safe(socket, ({ mapId, light }: UpsertLightPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const lights = [...map.lights];
    const id = light.id ?? newId();
    const idx = lights.findIndex((x) => x.id === id);
    const next = {
      id, x: light.x, y: light.y,
      brightRadius: Math.max(0, light.brightRadius),
      dimRadius: Math.max(0, light.dimRadius),
      color: light.color,
    };
    if (idx >= 0) lights[idx] = next;
    else lights.push(next);
    maps.setLights(mapId, lights);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, lights });
    syncMapVision(io, d.campaignId!, mapId);
  }));

  socket.on(C2S.DELETE_LIGHT, safe(socket, ({ mapId, lightId }: DeleteLightPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const lights = map.lights.filter((x) => x.id !== lightId);
    maps.setLights(mapId, lights);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, lights });
    syncMapVision(io, d.campaignId!, mapId);
  }));
}
