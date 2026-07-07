// Core domain types shared by server and client.

// ---------- Accounts & campaigns ----------

export type GameSystem = 'dnd5e' | 'swn';
export type Role = 'dm' | 'player';

export interface UserInfo {
  id: string;
  username: string;
}

export interface CampaignInfo {
  id: string;
  name: string;
  system: GameSystem;
  dmUserId: string;
  inviteCode: string; // only sent to the DM
  activeMapId: string | null;
}

export interface MemberInfo {
  userId: string;
  username: string;
  role: Role;
  online: boolean;
  /** The map this member is currently viewing (override or party map). */
  mapId: string | null;
  /** Custom 3D-dice color ("#rrggbb"); null = the per-die-type defaults. */
  diceColor: string | null;
  /** Custom color for the pips/numbers painted on this member's dice ("#rrggbb"); null = automatic contrast. */
  diceTextColor: string | null;
  /** Custom color for this member's presence dot + their player-controlled
   *  token names in chat ("#rrggbb"); null = a deterministic per-user default. */
  playerColor: string | null;
}

/**
 * Visual flavor for the impact animation played over a token once a
 * damage/heal roll's dice have settled — see client/src/table/impactFx.tsx.
 */
export type ImpactKind = 'melee' | 'ranged' | 'aoe' | 'heal';

// ---------- Map geometry ----------

/** Axial hex coordinate (pointy-top). */
export interface Hex {
  q: number;
  r: number;
}

/** Pixel-space point on the map image. */
export interface Point {
  x: number;
  y: number;
}

// ---------- Area-of-effect spell templates ----------

export type AoeShape = 'sphere' | 'cone' | 'line' | 'cube' | 'cylinder';

/** A shape + size an action affects, independent of where it's aimed. */
export interface AoeSpec {
  shape: AoeShape;
  /** Radius (sphere/cylinder), length (cone/line/cube), in feet. */
  sizeFt: number;
  /** Line width in feet; defaults to 5 ft if omitted. */
  widthFt?: number;
}

/**
 * Map-wide ambient lighting level (independent of individual light sources):
 * 'light' = outdoor daylight, every hex in range with LOS is lit; 'dim' =
 * needs a light source or darkvision to see past a short ambient radius
 * around each viewer; 'dark' = true darkness, only lit hexes or darkvision
 * reveal anything.
 */
export type LightingLevel = 'dark' | 'dim' | 'light';

export interface GridConfig {
  /** Center-to-corner radius of a hex, in background-image pixels. */
  hexSize: number;
  originX: number;
  originY: number;
  /** Bounds used to limit fog/vision computation, in hex counts. */
  cols: number;
  rows: number;
  /** Whether the hex grid lines are drawn; the underlying hex math (snapping,
   *  distance, vision) still applies either way. */
  gridEnabled: boolean;
  lighting: LightingLevel;
  /** Label for the ruler, e.g. 5 (ft per hex). */
  feetPerHex: number;
}

export type WallType = 'solid' | 'window' | 'oneway';

export interface Wall {
  id: string;
  /** Polyline; each consecutive pair of points is a blocking segment. */
  points: Point[];
  /**
   * solid  = blocks movement + sight (default).
   * window = blocks movement, transparent to sight.
   * oneway = blocks movement; blocks sight only from the "blocked" side.
   */
  type?: WallType;
  /** One-way walls: which side sight is blocked from. */
  flip?: boolean;
}

export type DoorType = 'door' | 'gate';

export interface Door {
  id: string;
  a: Point;
  b: Point;
  open: boolean;
  /**
   * door = blocks movement when closed, sight too (default).
   * gate = blocks movement when closed, but always see-through (open or not).
   */
  type?: DoorType;
}

export interface Light {
  id: string;
  x: number;
  y: number;
  /** Radii in hexes. */
  brightRadius: number;
  dimRadius: number;
  color?: string;
}

export interface MapMeta {
  id: string;
  name: string;
  sortOrder: number;
  /** Parent in the unified world tree (any entity id, or null = top level). */
  parentId?: string | null;
}

/** Full map definition — walls/doors/lights are DM-only over the wire. */
export interface MapDef extends MapMeta {
  bgUrl: string | null;
  bgWidth: number;
  bgHeight: number;
  grid: GridConfig;
  walls: Wall[];
  doors: Door[];
  lights: Light[];
  /** Where new tokens spawn (axial hex); null = map center. */
  spawn: Hex | null;
}

/** What players receive: geometry stripped, doors reduced to known state. */
export interface MapView extends MapMeta {
  bgUrl: string | null;
  bgWidth: number;
  bgHeight: number;
  grid: GridConfig;
  spawn?: Hex | null;
}

// ---------- Tokens ----------

export type TokenLayer = 'token' | 'gm';

export interface VisionStats {
  /** Max sight distance in hexes (in lit conditions). */
  visionRange: number;
  /** Distance in hexes seen without any light. */
  darkvision: number;
}

/** Rendered outline of a token piece. */
export type TokenShape = 'circle' | 'square' | 'triangle' | 'star' | 'rect-v' | 'rect-h';

export interface Token {
  id: string;
  mapId: string;
  characterId: string | null; // null = plain marker/decoration
  name: string;
  artUrl: string | null;
  q: number;
  r: number;
  layer: TokenLayer;
  size: number; // hex footprint radius multiplier, 1 = single hex
  shape: TokenShape;
  color: string;
  /** Explicit stats for NPC tokens; PC tokens derive from their character sheet. */
  vision: VisionStats | null;
  bar: { hp: number; maxHp: number } | null;
  /** Emits light from the token's position (radii in hexes); null = no light. */
  light: { bright: number; dim: number } | null;
}

/** Token as seen by a player (same shape; gm-layer tokens never sent). */
export type TokenView = Token;

// ---------- Characters & sheets ----------

/** Sheet payload is schema-driven; concrete fields depend on the system. */
export type SheetData = Record<string, unknown>;

export interface Character {
  id: string;
  campaignId: string;
  ownerUserId: string | null; // null = DM-controlled NPC template
  name: string;
  system: GameSystem;
  sheet: SheetData;
  /** Parent in the unified world tree (any entity id, or null = top level). */
  parentId?: string | null;
}

// ---------- Chat & dice ----------

export type ChatKind = 'say' | 'roll' | 'whisper' | 'system';

export interface DieRoll {
  sides: number;
  value: number;
  kept: boolean;
}

export interface RollBreakdown {
  expression: string;
  total: number;
  dice: DieRoll[];
  /** Human-readable expansion, e.g. "2d20kh1 (14, ~3~) + 5". */
  detail: string;
  /** Set for pass/fail rolls (e.g. a saving throw) so chat can theme the card red/green. */
  outcome?: 'success' | 'failure';
}

export interface ChatMessage {
  id: number;
  kind: ChatKind;
  fromUserId: string | null; // null = system
  fromName: string;
  text: string;
  roll: RollBreakdown | null;
  /** For whispers: usernames included. */
  recipients: string[] | null;
  at: number;
  /** DM hid this roll: players see a placeholder; the DM sees the original. */
  hidden?: boolean;
}

export interface Macro {
  id: string;
  name: string;
  command: string;
  sortOrder: number;
  /** Pill color on the toolbar. */
  color: string | null;
  /** Optional live binding to a character-sheet roll (stays current with the sheet). */
  characterId: string | null;
  rollableId: string | null;
  /** Optional binding to a combat action (usable item / attack). */
  actionId: string | null;
}

export interface RollableTableItem {
  text: string;
  weight: number;
}

export interface RollableTable {
  id: string;
  name: string;
  playersCanRoll: boolean;
  items: RollableTableItem[];
  parentId?: string | null;
}

// ---------- Initiative ----------

export interface InitiativeEntry {
  id: string;
  tokenId: string | null;
  name: string;
  value: number;
  /** Hidden entries are visible only to the DM. */
  hidden: boolean;
}

export interface InitiativeState {
  entries: InitiativeEntry[];
  turnIdx: number;
  round: number;
  active: boolean;
}

// ---------- Drawings, pings, measurement ----------

export type DrawingLayerName = 'map' | 'gm';

export type DrawingShape =
  | { kind: 'free'; points: Point[]; color: string; width: number }
  | { kind: 'line'; a: Point; b: Point; color: string; width: number }
  | { kind: 'poly'; points: Point[]; color: string; width: number; fill: boolean };

export interface Drawing {
  id: string;
  mapId: string;
  authorId: string;
  layer: DrawingLayerName;
  shape: DrawingShape;
}

export interface PingInfo {
  x: number;
  y: number;
  color: string;
  byName: string;
}

export interface MeasureInfo {
  from: Hex;
  to: Hex;
  byName: string;
  color: string;
  /** null clears the shared ruler for this user. */
  active: boolean;
}

/** A caster's AoE template as they aim it — everyone sees it live, like the measure ruler. */
export interface AoePreviewInfo {
  shape: AoeShape;
  sizeFt: number;
  widthFt?: number;
  /** Where the shape originates (the caster's hex, for cone/line/cube). */
  originHex: Hex;
  /** Where the caster is currently aiming. */
  aimHex: Hex;
  byName: string;
  color: string;
  /** false clears this user's template (they locked it in or cancelled). */
  active: boolean;
}

/** A caster's in-progress single-target selection — everyone sees the same
 *  in-range/out-of-range token highlighting the caster sees, before they click. */
export interface TargetPreviewInfo {
  sourceTokenId: string;
  rangeFt: number;
  effect: 'damage' | 'heal';
  label: string;
  byName: string;
  color: string;
  /** false clears this user's preview (they resolved or cancelled it). */
  active: boolean;
}

// ---------- Handouts ----------

export interface Handout {
  id: string;
  title: string;
  bodyMd: string;
  imageUrl: string | null;
  sharedAll: boolean;
  /** userIds; only meaningful for the DM's view. */
  sharedWith: string[];
  folderId: string | null;
  parentId?: string | null;
}

// ---------- Asset library ----------

export type FolderKind = 'art' | 'handout';

export interface AssetFolder {
  id: string;
  name: string;
  kind: FolderKind;
}

export interface AssetInfo {
  id: string;
  kind: 'map' | 'token' | 'handout' | 'audio';
  url: string;
  title: string;
  folderId: string | null;
  width: number;
  height: number;
  mime: string;
}

// ---------- Audio jukebox ----------

export interface AudioTrack {
  id: string;
  title: string;
  url: string;
}

export interface AudioState {
  trackId: string | null;
  playing: boolean;
  loop: boolean;
  volume: number;      // 0..1
  /** Server epoch ms when the current track started (for rough sync). */
  startedAt: number;
}

// ---------- Merchant / shops ----------

export interface ShopItem {
  name: string;
  price: number;
  /** Stock; -1 = unlimited. */
  qty: number;
  notes: string;
  /** Compendium entry id: buying applies its full logic (attack/spell/usable). */
  contentId?: string;
  /** Custom usable items (no contentId): applied to the buyer's inventory. */
  effect?: 'heal' | 'damage';
  amount?: string;
  range?: number;
}

export interface Shop {
  id: string;
  name: string;
  description: string;
  /** Display label for the price column (e.g. "gp", "credits"). */
  currency: string;
  playersCanBuy: boolean;
  items: ShopItem[];
  parentId?: string | null;
}

// ---------- Locations ----------

export type LocationKind = 'region' | 'settlement' | 'district' | 'building' | 'poi';

export interface LocationNode {
  id: string;
  name: string;
  kind: LocationKind;
  notes: string;
  parentId: string | null;
  visibleToPlayers: boolean;
  npcIds: string[];
  shopIds: string[];
  handoutIds: string[];
}

// ---------- World folders (pure organization; no game behavior) ----------

export interface WorldFolder {
  id: string;
  name: string;
  parentId: string | null;
}
