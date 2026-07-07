// Per-player vision: the server-side secret boundary. Players only ever
// receive tokens/doors inside their computed field of view; walls, lights
// and gm-layer objects never leave the server except to the DM.

import type { Server, Socket } from 'socket.io';
import {
  computeLightPolygons, computeUnionFovBands, computeUnionVisibilityPolygons, hexDistance, hexToPixel, litHexes,
  packHex, pixelToHex, sightSegments, systemFor,
  S2C, type Door, type FovInput, type Hex, type Light, type MapStatePayload, type Point, type Segment, type Token,
  type TokenView, type VisibilityLitMask, type VisionStats, type VisionUpdatePayload,
} from 'shared';
import { campaigns, characters, doorMemory, fog, maps, tokens } from '../db/repos.js';
import { campaignSockets, sdata, userRoom } from './hub.js';

type MapRecord = NonNullable<ReturnType<typeof maps.byId>>;

const DEFAULT_VISION: VisionStats = { visionRange: 24, darkvision: 0 };

/** How close (in hexes) a player's own token must be to a door to discover
 *  it even without direct line of sight -- e.g. it sits across a diagonal
 *  the raycast grazes, even though you're standing close enough to see and
 *  use it in person. */
const DOOR_DISCOVERY_RADIUS = 5;

interface VisionCache {
  mapId: string;
  visible: Set<number>;
  explored: Set<number>;
  /** Doors this player has discovered, snapshotted as last observed -- kept
   *  visible (in that last-seen state) even once they're out of sight again. */
  doorMemory: Map<string, Door>;
}

// Keyed `${userId}:${mapId}` — survives map switches per user.
const visionCache = new Map<string, VisionCache>();
const fogFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const doorMemoryFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cacheKey(userId: string, mapId: string): string {
  return `${userId}:${mapId}`;
}

// A vision pass looks up the same characters over and over: per token, per
// viewer, per online user (ownership, vision stats, visibility). Each lookup
// was a separate SELECT + sheet-JSON parse. The pass is fully synchronous, so
// a memo scoped to the enclosing withCharCache() call is safe -- it can never
// outlive the pass and serve a stale character across events.
type CharacterRecord = NonNullable<ReturnType<typeof characters.byId>>;
let charCache: Map<string, CharacterRecord | undefined> | null = null;

function charById(id: string): CharacterRecord | undefined {
  if (!charCache) return characters.byId(id);
  if (!charCache.has(id)) charCache.set(id, characters.byId(id));
  return charCache.get(id);
}

function withCharCache<T>(fn: () => T): T {
  const mine = charCache === null; // nested calls share the outermost cache
  if (mine) charCache = new Map();
  try {
    return fn();
  } finally {
    if (mine) charCache = null;
  }
}

/** Vision stats for a token: explicit override, else its character's sheet. */
export function tokenVision(token: Token): VisionStats {
  if (token.vision) return token.vision;
  if (token.characterId) {
    const ch = charById(token.characterId);
    if (ch) return systemFor(ch.system).vision(ch.sheet);
  }
  return DEFAULT_VISION;
}

/** Tokens through which a user sees on a map (owned characters, token layer). */
function viewerTokensFor(userId: string, mapTokens: Token[]): Token[] {
  return mapTokens.filter((t) => {
    if (t.layer !== 'token' || !t.characterId) return false;
    const ch = charById(t.characterId);
    return ch?.ownerUserId === userId;
  });
}

/**
 * A narrow, opt-in hint that a change can only possibly matter within a
 * bounded area — e.g. a single token's move from one hex to another. When
 * supplied to `syncMapVision`, viewers whose own tokens couldn't possibly
 * perceive anything in that area are skipped entirely (no FOV recompute, no
 * emit), instead of every online viewer of the map re-running a full FOV
 * pass on every single move. Omit it (the default) to keep the always-safe
 * "recompute for everyone" behavior, appropriate for map-wide edits (walls,
 * doors, lights, grid) where the affected area isn't a small, known region.
 */
export interface SyncVisionHint {
  /** Hexes definitely relevant to the change (e.g. a moved token's old and new hex). */
  hexes: Hex[];
  /** How far beyond `hexes` the change's effect can reach (e.g. a moving
   *  light's own dim radius) -- 0 for a plain token move with no light. */
  extraRadius?: number;
}

/** The furthest hex distance from a single viewer token that anything could
 *  ever register in its owner's FOV -- the FOV engine's own hard cutoff
 *  (`max(visionRange, darkvision)`) plus the one-hex fade rim it extends
 *  bands out to. Anything strictly beyond this, from every one of a user's
 *  viewer tokens, cannot possibly change what that user sees. */
function viewerMaxReach(stats: VisionStats): number {
  return Math.max(stats.visionRange, stats.darkvision, 0) + 1;
}

/** Conservative check: could this user's view possibly change because of a
 *  change confined to `hint`? False only when EVERY one of the user's own
 *  viewer tokens is farther than its reach (plus the hint's extra radius,
 *  e.g. a moving light's glow) from EVERY hinted hex. */
function mightAffectUser(userId: string, mapTokens: Token[], hint: SyncVisionHint): boolean {
  const extra = hint.extraRadius ?? 0;
  for (const v of viewerTokensFor(userId, mapTokens)) {
    const reach = viewerMaxReach(tokenVision(v)) + extra;
    for (const h of hint.hexes) {
      if (hexDistance({ q: v.q, r: v.r }, h) <= reach) return true;
    }
  }
  return false;
}

function loadExplored(userId: string, mapId: string): Set<number> {
  return new Set(fog.get(userId, mapId));
}

function loadDoorMemory(userId: string, mapId: string): Map<string, Door> {
  return new Map(Object.entries(doorMemory.get(userId, mapId)));
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

function scheduleDoorMemoryFlush(userId: string, mapId: string, memory: Map<string, Door>): void {
  const key = cacheKey(userId, mapId);
  const existing = doorMemoryFlushTimers.get(key);
  if (existing) clearTimeout(existing);
  doorMemoryFlushTimers.set(key, setTimeout(() => {
    doorMemoryFlushTimers.delete(key);
    doorMemory.set(userId, mapId, Object.fromEntries(memory));
  }, 3000));
}

export function flushAllVisionMemory(): void {
  for (const [key, timer] of fogFlushTimers) {
    clearTimeout(timer);
    const [userId, mapId] = key.split(':');
    const cache = visionCache.get(key);
    if (cache) fog.set(userId, mapId, Int32Array.from(cache.explored));
  }
  fogFlushTimers.clear();
  for (const [key, timer] of doorMemoryFlushTimers) {
    clearTimeout(timer);
    const [userId, mapId] = key.split(':');
    const cache = visionCache.get(key);
    if (cache) doorMemory.set(userId, mapId, Object.fromEntries(cache.doorMemory));
  }
  doorMemoryFlushTimers.clear();
}

/** Tokens a player may see: token-layer tokens on visible hexes, plus their own. */
function visibleTokens(userId: string, mapTokens: Token[], visible: Set<number>): TokenView[] {
  return mapTokens.filter((t) => {
    if (t.layer === 'gm') return false;
    if (t.characterId && charById(t.characterId)?.ownerUserId === userId) return true;
    return visible.has(packHex({ q: t.q, r: t.r }));
  });
}

/**
 * Doors the player knows about: currently observable ones (midpoint inside
 * explored/visible hexes, or within DOOR_DISCOVERY_RADIUS hexes of one of
 * their own tokens) get a fresh snapshot into `memory`; anything already in
 * `memory` from an earlier discovery is included too, so a door stays
 * visible -- in whatever state it was last actually observed in -- even
 * after the player walks back out of sight of it. Mutates `memory` in
 * place; returns whether it changed (so the caller knows to persist it).
 */
function knownDoors(
  map: MapRecord, explored: Set<number>, visible: Set<number>, viewerHexes: Hex[], memory: Map<string, Door>,
): { doors: Door[]; changed: boolean } {
  let changed = false;
  const liveIds = new Set<string>();
  for (const d of map.doors) {
    const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
    const doorHex = pixelToHex(mid, map.grid);
    const key = packHex(doorHex);
    const observable = explored.has(key) || visible.has(key) || viewerHexes.some((h) => hexDistance(h, doorHex) <= DOOR_DISCOVERY_RADIUS);
    if (!observable) continue;
    liveIds.add(d.id);
    const remembered = memory.get(d.id);
    const samePoint = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
    if (!remembered || remembered.open !== d.open || remembered.type !== d.type
      || !samePoint(remembered.a, d.a) || !samePoint(remembered.b, d.b)) {
      memory.set(d.id, d);
      changed = true;
    }
  }
  const doors: Door[] = [];
  for (const [id, snapshot] of memory) {
    doors.push(liveIds.has(id) ? map.doors.find((d) => d.id === id)! : snapshot);
  }
  return { doors, changed };
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

/**
 * The parts of a map's vision picture that don't depend on which user is
 * looking: the FOV input (walls/doors/lights, with token-light sources
 * merged in) plus the lit-hexes set and light-source polygons derived from
 * it. `syncMapVision` computes this once per map change and shares it across
 * every online viewer instead of each of them redoing identical light
 * raycasts.
 */
export interface MapVisionShared {
  fovInput: FovInput;
  lit: Set<number> | undefined;
  lightPolygons: Point[][] | undefined;
}

const SQRT3 = Math.sqrt(3);

export function buildMapVisionShared(map: MapRecord, mapTokens?: Token[]): MapVisionShared {
  const allTokens = mapTokens ?? tokens.forMap(map.id);
  // Tokens flagged as light sources contribute lights at their hex position.
  const tokenLights: Light[] = allTokens
    .filter((t) => t.light && (t.light.bright > 0 || t.light.dim > 0))
    .map((t) => {
      const px = hexToPixel({ q: t.q, r: t.r }, map.grid);
      return { id: `tl-${t.id}`, x: px.x, y: px.y, brightRadius: t.light!.bright, dimRadius: t.light!.dim };
    });
  const lights = tokenLights.length > 0 ? [...map.lights, ...tokenLights] : map.lights;
  const fovInput: FovInput = { grid: map.grid, walls: map.walls, doors: map.doors, lights };
  const isLight = map.grid.lighting === 'light';
  return {
    fovInput,
    lit: isLight ? undefined : litHexes(fovInput),
    lightPolygons: isLight ? undefined : computeLightPolygons(fovInput, map.grid.hexSize * SQRT3),
  };
}

/** Compute (and cache) a player's current view of a map. */
export function computeUserMapView(
  userId: string, map: MapRecord, mapTokens?: Token[], shared?: MapVisionShared,
): UserMapView {
  return withCharCache(() => computeUserMapViewInner(userId, map, mapTokens, shared));
}

function computeUserMapViewInner(
  userId: string, map: MapRecord, mapTokens?: Token[], shared?: MapVisionShared,
): UserMapView {
  const allTokens = mapTokens ?? tokens.forMap(map.id);
  const key = cacheKey(userId, map.id);
  let cache = visionCache.get(key);
  if (!cache || cache.mapId !== map.id) {
    cache = {
      mapId: map.id, visible: new Set(), explored: loadExplored(userId, map.id),
      doorMemory: loadDoorMemory(userId, map.id),
    };
    visionCache.set(key, cache);
  }
  const viewers = viewerTokensFor(userId, allTokens).map((t) => ({
    hex: { q: t.q, r: t.r },
    stats: tokenVision(t),
  }));
  const { fovInput, lit, lightPolygons } = shared ?? buildMapVisionShared(map, allTokens);
  // Both the hex-band and polygon computations below need each viewer's own
  // sight-blocking segments (one-way walls depend on which side the viewer
  // stands on) -- built once here and handed to both instead of each of them
  // rebuilding the identical O(walls) segment list for the same viewer.
  const segsByViewer = new Map<number, Segment[]>(
    viewers.map((v) => [packHex(v.hex), sightSegments(fovInput.walls, fovInput.doors, hexToPixel(v.hex, fovInput.grid))]),
  );
  const bands = viewers.length === 0
    ? { full: new Set<number>(), fade: new Set<number>() }
    : computeUnionFovBands(viewers, fovInput, lit, segsByViewer);
  const polyBands = viewers.length === 0 ? null : computeUnionVisibilityPolygons(viewers, fovInput, { lightPolygons, segsByViewer });
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
  const doors = knownDoors(map, cache.explored, seen, viewers.map((v) => v.hex), cache.doorMemory);
  if (doors.changed) scheduleDoorMemoryFlush(userId, map.id, cache.doorMemory);
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
    knownDoors: doors.doors,
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
 *
 * `hint`, when given, lets viewers who couldn't possibly be affected skip
 * the recompute entirely -- see `SyncVisionHint`. Leave it out for changes
 * whose reach isn't a small known area (wall/door/light/grid edits): those
 * still safely recompute for every online viewer, unchanged from before.
 */
export function syncMapVision(io: Server, campaignId: string, mapId: string, hint?: SyncVisionHint): void {
  withCharCache(() => syncMapVisionInner(io, campaignId, mapId, hint));
}

function syncMapVisionInner(io: Server, campaignId: string, mapId: string, hint?: SyncVisionHint): void {
  const campaign = campaigns.byId(campaignId);
  if (!campaign) return;
  const map = maps.byId(mapId);
  if (!map || map.campaignId !== campaignId) return;
  const allTokens = tokens.forMap(mapId);

  const sockets = campaignSockets(io, campaignId);
  const sentToUser = new Set<string>();
  // Lit hexes and light polygons don't depend on who's looking, only on the
  // map's own geometry -- computed once here (lazily, only if someone online
  // actually needs a recompute) and shared across every viewer below instead
  // of each of them re-running identical light raycasts.
  let shared: MapVisionShared | undefined;

  for (const socket of sockets) {
    const d = sdata(socket);
    // Members can be on different maps; only update viewers of THIS map.
    const effectiveUser = d.role === 'dm' ? d.viewingAs : d.userId;
    if (effectiveUser && campaigns.viewMapIdFor(campaignId, effectiveUser) !== mapId) continue;
    if (hint && effectiveUser && !mightAffectUser(effectiveUser, allTokens, hint)) continue;
    if (d.role === 'dm') {
      // God mode: DM already receives raw token/map events; only a view-as
      // preview needs a vision update.
      if (d.viewingAs) {
        shared ??= buildMapVisionShared(map, allTokens);
        const view = computeUserMapView(d.viewingAs, map, allTokens, shared);
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
    shared ??= buildMapVisionShared(map, allTokens);
    const view = computeUserMapView(d.userId, map, allTokens, shared);
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
    else if (token.characterId && charById(token.characterId)?.ownerUserId === d.userId) out.push(socket);
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
      doorMemory.set(userId, mapId, Object.fromEntries(cache.doorMemory));
      visionCache.delete(key);
    }
  }
}

/** Forget all cached vision and pending fog/door-memory flushes for a deleted map. */
export function dropMapVisionCaches(mapId: string): void {
  for (const key of [...visionCache.keys()]) {
    if (key.endsWith(`:${mapId}`)) {
      visionCache.delete(key);
      const timer = fogFlushTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        fogFlushTimers.delete(key);
      }
      const doorTimer = doorMemoryFlushTimers.get(key);
      if (doorTimer) {
        clearTimeout(doorTimer);
        doorMemoryFlushTimers.delete(key);
      }
    }
  }
}
