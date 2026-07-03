import { create } from 'zustand';
import {
  C2S, S2C,
  type CampaignInfo, type CampaignStatePayload, type Character, type ChatMessage,
  type DieRoll, type DirectoryPayload,
  type Door, type Drawing, type DrawingLayerName, type GridConfig, type Handout, type Hex,
  type InitiativeState, type Light, type Macro, type MapEditedPayload, type MapMeta,
  type MapStatePayload, type MapView, type MeasureShownPayload, type MemberInfo,
  type PingShownPayload, type RollableTable, type TokenView, type VisionStats,
  type VisionUpdatePayload, type Wall, type YouArePayload,
} from 'shared';
import { connectSocket, socket } from '../socket';

export type Tool = 'select' | 'wall' | 'door' | 'light' | 'draw' | 'measure' | 'erase' | 'ping';

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
  diceAnim: { id: number; dice: DieRoll[]; byName: string } | null;

  camera: Camera;
  tool: Tool;
  selectedTokenId: string | null;
  selectedLightId: string | null;
  sheetCharacterId: string | null;
  drawColor: string;
  drawLayer: DrawingLayerName;
  setDrawColor(c: string): void;
  setDrawLayer(l: DrawingLayerName): void;

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

  camera: { x: 0, y: 0, scale: 1 },
  tool: 'select',
  selectedTokenId: null,
  selectedLightId: null,
  sheetCharacterId: null,
  drawColor: '#e8d27b',
  drawLayer: 'map',
  setDrawColor(drawColor) { set({ drawColor }); },
  setDrawLayer(drawLayer) { set({ drawLayer }); },

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
      viewingAs: null, dragGhosts: {}, selectedTokenId: null, sheetCharacterId: null,
    });
  },

  setCamera(camera) { set({ camera }); },
  setTool(tool) {
    set({
      tool,
      selectedTokenId: tool === 'select' ? get().selectedTokenId : null,
      selectedLightId: tool === 'light' ? get().selectedLightId : null,
    });
  },
  selectToken(selectedTokenId) { set({ selectedTokenId }); },
  selectLight(selectedLightId) { set({ selectedLightId }); },
  openSheet(sheetCharacterId) { set({ sheetCharacterId }); },
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

  socket.on(S2C.CHARACTER_REMOVED, ({ characterId }: { characterId: string }) => {
    const s = useGameStore.getState();
    useGameStore.setState({
      characters: s.characters.filter((c) => c.id !== characterId),
      sheetCharacterId: s.sheetCharacterId === characterId ? null : s.sheetCharacterId,
    });
  });

  socket.on(S2C.CHAT, ({ msg }: { msg: ChatMessage }) => {
    const s = useGameStore.getState();
    useGameStore.setState({ chatLog: [...s.chatLog.slice(-499), msg] });
    // Any dice roll triggers the 3D dice animation (capped so a 100d6
    // doesn't fill the screen).
    if (msg.roll && msg.roll.dice.length > 0) {
      const id = ++pingCounter;
      useGameStore.setState({ diceAnim: { id, dice: msg.roll.dice.slice(0, 12), byName: msg.fromName } });
      setTimeout(() => {
        const cur = useGameStore.getState();
        if (cur.diceAnim?.id === id) useGameStore.setState({ diceAnim: null });
      }, 3000);
    }
  });

  socket.on(S2C.MACROS, ({ macros }: { macros: Macro[] }) => {
    useGameStore.setState({ macroList: macros });
  });

  socket.on(S2C.TABLES, ({ tables }: { tables: RollableTable[] }) => {
    useGameStore.setState({ tableList: tables });
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

  socket.on(S2C.MEMBER_PRESENCE, ({ userId, online, mapId }: { userId: string; online: boolean; mapId: string | null }) => {
    const s = useGameStore.getState();
    useGameStore.setState({
      members: s.members.map((m) => (m.userId === userId ? { ...m, online, mapId } : m)),
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

  upsertWall: (mapId: string, wall: { id?: string; points: Array<{ x: number; y: number }> }) =>
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

  createCharacter: (name: string, system: 'dnd5e' | 'swn', ownerUserId?: string | null) =>
    socket.emit(C2S.CREATE_CHARACTER, { name, system, ownerUserId }),
  createNpc: (libraryId: string, name?: string) => socket.emit(C2S.CREATE_NPC, { libraryId, name }),
  deleteCharacter: (characterId: string) => socket.emit(C2S.DELETE_CHARACTER, { characterId }),
  updateCharacter: (characterId: string, patch: Record<string, unknown>, name?: string) =>
    socket.emit(C2S.UPDATE_CHARACTER, { characterId, patch, name }),
  sheetRoll: (characterId: string, rollableId: string, adv?: 'adv' | 'dis' | null) =>
    socket.emit(C2S.SHEET_ROLL, { characterId, rollableId, adv }),

  chat: (text: string) => socket.emit(C2S.CHAT, { text }),
  saveMacro: (macro: { id?: string; name: string; command: string; color?: string | null; characterId?: string | null; rollableId?: string | null }) =>
    socket.emit(C2S.SAVE_MACRO, { macro }),
  reorderMacros: (macroIds: string[]) => socket.emit(C2S.REORDER_MACROS, { macroIds }),
  deleteMacro: (macroId: string) => socket.emit(C2S.DELETE_MACRO, { macroId }),
  runMacro: (macroId: string) => {
    const m = useGameStore.getState().macroList.find((x) => x.id === macroId);
    if (!m) return;
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
};
