import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, rows, str,
  type AutoTraceWallsPayload,
  type CreateMapPayload, type DeleteMapPayload, type DeleteDoorPayload,
  type DeleteLightPayload, type DeleteWallPayload, type Door, type MapEditedPayload,
  type Point, type Wall,
  type SetGridConfigPayload, type SetSpawnPayload, type ToggleDoorPayload, type UpdateMapPayload,
  type UpsertDoorPayload, type UpsertLightPayload, type UpsertWallPayload,
} from 'shared';
import { assets, campaigns, characters, doorMemory, fog, maps } from '../../db/repos.js';
import { newId } from '../../db/db.js';
import { campaignRoom, dmRoom, emitError, safe, sdata } from '../hub.js';
import { canReachDoor, dropMapVisionCaches, syncMapVision } from '../visionService.js';
import { broadcastPresence, sendMapState } from './session.js';
import { broadcastDirectory } from '../directory.js';
import { detectWalls } from '../../autoTrace.js';

/** Does any character this user owns in the campaign carry an inventory item
 *  named `keyName` (case-insensitive)? Possession alone unlocks -- the item
 *  isn't consumed. */
function hasKeyItem(userId: string, campaignId: string, keyName: string): boolean {
  const wanted = keyName.trim().toLowerCase();
  return characters.forCampaign(campaignId).some((c) => {
    if (c.ownerUserId !== userId) return false;
    return rows(c.sheet, 'inventory').some((item) => str(item, 'name', '').trim().toLowerCase() === wanted);
  });
}

/** Project point p onto segment a→b; returns whether p is on the segment
 *  (within `tol` pixels perpendicular distance) and the normalised parameter t
 *  (0 = at a, 1 = at b). */
function pointOnSegment(p: Point, a: Point, b: Point, tol: number): { on: boolean; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return { on: Math.hypot(p.x - a.x, p.y - a.y) <= tol, t: 0 };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const dist = Math.hypot(p.x - (a.x + tc * dx), p.y - (a.y + tc * dy));
  return { on: dist <= tol && tc >= -tol / Math.sqrt(len2) && tc <= 1 + tol / Math.sqrt(len2), t: tc };
}

/** When both endpoints of a new segment (wall or door) lie on an existing
 *  wall's polyline, split that wall into "before" and "after" parts so the
 *  new segment fills the gap seamlessly.  Works even when the two endpoints
 *  fall on different segments of the same multi-point wall (the overlap spans
 *  the segments between them).  Returns the (possibly modified) walls array. */
function splitWallsAtOverlap(walls: Wall[], p1: Point, p2: Point): Wall[] {
  const TOL = 4;
  const polyLen = (pts: Point[]) =>
    pts.reduce((s, pt, i) => (i === 0 ? 0 : s + Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y)), 0);

  for (let wi = 0; wi < walls.length; wi++) {
    const w = walls[wi];
    let hit1: { si: number; t: number } | null = null;
    let hit2: { si: number; t: number } | null = null;
    for (let si = 0; si + 1 < w.points.length; si++) {
      const a = w.points[si];
      const b = w.points[si + 1];
      if (!hit1) { const r = pointOnSegment(p1, a, b, TOL); if (r.on) hit1 = { si, t: r.t }; }
      if (!hit2) { const r = pointOnSegment(p2, a, b, TOL); if (r.on) hit2 = { si, t: r.t }; }
    }
    if (!hit1 || !hit2) continue;

    // Order so "near" comes first along the polyline.
    let near = hit1, far = hit2, pNear = p1, pFar = p2;
    if (near.si > far.si || (near.si === far.si && near.t > far.t)) {
      [near, far, pNear, pFar] = [far, near, pFar, pNear];
    }

    const beforePts: Point[] = w.points.slice(0, near.si + 1);
    if (near.t > 0.01) beforePts.push(pNear);

    const afterPts: Point[] = [];
    if (far.t < 0.99) afterPts.push(pFar);
    afterPts.push(...w.points.slice(far.si + 1));

    const result = walls.filter((_, i) => i !== wi);
    if (beforePts.length >= 2 && polyLen(beforePts) > TOL) {
      result.push({ ...w, id: newId(), points: beforePts });
    }
    if (afterPts.length >= 2 && polyLen(afterPts) > TOL) {
      result.push({ ...w, id: newId(), points: afterPts });
    }
    return result;
  }
  return walls;
}

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
  }, 'CREATE_MAP'));

  socket.on(C2S.DELETE_MAP, safe(socket, ({ mapId }: DeleteMapPayload) => {
    const { d } = requireDmMap(socket, mapId);
    const campaign = campaigns.byId(d.campaignId!)!;
    maps.delete(mapId);
    fog.clearMap(mapId);
    doorMemory.clearMap(mapId);
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
  }, 'DELETE_MAP'));

  socket.on(C2S.UPDATE_MAP, safe(socket, (payload: UpdateMapPayload) => {
    const { d, map } = requireDmMap(socket, payload.mapId);
    if (payload.bgAssetId && !assets.byId(payload.bgAssetId)) {
      emitError(socket, 'Asset not found — upload may have failed.');
      return;
    }
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
  }, 'UPDATE_MAP'));

  socket.on(C2S.SET_GRID_CONFIG, safe(socket, ({ mapId, grid }: SetGridConfigPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const merged = { ...map.grid, ...grid };
    merged.hexSize = Math.max(4, Math.min(300, merged.hexSize));
    merged.cols = Math.max(1, Math.min(200, merged.cols));
    merged.rows = Math.max(1, Math.min(200, merged.rows));
    maps.setGrid(mapId, merged);
    io.to(campaignRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, grid: merged });
    syncMapVision(io, d.campaignId!, mapId);
  }, 'SET_GRID_CONFIG'));

  socket.on(C2S.SET_SPAWN, safe(socket, ({ mapId, q, r }: SetSpawnPayload) => {
    const { d } = requireDmMap(socket, mapId);
    const spawn = { q: Math.round(q), r: Math.round(r) };
    maps.setSpawn(mapId, spawn);
    io.to(campaignRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, spawn });
  }, 'SET_SPAWN'));

  // ----- walls -----

  socket.on(C2S.UPSERT_WALL, safe(socket, ({ mapId, wall }: UpsertWallPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    if (!Array.isArray(wall.points) || wall.points.length < 2) throw new Error('A wall needs at least 2 points.');
    const id = wall.id ?? newId();
    const isNew = !map.walls.some((w) => w.id === id);
    let walls = [...map.walls];
    if (isNew) {
      walls = splitWallsAtOverlap(walls, wall.points[0], wall.points[wall.points.length - 1]);
    }
    const idx = walls.findIndex((w) => w.id === id);
    const next: Wall = {
      id, points: wall.points, type: wall.type ?? 'solid', flip: !!wall.flip,
      ...(wall.type === 'stainedglass' ? { glassColor: wall.glassColor, rainbow: !!wall.rainbow } : {}),
    };
    if (idx >= 0) walls[idx] = next;
    else walls.push(next);
    maps.setWalls(mapId, walls);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, walls });
    syncMapVision(io, d.campaignId!, mapId);
  }, 'UPSERT_WALL'));

  socket.on(C2S.DELETE_WALL, safe(socket, ({ mapId, wallId }: DeleteWallPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const walls = map.walls.filter((w) => w.id !== wallId);
    maps.setWalls(mapId, walls);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, walls });
    syncMapVision(io, d.campaignId!, mapId);
  }, 'DELETE_WALL'));

  // ----- doors -----

  socket.on(C2S.UPSERT_DOOR, safe(socket, ({ mapId, door }: UpsertDoorPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const doors = [...map.doors];
    const id = door.id ?? newId();
    const isNew = !map.doors.some((x) => x.id === id);
    const idx = doors.findIndex((x) => x.id === id);
    const next: Door = {
      id, a: door.a, b: door.b, open: door.open ?? false, type: door.type === 'gate' ? 'gate' as const : 'door' as const,
      locked: !!door.locked, keyName: door.locked ? (door.keyName?.trim() || 'Key') : null,
    };
    if (idx >= 0) doors[idx] = next;
    else doors.push(next);
    maps.setDoors(mapId, doors);
    let wallsChanged = false;
    if (isNew) {
      const walls = splitWallsAtOverlap([...map.walls], door.a, door.b);
      if (walls.length !== map.walls.length || walls.some((w, i) => w !== map.walls[i])) {
        maps.setWalls(mapId, walls);
        wallsChanged = true;
        io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, doors, walls });
      }
    }
    if (!wallsChanged) io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, doors });
    syncMapVision(io, d.campaignId!, mapId);
  }, 'UPSERT_DOOR'));

  socket.on(C2S.DELETE_DOOR, safe(socket, ({ mapId, doorId }: DeleteDoorPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const doors = map.doors.filter((x) => x.id !== doorId);
    maps.setDoors(mapId, doors);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, doors });
    syncMapVision(io, d.campaignId!, mapId);
  }, 'DELETE_DOOR'));

  socket.on(C2S.TOGGLE_DOOR, safe(socket, ({ mapId, doorId }: ToggleDoorPayload) => {
    const d = sdata(socket);
    if (!d.campaignId) return;
    const map = maps.byId(mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    const door = map.doors.find((x) => x.id === doorId);
    if (!door) throw new Error('Unknown door.');
    if (d.role !== 'dm') {
      if (!canReachDoor(d.userId, map, door)) {
        throw new Error('You need a token within 2 hexes to use that door.');
      }
      if (!door.open && door.locked && !hasKeyItem(d.userId, d.campaignId, door.keyName || 'Key')) {
        throw new Error(`This ${door.type === 'gate' ? 'gate' : 'door'} is locked. You need a "${door.keyName || 'Key'}".`);
      }
    }
    door.open = !door.open;
    maps.setDoors(mapId, map.doors);
    // Everyone who knows the door hears its state change; vision sync reveals
    // (or hides) what lies beyond.
    io.to(campaignRoom(d.campaignId)).emit(S2C.DOOR_STATE, { mapId, doorId, open: door.open });
    syncMapVision(io, d.campaignId, mapId);
  }, 'TOGGLE_DOOR'));

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
  }, 'UPSERT_LIGHT'));

  socket.on(C2S.DELETE_LIGHT, safe(socket, ({ mapId, lightId }: DeleteLightPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    const lights = map.lights.filter((x) => x.id !== lightId);
    maps.setLights(mapId, lights);
    io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, lights });
    syncMapVision(io, d.campaignId!, mapId);
  }, 'DELETE_LIGHT'));

  // ----- auto-trace walls from background image -----

  socket.on(C2S.AUTO_TRACE_WALLS, safe(socket, ({ mapId }: AutoTraceWallsPayload) => {
    const { d, map } = requireDmMap(socket, mapId);
    if (!map.bgAssetId) {
      emitError(socket, 'Upload a background image first.');
      return;
    }
    const asset = assets.byId(map.bgAssetId);
    if (!asset) {
      emitError(socket, 'Background asset not found.');
      return;
    }
    const minLen = map.grid.hexSize * 0.8;
    detectWalls(asset.id, asset.ext, minLen).then((segments: Array<{x1: number; y1: number; x2: number; y2: number}>) => {
      const fresh = maps.byId(mapId);
      if (!fresh) return;
      const walls = [...fresh.walls];
      for (const s of segments) {
        walls.push({ id: newId(), points: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], type: 'solid' });
      }
      maps.setWalls(mapId, walls);
      io.to(dmRoom(d.campaignId!)).emit(S2C.MAP_EDITED, { mapId, walls });
      syncMapVision(io, d.campaignId!, mapId);
    }).catch((err: unknown) => {
      console.error('Auto-trace failed:', err);
      emitError(socket, 'Auto-trace failed — could not process the image.');
    });
  }, 'AUTO_TRACE_WALLS'));
}
