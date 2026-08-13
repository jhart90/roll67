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
  /** How often this member's dice carom off a wall, 0-100. Null = the default.
   *  Travels with the roller, not the watcher, so a player's dice throw the
   *  same way on every screen at the table. */
  diceBouncePct: number | null;
  /** How this member's aced dice celebrate. Null = the default. Rides with the
   *  roller for the same reason the colours and the bounce do. */
  diceAceStyle: AceStyle | null;
}

/** Share of dice that bounce off a wall when a player hasn't chosen. */
export const DICE_BOUNCE_PCT_DEFAULT = 33;

/** How an exploding die announces itself when it aces. */
export const ACE_STYLES = ['flash', 'explosion', 'flames', 'disco', 'rainbow', 'smoke', 'water', 'confetti'] as const;
export type AceStyle = (typeof ACE_STYLES)[number];
export const ACE_STYLE_DEFAULT: AceStyle = 'flash';

export function isAceStyle(v: unknown): v is AceStyle {
  return typeof v === 'string' && (ACE_STYLES as readonly string[]).includes(v);
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
  /** Packed hex keys painted as INACCESSIBLE — a chasm, lava, deep water.
   *  No token may stand here, DM's included: it is scenery, not cover. */
  blocked: number[];
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
  /** Packed hex keys painted as INACCESSIBLE — a chasm, lava, deep water.
   *  No token may stand here, DM's included: it is scenery, not cover. */
  blocked: number[];
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
  /** The master switch. False hides it from every player regardless of
   *  `sharedWith`; the DM always sees their own counters either way. */
  visible: boolean;
  /** Who it is shared with once `visible` is on. Null means the whole table —
   *  the ordinary case, and what every counter created before this field
   *  existed does. A list names the only players who get it, which is how the
   *  DM runs a clock one faction can see and the rest cannot. An empty list is
   *  therefore "nobody", distinct from null. */
  sharedWith: string[] | null;
  /** Which edge of the map pane it docks to. Top and bottom are full-width
   *  banners; left and right are narrow columns down the sides, kept clear of
   *  the tool rail, the chat dock, and the bottom pill/Benny/Keyring row. */
  position: CounterPosition;
}

/** Whether a counter reaches one player, ignoring whether they know its map. */
export function counterSharedWith(c: Counter, userId: string): boolean {
  if (!c.visible) return false;
  return c.sharedWith === null || c.sharedWith.includes(userId);
}

export const COUNTER_POSITIONS = ['top', 'bottom', 'left', 'right'] as const;
export type CounterPosition = (typeof COUNTER_POSITIONS)[number];

export function isCounterPosition(v: unknown): v is CounterPosition {
  return typeof v === 'string' && (COUNTER_POSITIONS as readonly string[]).includes(v);
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
  /** Condition ids to badge over the token, mirrored from the linked
   *  character's sheet. On the TOKEN rather than read from the sheet because
   *  a player is not sent other people's sheets, and being able to see that
   *  the ogre is Shaken is the whole point of the badge. */
  conditions?: string[] | null;
  /** The DM has marked this token as something that can be ridden. Nothing is
   *  mountable by default: a mount is a deliberate designation, not a property
   *  every token quietly has. */
  mountable?: boolean;
  /** For a RIDER: the token carrying them. They share its hex, move where it
   *  moves, and cannot walk off on their own until they dismount. */
  mountedOn?: string | null;
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
 *  level badge, a standing (SWADE's Wild Card / Extra), the character's
 *  concept, or where they come from. */
export type NameplateLineKind = 'rank' | 'status' | 'concept' | 'origin';
export interface NameplateLine { text: string; kind: NameplateLineKind }

/** A named trait shown as a pill on the nameplate: the name is always on
 *  show, the description only on hover. */
export interface NameplatePill {
  name: string;
  /** Rules text for the hover popover. Empty when the row carried no note. */
  desc: string;
  kind: 'edge' | 'hindrance';
}

/** The longest a Concept may be. Sized so it cannot outrun three lines of the
 *  nameplate's body column, which is what the card reserves for it — a longer
 *  one used to push the origin line out of the card entirely. Enforced by the
 *  sheet renderer and the creation wizards; the nameplate also line-clamps, so
 *  characters written before the cap still render inside their box. */
export const CONCEPT_MAX_LEN = 100;

export interface TokenNameplate {
  name: string;
  portraitUrl: string | null;
  color: string;
  lines: NameplateLine[];
  /** Edges and Hindrances, for systems that have them. */
  pills: NameplatePill[];
  /** SWADE: is this a Wild Card? Rides on the token so the client can grey out
   *  Extras when aiming something that only Wild Cards can receive, without
   *  ever being handed their sheet. Absent for systems with no such idea. */
  wildCard?: boolean;
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

/**
 * A character-sheet card posted into the chat log.
 *
 * Carried structured rather than flattened into a sentence: a weapon's stats
 * are a dozen short facts, and "Shooting · 2d6!+1 · kinetic · Range ft 60 · …"
 * is a wall of text that nobody reads mid-fight. The chat log renders this
 * with the card's own styling, minus the controls — there is nothing on a
 * posted card to tick, edit or reorder.
 */
export interface SheetCard {
  /** The item's name — the card's title. */
  name: string;
  /** Chips in the order the card shows them, each with the tone that
   *  colours it (see ChipTone in the sheet renderer). */
  chips: { text: string; tone: string }[];
  /** Free-text lines below the chips. */
  notes: string[];
  /** Card theme: 'card-good' (edges), 'card-bad' (hindrances),
   *  'card-info' (racial traits). Absent for a plain card. */
  theme?: string;
}

/**
 * What the banner over the map says while this roll's dice are in the air:
 * what is being rolled, and a tone to colour it by. WHO is rolling comes from
 * the message itself — the character, or the account for a bare /r.
 *
 * Set by whichever handler knows what the roll MEANS. A roll that sets none
 * still gets a banner: the client falls back to the dice expression, so the
 * table always learns who is rolling and what for.
 */
export type RollCalloutTone =
  | 'attack' | 'damage' | 'save' | 'trait' | 'recover' | 'fear' | 'benny' | 'initiative' | 'neutral';
export interface RollCalloutInfo { what: string; tone?: RollCalloutTone }

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
  /** A sheet card shown in the log instead of `text` (which stays as the
   *  plain-text fallback for search and for anything that can't render it). */
  card?: SheetCard | null;
  /** The banner shown over the map while this roll's dice are animating. */
  callout?: RollCalloutInfo | null;
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

/** How many playlists a campaign gets, and how many tracks fit in each. */
export const PLAYLIST_COUNT = 3;
export const PLAYLIST_SIZE = 7;

export interface AudioTrack {
  id: string;
  title: string;
  url: string;
  /** Which playlist tab it lives on, 0-based. */
  playlist: number;
}

export interface AudioState {
  trackId: string | null;
  playing: boolean;
  /** Wrap to the top of the playlist at the end instead of falling silent. */
  loop: boolean;
  /** Pick the next track at random rather than in order. */
  shuffle: boolean;
  /** Which playlist is being played through. */
  playlist: number;
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
  /** A briefing image players see above the stock, like a handout. Its text
   *  half is `description`, which the storefront already shows. */
  detailAssetId?: string | null;
  /** Server-resolved URL for that asset (uploads carry an extension). */
  detailUrl?: string | null;
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
  /** How many are in the pile. Absent or 1 = a single item; taking one
   *  decrements rather than emptying the chest. Mirrors a shop's stock so the
   *  DM stocks both the same way. */
  qty?: number;
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
