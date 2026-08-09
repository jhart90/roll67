// Core domain types shared by server and client.

import type { PlayingCard } from './systems/cards.js';

// ---------- Accounts & campaigns ----------

export type GameSystem = 'dnd5e' | 'swn' | 'swade';
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
  /** SWADE colors dice by their role in the roll rather than by die size, so
   *  it gets its own palette. Null in any slot = that role's default. */
  diceTraitColor: string | null;
  diceWildColor: string | null;
  diceRaiseColor: string | null;
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
  /** SWADE blast templates are sized in TILES, not feet: the number of rings
   *  beyond the targeted tile (Small=1, Medium=3, Large=5, i.e. 2/4/6 tiles
   *  counting the target). When set it overrides sizeFt, and membership is
   *  exact hex distance — the same tiles on every map whatever a hex is
   *  worth in feet. */
  sizeHexes?: number;
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
export type LightingLevel = 'dark' | 'dim' | 'light' | 'pitch';

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
  /** Hex-line color (#rrggbb); default white. */
  gridColor?: string;
  /** Hex-line opacity 0–1; default 0.16. */
  gridOpacity?: number;
  lighting: LightingLevel;
  /** Label for the ruler, e.g. 5 (ft per hex). */
  feetPerHex: number;
}

export type WallType = 'solid' | 'window' | 'oneway' | 'stainedglass';

export interface Wall {
  id: string;
  /** Polyline; each consecutive pair of points is a blocking segment. */
  points: Point[];
  /**
   * solid  = blocks movement + sight (default).
   * window = blocks movement, transparent to sight.
   * oneway = blocks movement; blocks sight only from the "blocked" side.
   * stainedglass = like window (blocks movement, transparent to sight) but
   *   tints any light that passes through it.
   */
  type?: WallType;
  /** One-way walls: which side sight is blocked from. */
  flip?: boolean;
  /** Stained glass: the tint color applied to light passing through.
   *  Ignored for other wall types. */
  glassColor?: string;
  /** Stained glass: if true, projects a rainbow fan instead of a single color. */
  rainbow?: boolean;
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
  /** Locked doors/gates refuse a player's TOGGLE_DOOR unless they hold a
   *  matching key item; the DM can always toggle regardless. */
  locked?: boolean;
  /** Inventory item name (case-insensitive) required to unlock -- "Key" by
   *  default represents a generic key; a DM can name a specific item instead. */
  keyName?: string | null;
}

export interface Light {
  id: string;
  name?: string;
  x: number;
  y: number;
  /** Radii in hexes. */
  brightRadius: number;
  dimRadius: number;
  color?: string;
}

/**
 * A label the DM paints onto the map — a room name, a warning, a signpost.
 * Persistent map furniture like walls, but unlike walls it is meant to be READ,
 * so players receive it too.
 */
export interface MapText {
  id: string;
  /** Anchor in background-image pixels; the text is centred on it. */
  x: number;
  y: number;
  text: string;
  /** Font size in map pixels, so labels zoom with the map. */
  size: number;
  color: string;
  font: string;
  bold?: boolean;
  italic?: boolean;
}

export interface MapMeta {
  /** A scene is a map every player sees in full — no fog, no vision checks.
   *  The DM stages it by moving pieces from the GM layer, which fades them in. */
  isScene?: boolean;
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
  /** Packed hex keys painted as rough terrain. */
  terrain: number[];
  texts: MapText[];
}

/** What players receive: geometry stripped, doors reduced to known state. */
export interface MapView extends MapMeta {
  bgUrl: string | null;
  bgWidth: number;
  bgHeight: number;
  grid: GridConfig;
  spawn?: Hex | null;
  /** Packed hex keys painted as rough terrain. */
  terrain: number[];
  /** Labels are for reading, so players get them too. */
  texts: MapText[];
}

/** A DM counter: a giant segmented banner bar pinned to a map pane's top or
 *  bottom edge (doom clock, ritual progress, fortress HP). Hidden from
 *  players until the DM shows it; the DM alone edits and increments it. */
export interface Counter {
  id: string;
  campaignId: string;
  mapId: string;
  name: string;
  /** Fill color of the completed segments. */
  color: string;
  /** Total increments. */
  max: number;
  /** Filled increments. */
  value: number;
  visible: boolean;
  position: 'top' | 'bottom';
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
/** 'original' shows the uploaded art at its own aspect ratio, scaled so its
 *  WIDTH spans one hex; 'original-alt' scales so its HEIGHT spans one hex. */
export type TokenShape = 'circle' | 'square' | 'triangle' | 'star' | 'hexagon' | 'rect-v' | 'rect-h' | 'original' | 'original-alt';

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
  /** When this token was moved onto the visible layer. Players fade it in over
   *  REVEAL_FADE_MS from this moment; null once the fade is ancient history. */
  revealedAt?: number | null;
  /** Emits light from the token's position (radii in hexes); null = no light. */
  light: { bright: number; dim: number; color?: string } | null;
}

/** Token as seen by a player (same shape; gm-layer tokens never sent). */
/** The public face of a character, shown when someone selects a token they
 *  do not control. Computed server-side: players never receive other
 *  players' sheets, so it cannot be derived on the client. */
/** What each descriptive line IS, so the nameplate can style it: a rank or
 *  level badge, the character's concept, or where they come from. */
export type NameplateLineKind = 'rank' | 'concept' | 'origin';
export interface NameplateLine { text: string; kind: NameplateLineKind }

export interface TokenNameplate {
  name: string;
  portraitUrl: string | null;
  color: string;
  lines: NameplateLine[];
}

export type TokenView = Token & { nameplate?: TokenNameplate | null };

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
  /** This die aced (rolled its max on an exploding die) and spawned the die
   *  immediately after it. Drives the sequenced roll-flash-roll animation. */
  ace?: boolean;
  /** Bonus die earned by a SWADE raise (beating the target number by 4+).
   *  Rendered in raise green so it reads as earned, not part of the base. */
  raise?: boolean;
  /** A Wild Die — the second arm of SWADE's `best(trait!, 1d6!)`. Rendered in
   *  the roller's own colour so the two arms are told apart by hue rather than
   *  by dimming the loser, which would spoil aces that have yet to be thrown. */
  wild?: boolean;
  /** Which arm of a `best(...)` this die belongs to. Lets the renderer work out
   *  the moment a losing arm can no longer catch up, and grey it out only then.
   *  Nested `best()` calls report the outermost arm. */
  arm?: number;
}

export interface RollBreakdown {
  expression: string;
  total: number;
  dice: DieRoll[];
  /** Human-readable expansion, e.g. "2d20kh1 (14, ~3~) + 5". */
  detail: string;
  /** Set for pass/fail rolls (e.g. a saving throw) so chat can theme the card red/green. */
  outcome?: 'success' | 'failure';
  /** Itemized sources of every flat modifier folded into this roll —
   *  wounds, fatigue, conditions, and situational tags — so chat tooltips
   *  can explain the math instead of guessing. */
  modWhy?: string[];
  /** IronDice provenance: keystream index + the seed commitment published
   *  before this roll was thrown, so the card is independently verifiable. */
  iron?: { idx: number; commit: string };
}

export interface ChatMessage {
  id: number;
  kind: ChatKind;
  fromUserId: string | null; // null = system
  fromName: string;
  /** Set when the message came from a character rather than the account:
   *  chat shows "Character (Player)". Null for plain talk and system lines. */
  fromCharacter?: string | null;
  /** The action this message is about (a weapon, spell or power). Rendered as
   *  a hoverable term, so it stays out of . */
  actionName?: string | null;
  /** Why it landed or not — drawn under the dice, not in the headline. */
  outcomeNote?: string | null;
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
  /** SWADE card mode: the action card this combatant drew. */
  card?: PlayingCard;
  /** SWADE: holding their action to act later in the round. */
  held?: boolean;
  /** Who controls this combatant, resolved server-side from the token's
   *  character. Players cannot look this up themselves - they only receive
   *  their own sheets - so it rides along on the entry. Null for NPCs. */
  ownerUserId?: string | null;
  ownerName?: string | null;
  /** The token's colour — what the turn banner wears, so a DM-run combatant
   *  gets its own identity rather than a default grey. */
  color?: string | null;
  /** SWADE card mode: draw order (earlier draw wins rank ties). */
  drawSeq?: number;
}

/** SWADE card mode: a combatant who still owes a draw. */
/** A combatant who still owes their own initiative — a SWADE card draw, or
 *  a d20/2d6 roll in the systems that roll for it. Identical either way. */
export interface PendingInitiative {
  tokenId: string;
  name: string;
  /** The player who resolves this one; null = the DM does (NPCs). */
  ownerUserId: string | null;
  /** Hidden (GM-layer) token — its eventual entry stays DM-only. */
  hidden: boolean;
}

/** Historical name kept for the SWADE card path. */
export type PendingCardDraw = PendingInitiative;

export interface InitiativeState {
  entries: InitiativeEntry[];
  turnIdx: number;
  round: number;
  active: boolean;
  /** SWADE action-deck mode (deal cards instead of rolling). */
  cardMode?: boolean;
  /** Server-only: the shuffled cards still in the deck. Stripped before
   *  sending to ANY client (see initiativeViewFor) — clients get deckRemaining. */
  deck?: PlayingCard[];
  /** How many cards are left in the deck (client-facing). */
  deckRemaining?: number;
  /** Combatants who haven't drawn yet this deal. */
  pendingDraws?: PendingCardDraw[];
  /** A Joker hit the table this round — the deck reshuffles before the next. */
  jokerDealt?: boolean;
  /** Server-only counter behind each entry's drawSeq. */
  drawCounter?: number;
  /** Non-card systems: combatants the DM has called on who still owe their
   *  own initiative roll. Each player rolls for their own character. */
  pendingRolls?: PendingInitiative[];
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
  sizeHexes?: number;
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

/**
 * One filled square of the DM's 4x4 soundboard. Empty squares simply have no
 * entry, so the grid is rebuilt by indexing rather than by padding.
 */
export interface SoundboardSlot {
  slotIndex: number;   // 0..15
  label: string;
  url: string;
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
  /** Walking merchant: links this shop to a character token. */
  linkedCharacterId?: string | null;
  /** Custom art for the shop when placed on the map. */
  artAssetId?: string | null;
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

// ---------- Loot items ----------

export interface LootItem {
  id: string;
  name: string;
  description: string;
  /** Links to a compendium or custom item entry for full apply-on-take logic. */
  contentId?: string;
}

// ---------- World folders / chests ----------

export interface WorldFolder {
  id: string;
  name: string;
  parentId: string | null;
  /** Item contents for chest-folders (compendium-linked or plain). */
  items: LootItem[];
  /** Visual kind: 'folder' for organization, 'chest' for map-placeable containers. */
  displayKind: 'folder' | 'chest';
  /** Custom art for the chest on the map. */
  artAssetId: string | null;
}
