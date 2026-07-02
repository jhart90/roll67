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
}

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

export interface GridConfig {
  /** Center-to-corner radius of a hex, in background-image pixels. */
  hexSize: number;
  originX: number;
  originY: number;
  /** Bounds used to limit fog/vision computation, in hex counts. */
  cols: number;
  rows: number;
  /** Outdoor daylight: every hex in range with LOS is lit. */
  globalIllumination: boolean;
  /** Label for the ruler, e.g. 5 (ft per hex). */
  feetPerHex: number;
}

export interface Wall {
  id: string;
  /** Polyline; each consecutive pair of points is a blocking segment. */
  points: Point[];
}

export interface Door {
  id: string;
  a: Point;
  b: Point;
  open: boolean;
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
}

/** What players receive: geometry stripped, doors reduced to known state. */
export interface MapView extends MapMeta {
  bgUrl: string | null;
  bgWidth: number;
  bgHeight: number;
  grid: GridConfig;
}

// ---------- Tokens ----------

export type TokenLayer = 'token' | 'gm';

export interface VisionStats {
  /** Max sight distance in hexes (in lit conditions). */
  visionRange: number;
  /** Distance in hexes seen without any light. */
  darkvision: number;
}

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
  color: string;
  /** Explicit stats for NPC tokens; PC tokens derive from their character sheet. */
  vision: VisionStats | null;
  bar: { hp: number; maxHp: number } | null;
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
}

export interface Macro {
  id: string;
  name: string;
  command: string;
  sortOrder: number;
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

// ---------- Handouts ----------

export interface Handout {
  id: string;
  title: string;
  bodyMd: string;
  imageUrl: string | null;
  sharedAll: boolean;
  /** userIds; only meaningful for the DM's view. */
  sharedWith: string[];
}
