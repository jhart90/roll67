import { create } from 'zustand';
import {
  C2S, S2C, castableLevels, combatActions, systemFor,
  type CampaignInfo, type CampaignStatePayload, type Character, type ChatMessage,
  type CombatAction, type DieRoll, type DirectoryPayload, type HpFloatPayload,
  type Door, type Drawing, type DrawingLayerName, type GridConfig, type Handout, type Hex,
  type InitiativeState, type Light, type Macro, type MapEditedPayload, type MapMeta,
  type AssetFolder, type AssetInfo, type AudioState, type AudioTrack,
  type LocationNode, type MapStatePayload, type MapView, type MeasureShownPayload,
  type MemberInfo, type PingShownPayload, type RollableTable, type Shop,
  type TableResultPayload,
  type TokenView, type VisionStats, type VisionUpdatePayload, type Wall, type YouArePayload,
} from 'shared';
import { connectSocket, socket } from '../socket';
import { closeWindow, openWindow } from './windowManager';

export type Tool = 'select' | 'wall' | 'door' | 'light' | 'draw' | 'measure' | 'erase' | 'ping' | 'spawn';

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
  shopList: Shop[];
  locationList: LocationNode[];
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
  explored: Set<number> | null;
  knownDoors: Door[];
  viewingAs: string | null;
  dragGhosts: Record<string, { x: number; y: number }>;
  pings: Array<PingShownPayload & { id: number }>;
  measures: Record<string, MeasureShownPayload>;
  errorToast: string | null;
  /** Live 3D dice animation for the latest roll. */
  diceAnim: { id: number; dice: DieRoll[]; byName: string; byUserId: string | null; total: number; expression: string } | null;
  /** In-progress combat action awaiting a target selection. */
  targeting: { characterId: string; sourceTokenId: string; action: CombatAction; adv: 'adv' | 'dis' | null } | null;
  /** Floating +/-HP combat text over tokens. */
  floats: Array<{ id: number; tokenId: string; delta: number }>;
  /** On-screen rollable-table result pills (fade out after ~3s). */
  tableToasts: Array<{ id: number; text: string; color: string }>;
  beginTargeting(characterId: string, sourceTokenId: string, action: CombatAction, adv: 'adv' | 'dis' | null): void;
  cancelTargeting(): void;
  resolveTarget(targetTokenId: string): void;
  /** Pending spell cast awaiting a slot-level choice. */
  castPrompt: { characterId: string; rollableId: string; label: string; levels: number[] } | null;
  beginCast(characterId: string, rollableId: string, minLevel: number, label: string): void;
  castSpell(characterId: string, rollableId: string, slotLevel: number): void;
  cancelCast(): void;

  camera: Camera;
  tool: Tool;
  selectedTokenId: string | null;
  /** Token whose inspector panel is open (right-click), separate from selection. */
  inspectorTokenId: string | null;
  openInspector(id: string | null): void;
  selectedLightId: string | null;
  /** Local-only: mute audio on this device without affecting others. */
  clientMuted: boolean;
  setClientMuted(m: boolean): void;
  drawColor: string;
  drawLayer: DrawingLayerName;
  setDrawColor(c: string): void;
  setDrawLayer(l: DrawingLayerName): void;
  wallType: 'solid' | 'window' | 'oneway';
  wallFlip: boolean;
  setWallType(t: 'solid' | 'window' | 'oneway'): void;
  toggleWallFlip(): void;

  // actions
  join(campaignId: string): void;
  leave(): void;
  setCamera(c: Camera): void;
  setTool(t: Tool): void;
  selectToken(id: string | null): void;
  selectLight(id: string | null): void;
  openSheet(characterId: string | null): void;
  clearError(): void;

  isDm(): boolean;
  effectiveVisible(): Set<number> | null;
}

let pingCounter = 0;

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
  audioState: { trackId: null, playing: false, loop: false, volume: 0.6, startedAt: 0 },
  shopList: [],
  locationList: [],
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
  explored: null,
  knownDoors: [],
  viewingAs: null,
  dragGhosts: {},
  pings: [],
  measures: {},
  errorToast: null,
  diceAnim: null,
  targeting: null,
  floats: [],
  tableToasts: [],
  beginTargeting(characterId, sourceTokenId, action, adv) {
    // Character sheets are movable windows now (not a full-screen modal), so
    // the map stays clickable underneath them — no need to force one closed.
    set({ targeting: { characterId, sourceTokenId, action, adv }, tool: 'select', selectedTokenId: null });
  },
  cancelTargeting() { set({ targeting: null }); },
  resolveTarget(targetTokenId) {
    const t = get().targeting;
    if (!t) return;
    socket.emit(C2S.COMBAT_ACTION, {
      characterId: t.characterId, actionId: t.action.id,
      sourceTokenId: t.sourceTokenId, targetTokenId, adv: t.adv,
    });
    set({ targeting: null });
  },
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
    set({ castPrompt: null });
  },
  cancelCast() { set({ castPrompt: null }); },

  camera: { x: 0, y: 0, scale: 1 },
  tool: 'select',
  selectedTokenId: null,
  inspectorTokenId: null,
  openInspector(inspectorTokenId) { set({ inspectorTokenId }); },
  selectedLightId: null,
  clientMuted: false,
  setClientMuted(clientMuted) { set({ clientMuted }); },
  drawColor: '#e8d27b',
  drawLayer: 'map',
  setDrawColor(drawColor) { set({ drawColor }); },
  setDrawLayer(drawLayer) { set({ drawLayer }); },
  wallType: 'solid',
  wallFlip: false,
  setWallType(wallType) { set({ wallType }); },
  toggleWallFlip() { set({ wallFlip: !get().wallFlip }); },

  join(campaignId) {
    connectSocket();
    socket.emit(C2S.JOIN_CAMPAIGN, { campaignId });
  },

  leave() {
    socket.emit(C2S.LEAVE_CAMPAIGN);
    set({
      you: null, campaign: null, members: [], characters: [], mapsMeta: [],
      handoutList: [], macroList: [], chatLog: [], map: null, dmGeometry: null,
      tokens: {}, drawingList: [], visible: null, fade: null, explored: null, knownDoors: [],
      viewingAs: null, dragGhosts: {}, selectedTokenId: null, inspectorTokenId: null,
      targeting: null, floats: [], castPrompt: null,
    });
  },

  setCamera(camera) { set({ camera }); },
  setTool(tool) {
    set({
      tool,
      inspectorTokenId: null,
      selectedTokenId: tool === 'select' ? get().selectedTokenId : null,
      selectedLightId: tool === 'light' ? get().selectedLightId : null,
    });
  },
  selectToken(selectedTokenId) { set({ selectedTokenId }); },
  selectLight(selectedLightId) { set({ selectedLightId }); },
  openSheet(characterId) {
    if (!characterId) return; // legacy "close" signal — each sheet window now closes itself
    const char = get().characters.find((c) => c.id === characterId);
    openWindow('characterSheet', characterId, { characterId }, char?.name ?? 'Character');
  },
  clearError() { set({ errorToast: null }); },

  isDm() { return get().you?.role === 'dm'; },
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
      chatLog: p.chatTail,
    });
  });

  socket.on(S2C.MAP_STATE, (p: MapStatePayload) => {
    useGameStore.setState({
      map: p.map,
      dmGeometry: p.dmGeometry,
      tokens: tokensById(p.tokens),
      drawingList: p.drawings,
      visible: p.visible ? new Set(p.visible) : null,
      fade: p.fade ? new Set(p.fade) : null,
      explored: p.explored ? new Set(p.explored) : null,
      knownDoors: p.knownDoors,
      viewingAs: p.viewingAs,
      dragGhosts: {},
      selectedTokenId: null,
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
    const explored = new Set(s.explored ?? []);
    for (const h of p.newlyExplored) explored.add(h);
    useGameStore.setState({
      visible: new Set(p.visible),
      fade: new Set(p.fade),
      explored,
      tokens: tokensById(p.tokens),
      knownDoors: p.knownDoors,
      dragGhosts: {},
    });
  });

  socket.on(S2C.TOKEN_UPSERTED, ({ token }: { token: TokenView }) => {
    const s = useGameStore.getState();
    if (s.viewingAs) return; // preview mode: vision updates drive tokens
    if (s.map?.id !== token.mapId) return;
    useGameStore.setState({ tokens: { ...s.tokens, [token.id]: token } });
  });

  socket.on(S2C.TOKEN_REMOVED, ({ tokenId }: { tokenId: string }) => {
    const s = useGameStore.getState();
    if (s.viewingAs) return;
    const tokens = { ...s.tokens };
    delete tokens[tokenId];
    useGameStore.setState({
      tokens,
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
    useGameStore.setState({ floats: [...s.floats, { id, tokenId: p.tokenId, delta: p.delta }] });
    setTimeout(() => {
      const cur = useGameStore.getState();
      useGameStore.setState({ floats: cur.floats.filter((f) => f.id !== id) });
    }, 1600);
  });

  socket.on(S2C.CHARACTER_REMOVED, ({ characterId }: { characterId: string }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ characters: s.characters.filter((c) => c.id !== characterId) });
    closeWindow(`characterSheet:${characterId}`);
  });

  socket.on(S2C.CHAT, ({ msg }: { msg: ChatMessage }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ chatLog: [...s.chatLog.slice(-499), msg] });
    // Any dice roll triggers the 3D dice animation (capped so a 100d6
    // doesn't fill the screen).
    if (msg.roll && msg.roll.dice.length > 0) {
      const id = ++pingCounter;
      useGameStore.setState({
        diceAnim: {
          id, dice: msg.roll.dice.slice(0, 12), byName: msg.fromName,
          byUserId: msg.fromUserId, total: msg.roll.total, expression: msg.roll.expression,
        },
      });
      // Long enough for the roll-in (~2s) plus time to read the result.
      setTimeout(() => {
        const cur = useGameStore.getState();
        if (cur.diceAnim?.id === id) useGameStore.setState({ diceAnim: null });
      }, 5000);
    }
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

  socket.on(S2C.SHOPS, ({ shops }: { shops: Shop[] }) => {
    useGameStore.setState({ shopList: shops });
  });

  socket.on(S2C.SHOP_PRESENTATION, ({ shopId }: { shopId: string | null }) => {
    useGameStore.setState({ presentedShopId: shopId });
  });

  socket.on(S2C.LOCATIONS, ({ locations }: { locations: LocationNode[] }) => {
    useGameStore.setState({ locationList: locations });
  });

  socket.on(S2C.INITIATIVE, ({ state }: { state: InitiativeState }) => {
    useGameStore.setState({ initiativeState: state });
  });

  socket.on(S2C.HANDOUTS, ({ handouts }: { handouts: Handout[] }) => {
    useGameStore.setState({ handoutList: handouts });
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

  socket.on(S2C.MEMBER_PRESENCE, ({ userId, online, mapId, diceColor }: { userId: string; online: boolean; mapId: string | null; diceColor: string | null }) => {
    const s = useGameStore.getState();
    useGameStore.setState({
      members: s.members.map((m) => (m.userId === userId ? { ...m, online, mapId, diceColor } : m)),
    });
  });

  socket.on(S2C.ACTIVE_MAP, ({ mapId }: { mapId: string | null }) => {
    const s = useGameStore.getState();
    if (s.campaign) {
      useGameStore.setState({ campaign: { ...s.campaign, activeMapId: mapId } });
    }
  });

  socket.on(S2C.ERROR_MSG, ({ message }: { message: string }) => {
    useGameStore.setState({ errorToast: message });
    setTimeout(() => {
      if (useGameStore.getState().errorToast === message) {
        useGameStore.setState({ errorToast: null });
      }
    }, 5000);
  });
}

// ---------- intent emitters ----------

export const intents = {
  switchMap: (mapId: string) => socket.emit(C2S.SWITCH_ACTIVE_MAP, { mapId }),
  viewMap: (mapId: string | null) => socket.emit(C2S.VIEW_MAP, { mapId }),
  assignPlayerMap: (userId: string, mapId: string | null) =>
    socket.emit(C2S.ASSIGN_PLAYER_MAP, { userId, mapId }),
  dmViewAs: (userId: string | null) => socket.emit(C2S.DM_VIEW_AS, { userId }),

  createMap: (name: string) => socket.emit(C2S.CREATE_MAP, { name }),
  deleteMap: (mapId: string) => socket.emit(C2S.DELETE_MAP, { mapId }),
  updateMap: (mapId: string, fields: { name?: string; bgAssetId?: string | null }) =>
    socket.emit(C2S.UPDATE_MAP, { mapId, ...fields }),
  setGrid: (mapId: string, grid: Partial<GridConfig>) => socket.emit(C2S.SET_GRID_CONFIG, { mapId, grid }),
  setSpawn: (mapId: string, q: number, r: number) => socket.emit(C2S.SET_SPAWN, { mapId, q, r }),

  upsertWall: (mapId: string, wall: { id?: string; points: Array<{ x: number; y: number }>; type?: 'solid' | 'window' | 'oneway'; flip?: boolean }) =>
    socket.emit(C2S.UPSERT_WALL, { mapId, wall }),
  deleteWall: (mapId: string, wallId: string) => socket.emit(C2S.DELETE_WALL, { mapId, wallId }),
  upsertDoor: (mapId: string, door: { id?: string; a: { x: number; y: number }; b: { x: number; y: number }; open?: boolean }) =>
    socket.emit(C2S.UPSERT_DOOR, { mapId, door }),
  deleteDoor: (mapId: string, doorId: string) => socket.emit(C2S.DELETE_DOOR, { mapId, doorId }),
  toggleDoor: (mapId: string, doorId: string) => socket.emit(C2S.TOGGLE_DOOR, { mapId, doorId }),
  upsertLight: (mapId: string, light: { id?: string; x: number; y: number; brightRadius: number; dimRadius: number; color?: string }) =>
    socket.emit(C2S.UPSERT_LIGHT, { mapId, light }),
  deleteLight: (mapId: string, lightId: string) => socket.emit(C2S.DELETE_LIGHT, { mapId, lightId }),

  createToken: (payload: {
    mapId: string; name: string; q: number; r: number; characterId?: string | null;
    artAssetId?: string | null; layer?: 'token' | 'gm'; size?: number; color?: string;
    vision?: VisionStats | null; bar?: { hp: number; maxHp: number } | null;
  }) => socket.emit(C2S.CREATE_TOKEN, payload),
  deleteToken: (tokenId: string) => socket.emit(C2S.DELETE_TOKEN, { tokenId }),
  updateToken: (tokenId: string, patch: Record<string, unknown>) => socket.emit(C2S.UPDATE_TOKEN, { tokenId, patch }),
  moveToken: (tokenId: string, q: number, r: number) => socket.emit(C2S.MOVE_TOKEN, { tokenId, q, r }),
  dragToken: (tokenId: string, x: number, y: number, done = false) =>
    socket.emit(C2S.DRAG_TOKEN, { tokenId, x, y, done }),

  createCharacter: (name: string, system: 'dnd5e' | 'swn', ownerUserId?: string | null, initialClass?: string) =>
    socket.emit(C2S.CREATE_CHARACTER, { name, system, ownerUserId, initialClass }),
  createNpc: (libraryId: string, name?: string) => socket.emit(C2S.CREATE_NPC, { libraryId, name }),
  createRandomNpc: (count?: number, modelId?: string) => socket.emit(C2S.CREATE_RANDOM_NPC, { count, modelId }),
  deleteCharacter: (characterId: string) => socket.emit(C2S.DELETE_CHARACTER, { characterId }),
  updateCharacter: (characterId: string, patch: Record<string, unknown>, name?: string) =>
    socket.emit(C2S.UPDATE_CHARACTER, { characterId, patch, name }),
  levelUpRoll: (p: { characterId: string; patch: Record<string, unknown>; hitDie: number; conMod: number; avgHp: number; label: string }) =>
    socket.emit(C2S.LEVEL_UP_ROLL, p),
  sheetRoll: (characterId: string, rollableId: string, adv?: 'adv' | 'dis' | null) =>
    socket.emit(C2S.SHEET_ROLL, { characterId, rollableId, adv }),

  chat: (text: string) => socket.emit(C2S.CHAT, { text }),
  setDiceColor: (color: string | null) => socket.emit(C2S.SET_DICE_COLOR, { color }),
  saveMacro: (macro: { id?: string; name: string; command: string; color?: string | null; characterId?: string | null; rollableId?: string | null; actionId?: string | null }) =>
    socket.emit(C2S.SAVE_MACRO, { macro }),
  reorderMacros: (macroIds: string[]) => socket.emit(C2S.REORDER_MACROS, { macroIds }),
  deleteMacro: (macroId: string) => socket.emit(C2S.DELETE_MACRO, { macroId }),
  castSpell: (characterId: string, rollableId: string, slotLevel: number) =>
    socket.emit(C2S.CAST_SPELL, { characterId, rollableId, slotLevel }),
  usePower: (characterId: string, powerIndex: number) =>
    socket.emit(C2S.USE_POWER, { characterId, powerIndex }),
  deathSave: (characterId: string) => socket.emit(C2S.DEATH_SAVE, { characterId }),
  requestSave: (p: { tokenIds: string[]; saveId: string; dc: number; damageExpr?: string; onSave: 'half' | 'negate'; damageType?: string; label?: string }) =>
    socket.emit(C2S.REQUEST_SAVE, p),
  moderateMessage: (messageId: number, action: 'hide' | 'unhide' | 'hideUndo') =>
    socket.emit(C2S.MODERATE_MESSAGE, { messageId, action }),
  runMacro: (macroId: string) => {
    const s = useGameStore.getState();
    const m = s.macroList.find((x) => x.id === macroId);
    if (!m) return;
    const char = m.characterId ? s.characters.find((c) => c.id === m.characterId) : undefined;
    // Combat-action pill (usable item / attack): begin targeting.
    if (m.characterId && m.actionId && char) {
      const action = combatActions(char).find((a) => a.id === m.actionId);
      if (!action) { s.clearError(); useGameStore.setState({ errorToast: `${m.name} is not available right now.` }); return; }
      const src = Object.values(s.tokens).find((t) => t.characterId === char.id && t.mapId === s.map?.id);
      if (!src) { useGameStore.setState({ errorToast: `Place ${char.name}'s token on this map first.` }); return; }
      s.beginTargeting(char.id, src.id, action, null);
      return;
    }
    // Spell-roll pill that costs a slot: run the cast flow.
    if (m.characterId && m.rollableId && char) {
      const r = systemFor(char.system).rollables(char.sheet).find((x) => x.id === m.rollableId);
      if (r?.slotLevel) { s.beginCast(char.id, m.rollableId, r.slotLevel, r.label); return; }
    }
    if (m.characterId && m.rollableId) socket.emit(C2S.SHEET_ROLL, { characterId: m.characterId, rollableId: m.rollableId });
    else socket.emit(C2S.CHAT, { text: m.command });
  },
  createTable: (name: string) => socket.emit(C2S.CREATE_TABLE, { name }),
  updateTable: (tableId: string, fields: { name?: string; playersCanRoll?: boolean; items?: Array<{ text: string; weight?: number }> }) =>
    socket.emit(C2S.UPDATE_TABLE, { tableId, ...fields }),
  deleteTable: (tableId: string) => socket.emit(C2S.DELETE_TABLE, { tableId }),
  rollTable: (tableId: string) => socket.emit(C2S.ROLL_TABLE, { tableId }),

  initAdd: (p: { tokenId?: string | null; name?: string; value?: number; roll?: boolean; hidden?: boolean }) =>
    socket.emit(C2S.INIT_ADD, p),
  initRemove: (entryId: string) => socket.emit(C2S.INIT_REMOVE, { entryId }),
  initUpdate: (entryId: string, fields: { value?: number; hidden?: boolean; name?: string }) =>
    socket.emit(C2S.INIT_UPDATE, { entryId, ...fields }),
  initNext: () => socket.emit(C2S.INIT_NEXT),
  initPrev: () => socket.emit(C2S.INIT_PREV),
  initSort: () => socket.emit(C2S.INIT_SORT),
  initClear: () => socket.emit(C2S.INIT_CLEAR),
  initSetActive: (active: boolean) => socket.emit(C2S.INIT_SET_ACTIVE, { active }),
  initRollMap: (mapId: string, includeGm: boolean) => socket.emit(C2S.INIT_ROLL_MAP, { mapId, includeGm }),

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

  addAudio: (assetId: string, title: string) => socket.emit(C2S.ADD_AUDIO, { assetId, title }),
  removeAudio: (trackId: string) => socket.emit(C2S.REMOVE_AUDIO, { trackId }),
  audioControl: (p: { trackId?: string; action: 'play' | 'stop' | 'pause'; loop?: boolean; volume?: number }) =>
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

  /** Reparent any world-tree entity (DM). parentId=null → top level. */
  setParent: (kind: 'location' | 'character' | 'shop' | 'table' | 'handout' | 'map', id: string, parentId: string | null) => {
    if (kind === 'character') socket.emit(C2S.UPDATE_CHARACTER, { characterId: id, patch: {}, parentId });
    else if (kind === 'location') socket.emit(C2S.UPDATE_LOCATION, { locationId: id, parentId });
    else if (kind === 'shop') socket.emit(C2S.UPDATE_SHOP, { shopId: id, parentId });
    else if (kind === 'table') socket.emit(C2S.UPDATE_TABLE, { tableId: id, parentId });
    else if (kind === 'handout') socket.emit(C2S.UPDATE_HANDOUT, { handoutId: id, parentId });
    else if (kind === 'map') socket.emit(C2S.UPDATE_MAP, { mapId: id, parentId });
  },

  /** Dragged a character from the World tab straight onto the map canvas: nest it under the map and drop its token at the exact hex released. */
  dropCharacterOnMap: (characterId: string, mapId: string, q: number, r: number) =>
    socket.emit(C2S.UPDATE_CHARACTER, { characterId, patch: {}, parentId: mapId, dropHex: { q, r } }),
};
