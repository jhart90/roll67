// Socket protocol contract. Every event name and payload shape lives here;
// server handlers and client store both import from this file only.

import type {
  AoePreviewInfo, AoeShape, AssetFolder, AssetInfo, AudioState, AudioTrack,
  CampaignInfo, Character, ChatMessage, DiceSpeed, Door, DoorType, Drawing, DrawingLayerName,
  GameSystem, GridConfig, Handout, Hex, ImpactKind, InitiativeState, LocationNode, Light, LootItem, Macro,
  MapDef, MapMeta, MapText, MapView, MapZone, MeasureInfo, MemberInfo, PingInfo, Point,
  Counter, NameplateLine, RollableTable, SheetData, Shop, SoundboardSlot, TargetPreviewInfo, Token, TokenLayer, TokenShape, TokenView, VisionStats, WallType, WorldFolder,
} from './types.js';
import type { VisibilityLitMask } from './vision/fov.js';
import type { KnownWallSegment } from './vision/wallMemory.js';
import type { CardBackSpec, PlayingCard } from './systems/cards.js';

// ---------- Client -> server intents ----------

export const C2S = {
  // session
  JOIN_CAMPAIGN: 'joinCampaign',
  LEAVE_CAMPAIGN: 'leaveCampaign',
  /** DM: remove a player from the campaign (their characters revert to DM control). */
  BOOT_PLAYER: 'bootPlayer',
  /** DM: pop the character-creator wizard open on a player's screen. */
  SEND_CREATOR: 'sendCreator',
  /** DM: wipe a player's discovered-world memory so they start blank again. */
  FORGET_KNOWLEDGE: 'forgetKnowledge',
  SWITCH_ACTIVE_MAP: 'switchActiveMap',
  VIEW_MAP: 'viewMap',
  ASSIGN_PLAYER_MAP: 'assignPlayerMap',
  DM_VIEW_AS: 'dmViewAs',
  // maps (DM)
  CREATE_MAP: 'createMap',
  DELETE_MAP: 'deleteMap',
  UPDATE_MAP: 'updateMap',
  SET_GRID_CONFIG: 'setGridConfig',
  SET_SPAWN: 'setSpawn',
  SET_TERRAIN: 'setTerrain',
  // map geometry (DM, except toggleDoor)
  UPSERT_WALL: 'upsertWall',
  DELETE_WALL: 'deleteWall',
  UPSERT_DOOR: 'upsertDoor',
  DELETE_DOOR: 'deleteDoor',
  TOGGLE_DOOR: 'toggleDoor',
  UPSERT_LIGHT: 'upsertLight',
  DELETE_LIGHT: 'deleteLight',
  UPSERT_MAP_TEXT: 'upsertMapText',
  DELETE_MAP_TEXT: 'deleteMapText',
  // tokens
  CREATE_TOKEN: 'createToken',
  DELETE_TOKEN: 'deleteToken',
  UPDATE_TOKEN: 'updateToken',
  MOVE_TOKEN: 'moveToken',
  DRAG_TOKEN: 'dragToken',
  // characters
  CREATE_CHARACTER: 'createCharacter',
  CREATE_NPC: 'createNpc',
  CREATE_RANDOM_NPC: 'createRandomNpc',
  DELETE_CHARACTER: 'deleteCharacter',
  UPDATE_CHARACTER: 'updateCharacter',
  LEVEL_UP_ROLL: 'levelUpRoll',
  SHEET_ROLL: 'sheetRoll',
  CAST_SPELL: 'castSpell',
  COMBAT_ACTION: 'combatAction',
  USE_POWER: 'usePower',
  /** SWN: reload a weapon's magazine from a matching ammo inventory item. */
  RELOAD_WEAPON: 'reloadWeapon',
  DEATH_SAVE: 'deathSave',
  REQUEST_SAVE: 'requestSave',
  REQUEST_FEAR: 'requestFear',
  REQUEST_TEST: 'requestTest',
  TEST_OUTCOME: 'testOutcome',
  POST_SHEET_CARD: 'postSheetCard',
  AOE_PREVIEW: 'aoePreview',
  CAST_AOE: 'castAoe',
  TARGET_PREVIEW: 'targetPreview',
  MODERATE_MESSAGE: 'moderateMessage',
  // shops
  CREATE_SHOP: 'createShop',
  UPDATE_SHOP: 'updateShop',
  DELETE_SHOP: 'deleteShop',
  BUY_ITEM: 'buyItem',
  PRESENT_SHOP: 'presentShop',
  DISMISS_SHOP: 'dismissShop',
  // locations
  CREATE_LOCATION: 'createLocation',
  UPDATE_LOCATION: 'updateLocation',
  DELETE_LOCATION: 'deleteLocation',
  // world-tree folders (pure organization; distinct from the asset-library folders below)
  CREATE_WORLD_FOLDER: 'createWorldFolder',
  UPDATE_WORLD_FOLDER: 'updateWorldFolder',
  DELETE_WORLD_FOLDER: 'deleteWorldFolder',
  // chat & macros
  CHAT: 'chat',
  /** DM: erase the campaign's whole chat log, for every screen at once. */
  CHAT_WIPE: 'chatWipe',
  SAVE_MACRO: 'saveMacro',
  DELETE_MACRO: 'deleteMacro',
  REORDER_MACROS: 'reorderMacros',
  SET_DICE_COLOR: 'setDiceColor',
  SET_DICE_TEXT_COLOR: 'setDiceTextColor',
  SET_DICE_ROLE_COLOR: 'setDiceRoleColor',
  /** How often your dice carom off a wall on their way in (0-100). */
  SET_DICE_BOUNCE: 'setDiceBounce',
  /** How your aced dice celebrate (flash, explosion, flames, disco, rainbow). */
  SET_DICE_ACE_STYLE: 'setDiceAceStyle',
  /** Show the combat turn guide over my map, or don't. */
  SET_TURN_GUIDE: 'setTurnGuide',
  /** DM: how long the whole table spends watching dice. */
  SET_DICE_SPEED: 'setDiceSpeed',
  RENAME_CAMPAIGN: 'renameCampaign',
  DELETE_CAMPAIGN: 'deleteCampaign',
  /** DM: freeze every player's tokens in place (and thaw them again). */
  SET_MOVE_LOCK: 'setMoveLock',
  ADJUST_PACE: 'adjustPace',
  HOLO_PROJECT: 'holoProject',
  HOLO_STOP: 'holoStop',
  SET_ROLL_LOCK: 'setRollLock',
  SET_PLAYER_LOCK: 'setPlayerLock',
  SET_PLAYER_COLOR: 'setPlayerColor',
  SET_USERNAME: 'setUsername',
  /** Save this account's audio mix (music + effects), so it follows the player. */
  SET_VOLUMES: 'setVolumes',
  // rollable tables
  CREATE_TABLE: 'createTable',
  UPDATE_TABLE: 'updateTable',
  DELETE_TABLE: 'deleteTable',
  ROLL_TABLE: 'rollTable',
  // initiative
  INIT_ADD: 'initAdd',
  INIT_REMOVE: 'initRemove',
  INIT_UPDATE: 'initUpdate',
  INIT_NEXT: 'initNext',
  INIT_PREV: 'initPrev',
  INIT_SORT: 'initSort',
  INIT_CLEAR: 'initClear',
  /** SWADE: start a chase — lay out the Chase Card track. */
  CHASE_START: 'chaseStart',
  /** SWADE: tear the track down; the fight (if any) carries on. */
  CHASE_END: 'chaseEnd',
  /** SWADE: Change Position, or drop back, on the chase track. */
  CHASE_MOVE: 'chaseMove',
  /** SWADE: spend the turn's action on a chase maneuver — Force, Ram, Board… */
  CHASE_ACTION: 'chaseAction',
  INIT_SET_ACTIVE: 'initSetActive',
  INIT_ROLL_MAP: 'initRollMap',
  /** SWADE: DM deals a fresh action deck — everyone owes a card draw. */
  INIT_CARD_CALL: 'initCardCall',
  /** SWADE: draw the top card for one pending combatant. */
  INIT_CARD_DRAW: 'initCardDraw',
  /** DM: deal a latecomer into the round already in progress. */
  INIT_DEAL_IN: 'initDealIn',
  /** What would this shot be modified by? Asked while hovering a target. */
  ATTACK_PREVIEW: 'attackPreview',
  /** 5e/SWN: DM calls for initiative — every combatant owes their own roll. */
  INIT_ROLL_CALL: 'initRollCall',
  /** 5e/SWN: roll initiative for one pending combatant. */
  INIT_ROLL_MINE: 'initRollMine',
  /** A player ends their own character's turn. */
  INIT_END_TURN: 'initEndTurn',
  /** SWADE: hold your action — skip now, act later in the round. */
  INIT_HOLD: 'initHold',
  /** SWADE: a held combatant jumps back in and acts now. */
  INIT_ACT_NOW: 'initActNow',
  /** SWADE: spend a Benny to Soak wounds just taken (or decline). */
  SOAK_ROLL: 'soakRoll',
  /** SWADE: answer a live grenade sitting at your feet — throw it back
   *  (Hot Potato), smother it (Covering), or stand fast. */
  BLAST_RESPONSE: 'blastResponse',
  /** SWADE: spend a Benny from the Benny menu (reroll, recover, redraw…). */
  BENNY_USE: 'bennyUse',
  /** SWADE: DM hands a character a Benny (announced in chat). */
  BENNY_AWARD: 'bennyAward',
  /** SWADE: a new session — Bennies are drawn afresh. */
  SESSION_START: 'sessionStart',
  /** DM: move the in-world clock forward (a round, a minute, an hour, a day). */
  ADVANCE_TIME: 'advanceTime',
  /** SWADE: a Bleeding Out player makes their start-of-turn Vigor roll. */
  BLEED_ROLL: 'bleedRoll',
  /** SWADE: a Shaken combatant makes their start-of-turn Spirit roll. */
  SHAKEN_ROLL: 'shakenRoll',
  /** SWADE: a Stunned combatant makes their start-of-turn Vigor roll. */
  STUN_ROLL: 'stunRoll',
  /** SWADE: spend the whole turn Aiming — the bonus rides next turn's first shot. */
  COMBAT_AIM: 'combatAim',
  /** SWADE: a downed Wild Card proceeds to the Incapacitation Vigor roll. */
  INCAP_ROLL: 'incapRoll',
  /** SWADE: DM skips the Incapacitation roll for their own Wild Card — dead. */
  INCAP_DEATH: 'incapDeath',
  /** SWADE: roll the running die to move past Pace this turn. */
  RUN_ROLL: 'runRoll',
  /** SWADE: jump — clears rough ground, and Athletics can extend it. */
  JUMP_ROLL: 'jumpRoll',
  /** SWADE: answer the crawl prompt — stand up, or stay down. */
  PRONE_MOVE: 'proneMove',
  /** Climb onto a mount the DM has marked rideable, or get off it. */
  MOUNT_TOKEN: 'mountToken',
  /** SWADE: the DM's answer to the aftermath prompt. */
  AFTERMATH_ROLL: 'aftermathRoll',
  /** SWADE: the DM's answer to the natural-healing prompt. */
  HEALING_ROLL: 'healingRoll',
  /** SWADE: the DM answers a vehicle's Out of Control threat. */
  VEHICLE_OOC_ROLL: 'vehicleOocRoll',
  /** SWADE: the DM's answer to the vehicle-repair prompt. */
  REPAIR_ROLL: 'repairRoll',
  /** Fetch lifetime roll statistics (account-wide, or one character's). */
  ROLL_STATS_GET: 'rollStatsGet',
  /** Fetch the public-facing sheet of a character you don't control. */
  PUBLIC_SHEET_GET: 'publicSheetGet',
  /** DM-only: force-reveal / force-hide a world-tab entry for all players. */
  WORLD_OVERRIDE: 'worldOverride',
  /** DM-only: read / write the secret notes attached to a character. */
  DM_NOTES_GET: 'dmNotesGet',
  DM_NOTES_SET: 'dmNotesSet',
  /** Any member: read / write their own private notes on a character. */
  PRIVATE_NOTES_GET: 'privateNotesGet',
  PRIVATE_NOTES_SET: 'privateNotesSet',
  /** IronDice: fetch the current seed commitment + revealed seed history. */
  IRON_DICE_GET: 'ironDiceGet',
  /** IronDice: DM reveals the current seed and mints a fresh one. */
  IRON_DICE_ROTATE: 'ironDiceRotate',
  // table
  DRAW: 'draw',
  ERASE_DRAWING: 'eraseDrawing',
  CLEAR_DRAWINGS: 'clearDrawings',
  PING: 'ping',
  MEASURE: 'measure',
  // handouts
  /** DM: persist a manual ordering of world-tree siblings. */
  WORLD_REORDER: 'worldReorder',
  CREATE_HANDOUT: 'createHandout',
  UPDATE_HANDOUT: 'updateHandout',
  DELETE_HANDOUT: 'deleteHandout',
  SHARE_HANDOUT: 'shareHandout',
  // directory
  REQUEST_DIRECTORY: 'requestDirectory',
  // asset library
  REQUEST_ASSETS: 'requestAssets',
  CREATE_FOLDER: 'createFolder',
  RENAME_FOLDER: 'renameFolder',
  DELETE_FOLDER: 'deleteFolder',
  MOVE_ASSET: 'moveAsset',
  RENAME_ASSET: 'renameAsset',
  DELETE_ASSET: 'deleteAsset',
  MOVE_HANDOUT: 'moveHandout',
  // audio jukebox
  ADD_AUDIO: 'addAudio',
  REMOVE_AUDIO: 'removeAudio',
  AUDIO_CONTROL: 'audioControl',
  SET_SOUNDBOARD_SLOT: 'setSoundboardSlot',
  CLEAR_SOUNDBOARD_SLOT: 'clearSoundboardSlot',
  PLAY_SFX: 'playSfx',
  // auto-trace
  AUTO_TRACE_WALLS: 'autoTraceWalls',
  // custom compendium
  SAVE_TO_COMPENDIUM: 'saveToCompendium',
  DELETE_CUSTOM_NPC: 'deleteCustomNpc',
  // DM counters (banner bars over the map)
  COUNTER_CREATE: 'counterCreate',
  COUNTER_UPDATE: 'counterUpdate',
  COUNTER_DELETE: 'counterDelete',
  COUNTERS_GET: 'countersGet',
  // map loot objects
  PLACE_MAP_OBJECT: 'placeMapObject',
  UPDATE_MAP_OBJECT: 'updateMapObject',
  DELETE_MAP_OBJECT: 'deleteMapObject',
  TAKE_MAP_ITEM: 'takeMapItem',
  TAKE_CHEST_ITEM: 'takeChestItem',
  TAKE_ALL_CHEST: 'takeAllChest',
  OPEN_CHEST: 'openChest',
  // folder batch operations
  DROP_FOLDER_ON_MAP: 'dropFolderOnMap',
  DROP_SHOP_ON_MAP: 'dropShopOnMap',
  DROP_FOLDER_ON_CHARACTER: 'dropFolderOnCharacter',
  // light management
  MOVE_LIGHT_TO_MAP: 'moveLightToMap',
  LINK_LIGHT_TO_TOKEN: 'linkLightToToken',
  UNLINK_LIGHT_FROM_TOKEN: 'unlinkLightFromToken',
  RENAME_LIGHT: 'renameLight',
  // custom compendium items
  CREATE_CUSTOM_ITEM: 'createCustomItem',
  UPDATE_CUSTOM_ITEM: 'updateCustomItem',
  DELETE_CUSTOM_ITEM: 'deleteCustomItem',
} as const;

export interface JoinCampaignPayload { campaignId: string }
export interface SwitchActiveMapPayload { mapId: string }
/** DM: view a map yourself without changing anyone else's map. null = follow party. */
export interface ViewMapPayload { mapId: string | null }
/** DM: put a player on a specific map. null = follow the party map. */
export interface AssignPlayerMapPayload { userId: string; mapId: string | null }
export interface DmViewAsPayload { userId: string | null }

export interface CreateMapPayload { name: string; isScene?: boolean }
export interface DeleteMapPayload { mapId: string }
export interface UpdateMapPayload {
  mapId: string;
  name?: string;
  bgAssetId?: string | null;
  parentId?: string | null;
}
export interface SetGridConfigPayload { mapId: string; grid: Partial<GridConfig> }
export interface SetSpawnPayload { mapId: string; q: number; r: number }
export interface SetTerrainPayload { mapId: string; terrain?: number[]; blocked?: number[] }

export interface UpsertWallPayload {
  mapId: string;
  wall: { id?: string; points: Point[]; type?: WallType; flip?: boolean; glassColor?: string; rainbow?: boolean };
}
export interface DeleteWallPayload { mapId: string; wallId: string }
export interface UpsertDoorPayload {
  mapId: string;
  door: { id?: string; a: Point; b: Point; open?: boolean; type?: DoorType; locked?: boolean; keyName?: string | null };
}
export interface DeleteDoorPayload { mapId: string; doorId: string }
export interface ToggleDoorPayload { mapId: string; doorId: string }
export interface UpsertLightPayload {
  mapId: string;
  light: { id?: string; name?: string; x: number; y: number; brightRadius: number; dimRadius: number; color?: string };
}
export interface DeleteLightPayload { mapId: string; lightId: string }
/** Place or edit a map label. Omit id to create one. */
export interface UpsertMapTextPayload {
  mapId: string;
  text: { id?: string; x: number; y: number; text: string; size?: number; color?: string; font?: string; bold?: boolean; italic?: boolean };
}
export interface DeleteMapTextPayload { mapId: string; textId: string }

export interface CreateTokenPayload {
  mapId: string;
  name: string;
  q: number;
  r: number;
  characterId?: string | null;
  artAssetId?: string | null;
  layer?: TokenLayer;
  size?: number;
  shape?: TokenShape;
  color?: string;
  vision?: VisionStats | null;
  bar?: { hp: number; maxHp: number } | null;
  light?: { bright: number; dim: number } | null;
}
export interface DeleteTokenPayload { tokenId: string }
export interface UpdateTokenPayload {
  tokenId: string;
  patch: Partial<Pick<Token, 'name' | 'layer' | 'size' | 'shape' | 'color' | 'vision' | 'bar' | 'light' | 'characterId' | 'mountable' | 'maxRiders' | 'driverTokenId'>> & {
    artAssetId?: string | null;
  };
}
export interface MoveTokenPayload {
  tokenId: string;
  q: number;
  r: number;
  /** True only for a deliberate drag-and-drop. Walking (WASD/arrows) is a
   *  step through the world and always collides with walls; a drag is the
   *  player saying "put me over there", which out of combat may cross walls
   *  onto ground they have already explored. */
  drag?: boolean;
}
export interface DragTokenPayload { tokenId: string; x: number; y: number; done?: boolean }

export interface CreateCharacterPayload {
  name: string;
  system: GameSystem;
  /** DM may create NPC characters (ownerUserId null) or assign an owner. */
  ownerUserId?: string | null;
  /** Seed the new sheet's class field (e.g. "New player character" rows). */
  initialClass?: string;
  /** Merged over the system's default sheet (e.g. a guided character
   *  creator's finished build) — takes precedence over initialClass. */
  sheetPatch?: SheetData;
  /** Drop a token for this character onto its owner's currently-viewed map
   *  (visible layer), right after creation. Only takes effect when the new
   *  character has an owner (a player's own PC, or one the DM assigns). */
  placeToken?: boolean;
}
export interface CreateNpcPayload {
  /** Id from the shared pre-built NPC library. */
  libraryId: string;
  /** Optional custom display name (defaults to the library name). */
  name?: string;
}
export interface CreateRandomNpcPayload {
  count?: number;
  /** Library NPC id to model the random NPC's stats/name/description after. */
  modelId?: string;
}
export interface DeleteCharacterPayload { characterId: string }

export interface CreateShopPayload { name: string }
export interface UpdateShopPayload {
  shopId: string;
  name?: string;
  description?: string;
  currency?: string;
  playersCanBuy?: boolean;
  parentId?: string | null;
  /** Briefing image shown to players above the stock. '' clears it. */
  detailAssetId?: string | null;
  items?: Array<{
    name: string; price?: number; qty?: number; notes?: string;
    contentId?: string; effect?: 'heal' | 'damage'; amount?: string; range?: number;
  }>;
}
export interface DeleteShopPayload { shopId: string }
export interface BuyItemPayload { shopId: string; itemIndex: number; characterId: string }
/** DM: pop this shop's storefront on targeted players' screens. */
export interface PresentShopPayload { shopId: string; userIds: string[] | 'all' }

export interface CreateLocationPayload { name: string; parentId?: string | null }
export interface UpdateLocationPayload {
  locationId: string;
  name?: string;
  kind?: 'region' | 'settlement' | 'district' | 'building' | 'poi';
  notes?: string;
  parentId?: string | null;
  visibleToPlayers?: boolean;
  npcIds?: string[];
  shopIds?: string[];
  handoutIds?: string[];
}
export interface DeleteLocationPayload { locationId: string }

export interface CreateWorldFolderPayload {
  name: string;
  parentId?: string | null;
  displayKind?: 'folder' | 'chest';
  items?: LootItem[];
}
export interface UpdateWorldFolderPayload {
  folderId: string;
  name?: string;
  parentId?: string | null;
  items?: LootItem[];
  displayKind?: 'folder' | 'chest';
  artAssetId?: string | null;
}
export interface DeleteWorldFolderPayload { folderId: string }
export interface DropFolderOnMapPayload { folderId: string; mapId: string; q?: number; r?: number }
export interface DropShopOnMapPayload { shopId: string; mapId: string; q?: number; r?: number }
export interface DropFolderOnCharacterPayload { folderId: string; characterId: string }
export interface MoveLightToMapPayload { lightId: string; sourceMapId: string; targetMapId: string }
export interface LinkLightToTokenPayload { lightId: string; sourceMapId: string; tokenId: string }
export interface UnlinkLightFromTokenPayload { tokenId: string; mapId: string }
export interface RenameLightPayload { lightId: string; mapId: string; name: string }
export interface OpenChestPayload { objectId: string }
export interface UpdateCharacterPayload {
  characterId: string;
  patch: SheetData;
  name?: string;
  parentId?: string | null;
  /** Exact hex to drop the token at (dragged onto the map canvas), overriding the default spawn/first-free-hex placement. */
  dropHex?: { q: number; r: number } | null;
  /** DM-only: reassign who controls this character. null = DM-only NPC. */
  ownerUserId?: string | null;
}
/**
 * Apply a level-up whose HP is rolled: the server rolls the hit die (+CON),
 * adjusts the patch's HP from the average baseline, applies it, and posts the
 * roll to chat for everyone. Keeps the roll server-authoritative.
 */
export interface LevelUpRollPayload {
  characterId: string;
  patch: SheetData;   // computed with average HP as the baseline
  hitDie: number;
  conMod: number;
  avgHp: number;      // the baseline HP already baked into `patch`
  label: string;
}
export interface SheetRollPayload {
  characterId: string;
  rollableId: string;
  adv?: 'adv' | 'dis' | null;
}
/** Cast a spell roll, spending a slot of the chosen level. */
export interface CastSpellPayload {
  characterId: string;
  rollableId: string;
  slotLevel: number;
}
/** Use a weapon/item against a target token; server rolls & applies HP. */
export interface CombatActionPayload {
  characterId: string;
  actionId: string;
  sourceTokenId: string;
  targetTokenId: string;
  adv?: 'adv' | 'dis' | null;
  /** SWADE: rounds-per-attack setting for this shot, 1..weapon RoF
   *  (default: the weapon's full RoF). Drives Recoil, burst hits, ammo. */
  rof?: number;
  /** SWADE Called Shot: what the attacker is aiming at, chosen before the
   *  roll. The penalty is the target part's own Scale, not the creature's. */
  calledShot?: { label: string; penalty: number; damageBonus?: number } | null;
}

/** Activate a psychic power that has no target (utility/self powers): commits
 *  Effort and rolls the discipline's activation check server-side. */
export interface UsePowerPayload {
  characterId: string;
  powerIndex: number;
}

/** SWN: refill a weapon's magazine from a matching ammo item in inventory. */
export interface ReloadWeaponPayload {
  characterId: string;
  attackIndex: number;
}

/** Roll a 5e death saving throw for a downed character (server-authoritative). */
export interface DeathSavePayload { characterId: string }

/** DM "call for save": each listed token rolls its save; on fail (or on save,
 *  optionally halved) the shared damage roll is applied. */
export interface RequestSavePayload {
  tokenIds: string[];
  saveId: string;
  dc: number;
  damageExpr?: string;
  onSave: 'half' | 'negate';
  damageType?: string;
  label?: string;
  /** SWADE Group Roll: one roll — a Trait die AND a Wild Die — stands for the
   *  whole mob of like Extras, instead of one roll each. */
  group?: boolean;
}

/** Show a character-sheet card in the chat log, as the card itself. */
export interface PostSheetCardPayload {
  characterId: string;
  card: import('./types.js').SheetCard;
}

/** DM calls for a SWADE Fear check: a Spirit roll at the creature's Fear
 *  penalty, with failures routed through the Fear Table. */
export interface RequestFearPayload {
  tokenIds: string[];
  /** The creature's Fear penalty, e.g. 2 for "Fear −2". 0 for a plain check. */
  fearPenalty: number;
  source: import('./systems/swadeFear.js').FearSource;
  label?: string;
}

/** Live-broadcast an AoE template as its caster aims it; active:false clears it. */
export interface AoePreviewPayload {
  sourceTokenId: string;
  shape: AoeShape;
  sizeFt: number;
  widthFt?: number;
  originHex: Hex;
  aimHex: Hex;
  active: boolean;
}

/** Live-broadcast a single-target selection in progress; active:false clears it. */
export interface TargetPreviewPayload {
  sourceTokenId: string;
  rangeFt: number;
  effect: 'damage' | 'heal';
  label: string;
  active: boolean;
}

/** Lock in an AoE spell's template: server resolves which tokens are inside it
 *  and rolls saves/damage against exactly that set (never the client's guess). */
export interface CastAoePayload {
  characterId: string;
  actionId: string;
  sourceTokenId: string;
  originHex: Hex;
  aimHex: Hex;
  adv?: 'adv' | 'dis' | null;
  /** SWADE grenades: "cook" it first — a free Smarts roll that times the
   *  fuse so nobody can throw it back or dive clear. A Critical Failure
   *  means it goes off in your hand. */
  cook?: boolean;
}

export interface ChatPayload { text: string }

/** A reversible effect recorded on a roll message so the DM can undo it. */
export type UndoEntry =
  | { t: 'hp'; characterId?: string; tokenId?: string; delta: number }
  | { t: 'slot'; characterId: string; level: number }
  | { t: 'item'; characterId: string; index: number }
  | { t: 'field'; characterId: string; key: string; value: unknown };

/** DM moderates a chat message by id: hide it, unhide it, or hide + undo its
 *  recorded effects on character sheets/tokens. */
export interface ModerateMessagePayload {
  messageId: number;
  // 'delete' is the end of the line: the rows go, and every screen drops
  // them. Offered only for something already hidden, so erasing the log is
  // always a second, deliberate act rather than a slip of the mouse.
  action: 'hide' | 'unhide' | 'hideUndo' | 'delete';
}
export interface SaveMacroPayload {
  macro: {
    id?: string;
    name: string;
    command: string;
    color?: string | null;
    characterId?: string | null;
    rollableId?: string | null;
    actionId?: string | null;
  };
}
export interface DeleteMacroPayload { macroId: string }
export interface ReorderMacrosPayload { macroIds: string[] }

export interface CreateTablePayload { name: string }
export interface UpdateTablePayload {
  tableId: string;
  name?: string;
  playersCanRoll?: boolean;
  parentId?: string | null;
  items?: Array<{ text: string; weight?: number }>;
}
export interface DeleteTablePayload { tableId: string }
export interface RollTablePayload { tableId: string }

export interface InitAddPayload {
  tokenId?: string | null;
  name?: string;
  value?: number;      // explicit value, or
  roll?: boolean;      // roll from sheet/token
  hidden?: boolean;
}
/** Roll initiative for every token on a map at once (DM). */
export interface InitRollMapPayload { mapId: string; includeGm?: boolean }
export interface InitRemovePayload { entryId: string }
export interface InitUpdatePayload {
  entryId: string;
  value?: number;
  hidden?: boolean;
  name?: string;
  /** DM: re-roll this entry's initiative server-side (uses its own expr, posts to chat). */
  reroll?: boolean;
}

/** SWADE: DM calls for action cards for every token on a map. */
/**
 * Deal the action deck. `tokenIds`, when present, IS the roster — the DM has
 * ticked exactly who is in this fight, so it overrides the includeGm shortcut
 * rather than filtering after it. `battleName` is what chat calls the fight.
 */
export interface InitCardCallPayload {
  mapId: string;
  includeGm?: boolean;
  tokenIds?: string[];
  battleName?: string;
}
/** 5e/SWN: DM calls every token on a map to roll its own initiative. */
export interface InitRollCallPayload { mapId: string; includeGm?: boolean }
/** 5e/SWN: roll initiative for one pending combatant's token. */
export interface InitRollMinePayload { tokenId: string }
/** SWADE: draw the top card for one pending combatant's token. */
export interface InitCardDrawPayload { tokenId: string }
export interface InitDealInPayload { tokenId: string }
export interface AttackPreviewPayload {
  characterId: string;
  actionId: string;
  sourceTokenId: string;
  targetTokenId: string;
  adv?: 'adv' | 'dis' | null;
  rof?: number;
}
/** SWADE: a card was drawn — drives the flip animation + chat framing. */
/** Round 2+ auto-deal: every combatant's new card, in deal order, for the
 *  sequenced face-down → flip-over reveal. Hidden combatants are omitted. */
export interface RoundCardsPayload {
  round: number;
  /** `back` is the card back that combatant chose — how the table tells
   *  whose card is whose while it is still face down. Absent = classic. */
  cards: Array<{ tokenId: string | null; name: string; card: PlayingCard; back?: CardBackSpec }>;
}
export interface InitCardDrawnPayload {
  tokenId: string;
  name: string;
  card: PlayingCard;
  /** The user who clicked the deck (their client plays the big flip). */
  byUserId: string;
  /** The card back this combatant's cards wear. Absent = classic. */
  back?: CardBackSpec;
}

export interface DrawPayload { mapId: string; layer: DrawingLayerName; shape: Drawing['shape'] }
export interface EraseDrawingPayload { drawingId: string }
export interface ClearDrawingsPayload { mapId: string; layer: DrawingLayerName }
export interface PingPayload { x: number; y: number }
export interface MeasurePayload { from: Hex; to: Hex; active: boolean }

export interface CreateFolderPayload { name: string; kind: 'art' | 'handout' }
export interface RenameFolderPayload { folderId: string; name: string }
export interface DeleteFolderPayload { folderId: string }
export interface MoveAssetPayload { assetId: string; folderId: string | null }
export interface RenameAssetPayload { assetId: string; title: string }
export interface DeleteAssetPayload { assetId: string }
export interface MoveHandoutPayload { handoutId: string; folderId: string | null }

export interface AddAudioPayload { assetId: string; title: string; /** Which of the three playlists to file it under (0-based). */ playlist?: number }
export interface RemoveAudioPayload { trackId: string }
export interface AudioControlPayload {
  trackId?: string;
  action: 'play' | 'stop' | 'pause';
  loop?: boolean;
  /** Repeat the CURRENT track instead of the playlist. Only meaningful
   *  alongside loop; the two together are the 'repeat one' state. */
  loopOne?: boolean;
  shuffle?: boolean;
  /** Which playlist is being played through. */
  playlist?: number;
  volume?: number;
}

/** `imageAssetIds` lets a handout be born with its whole gallery — the
 *  editor can upload four before the handout exists to attach them to. */
export interface CreateHandoutPayload { title: string; bodyMd?: string; assetId?: string | null; imageAssetIds?: string[] }
/** `imageAssetIds` replaces the handout's whole gallery, first image first. */
export interface UpdateHandoutPayload {
  handoutId: string; title?: string; bodyMd?: string; dmNotesMd?: string;
  assetId?: string | null; parentId?: string | null; imageAssetIds?: string[];
}
export interface DeleteHandoutPayload { handoutId: string }
export interface ShareHandoutPayload { handoutId: string; to: string[] | 'all' | 'none' }

export interface AutoTraceWallsPayload { mapId: string }

export interface SaveToCompendiumPayload { characterId: string }
export interface DeleteCustomNpcPayload { customNpcId: string }

export interface CustomNpcView {
  id: string;
  system: GameSystem;
  name: string;
  category: string;
  challengeLabel: string;
  ac: number;
  hp: number;
  sheet: SheetData;
  color: string | null;
  artAssetId: string | null;
}

// ---------- Map loot objects ----------

export type { LootItem } from './types.js';

export interface MapObject {
  id: string;
  mapId: string;
  name: string;
  description: string;
  kind: 'item' | 'chest' | 'shop';
  q: number;
  r: number;
  artAssetId: string | null;
  /** Server-resolved URL for that asset. The id alone is not enough to build
   *  one — uploads are stored with their extension. */
  artUrl?: string | null;
  /** A briefing image players see above the contents, like a handout. Its
   *  text half is `description`, which the loot popup already shows. */
  detailAssetId?: string | null;
  detailUrl?: string | null;
  items: LootItem[];
  /** Links this map object to a world folder (chest-folder unification). */
  worldFolderId: string | null;
  /** Links this map object to a shop placed on the map. */
  shopId: string | null;
  /** A character who IS this container — the token carries the chest (or is
   *  the shopkeeper) rather than it sitting on the ground. Shops have carried
   *  linkedCharacterId for a while; chests get the same. */
  linkedCharacterId?: string | null;
  /** How many hexes away a player must be to interact (default 1). */
  interactRange: number;
  /** A locked chest refuses to open for a player without the key. Same rule
   *  as a locked door: possession of a matching inventory item is enough, the
   *  key is not consumed, and the DM can always open it. */
  locked?: boolean;
  /** Inventory item name that unlocks it — "Key" is the generic. */
  keyName?: string | null;
}

export interface PlaceMapObjectPayload {
  mapId: string;
  kind: 'item' | 'chest' | 'shop';
  name: string;
  description?: string;
  q: number;
  r: number;
  worldFolderId?: string;
  shopId?: string;
  interactRange?: number;
  locked?: boolean;
  keyName?: string | null;
}

export interface UpdateMapObjectPayload {
  objectId: string;
  patch: {
    name?: string;
    description?: string;
    artAssetId?: string;
    /** Briefing image shown to players above the contents. '' clears it. */
    detailAssetId?: string;
    q?: number;
    r?: number;
    items?: LootItem[];
    interactRange?: number;
    locked?: boolean;
    keyName?: string | null;
    linkedCharacterId?: string | null;
  };
}

export interface DeleteMapObjectPayload { objectId: string }
export interface TakeMapItemPayload { objectId: string }
export interface TakeChestItemPayload { objectId: string; itemId: string }
export interface TakeAllChestPayload { objectId: string }

// ---------- Custom compendium items ----------

export interface CustomItem {
  id: string;
  campaignId: string;
  entryJson: string;
  createdAt: number;
}

export interface CreateCustomItemPayload { entryJson: string }
export interface UpdateCustomItemPayload { itemId: string; entryJson: string }
export interface DeleteCustomItemPayload { itemId: string }

// ---------- Server -> client events ----------

export const S2C = {
  YOU_ARE: 'youAre',
  CAMPAIGN_STATE: 'campaignState',
  MAP_STATE: 'mapState',
  MAP_LIST: 'mapList',
  MAP_EDITED: 'mapEdited',
  VISION_UPDATE: 'visionUpdate',
  TOKEN_UPSERTED: 'tokenUpserted',
  TOKEN_REMOVED: 'tokenRemoved',
  TOKEN_MOVED: 'tokenMoved',
  TOKEN_DRAG_GHOST: 'tokenDragGhost',
  DOOR_STATE: 'doorState',
  CHARACTER_UPSERTED: 'characterUpserted',
  CHARACTER_REMOVED: 'characterRemoved',
  HP_FLOAT: 'hpFloat',
  PROJECTILE: 'projectile',
  AOE_BURST: 'aoeBurst',
  CHAT: 'chatMsg',
  MACROS: 'macros',
  INITIATIVE: 'initiativeState',
  INIT_CARD_DRAWN: 'initCardDrawn',
  /** SWADE round 2+: everyone's fresh action cards, revealed in sequence. */
  ROUND_CARDS: 'roundCards',
  DRAWING_ADDED: 'drawingAdded',
  DRAWING_REMOVED: 'drawingRemoved',
  DRAWINGS_CLEARED: 'drawingsCleared',
  PING_SHOWN: 'pingShown',
  MEASURE_SHOWN: 'measureShown',
  AOE_PREVIEW_SHOWN: 'aoePreviewShown',
  TARGET_PREVIEW_SHOWN: 'targetPreviewShown',
  OPEN_HANDOUT: 'openHandout',
  HANDOUTS: 'handouts',
  /** Manual world-tree sibling ordering: "kind:id" → rank. */
  WORLD_SORT: 'worldSort',
  /** You were removed from this campaign by the DM. */
  BOOTED: 'booted',
  /** The DM asked your client to open the character-creator wizard. */
  OPEN_CREATOR: 'openCreator',
  TABLES: 'tables',
  TABLE_RESULT: 'tableResult',
  /** SWADE: someone spent a Benny — flip the coin on every screen. */
  BENNY_FLIP: 'bennyFlip',
  /** "X is rolling to evade!" — says whose roll is coming BEFORE the
   *  result lands, so a group save isn't a silent wall of cards. */
  ROLL_CALLOUT: 'rollCallout',
  CHAT_UPDATED: 'chatUpdated',
  /** Messages that no longer exist — drop them, they were never there. */
  CHAT_REMOVED: 'chatRemoved',
  /** The log was erased — drop everything, a fresh line follows. */
  CHAT_WIPED: 'chatWiped',
  SHOPS: 'shops',
  SHOP_PRESENTATION: 'shopPresentation',
  LOCATIONS: 'locations',
  WORLD_FOLDERS: 'worldFolders',
  ASSETS: 'assets',
  AUDIO_TRACKS: 'audioTracks',
  AUDIO_STATE: 'audioState',
  SOUNDBOARD: 'soundboard',
  SFX_PLAY: 'sfxPlay',
  /** SWADE: your Wild Card took wounds and may Soak them with a Benny. */
  SOAK_OFFER: 'soakOffer',
  TEST_PROMPT: 'testPrompt',
  /** SWADE: a live grenade landed on you — the blast is parked for a beat
   *  while you decide whether to throw it back or throw yourself on it. */
  BLAST_OFFER: 'blastOffer',
  /** That window shut — somebody acted, or the fuse ran out. */
  BLAST_OFFER_CLOSED: 'blastOfferClosed',
  /** SWADE: which Benny reroll options are currently live for your character. */
  BENNY_STATE: 'bennyState',
  /** SWADE: how many Bennies are in the GM's own pool (DM only). */
  GM_BENNIES: 'gmBennies',
  /** SWADE: what is left of a token's Pace this turn, for the range shading. */
  MOVE_BUDGET: 'moveBudget',
  /** SWADE: your character is Bleeding Out and owes a Vigor roll. */
  BLEED_PROMPT: 'bleedPrompt',
  /** SWADE: your Shaken character may roll Spirit to recover. */
  SHAKEN_PROMPT: 'shakenPrompt',
  /** SWADE: your Stunned character may roll Vigor to come to. */
  STUN_PROMPT: 'stunPrompt',
  /** SWADE: your Wild Card went down — Soak, or face the Incapacitation roll. */
  INCAP_PROMPT: 'incapPrompt',
  /** SWADE: that move needs the running die — confirm or decline. */
  RUN_PROMPT: 'runPrompt',
  /** SWADE: a prone character is moving — stand up, or crawl? */
  CRAWL_PROMPT: 'crawlPrompt',
  /** SWADE: the fight is over and Extras are lying there — roll for them? */
  AFTERMATH_PROMPT: 'aftermathPrompt',
  /** SWADE: days passed and someone is due a natural healing roll. */
  HEALING_PROMPT: 'healingPrompt',
  /** SWADE: a vehicle was hit hard enough to threaten control. */
  VEHICLE_OOC_PROMPT: 'vehicleOocPrompt',
  /** SWADE: hours passed with damaged vehicles in the party's hands. */
  REPAIR_PROMPT: 'repairPrompt',
  /** The in-world clock, after any change. */
  CLOCK: 'clock',
  /** The campaign's dice pacing changed — everyone switches together. */
  DICE_SPEED: 'diceSpeed',
  CAMPAIGN_RENAMED: 'campaignRenamed',
  CAMPAIGN_DELETED: 'campaignDeleted',
  /** The DM locked or unlocked all player movement. */
  MOVE_LOCK: 'moveLock',
  ROLL_LOCK: 'rollLock',
  /** The modifier a hovered shot would carry, itemised. */
  ATTACK_PREVIEW: 'attackPreviewResult',
  /** The clouds hanging over a map changed — one landed, or one blew away. */
  MAP_ZONES: 'mapZones',
  /** Lifetime roll statistics for the requested scope. */
  ROLL_STATS: 'rollStats',
  /** IronDice public state: active commitment + revealed seeds. */
  IRON_DICE: 'ironDice',
  /** The public-facing sheet for one character. */
  PUBLIC_SHEET: 'publicSheet',
  /** DM-only: the secret notes for one character. */
  DM_NOTES: 'dmNotes',
  /** The requesting user's own private notes on one character. */
  PRIVATE_NOTES: 'privateNotes',
  /** Counters for one map (players receive only the visible ones). */
  COUNTERS: 'counters',
  /** Every counter in the campaign (for the world tree), role-filtered. */
  COUNTERS_ALL: 'countersAll',
  CUSTOM_NPCS: 'customNpcs',
  MAP_OBJECT_UPSERTED: 'mapObjectUpserted',
  MAP_OBJECT_REMOVED: 'mapObjectRemoved',
  CUSTOM_ITEMS: 'customItems',
  DIRECTORY: 'directory',
  MEMBER_PRESENCE: 'memberPresence',
  ACTIVE_MAP: 'activeMap',
  ERROR_MSG: 'errorMsg',
} as const;

export interface YouArePayload {
  userId: string;
  username: string;
  role: 'dm' | 'player';
  /** This account's saved audio mix (0..1); null = never set, use full volume. */
  musicVolume?: number | null;
  sfxVolume?: number | null;
}
export interface SetVolumesPayload { music: number; sfx: number }

export interface CampaignStatePayload {
  campaign: CampaignInfo;
  members: MemberInfo[];
  characters: Character[];
  maps: MapMeta[];
  handouts: Handout[];
  macros: Macro[];
  initiative: InitiativeState;
  /** In-world elapsed seconds, so the GM's clock reads right on join. */
  clockSeconds: number;
  /** SWADE: Bennies in the GM's own pool. */
  gmBennies?: number;
  chatTail: ChatMessage[];
  /** The DM's table-wide movement lock, as it stands on arrival. */
  moveLocked?: boolean;
  /** ...and the dice lock, so a player who refreshes mid-freeze still knows. */
  rollLocked?: boolean;
  /**
   * What is left of the current turn's Pace, for whoever is up.
   *
   * Carried IN the join payload rather than sent after it. It used to follow
   * as its own message a beat later, which meant a client that cleared its
   * budgets on arrival was relying on message order to get them back — and a
   * refresh mid-turn could land with a full Pace bar over a token that had
   * already walked half of it. One message, no window.
   */
  moveBudget?: MoveBudgetPayload;
  /** Loot/chest/shop markers across ALL maps (so the world tree can nest
   *  them under every map, not just the one being viewed). */
  mapObjects: MapObject[];
}

/**
 * Sent on join / map switch / view-as. For the DM `map` is the full MapDef
 * (walls, doors, lights); for players it is a MapView plus only what they
 * can currently see.
 */
export interface MapStatePayload {
  map: MapView;
  dmGeometry: { walls: MapDef['walls']; doors: Door[]; lights: Light[] } | null;
  tokens: TokenView[];
  drawings: Drawing[];
  /** Packed hex keys currently visible (players; null for god-mode DM). */
  visible: number[] | null;
  /** Packed hex keys in the fading rim just past vision range (players). */
  fade: number[] | null;
  /** Packed hex keys ever explored (players; null for god-mode DM). */
  explored: number[] | null;
  /**
   * Smooth, wall-accurate fog edge (one polygon per viewer token), in map
   * pixel space -- null in DM god mode, where the client falls back to
   * punching out the `visible`/`fade` hex sets instead.
   */
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
  /**
   * Under 'dark'/'dim' lighting, what's actually illuminated within
   * `visiblePolygons`/`fadePolygons` -- the client intersects them with this
   * before treating anything as visible. Null under 'light' (the whole
   * polygon counts) or DM god mode.
   */
  visibleLitMask: VisibilityLitMask | null;
  fadeLitMask: VisibilityLitMask | null;
  /** Doors within the viewer's explored region (players only). */
  knownDoors: Door[];
  /** Wall fragments on explored ground (players only) — see the field of the
   *  same name on VisionUpdatePayload. */
  knownWalls: KnownWallSegment[];
  /** Loot objects on this map (items and chests). */
  mapObjects: MapObject[];
  /** Non-null when this payload is a DM "view as" preview. */
  viewingAs: string | null;
}

export interface MapEditedPayload {
  mapId: string;
  walls?: MapDef['walls'];
  doors?: Door[];
  lights?: Light[];
  grid?: GridConfig;
  name?: string;
  bgUrl?: string | null;
  bgWidth?: number;
  bgHeight?: number;
  spawn?: import('./types.js').Hex | null;
  terrain?: number[];
  blocked?: number[];
}

export interface VisionUpdatePayload {
  mapId: string;
  visible: number[];
  /** Fading rim one hex past vision range. */
  fade: number[];
  /** See MapStatePayload.visiblePolygons/fadePolygons/visibleLitMask/fadeLitMask. */
  visiblePolygons: Point[][] | null;
  fadePolygons: Point[][] | null;
  visibleLitMask: VisibilityLitMask | null;
  fadeLitMask: VisibilityLitMask | null;
  newlyExplored: number[];
  /** Full list of tokens currently visible to this viewer. */
  tokens: TokenView[];
  /** Loot/chests/shop markers on ground this viewer has seen (full list). */
  mapObjects: MapObject[];
  /** Doors inside the viewer's explored region (full list). */
  knownDoors: Door[];
  /** The parts of walls that lie on ground this viewer has discovered —
   *  clipped, never whole walls, so a wall running off into the dark cannot
   *  report how far it goes. Lets their own client stop a move at a wall
   *  without asking the server first. */
  knownWalls: KnownWallSegment[];
  /** Non-null when this update belongs to a DM view-as preview. */
  viewingAs: string | null;
}

export interface TokenMovedPayload { tokenId: string; q: number; r: number }
export interface TokenDragGhostPayload { tokenId: string; x: number; y: number; done: boolean }
export interface TokenUpsertedPayload { token: TokenView }
export interface TokenRemovedPayload { tokenId: string }
export interface DoorStatePayload { mapId: string; doorId: string; open: boolean }

export interface CharacterUpsertedPayload { character: Character }
export interface CharacterRemovedPayload { characterId: string }
/** Floating combat text over a token: negative = damage, positive = heal. */
export interface HpFloatPayload {
  mapId: string; tokenId: string; delta: number; kind?: ImpactKind; damageType?: string;
  /**
   * What to show instead of the number.
   *
   * In SWADE the number is the least interesting thing about a hit: 9 damage
   * means nothing until you know it was 9 against Toughness 8. What the table
   * wants over the token is what HAPPENED — "Shaken!", "2 Wounds!", "No
   * effect" — so the server, which has just worked that out, says it.
   */
  text?: string;
}
/** A ranged attack's shot flying from shooter to target — sent far enough
 *  ahead of the matching HpFloatPayload that, timed with flightMs, it lands
 *  on-screen right as the damage/heal float appears. */
export interface ProjectilePayload { mapId: string; fromTokenId: string; toTokenId: string; damageType?: string; flightMs: number }
/** An AoE spell's detonation, timed to play once its damage roll has settled.
 *  For a point-target shape (sphere/cylinder) the client flies a projectile
 *  from the caster to the aim point over flightMs, then radiates a circular
 *  burst out to sizeFt; for a self-origin shape (cone) there's no projectile
 *  (flightMs: 0) and the wave instead ripples from the caster outward along
 *  the cone to its full length. */
export interface AoeBurstPayload {
  mapId: string; shape: AoeShape; sizeFt: number; sizeHexes?: number; widthFt?: number;
  originHex: Hex; aimHex: Hex; damageType?: string; flightMs: number;
}
/**
 * A Benny being spent, shown as a coin flip on every screen at the table.
 *
 * The landing face is decided HERE rather than on each client: it is a coin
 * everyone is watching, and two people seeing it land differently would make
 * it obvious the flip is decoration.
 */
/**
 * How long the coin is on screen, in ms — the throw, the beat where the words
 * sit readable, and the fade.
 *
 * It lives in the protocol because both sides need the same number for
 * different reasons: the client animates to it, and the SERVER waits it out
 * before rolling whatever the Benny bought. Two animations playing over each
 * other is two animations nobody watches.
 */
export const BENNY_FLIP_FLY_MS = 1900;
export const BENNY_FLIP_HOLD_MS = 1800;
export const BENNY_FLIP_FADE_MS = 550;
export const BENNY_FLIP_MS = BENNY_FLIP_FLY_MS + BENNY_FLIP_HOLD_MS + BENNY_FLIP_FADE_MS;

export interface BennyFlipPayload {
  /** Whose Benny — the character, not the account. */
  name: string;
  /** What it bought, as a phrase: "to Recover from Shaken". */
  reason: string;
  /** Which side lands up. */
  face: 'benny' | 'csb';
}

/** Announces the roll that is about to happen, on everyone's screen. */
export interface RollCalloutPayload {
  /** Whose roll it is — shown large. */
  name: string;
  /** What they are rolling, phrased as an action: "rolling to evade!" */
  what: string;
  /** How long the banner should hold, ms. Matches the pause the server
   *  leaves before the roll actually posts. */
  holdMs: number;
}

/** A rollable-table result to flash on-screen (same text as the chat card). */
export interface TableResultPayload { text: string; color: string }

export interface ChatBroadcastPayload { msg: ChatMessage }
export interface MacrosPayload { macros: Macro[] }
export interface TablesPayload { tables: RollableTable[] }
export interface InitiativePayload { state: InitiativeState }

export interface DrawingAddedPayload { drawing: Drawing }
export interface DrawingRemovedPayload { drawingId: string }
export interface DrawingsClearedPayload { mapId: string; layer: DrawingLayerName }
export interface PingShownPayload extends PingInfo {}
export interface MeasureShownPayload extends MeasureInfo { userId: string }
export interface AoePreviewShownPayload extends AoePreviewInfo { userId: string }
export interface TargetPreviewShownPayload extends TargetPreviewInfo { userId: string }

export interface HandoutsPayload { handouts: Handout[] }
export interface OpenHandoutPayload { handoutId: string; title: string }
export interface ShopsPayload { shops: Shop[] }
/** Which shop (if any) to pop for this viewer; DM receives the presented id for a badge. */
export interface ShopPresentationPayload { shopId: string | null }
export interface LocationsPayload { locations: LocationNode[] }
export interface WorldFoldersPayload { folders: WorldFolder[] }
export interface AssetsPayload { folders: AssetFolder[]; assets: AssetInfo[] }
export interface AudioTracksPayload { tracks: AudioTrack[] }
export interface AudioStatePayload { state: AudioState }
/** The DM's soundboard grid; only filled squares appear. */
export interface SoundboardPayload { slots: SoundboardSlot[] }
/** Assign an uploaded sound to one square (replaces whatever was there). */
export interface SetSoundboardSlotPayload { slotIndex: number; assetId: string; label: string }
export interface ClearSoundboardSlotPayload { slotIndex: number }
/** DM fires a square; the server resolves the URL and broadcasts SFX_PLAY. */
export interface PlaySfxPayload { slotIndex: number }
/** One-shot sound for every client to play. Deliberately not part of
 *  AudioState -- an effect must not interrupt the music track. */
export interface SfxPlayPayload { url: string; label: string }

/** Campaign-wide shared reference of everything introduced so far. */
/** World-tab visibility of one entry, as the DM sees it: has the party
 *  discovered it, or has the DM force-revealed / force-hidden it? */
export type WorldVisState = 'seen' | 'unseen' | 'reveal' | 'hide';
export interface DirectoryPayload {
  maps: Array<{
    id: string; name: string; vis?: WorldVisState;
    parentId?: string | null;
    /** A staged backdrop rather than a battlemap — shown in full, no fog. */
    isScene?: boolean;
    /** Whether this viewer has any explored ground here, i.e. whether a
     *  revealed-parts preview would show them anything. */
    hasPreview?: boolean;
  }>;
  characters: Array<{
    id: string; name: string; owner: string | null; system: GameSystem; vis?: WorldVisState;
    /** Where the DM filed this character in the world tree. */
    parentId?: string | null;
    /** Null for a DM-run NPC. Lets a viewer tell "someone's PC" from "an NPC"
     *  without shipping the sheet. */
    ownerUserId?: string | null;
  }>;
  tokens: Array<{
    id: string; name: string; mapName: string; gm: boolean; vis?: WorldVisState;
    /** The map this token stands on, so the tree can nest it there. */
    mapId?: string;
    characterId?: string | null;
    /** True when a player runs this character — drives the silhouette color
     *  (light blue for the party, grey for whatever the DM is running). */
    playerRun?: boolean;
  }>;
  weapons: string[];
  spells: string[];
  items: string[];
}
/** userId omitted = reset every player in the campaign. */
export interface ForgetKnowledgePayload { userId?: string }
export interface WorldOverridePayload {
  kind: 'map' | 'token' | 'character';
  key: string;
  mode: 'reveal' | 'hide' | 'clear';
}
/** The campaign's whole membership, authoritative: whoever is absent from
 *  this list is no longer a member and their pill should go. */
export interface MemberPresencePayload {
  /**
   * MemberInfo itself, not a structural copy of it. This was a hand-maintained
   * duplicate of the same fields, and it did what duplicates do: a field added
   * to MemberInfo did not arrive here, so the client assigned this payload
   * into a MemberInfo[] slot that no longer matched it.
   */
  members: import('./types.js').MemberInfo[];
}
/** Set your own 3D-dice color ("#rrggbb", or null for the defaults). */
export interface SetDiceColorPayload { color: string | null }
/** SWADE dice roles, each with its own color slot. */
export type DiceRole = 'trait' | 'wild' | 'raise';
/** Set one slot of your SWADE dice palette ("#rrggbb", or null for its default). */
export interface SetDiceRoleColorPayload { role: DiceRole; color: string | null }
/** How often your dice carom off a wall, 0-100 (null restores the default). */
export interface SetDiceBouncePayload { pct: number | null }
/** How your aced dice celebrate (null restores the default). */
export interface SetDiceAceStylePayload { style: import('./types.js').AceStyle | null }
export interface SetTurnGuidePayload { on: boolean }
export interface SetDiceSpeedPayload { speed: DiceSpeed }
export interface RenameCampaignPayload { name: string }
/**
 * Erase a campaign and everything in it. `confirmName` must match the
 * campaign's own name: this is the one action in the app with nothing behind
 * it, so it asks the DM to type the thing they are destroying rather than
 * trusting a click they might have meant for the button above.
 */
export interface DeleteCampaignPayload { confirmName: string }
/** Hand a token back some of the Pace it spent this turn (+), or take some
 *  away (−). The DM's correction for a misstep; see adjustSpentMovement. */
export interface AdjustPacePayload { tokenId: string; delta: number }
/** Light a Holo-Projector: a 20-foot square of illusion centred where the
 *  player put it, drawn for the whole table. Costs the actor an action. */
export interface HoloProjectPayload { characterId: string; mapId: string; x: number; y: number }
/** Shut one down. Also an action, per the device. */
export interface HoloStopPayload { characterId: string }
export interface SetMoveLockPayload { locked: boolean }
export interface SetRollLockPayload { locked: boolean }
/** One player's own lock. `which` names which of the two is being aimed. */
export interface SetPlayerLockPayload { userId: string; which: 'move' | 'roll'; locked: boolean }
export interface MoveLockPayload { locked: boolean }
export interface RollLockPayload { locked: boolean }
/**
 * The itemised modifier a shot would carry if it were taken right now.
 *
 * `tags` is the same list the roll's own tooltip shows afterwards, because it
 * is produced by the same function — see swadeShotModifiers.
 */
export interface ChatRemovedPayload { messageIds: number[] }

export interface MapZonesPayload { mapId: string; zones: MapZone[] }

export interface AttackPreviewResultPayload {
  sourceTokenId: string;
  targetTokenId: string;
  actionId: string;
  mod: number;
  tags: string[];
  /** Set when the shot cannot be taken at all; `tags` is then empty. */
  blocked?: string;
}
export interface DiceSpeedPayload { speed: DiceSpeed }
export interface CampaignRenamedPayload { name: string }
export interface CampaignDeletedPayload { campaignId: string; name: string }
/** SWADE Soak: spend=false declines and keeps the wounds. */
export interface SoakRollPayload { characterId: string; spend: boolean }
/**
 * SWADE Tests: an opposed trick — Taunt, Intimidation, a trip — resolved as
 * the attacker's skill against the attribute that skill is linked to. The
 * server rolls both sides; on a success the DM alone is asked what it earns.
 */
export interface RequestTestPayload {
  attackerTokenId: string;
  targetTokenId: string;
  /** The skill the trick is performed with; resisted by its linked attribute. */
  skill: string;
  /** The GM's situational modifier (range, cover, repetition, a bruised ego). */
  mod?: number;
}
/** Sent to the DM when a Test succeeds: the judgement seat. */
export interface TestPromptPayload {
  testId: string;
  attackerName: string;
  targetName: string;
  skill: string;
  margin: number;
  raise: boolean;
}
/** The DM's ruling. `shaken` only counts when the Test won with a raise. */
export interface TestOutcomePayload {
  testId: string;
  outcome: 'distracted' | 'vulnerable' | 'none';
  shaken?: boolean;
}
export interface SoakOfferPayload { characterId: string; name: string; wounds: number; bennies: number }

/**
 * SWADE grenades, the moment one lands and before it goes off. The blast is
 * parked for a beat and everyone standing in it is asked the same question.
 * One answer settles it for the whole blast: grabbing the grenade and
 * smothering it are both physical monopolies on the thing, so the first
 * decisive choice closes the window for everyone.
 */
export type BlastChoice = 'potato' | 'cover' | 'none';

/** One character of yours standing in the blast, and what they may try. */
export interface BlastCandidate {
  characterId: string;
  tokenId: string;
  name: string;
  /** Athletics penalty on the throw-back: −4, or −2 if they were on Hold. */
  potatoMod: number;
  /** They were on Hold, hence the softer penalty. */
  onHold: boolean;
}

export interface BlastOfferPayload {
  blastId: string;
  /** The grenade's name, for the prompt's headline. */
  label: string;
  /** Who threw it — the hex a successful throw-back sends it to. */
  throwerName: string;
  /** Milliseconds left on the fuse before the blast resolves itself. */
  graceMs: number;
  /** Covering only means something when the blast actually deals damage. */
  canCover: boolean;
  candidates: BlastCandidate[];
}

export interface BlastOfferClosedPayload { blastId: string }

export interface BlastResponsePayload {
  blastId: string;
  characterId: string;
  choice: BlastChoice;
}
/** The Benny-menu uses the server can automate. Soak rides the existing SOAK_ROLL flow. */
export type BennyUseId =
  | 'reroll-trait' | 'recover-shaken' | 'redraw-card' | 'reroll-damage' | 'regain-pp' | 'influence';
export interface BennyUsePayload { characterId: string; use: BennyUseId }
export interface BennyAwardPayload { characterId: string }
/** Start a new session: every hero draws a fresh hand of Bennies. */
export interface SessionStartPayload { confirm: true }
export interface BleedRollPayload { characterId: string }
export interface BleedPromptPayload { characterId: string; name: string }
export interface ShakenRollPayload { characterId: string }
export interface ShakenPromptPayload { characterId: string; name: string }
/** The full ordered "kind:id" key list of one parent's world-tree children. */
export interface WorldReorderPayload { keys: string[] }
export interface WorldSortPayload { orders: Record<string, number> }
export interface StunRollPayload { characterId: string }
export interface CombatAimPayload { characterId: string; tokenId: string }
export interface BootPlayerPayload { userId: string }
export interface SendCreatorPayload { userId: string }
export interface StunPromptPayload { characterId: string; name: string }
export interface IncapRollPayload { characterId: string }
export interface IncapDeathPayload { characterId: string }
export interface IncapPromptPayload {
  characterId: string;
  name: string;
  /** A Benny-funded Soak is still on the table (bennies in hand + fresh wounds). */
  canSoak: boolean;
}
export interface RunRollPayload { tokenId: string }
export interface RunPromptPayload { tokenId: string; name: string; pace: number; moved: number }
/** SWADE: a prone character asked to move. Standing costs 2″ of this turn's
 *  Pace; crawling keeps them down, is capped at 2″, and ignores rough ground. */
export interface CrawlPromptPayload { tokenId: string; name: string; crawlPace: number }
/** SWADE: leap. `withRunUp` doubles the free distance (2″ of movement first);
 *  `athletics` spends the turn's action to roll for extra distance. */
export interface JumpRollPayload { tokenId: string; withRunUp: boolean; athletics: boolean }
/** DM-only: the fight ended with this many Incapacitated Extras on the floor. */
export interface AftermathPromptPayload { names: string[] }
/** Start a chase between these tokens at this scale. */
export interface ChaseStartPayload {
  tokenIds: string[];
  incrementId: import('./systems/swadeChase.js').ChaseIncrementId;
  /** How many Chase Cards to lay out. */
  trackLength?: number;
}
/**
 * Move on the track. `mode` is how: a free maneuvering roll, the same roll as
 * an action for +2, or dropping back without rolling at all.
 */
export interface ChaseMovePayload {
  entryId: string;
  mode: 'free' | 'action' | 'dropBack';
  /** Which way, for a roll that succeeds (or how far back to drop). */
  direction: 'forward' | 'back';
}
/**
 * Spend the turn's action on a chase maneuver. `targetEntryId` is required by
 * the ones that need somebody to do it to — Force, Ram and Board — and the
 * server checks the reach itself rather than trusting the button that sent it.
 */
export interface ChaseActionPayload {
  entryId: string;
  action: import('./systems/swadeChase.js').ChaseActionId;
  targetEntryId?: string;
}
/** Roll Vigor for each of them, or let the wounds finish what they started. */
export interface AftermathRollPayload { roll: boolean }
/** DM-only: these wounded are due their natural healing roll. */
export interface HealingPromptPayload { names: string[] }
export interface HealingRollPayload { roll: boolean }
/** DM-only: this vehicle's driver owes a maneuvering roll or it goes Out of
 *  Control. `roll: false` means the driver held it. */
export interface VehicleOocPromptPayload { characterId: string; name: string }
/** DM-only: these machines are damaged and the clock has moved far enough to
 *  do something about it. `hours` is the downtime that just passed. */
export interface RepairPromptPayload { names: string[]; hours: number }
/** The GM's own Benny pool — villains' Jokers pay into it. DM-only. */
export interface GmBenniesPayload { count: number }
/**
 * What a token has left to move with this turn.
 *
 * The budget lives on the server (it is the only thing that can be trusted
 * with it) but the client has to draw the range, so it is published to
 * whoever is entitled to move that token. Absent entirely when no fight is
 * running: out of combat, Pace is not a budget at all.
 */
export interface MoveBudgetPayload {
  tokenId: string;
  /** Where the token stood when this was measured. The client predicts moves
   *  optimistically, so drawing the reach around the PREDICTED hex slid the
   *  whole area a step ahead and then snapped it back when the real budget
   *  arrived. Anchored here, it simply waits and redraws once. */
  from: { q: number; r: number };
  /** The turn's allowance in inches, already adjusted for standing/crawling. */
  pace: number;
  /** Inches spent so far this turn. */
  moved: number;
  /** The running die's bonus, once it has been rolled; null if it has not. */
  runBonus: number | null;
  /** The most that die could possibly add, for the "if you ran" band drawn
   *  on the map. 0 once it has been rolled — the bonus above is the answer
   *  then — and 0 for anything that cannot run at all. */
  runMax: number;
  /** Down and staying down: rough ground costs this token nothing extra. */
  crawling: boolean;
  /** Actions taken this turn, for the Multi-Action penalty and for the turn
   *  coach, which is trying to tell the player what is left to do. */
  actions: number;
  /** True while this character is Shaken and still owes the roll to shake it
   *  off — the first thing a SWADE turn asks. */
  shaken: boolean;
}
export interface RepairRollPayload { roll: boolean }
export interface VehicleOocRollPayload { characterId: string; roll: boolean }

/**
 * The GM's time controls. A SWADE round is six seconds — the book's own
 * figure, and ten rounds to the minute — so everything longer is a multiple
 * of it and the whole clock stays in one unit.
 */
export const SECONDS_PER_ROUND = 6;
export const TIME_STEPS = [
  { id: 'round', label: '1 round', icon: '⚔️', seconds: SECONDS_PER_ROUND },
  { id: 'minute', label: '1 minute', icon: '🕐', seconds: 60 },
  { id: 'hour', label: '1 hour', icon: '🕰️', seconds: 3600 },
  { id: 'day', label: '1 day', icon: '🌅', seconds: 86_400 },
] as const;
export type TimeStepId = (typeof TIME_STEPS)[number]['id'];
export interface AdvanceTimePayload { step: TimeStepId }
export interface ClockPayload { seconds: number }
/** Their answer: get up, or stay down and crawl. */
export interface ProneMovePayload { tokenId: string; mode: 'stand' | 'crawl' }
/** Ride `mountId`, or dismount when it is null. */
export interface MountTokenPayload { tokenId: string; mountId: string | null }
export interface IronDicePayload {
  /** SHA-256 of the ACTIVE secret seed — published before its rolls happen. */
  commit: string;
  firstIdx: number;
  createdAt: number;
  /** Rolls thrown under the active seed so far. */
  rolls: number;
  /** Rotated-out seeds, now public: recompute any roll in their idx range. */
  revealed: Array<{ commit: string; seedHex: string; firstIdx: number; lastIdx: number; revealedAt: number }>;
}
export interface PublicSheetGetPayload { characterId: string }
export interface DmNotesGetPayload { characterId: string }
export interface DmNotesSetPayload { characterId: string; text: string }
export interface DmNotesPayload { characterId: string; text: string }
export interface CounterUpdatePayload { counterId: string; patch: Partial<Pick<Counter, 'mapId' | 'name' | 'color' | 'max' | 'value' | 'visible' | 'sharedWith' | 'position'>> }
export interface CountersPayload { mapId: string; counters: Counter[] }
export interface PrivateNotesGetPayload { characterId: string }
export interface PrivateNotesSetPayload { characterId: string; text: string }
export interface PrivateNotesPayload { characterId: string; text: string }
/** The safe, anyone-at-the-table view of a character: exactly the nameplate
 *  info plus portrait, token art, and free-text bio — never the sheet. */
export interface PublicSheetPayload {
  characterId: string;
  name: string;
  system: GameSystem;
  color: string;
  /** The nameplate's descriptive lines, each tagged rank / concept / origin. */
  lines: NameplateLine[];
  portraitUrl: string | null;
  tokenImageUrl: string | null;
  /** The big Detail / portrait artwork, headlining the Profile tab. */
  detailImageUrl: string | null;
  /** The character's own public-facing write-up, in their player's words. */
  bioText: string;
  bio: Array<{ title: string; entries: Array<{ label: string; text: string }> }>;
}
export interface RollStatsGetPayload { characterId?: string | null }
export interface RollStatsUserBlock { userId: string; username: string; summary: import('./systems/rollStats.js').RollStatsSummary }
/** characterId null = account-wide stats for every member of this campaign. */
export interface RollStatsPayload { characterId: string | null; users: RollStatsUserBlock[] }
export interface BennyStatePayload {
  characterId: string;
  canRerollTrait: boolean;
  canRerollDamage: boolean;
  /** The last trait roll was a Critical Failure, which no Benny can buy back.
   *  Sent so the menu can SAY that rather than simply offering nothing. */
  traitCritFail?: boolean;
}
/** Set the color of the pips/numbers painted on your own dice ("#rrggbb", or null for automatic contrast). */
export interface SetDiceTextColorPayload { color: string | null }
/** Set your own presence-dot / chat-name color ("#rrggbb", or null for the deterministic default). */
export interface SetPlayerColorPayload { color: string | null }
/** Rename yourself (2-24 chars, letters/digits/underscore/hyphen, must be unique). */
export interface SetUsernamePayload { username: string }
/** The campaign's party (default) map changed. */
export interface ActiveMapPayload { mapId: string | null }
export interface ErrorMsgPayload { message: string }
