import { create } from 'zustand';
import {
  C2S, S2C, castableLevels, combatActions, systemFor,
  type AoeBurstPayload, type AoePreviewShownPayload, type AoeShape, type CampaignInfo, type CampaignStatePayload, type Character, type ChatMessage,
  type CombatAction, type CustomItem, type CustomNpcView, type DieRoll, type DirectoryPayload, type HpFloatPayload, type ImpactKind,
  type Door, type DoorType, type Drawing, type DrawingLayerName, type GameSystem, type GridConfig, type Handout, type Hex,
  type InitCardDrawnPayload, type InitiativeState, type Light, type LootItem, type Macro, type MapEditedPayload, type MapMeta, type MapObject,
  type AssetFolder, type AssetInfo, type AudioState, type AudioTrack,
  type LocationNode, type MapStatePayload, type MapView, type MeasureShownPayload,
  type DiceRole, type MemberInfo, type MemberPresencePayload, type PingShownPayload, type Point, type ProjectilePayload, type RollableTable, type AceStyle, type BennyStatePayload, type BennyUseId, type BlastChoice, type BlastOfferClosedPayload, type BlastOfferPayload, type BleedPromptPayload, type StunPromptPayload, type IncapPromptPayload, type Counter, type CountersPayload, type DmNotesPayload, type PrivateNotesPayload, type IronDicePayload, type PublicSheetPayload, type RollStatsPayload, type RoundCardsPayload, type RunPromptPayload, type ShakenPromptPayload, type SfxPlayPayload, type Shop, type SoakOfferPayload, type SoundboardPayload, type SoundboardSlot,
  type SheetData, type VisibilityLitMask,
  type TableResultPayload, type TargetPreviewShownPayload,
  type TokenView, type VisionStats, type VisionUpdatePayload, type Wall, type WorldFolder, type YouArePayload,
  type FearSource, type SheetCard, type RollCalloutPayload, type RollCalloutTone, type CrawlPromptPayload, type AftermathPromptPayload, type ClockPayload, type TimeStepId, type HealingPromptPayload, type BennyFlipPayload, type KnownWallSegment, reachableAlong, packHex,
  blastSoundClip, blastSoundVolume,
} from 'shared';
import { connectSocket, socket } from '../socket';
import { readMapColors, readTheme, saveMapColors, saveTheme, type MapColors, type UiTheme } from '../util/appearance';
import { closeWindow, openWindow, useWindowManager } from './windowManager';
import { BENNY_FLIP_MS, estimateDiceAnimMs } from '../table/dice3d';

/**
 * Serialized chat pipeline.
 *
 * A single action can produce several rolls back to back — an attack and then
 * its damage. Each needs the screen to itself: playing them at once (or worse,
 * letting the second replace the first mid-throw) means nobody can read either.
 * So dice animations run one at a time, and every chat entry — roll or not —
 * waits its turn, which keeps the log from getting ahead of the dice and
 * spoiling a result that is still bouncing around on screen.
 */
/**
 * A following ROLL waits this long after the previous one's dice have landed.
 * Long, deliberately: an attack and its damage are two separate results and
 * the table needs to read the first before the second starts throwing.
 */
const ROLL_TO_ROLL_GAP_MS = 3000;
/**
 * Everything else — a projectile, a chat line — waits this much instead. It
 * only has to clear the dice, not give them time to be read.
 */
const POST_ROLL_GAP_MS = 1000;
/**
 * How long a finished roll's dice linger before the overlay clears them. Sits
 * above ROLL_TO_ROLL_GAP_MS so a roll that ends a sequence stays readable
 * rather than vanishing the moment the gap elapses.
 */
const OVERLAY_LINGER_MS = 4000;

type DiceAnimState = NonNullable<GameState['diceAnim']>;
type QueueItem = {
  append: () => void;
  roll?: { id: number; dice: DieRoll[]; anim: DiceAnimState };
};

const chatQueue: QueueItem[] = [];
let activeRoll: QueueItem | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let gapTimer: ReturnType<typeof setTimeout> | null = null;
/** When the last roll's dice finished landing; the gaps are measured from it. */
let lastRollEndedAt = 0;
/**
 * Anim ids with a MOUNTED overlay still animating them. The fallback timer
 * consults this before finishing a roll: while the overlay is demonstrably
 * alive it is the sole authority on when its dice have landed, so a stale or
 * miscomputed estimate can never cut a chain off mid-air. The fallback only
 * ever acts when no overlay exists to report (hidden window, unmounted view).
 */
const liveOverlays = new Set<number>();
export function overlayMounted(id: number): void { liveOverlays.add(id); }
export function overlayUnmounted(id: number): void { liveOverlays.delete(id); }

function pumpChatQueue(): void {
  if (activeRoll) return; // a roll is still on screen
  const next = chatQueue[0];
  if (!next) return;
  // Measured against the clock rather than a one-shot timer, so an item that
  // arrives during the gap still waits its turn instead of jumping the queue.
  const wait = lastRollEndedAt + (next.roll ? ROLL_TO_ROLL_GAP_MS : POST_ROLL_GAP_MS) - Date.now();
  if (wait > 0) {
    if (gapTimer === null) {
      gapTimer = setTimeout(() => { gapTimer = null; pumpChatQueue(); }, wait);
    }
    return;
  }
  chatQueue.shift();
  if (!next.roll) {
    // Nothing to animate, so it lands now and we keep draining until we hit a
    // roll or run dry.
    next.append();
    pumpChatQueue();
    return;
  }
  activeRoll = next;
  useGameStore.setState({ diceAnim: next.roll.anim, diceAnimEnding: false });
  // The overlay reports the true finish via diceAnimationFinished(); this only
  // covers the case where no overlay is mounted to report back.
  const animMs = estimateDiceAnimMs(next.roll.dice);
  fallbackTimer = setTimeout(() => finishRoll(next.roll!.id), animMs + 500);
}

function finishRoll(id: number): void {
  if (activeRoll?.roll?.id !== id) return; // already finished, or not the active one
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  const done = activeRoll;
  activeRoll = null;
  lastRollEndedAt = Date.now();
  done.append(); // the dice have landed, so the total is safe to show
  setTimeout(() => {
    const cur = useGameStore.getState();
    if (cur.diceAnim?.id === id) useGameStore.setState({ diceAnim: null });
  }, OVERLAY_LINGER_MS);
  // pump works out how long this particular next item has to wait.
  pumpChatQueue();
}

/** Called by the dice overlay once a roll's animation has fully played. */
export function diceAnimationFinished(id: number): void {
  finishRoll(id);
}

/** Drop anything queued — used when leaving a room so stale rolls don't fire. */
function resetChatQueue(): void {
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
  chatQueue.length = 0;
  activeRoll = null;
  lastRollEndedAt = 0;
}

export type Tool = 'select' | 'wall' | 'door' | 'light' | 'draw' | 'measure' | 'erase' | 'ping' | 'spawn' | 'loot' | 'terrain' | 'text';
export type DockTab = 'chat' | 'initiative' | 'world';

/** What a Called Shot is aimed at, chosen before the roll goes out. */
export type CalledShotAim = { label: string; penalty: number; damageBonus?: number };
/** Declared before a target is picked; the part's Scale needs the defender. */
export const CALLED_SHOT_PENDING = 'pending' as const;

/** A piece on the current map, named the way the World pane finds it: either a
 *  token, or one of the chest/shop/prop objects. Null = this row has nothing
 *  on the map. */
export type MapTarget = { kind: 'token' | 'object'; id: string } | null;

export type TerrainBrush = 'brush' | 'rect' | 'circle';

export interface HpFloat { id: number; tokenId: string; delta: number; kind?: ImpactKind; damageType?: string }
export interface Projectile { id: number; fromTokenId: string; toTokenId: string; damageType?: string; flightMs: number }

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface DmGeometry {
  walls: Wall[];
  doors: Door[];
  lights: Light[];
}

interface GameState {
  connected: boolean;
  you: YouArePayload | null;
  campaign: CampaignInfo | null;
  members: MemberInfo[];
  characters: Character[];
  mapsMeta: MapMeta[];
  handoutList: Handout[];
  macroList: Macro[];
  tableList: RollableTable[];
  assetFolders: AssetFolder[];
  assetList: AssetInfo[];
  audioTracks: AudioTrack[];
  audioState: AudioState;
  /** DM soundboard grid; only filled squares are present. DM-only. */
  soundboardSlots: SoundboardSlot[];
  shopList: Shop[];
  locationList: LocationNode[];
  worldFolderList: WorldFolder[];
  /** Manual world-tree sibling ordering: "kind:id" → rank (unranked sort last). */
  worldSort: Record<string, number>;
  customNpcs: CustomNpcView[];
  customItems: CustomItem[];
  /** Shop the DM is presenting to this viewer (players pop a storefront). */
  presentedShopId: string | null;
  closePresentedShop(): void;
  directory: DirectoryPayload | null;
  initiativeState: InitiativeState;
  chatLog: ChatMessage[];

  map: MapView | null;
  dmGeometry: DmGeometry | null;
  tokens: Record<string, TokenView>;
  drawingList: Drawing[];
  /** null = god mode (no fog). */
  visible: Set<number> | null;
  /** Fading rim one hex past vision range. */
  fade: Set<number> | null;
  /** Smooth wall-accurate fog edge, one polygon per viewer token; null falls back to hex punching. */
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
  /** Under 'dark'/'dim' lighting, what's lit within visiblePolygons/fadePolygons -- null under 'light' (the whole polygon counts). */
  visibleLitMask: VisibilityLitMask | null;
  fadeLitMask: VisibilityLitMask | null;
  explored: Set<number> | null;
  /** Append-only log of every explored hex key in arrival order — same content
   *  as `explored`, but growable in place (reference stays stable), so
   *  FogCanvas can draw ONLY the newly-revealed hexes into its cached mask
   *  instead of re-issuing a path command for every hex ever explored (which
   *  measured ~600ms per reveal at ~10k explored hexes). Replaced wholesale
   *  (fresh reference) only on map switch/join — FogCanvas's full-rebuild cue. */
  exploredLog: number[] | null;
  knownDoors: Door[];
  /**
   * The parts of walls this player has discovered, clipped to explored ground
   * by the server. Never the whole map's geometry — a client holding that
   * could read the unexplored dungeon out of its own memory. Enough, though,
   * to stop your own token at a wall you already know about.
   */
  knownWalls: KnownWallSegment[];
  mapObjects: Record<string, MapObject>;
  /** Map object whose popup/inspector is open (click on item/chest). */
  lootPopupId: string | null;
  /** Map object whose DM edit inspector is open (right-click). */
  inspectedObjectId: string | null;
  openObjectInspector(id: string | null): void;
  /** SWADE: the just-drawn action card, for the flip animation overlay. */
  cardDrawFlash: (InitCardDrawnPayload & { seq: number }) | null;
  clearCardFlash(): void;
  /** Which of the right-hand dock's tabs is showing. Lives in the store
   *  (rather than local component state) so any dice-producing action,
   *  wherever it's triggered from, can jump the user to Chat to see it land. */
  dockTab: DockTab;
  setDockTab(tab: DockTab): void;
  /** Guided character-creation wizard (SWADE/SWN): open, and a one-shot
   *  guard so the auto-open-for-a-new-player effect only fires once per
   *  campaign join, not on every store update while it's deciding. */
  showCharacterCreator: boolean;
  setShowCharacterCreator(show: boolean): void;
  characterCreatorPrompted: boolean;
  setCharacterCreatorPrompted(prompted: boolean): void;
  viewingAs: string | null;
  dragGhosts: Record<string, { x: number; y: number }>;
  /**
   * Where a token is because YOU just moved it, before the server has said
   * so. Every move used to wait a full round trip before the token budged,
   * which on a slow connection reads as the app ignoring you. The prediction
   * is authoritative on screen only until the echo arrives — the server
   * always wins, and a move it refuses (a wall, not your turn) snaps back
   * when the guard below expires.
   */
  predictedMoves: Record<string, { q: number; r: number }>;
  pings: Array<PingShownPayload & { id: number }>;
  measures: Record<string, MeasureShownPayload>;
  /** Everyone's currently-aimed AoE templates, keyed by caster's userId. */
  aoePreviews: Record<string, AoePreviewShownPayload>;
  /** Everyone's in-progress single-target selections, keyed by caster's userId. */
  targetPreviews: Record<string, TargetPreviewShownPayload>;
  errorToast: string | null;
  /** Whether the toast is bad news or just news. Errors are red; an 'info'
   *  toast reports something that WORKED and should not look like a fault. */
  toastKind: 'error' | 'info';
  /** Say something to this user, in the app. Replaces alert(): a native dialog
   *  blocks the whole page, cannot be styled, and on a second monitor can pop
   *  somewhere they are not even looking. */
  toast(message: string, kind?: 'error' | 'info'): void;
  /** Live 3D dice animation for the latest roll. */
  diceAnim: {
    id: number; dice: DieRoll[]; byName: string; byUserId: string | null; total: number; expression: string;
    /** The banner over the map: who is rolling, what for, and its colour. */
    who: string; what: string; tone: RollCalloutTone;
  } | null;
  /** True once the settled dice have had their sit time and may fade out. */
  diceAnimEnding: boolean;
  /** SWADE: your Wild Card just took wounds it may Soak with a Benny. */
  soakOffer: SoakOfferPayload | null;
  /** SWADE: a live grenade landed on one of yours — throw it back, or on it. */
  blastOffer: BlastOfferPayload | null;
  /** SWADE: your Shaken character may roll Spirit to recover. */
  shakenPrompt: ShakenPromptPayload | null;
  /** SWADE: that move needs the running die — confirm or decline. */
  runPrompt: RunPromptPayload | null;
  /** A prone character is trying to move: stand up, or stay down and crawl? */
  crawlPrompt: CrawlPromptPayload | null;
  /** DM-only: the fight ended with Extras on the floor. Roll for them? */
  aftermathPrompt: AftermathPromptPayload | null;
  /** In-world elapsed seconds — what the GM's time controls move. */
  clockSeconds: number;
  /** DM-only: who is due a natural healing roll after days passed. */
  healingPrompt: HealingPromptPayload | null;
  /** SWADE: your Bleeding Out character owes their start-of-turn Vigor roll. */
  bleedPrompt: BleedPromptPayload | null;
  /** SWADE: your Stunned character may roll Vigor to come to. */
  stunPrompt: StunPromptPayload | null;
  /** SWADE: your Wild Card went down — Soak, or face the Incapacitation roll. */
  incapPrompt: IncapPromptPayload | null;
  /** SWADE round 2+ auto-deal awaiting its sequenced flip reveal. */
  roundCardsDeal: (RoundCardsPayload & { seq: number }) | null;
  /** DM counters on the current map (players receive only visible ones). */
  counters: Counter[];
  /** Every counter in the campaign (for the world tree), role-filtered. */
  allCounters: Counter[];
  /** My own private notes per character (each user only ever gets their own). */
  privateNotesData: Record<string, string>;
  /** DM-only: secret notes per character (DM clients only ever receive these). */
  dmNotesData: Record<string, string>;
  /** Public-facing sheets fetched for tokens we don't control. */
  publicSheets: Record<string, PublicSheetPayload>;
  /** IronDice public state: active seed commitment + revealed history. */
  ironDice: IronDicePayload | null;
  /** Lifetime roll stats keyed by scope: 'account' or a characterId. */
  rollStatsData: Record<string, RollStatsPayload>;
  /** SWADE: per-character flags for which Benny rerolls are currently live. */
  bennyState: Record<string, BennyStatePayload>;
  /** In-progress combat action awaiting a target selection. */
  targeting: { characterId: string; sourceTokenId: string; action: CombatAction; adv: 'adv' | 'dis' | null; rof?: number; calledShot?: CalledShotAim | typeof CALLED_SHOT_PENDING | null } | null;
  /** In-progress AoE spell awaiting the caster to aim + lock in a shape. */
  aoeTargeting: { characterId: string; sourceTokenId: string; action: CombatAction; adv: 'adv' | 'dis' | null; originHex: Hex; aimHex: Hex } | null;
  /** Floating +/-HP combat text over tokens. */
  floats: HpFloat[];
  /** In-flight ranged shots (arrow/bolt/etc.), timed to land as their matching float appears. */
  projectiles: Projectile[];
  /** An AoE spell's detonation (projectile + burst for sphere/cylinder, a
   *  ripple for cone), timed to play once its damage roll settles. */
  aoeBursts: Array<{
    id: number; shape: AoeShape; sizeFt: number; widthFt?: number; originHex: Hex; aimHex: Hex;
    damageType?: string; flightMs: number;
  }>;
  /** On-screen rollable-table result pills (fade out after ~3s). */
  tableToasts: Array<{ id: number; text: string; color: string }>;
  beginTargeting(characterId: string, sourceTokenId: string, action: CombatAction, adv: 'adv' | 'dis' | null, rof?: number, calledShot?: CalledShotAim | typeof CALLED_SHOT_PENDING | null): void;
  cancelTargeting(): void;
  resolveTarget(targetTokenId: string): void;
  beginAoeTargeting(characterId: string, sourceTokenId: string, action: CombatAction, adv: 'adv' | 'dis' | null): void;
  updateAoeAim(hex: Hex): void;
  cancelAoeTargeting(): void;
  /** Pass true/false to answer the cook prompt; omit to be asked. */
  confirmAoeTargeting(cook?: boolean): void;
  cookPrompt: { label: string } | null;
  /** Set from the door editor's "create a new key" so the DM lands in the Key Manager. */
  keyManagerOpen: boolean;
  /** Pending spell cast awaiting a slot-level choice. */
  castPrompt: { characterId: string; rollableId: string; label: string; levels: number[] } | null;
  beginCast(characterId: string, rollableId: string, minLevel: number, label: string): void;
  castSpell(characterId: string, rollableId: string, slotLevel: number): void;
  cancelCast(): void;

  camera: Camera;
  tool: Tool;
  selectedTokenId: string | null;
  /** All selected token IDs (multi-select via shift-click). First entry = primary. */
  selectedTokenIds: string[];
  /** Token whose inspector panel is open (right-click), separate from selection. */
  inspectorTokenId: string | null;
  openInspector(id: string | null): void;
  selectedLightId: string | null;
  selectedWallId: string | null;
  selectedDoorId: string | null;
  /** The row the World pane is showing as selected, as `${kind}:${id}`. Kept
   *  here rather than inside the panel so selecting a token on the MAP can
   *  light up its row too — one selection, two views of it. */
  worldSelectedKey: string | null;
  setWorldSelection(key: string | null): void;
  /** Map object (chest, shop, prop) wearing the selection ring. Distinct from
   *  `inspectedObjectId`: selecting shows you which one, inspecting edits it. */
  selectedObjectId: string | null;
  selectObject(id: string | null): void;
  /** The piece flashing on the map because the pointer is over its World-pane
   *  row. Purely a pointer echo — it never survives the mouse leaving, and it
   *  never touches selection. */
  worldHover: MapTarget;
  setWorldHover(t: MapTarget): void;
  /** Which bottom-corner chip has its panel open (Benny or Keyring), if any.
   *  Shared so the two are mutually exclusive: both panels open upward from
   *  the same baseline, so two at once would overlap each other. */
  /** A Called Shot waiting on its aim, now that the target is known. */
  calledShotPending: { targetTokenId: string } | null;
  confirmCalledShot(aim: CalledShotAim): void;
  cancelCalledShot(): void;
  openChip: 'benny' | 'keyring' | null;
  setOpenChip(c: 'benny' | 'keyring' | null): void;
  /** Local-only: mute audio on this device without affecting others. */
  clientMuted: boolean;
  /** This device's own music volume (multiplies the DM's jukebox volume). */
  /** How this viewer likes the app to look. Local only — see util/appearance. */
  uiTheme: UiTheme;
  setUiTheme(theme: UiTheme): void;
  mapColors: MapColors;
  setMapColors(colors: MapColors): void;
  localMusicVolume: number;
  /** This device's own sound-effects volume (soundboard hits, dice rattles). */
  /** Whose roll is about to land, shown across the map. */
  rollCallout: { id: number; name: string; what: string } | null;
  /** A Benny being spent — the coin flip everyone at the table watches. */
  bennyFlip: { id: number; name: string; reason: string; face: 'benny' | 'csb' } | null;
  localSfxVolume: number;
  setLocalMusicVolume(v: number): void;
  setLocalSfxVolume(v: number): void;
  setClientMuted(m: boolean): void;
  drawColor: string;
  drawLayer: DrawingLayerName;
  /** The label currently being edited/resized, if any. */
  selectedTextId: string | null;
  setSelectedTextId(id: string | null): void;
  /** Style the next map label is placed with. */
  textStyle: { size: number; color: string; font: string; bold: boolean; italic: boolean };
  setDrawColor(c: string): void;
  setTextStyle(patch: Partial<GameState['textStyle']>): void;
  setDrawLayer(l: DrawingLayerName): void;
  /** What the loot tool places. Only chests are offered now; 'item' remains
   *  so map objects placed before that stay readable. */
  lootKind: 'item' | 'chest';
  setLootKind(k: 'item' | 'chest'): void;
  wallType: 'solid' | 'window' | 'oneway' | 'stainedglass';
  wallFlip: boolean;
  wallGlassColor: string;
  wallRainbow: boolean;
  setWallType(t: 'solid' | 'window' | 'oneway' | 'stainedglass'): void;
  toggleWallFlip(): void;
  doorType: DoorType;
  setDoorType(t: DoorType): void;
  terrainBrush: TerrainBrush;
  terrainErase: boolean;
  /** Which ground the terrain tool paints. */
  terrainKind: 'rough' | 'blocked';
  /** Brush radius in tiles (0 = a single hex). */
  terrainRadius: number;
  setTerrainBrush(b: TerrainBrush): void;
  setTerrainErase(e: boolean): void;
  setTerrainKind(kind: 'rough' | 'blocked'): void;
  setTerrainRadius(n: number): void;

  // actions
  join(campaignId: string): void;
  leave(): void;
  setCamera(c: Camera): void;
  setTool(t: Tool): void;
  selectToken(id: string | null, additive?: boolean): void;
  selectLight(id: string | null): void;
  selectWall(id: string | null): void;
  selectDoor(id: string | null): void;
  openSheet(characterId: string | null): void;
  clearError(): void;

  /** Am I acting as the DM RIGHT NOW? False while previewing a player — the
   *  whole point of the preview is to stand in their shoes, so every capability
   *  gate and every DM-only overlay should read this. */
  isDm(): boolean;
  /** Is my ACCOUNT the DM, preview or not? Only for the controls that manage
   *  the preview itself, which must survive being inside it. */
  isDmAccount(): boolean;
  /** Whose account the UI should answer to: the previewed player while the DM
   *  is previewing, otherwise me. "My characters", "my pills", "my keys" all
   *  read this, so the preview shows THEIR party rather than the DM's. */
  asUserId(): string | null;
  effectiveVisible(): Set<number> | null;
}

let pingCounter = 0;

/**
 * The sound a blast template makes when its shockwave lands. Every client
 * fires its own clip off the broadcast burst, exactly as the dice Ace sounds
 * do — no extra event, and the volume follows the same local SFX slider and
 * mute as everything else.
 */
function playBlastSound(sizeHexes: number | undefined, damageType: string | undefined): void {
  const clip = blastSoundClip(sizeHexes, damageType, Math.random());
  const audio = new Audio(`/sounds/${clip}.mp3`);
  const s = useGameStore.getState();
  audio.volume = blastSoundVolume(sizeHexes) * s.localSfxVolume * (s.clientMuted ? 0 : 1);
  // Autoplay may be blocked before the user's first interaction — ignore.
  audio.play().catch(() => undefined);
}

// How long an AoE burst/ripple's own expansion-and-fade plays once it starts
// (after any projectile flight for sphere/cylinder shapes) -- see
// client/src/table/CombatTextLayer.tsx's aoe-burst CSS animation.
// How long a burst stays mounted after it lands. Long enough for the slowest
// Ace animation a template can use — the burst is drawn with the dice's own
// effect now, and unmounting mid-explosion would cut it off in the middle.
const AOE_BURST_MS = 2000;

export const useGameStore = create<GameState>((set, get) => ({
  connected: false,
  you: null,
  campaign: null,
  members: [],
  characters: [],
  mapsMeta: [],
  handoutList: [],
  macroList: [],
  tableList: [],
  assetFolders: [],
  assetList: [],
  audioTracks: [],
  audioState: { trackId: null, playing: false, loop: false, shuffle: false, playlist: 0, volume: 0.6, startedAt: 0 },
  soundboardSlots: [],
  shopList: [],
  locationList: [],
  worldFolderList: [],
  worldSort: {},
  customNpcs: [],
  customItems: [],
  presentedShopId: null,
  closePresentedShop() { set({ presentedShopId: null }); },
  directory: null,
  initiativeState: { entries: [], turnIdx: 0, round: 1, active: false },
  chatLog: [],

  map: null,
  dmGeometry: null,
  tokens: {},
  drawingList: [],
  visible: null,
  fade: null,
  visiblePolygons: null,
  fadePolygons: null,
  visibleLitMask: null,
  fadeLitMask: null,
  explored: null,
  exploredLog: null,
  knownDoors: [],
  knownWalls: [],
  mapObjects: {},
  lootPopupId: null,
  inspectedObjectId: null,
  openObjectInspector(inspectedObjectId) { set({ inspectedObjectId }); },
  cardDrawFlash: null,
  clearCardFlash() { set({ cardDrawFlash: null }); },
  dockTab: 'world',
  setDockTab(dockTab) { set({ dockTab }); },
  showCharacterCreator: false,
  setShowCharacterCreator(showCharacterCreator) { set({ showCharacterCreator }); },
  characterCreatorPrompted: false,
  setCharacterCreatorPrompted(characterCreatorPrompted) { set({ characterCreatorPrompted }); },
  viewingAs: null,
  dragGhosts: {},
  predictedMoves: {},
  pings: [],
  measures: {},
  aoePreviews: {},
  targetPreviews: {},
  errorToast: null,
  toastKind: 'error',
  diceAnim: null,
  diceAnimEnding: false,
  soakOffer: null,
  blastOffer: null,
  bennyState: {},
  bleedPrompt: null,
  shakenPrompt: null,
  stunPrompt: null,
  incapPrompt: null,
  runPrompt: null,
  crawlPrompt: null,
  aftermathPrompt: null,
  clockSeconds: 0,
  healingPrompt: null,
  rollStatsData: {},
  ironDice: null,
  publicSheets: {},
  dmNotesData: {},
  privateNotesData: {},
  counters: [],
  allCounters: [],
  roundCardsDeal: null,
  targeting: null,
  aoeTargeting: null,
  floats: [],
  projectiles: [],
  aoeBursts: [],
  tableToasts: [],
  rollCallout: null,
  bennyFlip: null,
  beginTargeting(characterId, sourceTokenId, action, adv, rof, calledShot) {
    // Character sheets are movable windows now (not a full-screen modal), so
    // the map stays clickable underneath them — no need to force one closed.
    set({ targeting: { characterId, sourceTokenId, action, adv, rof, calledShot: calledShot ?? null }, tool: 'select', selectedTokenId: null, selectedTokenIds: [] });
    // Live-broadcast the range highlight so the DM + other players see the
    // same in-range/out-of-range tokens the caster sees, before they click.
    socket.emit(C2S.TARGET_PREVIEW, {
      sourceTokenId, rangeFt: action.rangeFt * (get().campaign?.system === 'swade' && action.ranged ? (adv === 'adv' ? 16 : 4) : 1), effect: action.effect, label: action.label, active: true,
    });
  },
  cancelTargeting() {
    const t = get().targeting;
    set({ targeting: null });
    if (t) {
      socket.emit(C2S.TARGET_PREVIEW, {
        sourceTokenId: t.sourceTokenId, rangeFt: t.action.rangeFt, effect: t.action.effect, label: t.action.label, active: false,
      });
    }
  },
  resolveTarget(targetTokenId) {
    const t = get().targeting;
    if (!t) return;
    // A Called Shot cannot be priced until the victim is known: the part's
    // Scale is read off THEIR Size. Hold the attack and ask now.
    if (t.calledShot === CALLED_SHOT_PENDING) {
      set({ calledShotPending: { targetTokenId }, targeting: { ...t, calledShot: null } });
      return;
    }
    set({ dockTab: 'chat' });
    socket.emit(C2S.COMBAT_ACTION, {
      characterId: t.characterId, actionId: t.action.id,
      sourceTokenId: t.sourceTokenId, targetTokenId, adv: t.adv, rof: t.rof, calledShot: t.calledShot ?? null,
    });
    set({ targeting: null });
    socket.emit(C2S.TARGET_PREVIEW, {
      sourceTokenId: t.sourceTokenId, rangeFt: t.action.rangeFt, effect: t.action.effect, label: t.action.label, active: false,
    });
  },
  beginAoeTargeting(characterId, sourceTokenId, action, adv) {
    const src = get().tokens[sourceTokenId];
    const originHex = src ? { q: src.q, r: src.r } : { q: 0, r: 0 };
    set({
      aoeTargeting: { characterId, sourceTokenId, action, adv, originHex, aimHex: originHex },
      tool: 'select', selectedTokenId: null, selectedTokenIds: [],
    });
  },
  updateAoeAim(hex) {
    const t = get().aoeTargeting;
    if (!t || (t.aimHex.q === hex.q && t.aimHex.r === hex.r)) return;
    set({ aoeTargeting: { ...t, aimHex: hex } });
    const aoe = t.action.aoe;
    if (!aoe) return;
    socket.emit(C2S.AOE_PREVIEW, {
      sourceTokenId: t.sourceTokenId, shape: aoe.shape, sizeFt: aoe.sizeFt, widthFt: aoe.widthFt,
      originHex: t.originHex, aimHex: hex, active: true,
    });
  },
  cancelAoeTargeting() {
    const t = get().aoeTargeting;
    set({ aoeTargeting: null });
    if (t?.action.aoe) {
      socket.emit(C2S.AOE_PREVIEW, {
        sourceTokenId: t.sourceTokenId, shape: t.action.aoe.shape, sizeFt: t.action.aoe.sizeFt, widthFt: t.action.aoe.widthFt,
        originHex: t.originHex, aimHex: t.aimHex, active: false,
      });
    }
  },
  confirmAoeTargeting(cook?: boolean) {
    const t = get().aoeTargeting;
    if (!t) return;
    // A grenade asks whether to cook it before it leaves the hand. The
    // question is only worth asking once, so `cook` being undefined means
    // "not asked yet" and anything defined means the player has answered.
    if (cook === undefined && t.action.thrown === true && get().campaign?.system === 'swade') {
      set({ cookPrompt: { label: t.action.label } });
      return;
    }
    set({ aoeTargeting: null, cookPrompt: null });
    if (t.action.aoe) {
      socket.emit(C2S.AOE_PREVIEW, {
        sourceTokenId: t.sourceTokenId, shape: t.action.aoe.shape, sizeFt: t.action.aoe.sizeFt, widthFt: t.action.aoe.widthFt,
        originHex: t.originHex, aimHex: t.aimHex, active: false,
      });
    }
    set({ dockTab: 'chat' });
    socket.emit(C2S.CAST_AOE, {
      characterId: t.characterId, actionId: t.action.id, sourceTokenId: t.sourceTokenId,
      originHex: t.originHex, aimHex: t.aimHex, adv: t.adv, cook: cook === true,
    });
  },
  cookPrompt: null,
  keyManagerOpen: false,
  castPrompt: null,
  beginCast(characterId, rollableId, minLevel, label) {
    const c = get().characters.find((x) => x.id === characterId);
    if (!c) return;
    const levels = castableLevels(c.sheet, minLevel);
    if (levels.length === 0) {
      set({ errorToast: 'No spell slots available to cast this.' });
      setTimeout(() => { if (get().errorToast) set({ errorToast: null }); }, 4000);
      return;
    }
    if (levels.length === 1) { get().castSpell(characterId, rollableId, levels[0]); return; }
    set({ castPrompt: { characterId, rollableId, label, levels } });
  },
  castSpell(characterId, rollableId, slotLevel) {
    socket.emit(C2S.CAST_SPELL, { characterId, rollableId, slotLevel });
    set({ castPrompt: null, dockTab: 'chat' });
  },
  cancelCast() { set({ castPrompt: null }); },

  camera: { x: 0, y: 0, scale: 1 },
  tool: 'select',
  selectedTokenId: null,
  selectedTokenIds: [],
  worldSelectedKey: null,
  selectedObjectId: null,
  worldHover: null,
  inspectorTokenId: null,
  openInspector(inspectorTokenId) { set({ inspectorTokenId }); },
  selectedLightId: null,
  selectedWallId: null,
  selectedDoorId: null,
  clientMuted: false,
  setClientMuted(clientMuted) { set({ clientMuted }); },
  uiTheme: readTheme(),
  setUiTheme(theme) { saveTheme(theme); set({ uiTheme: theme }); },
  mapColors: readMapColors(),
  setMapColors(colors) { saveMapColors(colors); set({ mapColors: colors }); },
  localMusicVolume: readLocalVolume('roll67.musicVolume'),
  localSfxVolume: readLocalVolume('roll67.sfxVolume'),
  setLocalMusicVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    localStorage.setItem('roll67.musicVolume', String(vol));
    set({ localMusicVolume: vol });
    saveVolumesSoon();
  },
  setLocalSfxVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    localStorage.setItem('roll67.sfxVolume', String(vol));
    set({ localSfxVolume: vol });
    saveVolumesSoon();
  },
  drawColor: '#e8d27b',
  selectedTextId: null,
  textStyle: { size: 28, color: '#f4f6fb', font: 'sans-serif', bold: true, italic: false },
  drawLayer: 'map',
  setDrawColor(drawColor) { set({ drawColor }); },
  setSelectedTextId(selectedTextId) { set({ selectedTextId }); },
  setTextStyle(patch) { set((st) => ({ textStyle: { ...st.textStyle, ...patch } })); },
  setDrawLayer(drawLayer) { set({ drawLayer }); },
  lootKind: 'chest',
  setLootKind(lootKind) { set({ lootKind }); },
  wallType: 'solid',
  wallFlip: false,
  wallGlassColor: '#cc4444',
  wallRainbow: false,
  setWallType(wallType) { set({ wallType }); },
  toggleWallFlip() { set({ wallFlip: !get().wallFlip }); },
  doorType: 'door',
  setDoorType(doorType) { set({ doorType }); },
  terrainBrush: 'brush',
  terrainErase: false,
  terrainKind: 'rough' as const,
  terrainRadius: 0,
  setTerrainBrush(terrainBrush) { set({ terrainBrush }); },
  setTerrainErase(terrainErase) { set({ terrainErase }); },
  setTerrainKind(terrainKind) { set({ terrainKind }); },
  setTerrainRadius(n) { set({ terrainRadius: Math.max(0, Math.min(6, Math.round(n))) }); },

  join(campaignId) {
    connectSocket();
    socket.emit(C2S.JOIN_CAMPAIGN, { campaignId });
  },

  leave() {
    socket.emit(C2S.LEAVE_CAMPAIGN);
    // Queued rolls belong to the campaign being left; firing them into the next
    // one would append stray entries to a fresh log.
    resetChatQueue();
    set({
      you: null, campaign: null, members: [], characters: [], mapsMeta: [],
      handoutList: [], macroList: [], chatLog: [], map: null, dmGeometry: null,
      tokens: {}, drawingList: [], visible: null, fade: null, visiblePolygons: null, fadePolygons: null,
      visibleLitMask: null, fadeLitMask: null, explored: null, exploredLog: null, knownDoors: [], knownWalls: [],
      viewingAs: null, dragGhosts: {}, predictedMoves: {}, selectedTokenId: null, selectedTokenIds: [], inspectorTokenId: null,
      worldSelectedKey: null, selectedObjectId: null, worldHover: null,
      targeting: null, aoeTargeting: null, aoePreviews: {}, targetPreviews: {}, floats: [], projectiles: [], aoeBursts: [], castPrompt: null, mapObjects: {}, lootPopupId: null, inspectedObjectId: null,
      // Transient slices that used to leak into the NEXT campaign: a live
      // ruler from campaign A rendering over campaign B's map, a stale error
      // toast, a presented shop, last session's initiative order.
      measures: {}, pings: [], diceAnim: null, errorToast: null, presentedShopId: null,
      initiativeState: { entries: [], turnIdx: 0, round: 1, active: false }, cardDrawFlash: null, dockTab: 'world',
      showCharacterCreator: false, characterCreatorPrompted: false,
      shopList: [], locationList: [], worldFolderList: [], tableList: [], assetFolders: [], assetList: [],
      audioTracks: [], audioState: { trackId: null, playing: false, loop: false, shuffle: false, playlist: 0, volume: 0.6, startedAt: 0 }, soundboardSlots: [],
      directory: null,
    });
    // Any windows still open (character sheets, handouts, shops) belong to
    // the campaign being left; without this, their empty frames float over
    // the campaign list and the next campaign joined.
    useWindowManager.setState({ windows: [] });
  },

  setCamera(camera) { set({ camera }); },
  setTool(tool) {
    set({
      tool,
      inspectorTokenId: null,
      selectedTokenId: tool === 'select' ? get().selectedTokenId : null,
      selectedTokenIds: tool === 'select' ? get().selectedTokenIds : [],
      selectedLightId: tool === 'light' ? get().selectedLightId : null,
      selectedWallId: tool === 'select' ? get().selectedWallId : null,
      selectedDoorId: tool === 'select' ? get().selectedDoorId : null,
    });
  },
  selectToken(id: string | null, additive?: boolean) {
    // Picking a token anywhere lights up its World-pane row as well, and
    // drops whatever else was selected there — one selection, two views. A
    // multi-select has no single row to point at, so the tree goes quiet.
    if (!id) {
      set({ selectedTokenId: null, selectedTokenIds: [], worldSelectedKey: null, selectedObjectId: null });
      return;
    }
    if (additive) {
      const ids = get().selectedTokenIds;
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      set({
        selectedTokenIds: next, selectedTokenId: next[0] ?? null,
        worldSelectedKey: next.length === 1 ? `token:${next[0]}` : null,
        selectedObjectId: null,
      });
    } else {
      set({ selectedTokenId: id, selectedTokenIds: [id], worldSelectedKey: `token:${id}`, selectedObjectId: null });
    }
  },
  setWorldSelection(worldSelectedKey) { set({ worldSelectedKey }); },
  setWorldHover(worldHover) {
    // Bail on a no-op rather than churning a render for every mousemove that
    // lands on the row you are already over.
    const cur = get().worldHover;
    if (cur?.id === worldHover?.id && cur?.kind === worldHover?.kind) return;
    set({ worldHover });
  },
  selectObject(selectedObjectId) {
    // A map object and a token are the same kind of "the thing I'm pointing
    // at", so picking one releases the other. The World pane follows along;
    // when the pick CAME from the tree it overwrites this with the row that
    // was actually clicked, which may be the shop or chest-folder this object
    // only stands in for.
    set({
      selectedObjectId, selectedTokenId: null, selectedTokenIds: [],
      worldSelectedKey: selectedObjectId ? `mapobject:${selectedObjectId}` : null,
    });
  },
  selectLight(selectedLightId) { set({ selectedLightId }); },
  selectWall(selectedWallId) { set({ selectedWallId, selectedDoorId: null, selectedLightId: null }); },
  selectDoor(selectedDoorId) { set({ selectedDoorId, selectedWallId: null, selectedLightId: null }); },
  openSheet(characterId) {
    if (!characterId) return; // legacy "close" signal — each sheet window now closes itself
    const char = get().characters.find((c) => c.id === characterId);
    openWindow('characterSheet', characterId, { characterId }, char?.name ?? 'Character');
  },
  calledShotPending: null,
  confirmCalledShot(aim) {
    const s = get();
    const t = s.targeting;
    const pend = s.calledShotPending;
    if (!t || !pend) return;
    set({ dockTab: 'chat', calledShotPending: null, targeting: null });
    socket.emit(C2S.COMBAT_ACTION, {
      characterId: t.characterId, actionId: t.action.id,
      sourceTokenId: t.sourceTokenId, targetTokenId: pend.targetTokenId,
      adv: t.adv, rof: t.rof, calledShot: aim,
    });
    socket.emit(C2S.TARGET_PREVIEW, { sourceTokenId: t.sourceTokenId, rangeFt: 0, effect: 'damage', label: '', active: false });
  },
  cancelCalledShot() { set({ calledShotPending: null }); get().cancelTargeting(); },
  openChip: null,
  setOpenChip(openChip) { set({ openChip }); },
  clearError() { set({ errorToast: null }); },
  toast(message, kind = 'error') {
    set({ errorToast: message, toastKind: kind });
    // Self-clearing, and only if nothing newer has replaced it — otherwise a
    // stale timer wipes a message the user has not read yet.
    setTimeout(() => {
      if (get().errorToast === message) set({ errorToast: null });
    }, kind === 'info' ? 3500 : 6000);
  },

  isDm() { const s = get(); return s.you?.role === 'dm' && !s.viewingAs; },
  isDmAccount() { return get().you?.role === 'dm'; },
  asUserId() { const s = get(); return s.viewingAs ?? s.you?.userId ?? null; },
  effectiveVisible() {
    const s = get();
    if (s.you?.role === 'dm' && !s.viewingAs) return null;
    return s.visible;
  },
}));

// ---------- socket wiring (module-level, once) ----------

function tokensById(list: TokenView[]): Record<string, TokenView> {
  const out: Record<string, TokenView> = {};
  for (const t of list) out[t.id] = t;
  return out;
}

function mapObjectsById(list: MapObject[]): Record<string, MapObject> {
  const out: Record<string, MapObject> = {};
  for (const o of list) out[o.id] = o;
  return out;
}

/**
 * tokensById, but unchanged tokens keep their PREVIOUS object identity: every
 * vision update rebuilds all TokenViews from the wire, and those fresh
 * references defeated React.memo on every TokenPiece even when only one token
 * actually moved. Field-compares each incoming token against the previous
 * record (nested bar/vision/light compared by value) and reuses the old
 * object when nothing differs.
 */
/** Persist the audio mix to the account — debounced, since dragging a slider
 *  fires continuously and only the value it lands on matters. */
let volumeSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveVolumesSoon(): void {
  if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => {
    volumeSaveTimer = null;
    const s = useGameStore.getState();
    if (s.you) socket.emit(C2S.SET_VOLUMES, { music: s.localMusicVolume, sfx: s.localSfxVolume });
  }, 400);
}

/** A persisted per-device volume (0..1); malformed/missing → full volume. */
function readLocalVolume(key: string): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}

function tokensByIdReusing(prev: Record<string, TokenView>, list: TokenView[]): Record<string, TokenView> {
  const out: Record<string, TokenView> = {};
  for (const t of list) {
    const old = prev[t.id];
    out[t.id] = old && sameToken(old, t) ? old : t;
  }
  return out;
}

function sameToken(a: TokenView, b: TokenView): boolean {
  return a.id === b.id && a.mapId === b.mapId && a.characterId === b.characterId
    && a.name === b.name && a.artUrl === b.artUrl && a.q === b.q && a.r === b.r
    && a.layer === b.layer && a.size === b.size && a.shape === b.shape && a.color === b.color
    && JSON.stringify(a.vision) === JSON.stringify(b.vision)
    && JSON.stringify(a.bar) === JSON.stringify(b.bar)
    && JSON.stringify(a.light) === JSON.stringify(b.light);
}

let wired = false;

export function wireSocket(): void {
  if (wired) return;
  wired = true;

  socket.on('connect', () => {
    useGameStore.setState({ connected: true });
    // After a dropped connection, rejoin the campaign we were in so the
    // server rebuilds our rooms and sends fresh state.
    const s = useGameStore.getState();
    if (s.campaign) socket.emit(C2S.JOIN_CAMPAIGN, { campaignId: s.campaign.id });
  });
  socket.on('disconnect', () => useGameStore.setState({ connected: false }));

  socket.on(S2C.YOU_ARE, (payload: YouArePayload) => {
    useGameStore.setState({ you: payload });
    // The account's saved audio mix wins over this browser's cache, so a
    // player's levels follow them to a new device. Never set = full volume.
    if (typeof payload.musicVolume === 'number') {
      localStorage.setItem('roll67.musicVolume', String(payload.musicVolume));
      useGameStore.setState({ localMusicVolume: payload.musicVolume });
    }
    if (typeof payload.sfxVolume === 'number') {
      localStorage.setItem('roll67.sfxVolume', String(payload.sfxVolume));
      useGameStore.setState({ localSfxVolume: payload.sfxVolume });
    }
  });

  socket.on(S2C.CAMPAIGN_STATE, (p: CampaignStatePayload) => {
    useGameStore.setState({
      campaign: p.campaign,
      members: p.members,
      characters: p.characters,
      mapsMeta: p.maps,
      handoutList: p.handouts,
      macroList: p.macros,
      initiativeState: p.initiative,
      clockSeconds: p.clockSeconds ?? 0,
      chatLog: p.chatTail,
      mapObjects: mapObjectsById(p.mapObjects ?? []),
    });
  });

  socket.on(S2C.COUNTERS_ALL, (p: { counters: Counter[] }) => {
    useGameStore.setState({ allCounters: p.counters });
  });

  socket.on(S2C.COUNTERS, (p: CountersPayload) => {
    if (useGameStore.getState().map?.id === p.mapId) useGameStore.setState({ counters: p.counters });
  });

  socket.on(S2C.MAP_STATE, (p: MapStatePayload) => {
    socket.emit(C2S.COUNTERS_GET, { mapId: p.map.id });
    socket.emit(C2S.COUNTERS_GET, { mapId: '*' });
    const s = useGameStore.getState();
    // A map switch invalidates anything anchored to the OLD map's tokens: an
    // in-progress target pick (its source token id no longer resolves, which
    // used to leave every token on the new map dimmed and unclickable until
    // the player guessed Escape), the aimed AoE template, the open inspector,
    // and everyone's live measure/preview overlays. The cancel functions also
    // broadcast the active:false that clears our stale preview for others.
    if (s.targeting) s.cancelTargeting();
    if (s.aoeTargeting) s.cancelAoeTargeting();
    useGameStore.setState({
      map: p.map,
      dmGeometry: p.dmGeometry,
      tokens: tokensById(p.tokens),
      drawingList: p.drawings,
      visible: p.visible ? new Set(p.visible) : null,
      fade: p.fade ? new Set(p.fade) : null,
      visiblePolygons: p.visiblePolygons,
      fadePolygons: p.fadePolygons,
      visibleLitMask: p.visibleLitMask,
      fadeLitMask: p.fadeLitMask,
      explored: p.explored ? new Set(p.explored) : null,
      exploredLog: p.explored ? [...p.explored] : null,
      knownDoors: p.knownDoors,
      knownWalls: p.knownWalls ?? [],
      viewingAs: p.viewingAs,
      dragGhosts: {},
      selectedTokenId: null,
      selectedTokenIds: [],
      worldSelectedKey: null,
      selectedObjectId: null,
      worldHover: null,
      inspectorTokenId: null,
      inspectedObjectId: null,
      lootPopupId: null,
      // The store holds every map's objects (seeded by CAMPAIGN_STATE, so the
      // world tree can nest loot under all maps) — merge this map's fresh
      // list over the rest instead of replacing the whole record.
      mapObjects: {
        ...Object.fromEntries(Object.entries(s.mapObjects).filter(([, o]) => o.mapId !== p.map.id)),
        ...mapObjectsById(p.mapObjects),
      },
      measures: {},
      aoePreviews: {},
      targetPreviews: {},
    });
  });

  socket.on(S2C.MAP_LIST, ({ maps }: { maps: MapMeta[] }) => {
    useGameStore.setState({ mapsMeta: maps });
  });

  socket.on(S2C.MAP_EDITED, (p: MapEditedPayload) => {
    const s = useGameStore.getState();
    if (s.map?.id !== p.mapId) return;
    const map: MapView = {
      ...s.map,
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.grid !== undefined ? { grid: p.grid as GridConfig } : {}),
      ...(p.bgUrl !== undefined ? { bgUrl: p.bgUrl } : {}),
      ...(p.bgWidth !== undefined ? { bgWidth: p.bgWidth } : {}),
      ...(p.bgHeight !== undefined ? { bgHeight: p.bgHeight } : {}),
      ...(p.spawn !== undefined ? { spawn: p.spawn } : {}),
      ...(p.terrain !== undefined ? { terrain: p.terrain } : {}),
      // Inaccessible terrain arrives on the same broadcast as rough terrain
      // and was the one field this reducer dropped on the floor. The server
      // stored and broadcast every painted hex correctly; the client threw
      // them away, so painting looked dead until a reload — and erasing was
      // dead for real, since the brush diffs against the map's own blocked
      // set and it never stopped being stale.
      ...(p.blocked !== undefined ? { blocked: p.blocked } : {}),
    };
    const dmGeometry = s.dmGeometry
      ? {
          walls: p.walls ?? s.dmGeometry.walls,
          doors: p.doors ?? s.dmGeometry.doors,
          lights: p.lights ?? s.dmGeometry.lights,
        }
      : null;
    useGameStore.setState({ map, dmGeometry });
  });

  socket.on(S2C.VISION_UPDATE, (p: VisionUpdatePayload) => {
    const s = useGameStore.getState();
    if (s.map?.id !== p.mapId) return;
    // In god mode the DM ignores vision packets unless previewing a player.
    if (s.you?.role === 'dm' && !s.viewingAs && !p.viewingAs) return;
    if (s.you?.role === 'dm' && s.viewingAs !== p.viewingAs) return;
    // Most moves reveal nothing new -- skip cloning the (potentially huge,
    // ever-growing) explored set on every single vision update. FogCanvas
    // caches its explored-hex render keyed on this reference, so leaving it
    // untouched here also lets it skip re-filling every explored hex when
    // only the live visible/fade bands actually changed.
    let explored = s.explored;
    let exploredLog = s.exploredLog;
    if (p.newlyExplored.length > 0) {
      explored = new Set(s.explored ?? []);
      for (const h of p.newlyExplored) explored.add(h);
      // Appended in place, on purpose: FogCanvas keys its full-rebuild on this
      // array's IDENTITY changing (map switch), and consumes growth by index.
      if (exploredLog) exploredLog.push(...p.newlyExplored);
      else exploredLog = [...p.newlyExplored];
    }
    useGameStore.setState({
      visible: new Set(p.visible),
      fade: new Set(p.fade),
      visiblePolygons: p.visiblePolygons,
      fadePolygons: p.fadePolygons,
      visibleLitMask: p.visibleLitMask,
      fadeLitMask: p.fadeLitMask,
      explored,
      exploredLog,
      tokens: tokensByIdReusing(s.tokens, p.tokens),
      knownDoors: p.knownDoors,
      knownWalls: p.knownWalls ?? [],
      // Loot on this map is authoritative per update: chests appear as the
      // party explores toward them and drop away when they can't be seen.
      mapObjects: {
        ...Object.fromEntries(Object.entries(s.mapObjects).filter(([, o]) => o.mapId !== p.mapId)),
        ...mapObjectsById(p.mapObjects ?? []),
      },
      dragGhosts: {},
    });
  });

  socket.on(S2C.TOKEN_UPSERTED, ({ token }: { token: TokenView }) => {
    const s = useGameStore.getState();
    if (s.viewingAs) return; // preview mode: vision updates drive tokens
    if (s.map?.id !== token.mapId) return;
    // The server has spoken: whatever we guessed for this token is now moot,
    // whether it agreed with us or not.
    const predictedMoves = { ...s.predictedMoves };
    delete predictedMoves[token.id];
    useGameStore.setState({ tokens: { ...s.tokens, [token.id]: token }, predictedMoves });
  });

  socket.on(S2C.TOKEN_REMOVED, ({ tokenId }: { tokenId: string }) => {
    const s = useGameStore.getState();
    if (s.viewingAs) return;
    const tokens = { ...s.tokens };
    delete tokens[tokenId];
    useGameStore.setState({
      tokens,
      selectedTokenIds: s.selectedTokenIds.filter((x) => x !== tokenId),
      selectedTokenId: s.selectedTokenId === tokenId ? null : s.selectedTokenId,
      inspectorTokenId: s.inspectorTokenId === tokenId ? null : s.inspectorTokenId,
    });
  });

  socket.on(S2C.TOKEN_MOVED, ({ tokenId, q, r }: { tokenId: string; q: number; r: number }) => {
    const s = useGameStore.getState();
    const t = s.tokens[tokenId];
    if (!t) return;
    const ghosts = { ...s.dragGhosts };
    delete ghosts[tokenId];
    useGameStore.setState({ tokens: { ...s.tokens, [tokenId]: { ...t, q, r } }, dragGhosts: ghosts });
  });

  socket.on(S2C.TOKEN_DRAG_GHOST, ({ tokenId, x, y, done }: { tokenId: string; x: number; y: number; done: boolean }) => {
    const s = useGameStore.getState();
    const ghosts = { ...s.dragGhosts };
    if (done) delete ghosts[tokenId];
    else ghosts[tokenId] = { x, y };
    useGameStore.setState({ dragGhosts: ghosts });
  });

  socket.on(S2C.DOOR_STATE, ({ mapId, doorId, open }: { mapId: string; doorId: string; open: boolean }) => {
    const s = useGameStore.getState();
    if (s.map?.id !== mapId) return;
    useGameStore.setState({
      knownDoors: s.knownDoors.map((d) => (d.id === doorId ? { ...d, open } : d)),
      dmGeometry: s.dmGeometry
        ? { ...s.dmGeometry, doors: s.dmGeometry.doors.map((d) => (d.id === doorId ? { ...d, open } : d)) }
        : null,
    });
  });

  socket.on(S2C.CHARACTER_UPSERTED, ({ character }: { character: Character }) => {
    const s = useGameStore.getState();
    const idx = s.characters.findIndex((c) => c.id === character.id);
    const characters = idx >= 0
      ? s.characters.map((c) => (c.id === character.id ? character : c))
      : [...s.characters, character];
    useGameStore.setState({ characters });
  });

  socket.on(S2C.HP_FLOAT, (p: HpFloatPayload) => {
    const s = useGameStore.getState();
    // Only float over tokens we can actually see (secrecy preserved).
    if (s.map?.id !== p.mapId || !s.tokens[p.tokenId]) return;
    const id = ++pingCounter;
    useGameStore.setState({ floats: [...s.floats, { id, tokenId: p.tokenId, delta: p.delta, kind: p.kind, damageType: p.damageType }] });
    setTimeout(() => {
      const cur = useGameStore.getState();
      useGameStore.setState({ floats: cur.floats.filter((f) => f.id !== id) });
    }, 1600);
  });

  socket.on(S2C.PROJECTILE, (p: ProjectilePayload) => {
    // Queued rather than fired on arrival, so the shot flies once the damage
    // dice -- aces and all -- have finished and the queue's gap has elapsed.
    // Visibility is re-checked at launch, not now: by the time this reaches
    // the head of the queue the tokens may have moved or gone out of sight.
    chatQueue.push({
      append: () => {
        const s = useGameStore.getState();
        // Only show the shot if both ends are actually visible to us -- same
        // secrecy rule as HP_FLOAT, but checked at both endpoints since this
        // needs to draw a line between them, not just sit on one token.
        if (s.map?.id !== p.mapId || !s.tokens[p.fromTokenId] || !s.tokens[p.toTokenId]) return;
        const id = ++pingCounter;
        useGameStore.setState({
          projectiles: [...s.projectiles, { id, fromTokenId: p.fromTokenId, toTokenId: p.toTokenId, damageType: p.damageType, flightMs: p.flightMs }],
        });
        setTimeout(() => {
          const cur = useGameStore.getState();
          useGameStore.setState({ projectiles: cur.projectiles.filter((x) => x.id !== id) });
        }, p.flightMs);
      },
    });
    pumpChatQueue();
  });

  socket.on(S2C.AOE_BURST, (p: AoeBurstPayload) => {
    const s = useGameStore.getState();
    if (s.map?.id !== p.mapId) return;
    const id = ++pingCounter;
    useGameStore.setState({
      aoeBursts: [...s.aoeBursts, {
        id, shape: p.shape, sizeFt: p.sizeFt, widthFt: p.widthFt, originHex: p.originHex, aimHex: p.aimHex,
        damageType: p.damageType, flightMs: p.flightMs,
      }],
    });
    // The bang lands with the shockwave, not with the throw.
    setTimeout(() => playBlastSound(p.sizeHexes, p.damageType), p.flightMs);
    setTimeout(() => {
      const cur = useGameStore.getState();
      useGameStore.setState({ aoeBursts: cur.aoeBursts.filter((x) => x.id !== id) });
    }, p.flightMs + AOE_BURST_MS);
  });

  socket.on(S2C.CHARACTER_REMOVED, ({ characterId }: { characterId: string }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ characters: s.characters.filter((c) => c.id !== characterId) });
    closeWindow(`characterSheet:${characterId}`);
  });

  socket.on(S2C.CHAT, ({ msg }: { msg: ChatMessage }) => {
    const appendToLog = () => {
      const cur = useGameStore.getState();
      useGameStore.setState({ chatLog: [...cur.chatLog.slice(-499), msg] });
    };
    // Any dice roll triggers the 3D dice animation (capped so a 100d6
    // doesn't fill the screen). Both rolls and plain messages go through the
    // same queue so an attack finishes throwing — aces and all — before its
    // damage roll starts, and neither total reaches the log early.
    if (msg.roll && msg.roll.dice.length > 0) {
      const shown = msg.roll.dice.slice(0, 12);
      const id = ++pingCounter;
      chatQueue.push({
        append: appendToLog,
        roll: {
          id,
          dice: shown,
          anim: {
            id, dice: shown, byName: msg.fromName,
            byUserId: msg.fromUserId, total: msg.roll.total, expression: msg.roll.expression,
            // Whoever the dice belong to: the character if there is one, the
            // account otherwise — a bare /r is the player rolling, not a token.
            who: msg.fromCharacter || msg.fromName,
            // What the handler said it was, or the expression itself. Every
            // roll says SOMETHING, even a hand-typed 2d6+3.
            what: msg.callout?.what || msg.roll.expression,
            tone: msg.callout?.tone ?? 'neutral',
          },
        },
      });
    } else {
      chatQueue.push({ append: appendToLog });
    }
    pumpChatQueue();
  });

  socket.on(S2C.CHAT_UPDATED, ({ msg }: { msg: ChatMessage }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ chatLog: s.chatLog.map((m) => (m.id === msg.id ? msg : m)) });
  });

  socket.on(S2C.MACROS, ({ macros }: { macros: Macro[] }) => {
    useGameStore.setState({ macroList: macros });
  });

  socket.on(S2C.TABLES, ({ tables }: { tables: RollableTable[] }) => {
    useGameStore.setState({ tableList: tables });
  });

  socket.on(S2C.BENNY_FLIP, (p: BennyFlipPayload) => {
    const id = ++pingCounter;
    useGameStore.setState({ bennyFlip: { id, name: p.name, reason: p.reason, face: p.face } });
    setTimeout(() => {
      // Only clear our own flip: a second Benny spent while this one is still
      // in the air replaces it, and must not be cut short by the first timer.
      const cur = useGameStore.getState();
      if (cur.bennyFlip?.id === id) useGameStore.setState({ bennyFlip: null });
    }, BENNY_FLIP_MS);
  });

  socket.on(S2C.ROLL_CALLOUT, (p: RollCalloutPayload) => {
    const id = ++pingCounter;
    useGameStore.setState({ rollCallout: { id, name: p.name, what: p.what } });
    setTimeout(() => {
      // Only clear if nobody else's callout has replaced it in the meantime.
      const cur = useGameStore.getState();
      if (cur.rollCallout?.id === id) useGameStore.setState({ rollCallout: null });
    }, Math.max(500, Math.min(6000, p.holdMs || 2000)));
  });

  socket.on(S2C.TABLE_RESULT, (p: TableResultPayload) => {
    const id = ++pingCounter;
    const s = useGameStore.getState();
    useGameStore.setState({ tableToasts: [...s.tableToasts, { id, text: p.text, color: p.color }] });
    setTimeout(() => {
      const cur = useGameStore.getState();
      useGameStore.setState({ tableToasts: cur.tableToasts.filter((t) => t.id !== id) });
    }, 3000);
  });

  socket.on(S2C.ASSETS, ({ folders, assets }: { folders: AssetFolder[]; assets: AssetInfo[] }) => {
    useGameStore.setState({ assetFolders: folders, assetList: assets });
  });

  socket.on(S2C.AUDIO_TRACKS, ({ tracks }: { tracks: AudioTrack[] }) => {
    useGameStore.setState({ audioTracks: tracks });
  });

  socket.on(S2C.AUDIO_STATE, ({ state }: { state: AudioState }) => {
    useGameStore.setState({ audioState: state });
  });

  socket.on(S2C.SOUNDBOARD, ({ slots }: SoundboardPayload) => {
    useGameStore.setState({ soundboardSlots: slots });
  });

  // One-shot effect. Each gets its own Audio element so overlapping hits stack
  // rather than cutting each other off, and so the music track is untouched.
  socket.on(S2C.SOAK_OFFER, (p: SoakOfferPayload) => {
    useGameStore.setState({ soakOffer: p });
  });

  socket.on(S2C.BLAST_OFFER, (p: BlastOfferPayload) => {
    useGameStore.setState({ blastOffer: p });
  });

  // Somebody grabbed it, somebody lay on it, or the fuse ran out — either
  // way this prompt is stale and must go, or it would offer a choice the
  // server will now refuse.
  socket.on(S2C.BLAST_OFFER_CLOSED, (p: BlastOfferClosedPayload) => {
    useGameStore.setState((s) => (s.blastOffer?.blastId === p.blastId ? { blastOffer: null } : {}));
  });

  socket.on(S2C.BLEED_PROMPT, (p: BleedPromptPayload) => {
    useGameStore.setState({ bleedPrompt: p });
  });

  socket.on(S2C.SHAKEN_PROMPT, (p: ShakenPromptPayload) => {
    useGameStore.setState({ shakenPrompt: p });
  });

  socket.on(S2C.STUN_PROMPT, (p: StunPromptPayload) => {
    useGameStore.setState({ stunPrompt: p });
  });

  socket.on(S2C.INCAP_PROMPT, (p: IncapPromptPayload) => {
    // The incapacitation window replaces a bare Soak offer for the same
    // character — its Soak button carries that choice.
    useGameStore.setState((s) => ({
      incapPrompt: p,
      soakOffer: s.soakOffer?.characterId === p.characterId ? null : s.soakOffer,
    }));
  });

  socket.on(S2C.RUN_PROMPT, (p: RunPromptPayload) => {
    useGameStore.setState({ runPrompt: p });
  });

  socket.on(S2C.CRAWL_PROMPT, (p: CrawlPromptPayload) => {
    useGameStore.setState({ crawlPrompt: p });
  });

  socket.on(S2C.AFTERMATH_PROMPT, (p: AftermathPromptPayload) => {
    useGameStore.setState({ aftermathPrompt: p });
  });

  socket.on(S2C.HEALING_PROMPT, (p: HealingPromptPayload) => {
    useGameStore.setState({ healingPrompt: p });
  });

  socket.on(S2C.CLOCK, (p: ClockPayload) => {
    useGameStore.setState({ clockSeconds: Math.max(0, p.seconds) });
  });

  let roundCardsSeq = 0;
  socket.on(S2C.ROUND_CARDS, (p: RoundCardsPayload) => {
    useGameStore.setState({ roundCardsDeal: { ...p, seq: ++roundCardsSeq } });
  });

  socket.on(S2C.PRIVATE_NOTES, (p: PrivateNotesPayload) => {
    useGameStore.setState((s) => ({ privateNotesData: { ...s.privateNotesData, [p.characterId]: p.text } }));
  });

  socket.on(S2C.DM_NOTES, (p: DmNotesPayload) => {
    useGameStore.setState((s) => ({ dmNotesData: { ...s.dmNotesData, [p.characterId]: p.text } }));
  });

  socket.on(S2C.PUBLIC_SHEET, (p: PublicSheetPayload) => {
    useGameStore.setState((s) => ({ publicSheets: { ...s.publicSheets, [p.characterId]: p } }));
  });

  socket.on(S2C.IRON_DICE, (p: IronDicePayload) => {
    useGameStore.setState({ ironDice: p });
  });

  socket.on(S2C.ROLL_STATS, (p: RollStatsPayload) => {
    useGameStore.setState((s) => ({
      rollStatsData: { ...s.rollStatsData, [p.characterId ?? 'account']: p },
    }));
  });

  socket.on(S2C.BENNY_STATE, (p: BennyStatePayload) => {
    useGameStore.setState((s) => ({ bennyState: { ...s.bennyState, [p.characterId]: p } }));
  });

  socket.on(S2C.SFX_PLAY, ({ url }: SfxPlayPayload) => {
    if (useGameStore.getState().clientMuted) return;
    const el = new Audio(url);
    el.volume = useGameStore.getState().localSfxVolume;
    // Autoplay can be blocked until the user has interacted with the page;
    // a failed effect is not worth surfacing, the music player already
    // carries the "click to enable audio" affordance.
    void el.play().catch(() => {});
  });

  socket.on(S2C.SHOPS, ({ shops }: { shops: Shop[] }) => {
    useGameStore.setState({ shopList: shops });
  });

  socket.on(S2C.SHOP_PRESENTATION, ({ shopId }: { shopId: string | null }) => {
    useGameStore.setState({ presentedShopId: shopId });
  });

  socket.on(S2C.LOCATIONS, ({ locations }: { locations: LocationNode[] }) => {
    useGameStore.setState({ locationList: locations });
  });

  socket.on(S2C.WORLD_FOLDERS, ({ folders }: { folders: WorldFolder[] }) => {
    useGameStore.setState({ worldFolderList: folders });
  });

  socket.on(S2C.WORLD_SORT, ({ orders }: { orders: Record<string, number> }) => {
    useGameStore.setState({ worldSort: orders });
  });

  // The DM removed us from this campaign: back to the campaign list.
  socket.on(S2C.BOOTED, ({ campaignId }: { campaignId: string }) => {
    const s = useGameStore.getState();
    if (s.campaign?.id !== campaignId) return;
    s.leave();
    useGameStore.setState({ errorToast: 'You were removed from the campaign by the DM.' });
  });

  // The DM pushed the character-creator wizard to this player's screen.
  socket.on(S2C.OPEN_CREATOR, () => {
    const s = useGameStore.getState();
    if (s.you?.role === 'player' && s.campaign) s.setShowCharacterCreator(true);
  });

  socket.on(S2C.CUSTOM_NPCS, ({ npcs }: { npcs: CustomNpcView[] }) => {
    useGameStore.setState({ customNpcs: npcs });
  });

  socket.on(S2C.CUSTOM_ITEMS, ({ items }: { items: CustomItem[] }) => {
    useGameStore.setState({ customItems: items });
  });

  socket.on(S2C.MAP_OBJECT_UPSERTED, ({ object }: { object: MapObject }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ mapObjects: { ...s.mapObjects, [object.id]: object } });
  });

  socket.on(S2C.MAP_OBJECT_REMOVED, ({ objectId }: { objectId: string }) => {
    const s = useGameStore.getState();
    const mapObjects = { ...s.mapObjects };
    delete mapObjects[objectId];
    useGameStore.setState({
      mapObjects,
      lootPopupId: s.lootPopupId === objectId ? null : s.lootPopupId,
      inspectedObjectId: s.inspectedObjectId === objectId ? null : s.inspectedObjectId,
    });
  });

  socket.on(S2C.INITIATIVE, ({ state }: { state: InitiativeState }) => {
    useGameStore.setState({ initiativeState: state });
  });

  // SWADE action-deck draw: drives the card-flip animation overlay (seq keeps
  // back-to-back draws distinct so each one restarts the flip).
  socket.on(S2C.INIT_CARD_DRAWN, (p: InitCardDrawnPayload) => {
    const s = useGameStore.getState();
    useGameStore.setState({ cardDrawFlash: { seq: (s.cardDrawFlash?.seq ?? 0) + 1, ...p } });
  });

  socket.on(S2C.HANDOUTS, ({ handouts }: { handouts: Handout[] }) => {
    useGameStore.setState({ handoutList: handouts });
  });

  socket.on(S2C.OPEN_HANDOUT, ({ handoutId, title }: { handoutId: string; title: string }) => {
    // DM pushed this to the table: front and center of the map pane.
    openWindow('handout', handoutId, {}, title, { centered: true });
  });

  socket.on(S2C.DIRECTORY, (payload: DirectoryPayload) => {
    useGameStore.setState({ directory: payload });
  });

  socket.on(S2C.DRAWING_ADDED, ({ drawing }: { drawing: Drawing }) => {
    const s = useGameStore.getState();
    if (s.map?.id !== drawing.mapId) return;
    useGameStore.setState({ drawingList: [...s.drawingList, drawing] });
  });

  socket.on(S2C.DRAWING_REMOVED, ({ drawingId }: { drawingId: string }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ drawingList: s.drawingList.filter((d) => d.id !== drawingId) });
  });

  socket.on(S2C.DRAWINGS_CLEARED, ({ mapId, layer }: { mapId: string; layer: DrawingLayerName }) => {
    const s = useGameStore.getState();
    if (s.map?.id !== mapId) return;
    useGameStore.setState({ drawingList: s.drawingList.filter((d) => d.layer !== layer) });
  });

  socket.on(S2C.PING_SHOWN, (p: PingShownPayload) => {
    const id = ++pingCounter;
    const s = useGameStore.getState();
    useGameStore.setState({ pings: [...s.pings, { ...p, id }] });
    setTimeout(() => {
      const cur = useGameStore.getState();
      useGameStore.setState({ pings: cur.pings.filter((x) => x.id !== id) });
    }, 3000);
  });

  socket.on(S2C.MEASURE_SHOWN, (p: MeasureShownPayload) => {
    const s = useGameStore.getState();
    const measures = { ...s.measures };
    if (p.active) measures[p.userId] = p;
    else delete measures[p.userId];
    useGameStore.setState({ measures });
  });

  socket.on(S2C.AOE_PREVIEW_SHOWN, (p: AoePreviewShownPayload) => {
    const s = useGameStore.getState();
    const aoePreviews = { ...s.aoePreviews };
    if (p.active) aoePreviews[p.userId] = p;
    else delete aoePreviews[p.userId];
    useGameStore.setState({ aoePreviews });
  });

  socket.on(S2C.TARGET_PREVIEW_SHOWN, (p: TargetPreviewShownPayload) => {
    const s = useGameStore.getState();
    const targetPreviews = { ...s.targetPreviews };
    if (p.active) targetPreviews[p.userId] = p;
    else delete targetPreviews[p.userId];
    useGameStore.setState({ targetPreviews });
  });

  // The whole roster, authoritative — replace rather than merge, so someone
  // who joined after us appears and someone removed from the campaign goes.
  socket.on(S2C.MEMBER_PRESENCE, ({ members }: MemberPresencePayload) => {
    useGameStore.setState({ members });
  });

  socket.on(S2C.ACTIVE_MAP, ({ mapId }: { mapId: string | null }) => {
    const s = useGameStore.getState();
    if (s.campaign) {
      useGameStore.setState({ campaign: { ...s.campaign, activeMapId: mapId } });
    }
  });

  socket.on(S2C.ERROR_MSG, ({ message }: { message: string }) => {
    // Something was refused. We can't tell WHICH move from the message, but a
    // refusal is exactly the case a predicted position must not survive — so
    // every outstanding guess snaps back to where the server has the token.
    // Waiting out the guard here would leave a token standing in a wall with
    // the reason why sitting on screen beside it.
    useGameStore.setState({ errorToast: message, predictedMoves: {} });
    setTimeout(() => {
      if (useGameStore.getState().errorToast === message) {
        useGameStore.setState({ errorToast: null });
      }
    }, 5000);
  });
}

// ---------- intent emitters ----------

/** Jump the right-hand dock to the Chat tab — called by every intent that
 *  causes a die to actually get rolled, so the roller always sees it land. */
function jumpToChat(): void {
  useGameStore.getState().setDockTab('chat');
}

/** Chat slash-commands that resolve to an actual dice roll: /r, /roll, /gr. */
const CHAT_ROLL_PREFIX = /^\/(r|roll|gr)\b/i;
function isRollCommand(text: string): boolean {
  return CHAT_ROLL_PREFIX.test(text.trim());
}

/**
 * Where a move can actually get to, judged against the walls this client
 * knows about. Returns null when the token cannot move at all — the caller
 * then does nothing whatsoever, which is the point: a step into a wall you
 * can see should be a no-op, not a round trip and a snap back.
 *
 * The DM is never clamped here; they hold the real geometry and their own
 * moves are unrestricted by design. And a player who knows about no walls
 * yet is not clamped either — an empty list means "nothing discovered", not
 * "nowhere is blocked", so the server stays the only authority in the dark.
 */
export function clampToKnownWalls(tokenId: string, to: Hex, drag = false): Hex | null {
  const s = useGameStore.getState();
  const from = s.tokens[tokenId];
  if (!from || !s.map) return to;
  if (s.isDm() && !s.viewingAs) return to;
  if (s.knownWalls.length === 0) return to;
  // The server lets a player DRAG straight onto ground they personally
  // remember when no initiative is running — crossing a wall to a room they
  // have already explored is not scouting, it is saving them a walk. Mirror
  // that here, or the clamp would quietly take the feature away.
  if (drag && !s.initiativeState.active && s.explored?.has(packHex(to))) return to;

  // Each fragment is its own two-point wall; reachableAlong only cares about
  // the segments, not which polyline they came from.
  const walls = s.knownWalls.map((seg, i) => ({
    id: `known-${i}`, points: [seg.a, seg.b], type: 'solid' as const,
  }));
  const start = tokenHexFor(from);
  const stop = reachableAlong(start, to, { grid: s.map.grid, walls, doors: s.knownDoors });
  if (stop.q === start.q && stop.r === start.r) return null;   // held up
  return stop;
}

/**
 * How long a predicted position stands on its own.
 *
 * Every refusal the server knows how to give now answers — a wall bump echoes
 * the token back unchanged, and the rest report an error — so this is only a
 * backstop for a message that goes missing entirely. Kept short: a token
 * standing somewhere it never reached is worse than a brief stutter.
 */
const PREDICTION_TTL_MS = 1200;
const predictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Put the token where the mover just asked for it, now, without waiting for
 * the round trip. Replaced by the server's own answer as soon as it lands.
 */
function predictMove(tokenId: string, q: number, r: number): void {
  const s = useGameStore.getState();
  // Nothing to predict if it is already there — and predicting during a
  // preview would fight the vision feed that drives tokens in that mode.
  if (s.viewingAs) return;
  const tok = s.tokens[tokenId];
  if (!tok) return;
  useGameStore.setState({ predictedMoves: { ...s.predictedMoves, [tokenId]: { q, r } } });

  clearTimeout(predictionTimers.get(tokenId));
  predictionTimers.set(tokenId, setTimeout(() => {
    predictionTimers.delete(tokenId);
    const cur = useGameStore.getState();
    if (!cur.predictedMoves[tokenId]) return;
    const next = { ...cur.predictedMoves };
    delete next[tokenId];
    useGameStore.setState({ predictedMoves: next });
  }, PREDICTION_TTL_MS));
}

/** Where a token should be drawn: your own guess if you have one, else the
 *  server's position. One place, so every caller agrees. */
export function tokenHexFor(token: { id: string; q: number; r: number }): { q: number; r: number } {
  const p = useGameStore.getState().predictedMoves[token.id];
  return p ?? { q: token.q, r: token.r };
}

export const intents = {
  switchMap: (mapId: string) => socket.emit(C2S.SWITCH_ACTIVE_MAP, { mapId }),
  viewMap: (mapId: string | null) => socket.emit(C2S.VIEW_MAP, { mapId }),
  assignPlayerMap: (userId: string, mapId: string | null) =>
    socket.emit(C2S.ASSIGN_PLAYER_MAP, { userId, mapId }),
  dmViewAs: (userId: string | null) => socket.emit(C2S.DM_VIEW_AS, { userId }),

  createMap: (name: string, isScene = false) => socket.emit(C2S.CREATE_MAP, { name, isScene }),
  deleteMap: (mapId: string) => socket.emit(C2S.DELETE_MAP, { mapId }),
  updateMap: (mapId: string, fields: { name?: string; bgAssetId?: string | null }) =>
    socket.emit(C2S.UPDATE_MAP, { mapId, ...fields }),
  setGrid: (mapId: string, grid: Partial<GridConfig>) => socket.emit(C2S.SET_GRID_CONFIG, { mapId, grid }),
  setSpawn: (mapId: string, q: number, r: number) => socket.emit(C2S.SET_SPAWN, { mapId, q, r }),
  /** Send only the set being edited; the other is left as it is. */
  setTerrain: (mapId: string, sets: { terrain?: number[]; blocked?: number[] } | number[]) =>
    socket.emit(C2S.SET_TERRAIN, { mapId, ...(Array.isArray(sets) ? { terrain: sets } : sets) }),

  upsertWall: (mapId: string, wall: { id?: string; points: Array<{ x: number; y: number }>; type?: 'solid' | 'window' | 'oneway' | 'stainedglass'; flip?: boolean; glassColor?: string; rainbow?: boolean }) =>
    socket.emit(C2S.UPSERT_WALL, { mapId, wall }),
  deleteWall: (mapId: string, wallId: string) => socket.emit(C2S.DELETE_WALL, { mapId, wallId }),
  upsertDoor: (mapId: string, door: { id?: string; a: { x: number; y: number }; b: { x: number; y: number }; open?: boolean; type?: DoorType; locked?: boolean; keyName?: string | null }) =>
    socket.emit(C2S.UPSERT_DOOR, { mapId, door }),
  deleteDoor: (mapId: string, doorId: string) => socket.emit(C2S.DELETE_DOOR, { mapId, doorId }),
  toggleDoor: (mapId: string, doorId: string) => socket.emit(C2S.TOGGLE_DOOR, { mapId, doorId }),
  upsertLight: (mapId: string, light: { id?: string; x: number; y: number; brightRadius: number; dimRadius: number; color?: string }) =>
    socket.emit(C2S.UPSERT_LIGHT, { mapId, light }),
  deleteLight: (mapId: string, lightId: string) => socket.emit(C2S.DELETE_LIGHT, { mapId, lightId }),
  upsertMapText: (mapId: string, text: { id?: string; x: number; y: number; text: string; size?: number; color?: string; font?: string; bold?: boolean; italic?: boolean }) =>
    socket.emit(C2S.UPSERT_MAP_TEXT, { mapId, text }),
  deleteMapText: (mapId: string, textId: string) => socket.emit(C2S.DELETE_MAP_TEXT, { mapId, textId }),
  renameLight: (lightId: string, mapId: string, name: string) => socket.emit(C2S.RENAME_LIGHT, { lightId, mapId, name }),
  moveLightToMap: (lightId: string, sourceMapId: string, targetMapId: string) =>
    socket.emit(C2S.MOVE_LIGHT_TO_MAP, { lightId, sourceMapId, targetMapId }),
  linkLightToToken: (lightId: string, sourceMapId: string, tokenId: string) =>
    socket.emit(C2S.LINK_LIGHT_TO_TOKEN, { lightId, sourceMapId, tokenId }),
  unlinkLightFromToken: (tokenId: string, mapId: string) =>
    socket.emit(C2S.UNLINK_LIGHT_FROM_TOKEN, { tokenId, mapId }),
  autoTraceWalls: (mapId: string) => socket.emit(C2S.AUTO_TRACE_WALLS, { mapId }),

  createToken: (payload: {
    mapId: string; name: string; q: number; r: number; characterId?: string | null;
    artAssetId?: string | null; layer?: 'token' | 'gm'; size?: number; color?: string;
    vision?: VisionStats | null; bar?: { hp: number; maxHp: number } | null;
  }) => socket.emit(C2S.CREATE_TOKEN, payload),
  deleteToken: (tokenId: string) => socket.emit(C2S.DELETE_TOKEN, { tokenId }),
  updateToken: (tokenId: string, patch: Record<string, unknown>) => socket.emit(C2S.UPDATE_TOKEN, { tokenId, patch }),
  /** Climb onto a mount the DM marked rideable, or dismount (mountId null). */
  mountToken: (tokenId: string, mountId: string | null) => socket.emit(C2S.MOUNT_TOKEN, { tokenId, mountId }),
  /** `drag` marks a deliberate drag-and-drop; keyboard steps leave it off so
   *  they always collide with walls. */
  moveToken: (tokenId: string, q: number, r: number, drag = false) => {
    // Stop at the first wall we already know about, before anything is sent.
    // The server enforces this too — it has the whole map and we only have the
    // parts we've explored — but doing it here is what removes the twitch:
    // walking into a known wall now does nothing at all, rather than moving
    // and being pushed back when the answer comes.
    const dest = clampToKnownWalls(tokenId, { q, r }, drag);
    if (!dest) return;
    predictMove(tokenId, dest.q, dest.r);
    socket.emit(C2S.MOVE_TOKEN, { tokenId, q: dest.q, r: dest.r, drag });
  },
  dragToken: (tokenId: string, x: number, y: number, done = false) =>
    socket.emit(C2S.DRAG_TOKEN, { tokenId, x, y, done }),

  createCharacter: (
    name: string, system: GameSystem, ownerUserId?: string | null, initialClass?: string,
    opts?: { sheetPatch?: SheetData; placeToken?: boolean },
  ) =>
    socket.emit(C2S.CREATE_CHARACTER, { name, system, ownerUserId, initialClass, ...opts }),
  createNpc: (libraryId: string, name?: string) => socket.emit(C2S.CREATE_NPC, { libraryId, name }),
  saveToCompendium: (characterId: string) => socket.emit(C2S.SAVE_TO_COMPENDIUM, { characterId }),
  deleteCustomNpc: (customNpcId: string) => socket.emit(C2S.DELETE_CUSTOM_NPC, { customNpcId }),
  createRandomNpc: (count?: number, modelId?: string) => socket.emit(C2S.CREATE_RANDOM_NPC, { count, modelId }),
  deleteCharacter: (characterId: string) => socket.emit(C2S.DELETE_CHARACTER, { characterId }),
  updateCharacter: (characterId: string, patch: Record<string, unknown>, name?: string) =>
    socket.emit(C2S.UPDATE_CHARACTER, { characterId, patch, name }),
  /** DM-only: reassign who controls a character. null = DM-only NPC. */
  setCharacterOwner: (characterId: string, ownerUserId: string | null) =>
    socket.emit(C2S.UPDATE_CHARACTER, { characterId, patch: {}, ownerUserId }),
  levelUpRoll: (p: { characterId: string; patch: Record<string, unknown>; hitDie: number; conMod: number; avgHp: number; label: string }) => {
    jumpToChat();
    socket.emit(C2S.LEVEL_UP_ROLL, p);
  },
  sheetRoll: (characterId: string, rollableId: string, adv?: 'adv' | 'dis' | null) => {
    jumpToChat();
    socket.emit(C2S.SHEET_ROLL, { characterId, rollableId, adv });
  },

  chat: (text: string) => {
    if (isRollCommand(text)) jumpToChat();
    socket.emit(C2S.CHAT, { text });
  },
  setDiceColor: (color: string | null) => socket.emit(C2S.SET_DICE_COLOR, { color }),
  setDiceRoleColor: (role: DiceRole, color: string | null) => socket.emit(C2S.SET_DICE_ROLE_COLOR, { role, color }),
  setDiceTextColor: (color: string | null) => socket.emit(C2S.SET_DICE_TEXT_COLOR, { color }),
  setPlayerColor: (color: string | null) => socket.emit(C2S.SET_PLAYER_COLOR, { color }),
  /** How often your dice carom off a wall (0-100, or null for the default). */
  setDiceBounce: (pct: number | null) => socket.emit(C2S.SET_DICE_BOUNCE, { pct }),
  /** How your aced dice celebrate (null for the default flash). */
  setDiceAceStyle: (style: AceStyle | null) => socket.emit(C2S.SET_DICE_ACE_STYLE, { style }),
  setUsername: (username: string) => socket.emit(C2S.SET_USERNAME, { username }),
  saveMacro: (macro: { id?: string; name: string; command: string; color?: string | null; characterId?: string | null; rollableId?: string | null; actionId?: string | null }) =>
    socket.emit(C2S.SAVE_MACRO, { macro }),
  reorderMacros: (macroIds: string[]) => socket.emit(C2S.REORDER_MACROS, { macroIds }),
  deleteMacro: (macroId: string) => socket.emit(C2S.DELETE_MACRO, { macroId }),
  usePower: (characterId: string, powerIndex: number) => {
    jumpToChat();
    socket.emit(C2S.USE_POWER, { characterId, powerIndex });
  },
  reloadWeapon: (characterId: string, attackIndex: number) =>
    socket.emit(C2S.RELOAD_WEAPON, { characterId, attackIndex }),
  deathSave: (characterId: string) => {
    jumpToChat();
    socket.emit(C2S.DEATH_SAVE, { characterId });
  },
  requestSave: (p: { tokenIds: string[]; saveId: string; dc: number; damageExpr?: string; onSave: 'half' | 'negate'; damageType?: string; label?: string }) => {
    jumpToChat();
    socket.emit(C2S.REQUEST_SAVE, p);
  },
  postSheetCard: (characterId: string, card: SheetCard) => {
    jumpToChat();
    socket.emit(C2S.POST_SHEET_CARD, { characterId, card });
  },
  requestFear: (p: { tokenIds: string[]; fearPenalty: number; source: FearSource; label?: string }) => {
    jumpToChat();
    socket.emit(C2S.REQUEST_FEAR, p);
  },
  moderateMessage: (messageId: number, action: 'hide' | 'unhide' | 'hideUndo') =>
    socket.emit(C2S.MODERATE_MESSAGE, { messageId, action }),
  runMacro: (macroId: string) => {
    const s = useGameStore.getState();
    const m = s.macroList.find((x) => x.id === macroId);
    if (!m) return;
    const char = m.characterId ? s.characters.find((c) => c.id === m.characterId) : undefined;
    // Combat-action pill (usable item / attack): begin targeting. The
    // eventual roll happens on resolveTarget/confirmAoeTargeting, which
    // jump to Chat themselves — no need to do it here too.
    if (m.characterId && m.actionId && char) {
      const action = combatActions(char).find((a) => a.id === m.actionId);
      if (!action) { s.clearError(); useGameStore.setState({ errorToast: `${m.name} is not available right now.` }); return; }
      const src = Object.values(s.tokens).find((t) => t.characterId === char.id && t.mapId === s.map?.id);
      if (!src) { useGameStore.setState({ errorToast: `Place ${char.name}'s token on this map first.` }); return; }
      if (action.aoe) s.beginAoeTargeting(char.id, src.id, action, null);
      else s.beginTargeting(char.id, src.id, action, null);
      return;
    }
    // Spell-roll pill that costs a slot: run the cast flow (castSpell itself jumps to Chat).
    if (m.characterId && m.rollableId && char) {
      const r = systemFor(char.system).rollables(char.sheet).find((x) => x.id === m.rollableId);
      if (r?.slotLevel) { s.beginCast(char.id, m.rollableId, r.slotLevel, r.label); return; }
    }
    jumpToChat();
    if (m.characterId && m.rollableId) socket.emit(C2S.SHEET_ROLL, { characterId: m.characterId, rollableId: m.rollableId });
    else socket.emit(C2S.CHAT, { text: m.command });
  },
  createTable: (name: string) => socket.emit(C2S.CREATE_TABLE, { name }),
  updateTable: (tableId: string, fields: { name?: string; playersCanRoll?: boolean; items?: Array<{ text: string; weight?: number }> }) =>
    socket.emit(C2S.UPDATE_TABLE, { tableId, ...fields }),
  deleteTable: (tableId: string) => socket.emit(C2S.DELETE_TABLE, { tableId }),
  rollTable: (tableId: string) => {
    jumpToChat();
    socket.emit(C2S.ROLL_TABLE, { tableId });
  },

  initAdd: (p: { tokenId?: string | null; name?: string; value?: number; roll?: boolean; hidden?: boolean }) => {
    if (p.roll) jumpToChat();
    socket.emit(C2S.INIT_ADD, p);
  },
  initRemove: (entryId: string) => socket.emit(C2S.INIT_REMOVE, { entryId }),
  initUpdate: (entryId: string, fields: { value?: number; hidden?: boolean; name?: string; reroll?: boolean }) => {
    if (fields.reroll) jumpToChat();
    socket.emit(C2S.INIT_UPDATE, { entryId, ...fields });
  },
  initNext: () => socket.emit(C2S.INIT_NEXT),
  initPrev: () => socket.emit(C2S.INIT_PREV),
  initSort: () => socket.emit(C2S.INIT_SORT),
  initClear: () => socket.emit(C2S.INIT_CLEAR),
  initSetActive: (active: boolean) => socket.emit(C2S.INIT_SET_ACTIVE, { active }),
  initRollMap: (mapId: string, includeGm: boolean) => {
    jumpToChat();
    socket.emit(C2S.INIT_ROLL_MAP, { mapId, includeGm });
  },
  initCardCall: (mapId: string, includeGm: boolean) => socket.emit(C2S.INIT_CARD_CALL, { mapId, includeGm }),
  initCardDraw: (tokenId: string) => socket.emit(C2S.INIT_CARD_DRAW, { tokenId }),
  initRollCall: (mapId: string, includeGm: boolean) => socket.emit(C2S.INIT_ROLL_CALL, { mapId, includeGm }),
  initRollMine: (tokenId: string) => socket.emit(C2S.INIT_ROLL_MINE, { tokenId }),

  draw: (mapId: string, layer: DrawingLayerName, shape: Drawing['shape']) =>
    socket.emit(C2S.DRAW, { mapId, layer, shape }),
  eraseDrawing: (drawingId: string) => socket.emit(C2S.ERASE_DRAWING, { drawingId }),
  clearDrawings: (mapId: string, layer: DrawingLayerName) => socket.emit(C2S.CLEAR_DRAWINGS, { mapId, layer }),
  ping: (x: number, y: number) => socket.emit(C2S.PING, { x, y }),
  measure: (from: Hex, to: Hex, active: boolean) => socket.emit(C2S.MEASURE, { from, to, active }),

  createHandout: (title: string, bodyMd?: string, assetId?: string | null) =>
    socket.emit(C2S.CREATE_HANDOUT, { title, bodyMd, assetId }),
  updateHandout: (handoutId: string, fields: { title?: string; bodyMd?: string; assetId?: string | null }) =>
    socket.emit(C2S.UPDATE_HANDOUT, { handoutId, ...fields }),
  deleteHandout: (handoutId: string) => socket.emit(C2S.DELETE_HANDOUT, { handoutId }),
  shareHandout: (handoutId: string, to: string[] | 'all' | 'none') =>
    socket.emit(C2S.SHARE_HANDOUT, { handoutId, to }),
  requestDirectory: () => socket.emit(C2S.REQUEST_DIRECTORY),

  requestAssets: () => socket.emit(C2S.REQUEST_ASSETS),
  createFolder: (name: string, kind: 'art' | 'handout') => socket.emit(C2S.CREATE_FOLDER, { name, kind }),
  renameFolder: (folderId: string, name: string) => socket.emit(C2S.RENAME_FOLDER, { folderId, name }),
  deleteFolder: (folderId: string) => socket.emit(C2S.DELETE_FOLDER, { folderId }),
  moveAsset: (assetId: string, folderId: string | null) => socket.emit(C2S.MOVE_ASSET, { assetId, folderId }),
  renameAsset: (assetId: string, title: string) => socket.emit(C2S.RENAME_ASSET, { assetId, title }),
  deleteAsset: (assetId: string) => socket.emit(C2S.DELETE_ASSET, { assetId }),
  moveHandout: (handoutId: string, folderId: string | null) => socket.emit(C2S.MOVE_HANDOUT, { handoutId, folderId }),

  /** End the current combatant's turn (your own character, or any if DM). */
  endTurn: () => socket.emit(C2S.INIT_END_TURN, {}),
  /** SWADE: hold your action / jump back in with a held one. */
  holdTurn: () => socket.emit(C2S.INIT_HOLD, {}),
  actNow: (entryId: string) => socket.emit(C2S.INIT_ACT_NOW, { entryId }),
  soakRoll: (characterId: string, spend: boolean) => {
    socket.emit(C2S.SOAK_ROLL, { characterId, spend });
    useGameStore.setState({ soakOffer: null });
  },
  /** Answer the grenade at your feet. Dismiss locally straight away: the
   *  server closes the window for everyone, but the person who just clicked
   *  should not sit looking at a prompt they've already answered. */
  blastResponse: (blastId: string, characterId: string, choice: BlastChoice) => {
    socket.emit(C2S.BLAST_RESPONSE, { blastId, characterId, choice });
    useGameStore.setState({ blastOffer: null });
  },
  /** Spend a Benny from the Benny menu. */
  bennyUse: (characterId: string, use: BennyUseId) => socket.emit(C2S.BENNY_USE, { characterId, use }),
  /** DM: hand a character a Benny (announced in chat). */
  awardBenny: (characterId: string) => socket.emit(C2S.BENNY_AWARD, { characterId }),
  /** DM: start a new session — every hero draws a fresh hand of Bennies. */
  startSession: () => socket.emit(C2S.SESSION_START, { confirm: true }),
  /** Fetch lifetime roll stats (account-wide, or one character's). */
  getRollStats: (characterId?: string) => socket.emit(C2S.ROLL_STATS_GET, { characterId: characterId ?? null }),
  /** Fetch the public-facing sheet of a character you don't control. */
  getPublicSheet: (characterId: string) => socket.emit(C2S.PUBLIC_SHEET_GET, { characterId }),
  /** DM: persist a manual ordering of one parent's world-tree children. */
  worldReorder: (keys: string[]) => socket.emit(C2S.WORLD_REORDER, { keys }),
  /** DM-only: force-reveal / force-hide / reset a world-tab entry. */
  worldOverride: (kind: 'map' | 'token' | 'character', key: string, mode: 'reveal' | 'hide' | 'clear') =>
    socket.emit(C2S.WORLD_OVERRIDE, { kind, key, mode }),
  /** DM counters: banner bars over the map. */
  counterCreate: (mapId: string) => socket.emit(C2S.COUNTER_CREATE, { mapId }),
  counterUpdate: (counterId: string, patch: Partial<Counter>) => socket.emit(C2S.COUNTER_UPDATE, { counterId, patch }),
  counterDelete: (counterId: string) => socket.emit(C2S.COUNTER_DELETE, { counterId }),
  /** My own private notes on a character (public-sheet scratchpad). */
  getPrivateNotes: (characterId: string) => socket.emit(C2S.PRIVATE_NOTES_GET, { characterId }),
  setPrivateNotes: (characterId: string, text: string) => socket.emit(C2S.PRIVATE_NOTES_SET, { characterId, text }),
  /** DM-only: read / write the secret notes on a character. */
  getDmNotes: (characterId: string) => socket.emit(C2S.DM_NOTES_GET, { characterId }),
  setDmNotes: (characterId: string, text: string) => socket.emit(C2S.DM_NOTES_SET, { characterId, text }),
  /** IronDice: fetch commitment state / rotate the seed (DM). */
  getIronDice: () => socket.emit(C2S.IRON_DICE_GET, {}),
  rotateIronDice: () => socket.emit(C2S.IRON_DICE_ROTATE, {}),
  /** Make the Bleeding Out Vigor roll the prompt asked for. */
  bleedRoll: (characterId: string) => {
    socket.emit(C2S.BLEED_ROLL, { characterId });
    useGameStore.setState({ bleedPrompt: null });
  },
  /** Make the Shaken-recovery Spirit roll the prompt asked for. */
  shakenRoll: (characterId: string) => {
    socket.emit(C2S.SHAKEN_ROLL, { characterId });
    useGameStore.setState({ shakenPrompt: null });
  },
  /** DM: remove a player from the campaign (characters revert to DM control). */
  /** DM: wipe one player's discovered-world memory (omit for everyone). */
  forgetKnowledge: (userId?: string) => socket.emit(C2S.FORGET_KNOWLEDGE, { userId }),
  bootPlayer: (userId: string) => socket.emit(C2S.BOOT_PLAYER, { userId }),
  /** DM: open the character-creator wizard on a player's screen. */
  sendCreator: (userId: string) => socket.emit(C2S.SEND_CREATOR, { userId }),
  /** SWADE: spend the whole turn Aiming — pays out on next turn's first shot. */
  combatAim: (characterId: string, tokenId: string) => socket.emit(C2S.COMBAT_AIM, { characterId, tokenId }),
  /** Make the Stunned-recovery Vigor roll the prompt asked for. */
  stunRoll: (characterId: string) => {
    socket.emit(C2S.STUN_ROLL, { characterId });
    useGameStore.setState({ stunPrompt: null });
  },
  /** Proceed to the Incapacitation Vigor roll (closes the window). */
  incapRoll: (characterId: string) => {
    socket.emit(C2S.INCAP_ROLL, { characterId });
    useGameStore.setState({ incapPrompt: null });
  },
  /** DM only: skip the Incapacitation roll — the Wild Card dies outright. */
  incapDeath: (characterId: string) => {
    socket.emit(C2S.INCAP_DEATH, { characterId });
    useGameStore.setState({ incapPrompt: null });
  },
  /** Accept the run: roll the running die to extend this turn's Pace. */
  runRoll: (tokenId: string) => {
    socket.emit(C2S.RUN_ROLL, { tokenId });
    useGameStore.setState({ runPrompt: null });
  },
  /** Leap: free at 1″ (2″ off a run-up), or spend the action on Athletics. */
  jumpRoll: (tokenId: string, withRunUp: boolean, athletics: boolean) =>
    socket.emit(C2S.JUMP_ROLL, { tokenId, withRunUp, athletics }),
  /** DM: move the in-world clock forward one step. */
  advanceTime: (step: TimeStepId) => socket.emit(C2S.ADVANCE_TIME, { step }),
  /** Answer the natural-healing prompt: roll for the wounded, or not yet. */
  healingRoll: (roll: boolean) => {
    socket.emit(C2S.HEALING_ROLL, { roll });
    useGameStore.setState({ healingPrompt: null });
  },
  /** Answer the aftermath prompt: roll for the fallen Extras, or let them go. */
  aftermathRoll: (roll: boolean) => {
    socket.emit(C2S.AFTERMATH_ROLL, { roll });
    useGameStore.setState({ aftermathPrompt: null });
  },
  /** Answer the crawl prompt: get up, or stay down and crawl. */
  proneMove: (tokenId: string, mode: 'stand' | 'crawl') => {
    socket.emit(C2S.PRONE_MOVE, { tokenId, mode });
    useGameStore.setState({ crawlPrompt: null });
  },
  setSoundboardSlot: (slotIndex: number, assetId: string, label: string) =>
    socket.emit(C2S.SET_SOUNDBOARD_SLOT, { slotIndex, assetId, label }),
  clearSoundboardSlot: (slotIndex: number) => socket.emit(C2S.CLEAR_SOUNDBOARD_SLOT, { slotIndex }),
  playSfx: (slotIndex: number) => socket.emit(C2S.PLAY_SFX, { slotIndex }),
  addAudio: (assetId: string, title: string, playlist?: number) => socket.emit(C2S.ADD_AUDIO, { assetId, title, playlist }),
  removeAudio: (trackId: string) => socket.emit(C2S.REMOVE_AUDIO, { trackId }),
  audioControl: (p: { trackId?: string; action: 'play' | 'stop' | 'pause'; loop?: boolean; shuffle?: boolean; playlist?: number; volume?: number }) =>
    socket.emit(C2S.AUDIO_CONTROL, p),

  createShop: (name: string) => socket.emit(C2S.CREATE_SHOP, { name }),
  updateShop: (shopId: string, fields: Record<string, unknown>) => socket.emit(C2S.UPDATE_SHOP, { shopId, ...fields }),
  deleteShop: (shopId: string) => socket.emit(C2S.DELETE_SHOP, { shopId }),
  buyItem: (shopId: string, itemIndex: number, characterId: string) => socket.emit(C2S.BUY_ITEM, { shopId, itemIndex, characterId }),
  presentShop: (shopId: string, userIds: string[] | 'all') => socket.emit(C2S.PRESENT_SHOP, { shopId, userIds }),
  dismissShop: () => socket.emit(C2S.DISMISS_SHOP),

  createLocation: (name: string, parentId?: string | null) => socket.emit(C2S.CREATE_LOCATION, { name, parentId }),
  updateLocation: (locationId: string, fields: Record<string, unknown>) => socket.emit(C2S.UPDATE_LOCATION, { locationId, ...fields }),
  deleteLocation: (locationId: string) => socket.emit(C2S.DELETE_LOCATION, { locationId }),

  /** Pure-organization world-tree folders (DM). Distinct from the art/handout library's asset folders. */
  createWorldFolder: (name: string, parentId?: string | null, opts?: { displayKind?: 'folder' | 'chest'; items?: unknown[] }) =>
    socket.emit(C2S.CREATE_WORLD_FOLDER, { name, parentId, ...opts }),
  updateWorldFolder: (folderId: string, fields: Record<string, unknown>) => socket.emit(C2S.UPDATE_WORLD_FOLDER, { folderId, ...fields }),
  deleteWorldFolder: (folderId: string) => socket.emit(C2S.DELETE_WORLD_FOLDER, { folderId }),

  /** Reparent any world-tree entity (DM). parentId=null → top level. */
  setParent: (kind: 'location' | 'character' | 'shop' | 'table' | 'handout' | 'map' | 'folder', id: string, parentId: string | null) => {
    if (kind === 'character') socket.emit(C2S.UPDATE_CHARACTER, { characterId: id, patch: {}, parentId });
    else if (kind === 'location') socket.emit(C2S.UPDATE_LOCATION, { locationId: id, parentId });
    else if (kind === 'shop') socket.emit(C2S.UPDATE_SHOP, { shopId: id, parentId });
    else if (kind === 'table') socket.emit(C2S.UPDATE_TABLE, { tableId: id, parentId });
    else if (kind === 'handout') socket.emit(C2S.UPDATE_HANDOUT, { handoutId: id, parentId });
    else if (kind === 'map') socket.emit(C2S.UPDATE_MAP, { mapId: id, parentId });
    else if (kind === 'folder') socket.emit(C2S.UPDATE_WORLD_FOLDER, { folderId: id, parentId });
  },

  /** Dragged a character from the World tab straight onto the map canvas: nest it under the map and drop its token at the exact hex released. */
  dropCharacterOnMap: (characterId: string, mapId: string, q: number, r: number) =>
    socket.emit(C2S.UPDATE_CHARACTER, { characterId, patch: {}, parentId: mapId, dropHex: { q, r } }),

  dropFolderOnMap: (folderId: string, mapId: string, q?: number, r?: number) =>
    socket.emit(C2S.DROP_FOLDER_ON_MAP, { folderId, mapId, q, r }),
  dropShopOnMap: (shopId: string, mapId: string, q: number, r: number) =>
    socket.emit(C2S.DROP_SHOP_ON_MAP, { shopId, mapId, q, r }),
  dropFolderOnCharacter: (folderId: string, characterId: string) =>
    socket.emit(C2S.DROP_FOLDER_ON_CHARACTER, { folderId, characterId }),

  // map loot objects
  placeMapObject: (mapId: string, kind: 'item' | 'chest', name: string, q: number, r: number, description?: string) =>
    socket.emit(C2S.PLACE_MAP_OBJECT, { mapId, kind, name, description, q, r }),
  updateMapObject: (objectId: string, patch: { name?: string; description?: string; artAssetId?: string; detailAssetId?: string; q?: number; r?: number; items?: LootItem[]; interactRange?: number; locked?: boolean; keyName?: string | null; linkedCharacterId?: string | null }) =>
    socket.emit(C2S.UPDATE_MAP_OBJECT, { objectId, patch }),
  deleteMapObject: (objectId: string) => socket.emit(C2S.DELETE_MAP_OBJECT, { objectId }),
  takeMapItem: (objectId: string) => socket.emit(C2S.TAKE_MAP_ITEM, { objectId }),
  takeChestItem: (objectId: string, itemId: string) => socket.emit(C2S.TAKE_CHEST_ITEM, { objectId, itemId }),
  takeAllChest: (objectId: string) => socket.emit(C2S.TAKE_ALL_CHEST, { objectId }),
  openChest: (objectId: string) => socket.emit(C2S.OPEN_CHEST, { objectId }),

  // custom compendium items
  createCustomItem: (entryJson: string) => socket.emit(C2S.CREATE_CUSTOM_ITEM, { entryJson }),
  updateCustomItem: (itemId: string, entryJson: string) => socket.emit(C2S.UPDATE_CUSTOM_ITEM, { itemId, entryJson }),
  deleteCustomItem: (itemId: string) => socket.emit(C2S.DELETE_CUSTOM_ITEM, { itemId }),
};
