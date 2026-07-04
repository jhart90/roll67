// Socket protocol contract. Every event name and payload shape lives here;
// server handlers and client store both import from this file only.

import type {
  AssetFolder, AssetInfo, AudioState, AudioTrack,
  CampaignInfo, Character, ChatMessage, Door, Drawing, DrawingLayerName,
  GameSystem, GridConfig, Handout, Hex, InitiativeState, LocationNode, Light, Macro,
  MapDef, MapMeta, MapView, MeasureInfo, MemberInfo, PingInfo, Point,
  RollableTable, SheetData, Shop, Token, TokenLayer, TokenShape, TokenView, VisionStats,
} from './types.js';

// ---------- Client -> server intents ----------

export const C2S = {
  // session
  JOIN_CAMPAIGN: 'joinCampaign',
  LEAVE_CAMPAIGN: 'leaveCampaign',
  SWITCH_ACTIVE_MAP: 'switchActiveMap',
  VIEW_MAP: 'viewMap',
  ASSIGN_PLAYER_MAP: 'assignPlayerMap',
  DM_VIEW_AS: 'dmViewAs',
  // maps (DM)
  CREATE_MAP: 'createMap',
  DELETE_MAP: 'deleteMap',
  UPDATE_MAP: 'updateMap',
  SET_GRID_CONFIG: 'setGridConfig',
  // map geometry (DM, except toggleDoor)
  UPSERT_WALL: 'upsertWall',
  DELETE_WALL: 'deleteWall',
  UPSERT_DOOR: 'upsertDoor',
  DELETE_DOOR: 'deleteDoor',
  TOGGLE_DOOR: 'toggleDoor',
  UPSERT_LIGHT: 'upsertLight',
  DELETE_LIGHT: 'deleteLight',
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
  DEATH_SAVE: 'deathSave',
  REQUEST_SAVE: 'requestSave',
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
  // chat & macros
  CHAT: 'chat',
  SAVE_MACRO: 'saveMacro',
  DELETE_MACRO: 'deleteMacro',
  REORDER_MACROS: 'reorderMacros',
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
  INIT_SET_ACTIVE: 'initSetActive',
  INIT_ROLL_MAP: 'initRollMap',
  // table
  DRAW: 'draw',
  ERASE_DRAWING: 'eraseDrawing',
  CLEAR_DRAWINGS: 'clearDrawings',
  PING: 'ping',
  MEASURE: 'measure',
  // handouts
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
} as const;

export interface JoinCampaignPayload { campaignId: string }
export interface SwitchActiveMapPayload { mapId: string }
/** DM: view a map yourself without changing anyone else's map. null = follow party. */
export interface ViewMapPayload { mapId: string | null }
/** DM: put a player on a specific map. null = follow the party map. */
export interface AssignPlayerMapPayload { userId: string; mapId: string | null }
export interface DmViewAsPayload { userId: string | null }

export interface CreateMapPayload { name: string }
export interface DeleteMapPayload { mapId: string }
export interface UpdateMapPayload {
  mapId: string;
  name?: string;
  bgAssetId?: string | null;
}
export interface SetGridConfigPayload { mapId: string; grid: Partial<GridConfig> }

export interface UpsertWallPayload {
  mapId: string;
  wall: { id?: string; points: Point[]; type?: 'solid' | 'window' | 'oneway'; flip?: boolean };
}
export interface DeleteWallPayload { mapId: string; wallId: string }
export interface UpsertDoorPayload { mapId: string; door: { id?: string; a: Point; b: Point; open?: boolean } }
export interface DeleteDoorPayload { mapId: string; doorId: string }
export interface ToggleDoorPayload { mapId: string; doorId: string }
export interface UpsertLightPayload {
  mapId: string;
  light: { id?: string; x: number; y: number; brightRadius: number; dimRadius: number; color?: string };
}
export interface DeleteLightPayload { mapId: string; lightId: string }

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
  patch: Partial<Pick<Token, 'name' | 'layer' | 'size' | 'shape' | 'color' | 'vision' | 'bar' | 'light' | 'characterId'>> & {
    artAssetId?: string | null;
  };
}
export interface MoveTokenPayload { tokenId: string; q: number; r: number }
export interface DragTokenPayload { tokenId: string; x: number; y: number; done?: boolean }

export interface CreateCharacterPayload {
  name: string;
  system: GameSystem;
  /** DM may create NPC characters (ownerUserId null) or assign an owner. */
  ownerUserId?: string | null;
}
export interface CreateNpcPayload {
  /** Id from the shared pre-built NPC library. */
  libraryId: string;
  /** Optional custom display name (defaults to the library name). */
  name?: string;
}
export interface CreateRandomNpcPayload { count?: number }
export interface DeleteCharacterPayload { characterId: string }

export interface CreateShopPayload { name: string }
export interface UpdateShopPayload {
  shopId: string;
  name?: string;
  description?: string;
  currency?: string;
  playersCanBuy?: boolean;
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
export interface UpdateCharacterPayload { characterId: string; patch: SheetData; name?: string }
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
  action: 'hide' | 'unhide' | 'hideUndo';
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
export interface InitUpdatePayload { entryId: string; value?: number; hidden?: boolean; name?: string }

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

export interface AddAudioPayload { assetId: string; title: string }
export interface RemoveAudioPayload { trackId: string }
export interface AudioControlPayload {
  trackId?: string;
  action: 'play' | 'stop' | 'pause';
  loop?: boolean;
  volume?: number;
}

export interface CreateHandoutPayload { title: string; bodyMd?: string; assetId?: string | null }
export interface UpdateHandoutPayload { handoutId: string; title?: string; bodyMd?: string; assetId?: string | null }
export interface DeleteHandoutPayload { handoutId: string }
export interface ShareHandoutPayload { handoutId: string; to: string[] | 'all' | 'none' }

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
  CHAT: 'chatMsg',
  MACROS: 'macros',
  INITIATIVE: 'initiativeState',
  DRAWING_ADDED: 'drawingAdded',
  DRAWING_REMOVED: 'drawingRemoved',
  DRAWINGS_CLEARED: 'drawingsCleared',
  PING_SHOWN: 'pingShown',
  MEASURE_SHOWN: 'measureShown',
  HANDOUTS: 'handouts',
  TABLES: 'tables',
  TABLE_RESULT: 'tableResult',
  CHAT_UPDATED: 'chatUpdated',
  SHOPS: 'shops',
  SHOP_PRESENTATION: 'shopPresentation',
  LOCATIONS: 'locations',
  ASSETS: 'assets',
  AUDIO_TRACKS: 'audioTracks',
  AUDIO_STATE: 'audioState',
  DIRECTORY: 'directory',
  MEMBER_PRESENCE: 'memberPresence',
  ACTIVE_MAP: 'activeMap',
  ERROR_MSG: 'errorMsg',
} as const;

export interface YouArePayload {
  userId: string;
  username: string;
  role: 'dm' | 'player';
}

export interface CampaignStatePayload {
  campaign: CampaignInfo;
  members: MemberInfo[];
  characters: Character[];
  maps: MapMeta[];
  handouts: Handout[];
  macros: Macro[];
  initiative: InitiativeState;
  chatTail: ChatMessage[];
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
  /** Doors within the viewer's explored region (players only). */
  knownDoors: Door[];
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
}

export interface VisionUpdatePayload {
  mapId: string;
  visible: number[];
  /** Fading rim one hex past vision range. */
  fade: number[];
  newlyExplored: number[];
  /** Full list of tokens currently visible to this viewer. */
  tokens: TokenView[];
  /** Doors inside the viewer's explored region (full list). */
  knownDoors: Door[];
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
export interface HpFloatPayload { mapId: string; tokenId: string; delta: number }
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

export interface HandoutsPayload { handouts: Handout[] }
export interface ShopsPayload { shops: Shop[] }
/** Which shop (if any) to pop for this viewer; DM receives the presented id for a badge. */
export interface ShopPresentationPayload { shopId: string | null }
export interface LocationsPayload { locations: LocationNode[] }
export interface AssetsPayload { folders: AssetFolder[]; assets: AssetInfo[] }
export interface AudioTracksPayload { tracks: AudioTrack[] }
export interface AudioStatePayload { state: AudioState }

/** Campaign-wide shared reference of everything introduced so far. */
export interface DirectoryPayload {
  maps: Array<{ id: string; name: string }>;
  characters: Array<{ id: string; name: string; owner: string | null; system: GameSystem }>;
  tokens: Array<{ name: string; mapName: string; gm: boolean }>;
  weapons: string[];
  spells: string[];
  items: string[];
}
export interface MemberPresencePayload { userId: string; online: boolean; mapId: string | null }
/** The campaign's party (default) map changed. */
export interface ActiveMapPayload { mapId: string | null }
export interface ErrorMsgPayload { message: string }
