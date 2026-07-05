// Per-player vision: the server-side secret boundary. Players only ever
// receive tokens/doors inside their computed field of view; walls, lights
// and gm-layer objects never leave the server except to the DM.

import type { Server, Socket } from 'socket.io';
import {
  computeUnionFovBands, computeUnionVisibilityPolygons, hexDistance, hexToPixel, packHex, pixelToHex, systemFor,
  S2C, type Door, type Hex, type Light, type MapStatePayload, type Point, type Token, type TokenView,
  type VisibilityLitMask, type VisionStats, type VisionUpdatePayload,
} from 'shared';
import { campaigns, characters, fog, maps, tokens } from '../db/repos.js';
import { campaignSockets, sdata, userRoom } from './hub.js';

type MapRecord = NonNullable<ReturnType<typeof maps.byId>>;

const DEFAULT_VISION: VisionStats = { visionRange: 24, darkvision: 0 };

interface VisionCache {
  mapId: string;
  visible: Set<number>;
  explored: Set<number>;
}

// Keyed `${userId}:${mapId}` — survives map switches per user.
const visionCache = new Map<string, VisionCache>();
const fogFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cacheKey(userId: string, mapId: string): string {
  return `${userId}:${mapId}`;
}

/** Vision stats for a token: explicit override, else its character's sheet. */
export function tokenVision(token: Token): VisionStats {
  if (token.vision) return token.vision;
  if (token.characterId) {
    const ch = characters.byId(token.characterId);
    if (ch) return systemFor(ch.system).vision(ch.sheet);
  }
  return DEFAULT_VISION;
}

/** Tokens through which a user sees on a map (owned characters, token layer). */
function viewerTokensFor(userId: string, mapTokens: Token[]): Token[] {
  return mapTokens.filter((t) => {
    if (t.layer !== 'token' || !t.characterId) return false;
    const ch = characters.byId(t.characterId);
    return ch?.ownerUserId === userId;
  });
}

function loadExplored(userId: string, mapId: string): Set<number> {
  return new Set(fog.get(userId, mapId));
}

function scheduleFogFlush(userId: string, mapId: string, explored: Set<number>): void {
  const key = cacheKey(userId, mapId);
  const existing = fogFlushTimers.get(key);
  if (existing) clearTimeout(existing);
  fogFlushTimers.set(key, setTimeout(() => {
    fogFlushTimers.delete(key);
    fog.set(userId, mapId, Int32Array.from(explored));
  }, 3000));
}

export function flushAllFog(): void {
  for (const [key, timer] of fogFlushTimers) {
    clearTimeout(timer);
    const [userId, mapId] = key.split(':');
    const cache = visionCache.get(key);
    if (cache) fog.set(userId, mapId, Int32Array.from(cache.explored));
  }
  fogFlushTimers.clear();
}

/** Tokens a player may see: token-layer tokens on visible hexes, plus their own. */
function visibleTokens(userId: string, mapTokens: Token[], visible: Set<number>): TokenView[] {
  return mapTokens.filter((t) => {
    if (t.layer === 'gm') return false;
    if (t.characterId && characters.byId(t.characterId)?.ownerUserId === userId) return true;
    return visible.has(packHex({ q: t.q, r: t.r }));
  });
}

/**
 * Doors the player knows about: midpoint inside explored (or visible) hexes,
 * plus any door within 2 hexes of one of their own tokens regardless of fog
 * -- otherwise a door right next to you could be missed by FOV (e.g. it sits
 * across a diagonal the raycast grazes) even though you're standing close
 * enough to see and use it in person.
 */
function knownDoors(map: MapRecord, explored: Set<number>, visible: Set<number>, viewerHexes: Hex[]): Door[] {
  return map.doors.filter((d) => {
    const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
    const doorHex = pixelToHex(mid, map.grid);
    const key = packHex(doorHex);
    if (explored.has(key) || visible.has(key)) return true;
    return viewerHexes.some((h) => hexDistance(h, doorHex) <= 2);
  });
}

export interface UserMapView {
  visible: Set<number>;
  fade: Set<number>;
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
  visibleLitMask: VisibilityLitMask | null;
  fadeLitMask: VisibilityLitMask | null;
  newlyExplored: number[];
  explored: Set<number>;
  tokens: TokenView[];
  knownDoors: Door[];
}

/** Compute (and cache) a player's current view of a map. */
export function computeUserMapView(userId: string, map: MapRecord, mapTokens?: Token[]): UserMapView {
  const allTokens = mapTokens ?? tokens.forMap(map.id);
  const key = cacheKey(userId, map.id);
  let cache = visionCache.get(key);
  if (!cache || cache.mapId !== map.id) {
    cache = { mapId: map.id, visible: new Set(), explored: loadExplored(userId, map.id) };
    visionCache.set(key, cache);
  }
  const viewers = viewerTokensFor(userId, allTokens).map((t) => ({
    hex: { q: t.q, r: t.r },
    stats: tokenVision(t),
  }));
  // Tokens flagged as light sources contribute lights at their hex position.
  const tokenLights: Light[] = allTokens
    .filter((t) => t.light && (t.light.bright > 0 || t.light.dim > 0))
    .map((t) => {
      const px = hexToPixel({ q: t.q, r: t.r }, map.grid);
      return { id: `tl-${t.id}`, x: px.x, y: px.y, brightRadius: t.light!.bright, dimRadius: t.light!.dim };
    });
  const lights = tokenLights.length > 0 ? [...map.lights, ...tokenLights] : map.lights;
  const fovInput = { grid: map.grid, walls: map.walls, doors: map.doors, lights };
  const bands = viewers.length === 0
    ? { full: new Set<number>(), fade: new Set<number>() }
    : computeUnionFovBands(viewers, fovInput);
  const polyBands = viewers.length === 0 ? null : computeUnionVisibilityPolygons(viewers, fovInput);
  const { full: visible, fade } = bands;
  const newlyExplored: number[] = [];
  for (const h of [...visible, ...fade]) {
    if (!cache.explored.has(h)) {
      cache.explored.add(h);
      newlyExplored.push(h);
    }
  }
  cache.visible = visible;
  if (newlyExplored.length > 0) scheduleFogFlush(userId, map.id, cache.explored);
  // Tokens in the fade rim are still (dimly) seen.
  const seen = new Set([...visible, ...fade]);
  return {
    visible,
    fade,
    visiblePolygons: polyBands?.full.reach ?? null,
    fadePolygons: polyBands?.fade.reach ?? null,
    visibleLitMask: polyBands?.full.lit ?? null,
    fadeLitMask: polyBands?.fade.lit ?? null,
    newlyExplored,
    explored: cache.explored,
    tokens: visibleTokens(userId, allTokens, seen),
    knownDoors: knownDoors(map, cache.explored, seen, viewers.map((v) => v.hex)),
  };
}

/** Full MapStatePayload for a viewer (player, DM, or DM-as-player preview). */
export function buildMapState(
  map: MapRecord,
  viewer: { userId: string; isDm: boolean; viewingAs?: string },
  drawings: MapStatePayload['drawings'],
): MapStatePayload {
  const mapView = {
    id: map.id,
    name: map.name,
    sortOrder: map.sortOrder,
    bgUrl: map.bgUrl,
    bgWidth: map.bgWidth,
    bgHeight: map.bgHeight,
    grid: map.grid,
    spawn: map.spawn ?? null,
  };
  const allTokens = tokens.forMap(map.id);

  if (viewer.isDm && !viewer.viewingAs) {
    return {
      map: mapView,
      dmGeometry: { walls: map.walls, doors: map.doors, lights: map.lights },
      tokens: allTokens,
      drawings,
      visible: null,
      fade: null,
      visiblePolygons: null,
      fadePolygons: null,
      visibleLitMask: null,
      fadeLitMask: null,
      explored: null,
      knownDoors: [],
      viewingAs: null,
    };
  }

  const targetUser = viewer.viewingAs ?? viewer.userId;
  const view = computeUserMapView(targetUser, map, allTokens);
  return {
    map: mapView,
    // The DM previewing a player still keeps geometry for their editor overlays.
    dmGeometry: viewer.isDm ? { walls: map.walls, doors: map.doors, lights: map.lights } : null,
    tokens: view.tokens,
    drawings: drawings.filter((d) => viewer.isDm || d.layer !== 'gm'),
    visible: [...view.visible],
    fade: [...view.fade],
    visiblePolygons: view.visiblePolygons,
    fadePolygons: view.fadePolygons,
    visibleLitMask: view.visibleLitMask,
    fadeLitMask: view.fadeLitMask,
    explored: [...view.explored],
    knownDoors: view.knownDoors,
    viewingAs: viewer.viewingAs ?? null,
  };
}

/**
 * Recompute vision for every online viewer of a map and push updates.
 * Call after anything that can change what someone sees: token move/create/
 * delete/layer change, door toggle, wall/light/grid edits, sheet vision edits.
 */
export function syncMapVision(io: Server, campaignId: string, mapId: string): void {
  const campaign = campaigns.byId(campaignId);
  if (!campaign) return;
  const map = maps.byId(mapId);
  if (!map || map.campaignId !== campaignId) return;
  const allTokens = tokens.forMap(mapId);

  const sockets = campaignSockets(io, campaignId);
  const sentToUser = new Set<string>();

  for (const socket of sockets) {
    const d = sdata(socket);
    // Members can be on different maps; only update viewers of THIS map.
    const effectiveUser = d.role === 'dm' ? d.viewingAs : d.userId;
    if (effectiveUser && campaigns.viewMapIdFor(campaignId, effectiveUser) !== mapId) continue;
    if (d.role === 'dm') {
      // God mode: DM already receives raw token/map events; only a view-as
      // preview needs a vision update.
      if (d.viewingAs) {
        const view = computeUserMapView(d.viewingAs, map, allTokens);
        const payload: VisionUpdatePayload = {
          mapId,
          visible: [...view.visible],
          fade: [...view.fade],
          visiblePolygons: view.visiblePolygons,
          fadePolygons: view.fadePolygons,
          visibleLitMask: view.visibleLitMask,
          fadeLitMask: view.fadeLitMask,
          newlyExplored: view.newlyExplored,
          tokens: view.tokens,
          knownDoors: view.knownDoors,
          viewingAs: d.viewingAs,
        };
        socket.emit(S2C.VISION_UPDATE, payload);
      }
      continue;
    }
    if (sentToUser.has(d.userId)) continue;
    sentToUser.add(d.userId);
    const view = computeUserMapView(d.userId, map, allTokens);
    const payload: VisionUpdatePayload = {
      mapId,
      visible: [...view.visible],
      fade: [...view.fade],
      visiblePolygons: view.visiblePolygons,
      fadePolygons: view.fadePolygons,
      visibleLitMask: view.visibleLitMask,
      fadeLitMask: view.fadeLitMask,
      newlyExplored: view.newlyExplored,
      tokens: view.tokens,
      knownDoors: view.knownDoors,
      viewingAs: null,
    };
    io.to(userRoom(d.userId)).emit(S2C.VISION_UPDATE, payload);
  }
}

/** Player sockets that can currently see a token (for drag ghosts). */
export function socketsSeeingToken(io: Server, campaignId: string, token: Token): Socket[] {
  const out: Socket[] = [];
  const tokenKey = packHex({ q: token.q, r: token.r });
  for (const socket of campaignSockets(io, campaignId)) {
    const d = sdata(socket);
    if (d.role === 'dm') {
      out.push(socket);
      continue;
    }
    if (token.layer === 'gm') continue;
    // A stale vision cache from a map the player left must not leak events.
    if (campaigns.viewMapIdFor(campaignId, d.userId) !== token.mapId) continue;
    const cache = visionCache.get(cacheKey(d.userId, token.mapId));
    if (cache?.visible.has(tokenKey)) out.push(socket);
    else if (token.characterId && characters.byId(token.characterId)?.ownerUserId === d.userId) out.push(socket);
  }
  return out;
}

/** Can a player toggle this door? Must have an owned token within 2 hexes. */
export function canReachDoor(userId: string, map: MapRecord, door: Door): boolean {
  const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
  const doorHex: Hex = pixelToHex(mid, map.grid);
  const mine = viewerTokensFor(userId, tokens.forMap(map.id));
  return mine.some((t) => hexDistance({ q: t.q, r: t.r }, doorHex) <= 2);
}

/** Clear a user's vision cache (e.g. when they leave). */
export function dropVisionCache(userId: string): void {
  for (const key of [...visionCache.keys()]) {
    if (key.startsWith(`${userId}:`)) {
      const cache = visionCache.get(key)!;
      const [, mapId] = key.split(':');
      fog.set(userId, mapId, Int32Array.from(cache.explored));
      visionCache.delete(key);
    }
  }
}

/** Forget all cached vision and pending fog flushes for a deleted map. */
export function dropMapVisionCaches(mapId: string): void {
  for (const key of [...visionCache.keys()]) {
    if (key.endsWith(`:${mapId}`)) {
      visionCache.delete(key);
      const timer = fogFlushTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        fogFlushTimers.delete(key);
      }
    }
  }
}
