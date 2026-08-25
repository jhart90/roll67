import { useMemo, useRef, useState, type ReactNode } from 'react';
import { HandoutImages } from './HandoutsPanel';
import type { Character, Counter, DirectoryPayload, Handout, Light, LocationNode, MapMeta, MapObject, RollableTable, Shop, Token, WorldFolder } from 'shared';
import { str } from 'shared';
import { intents, useGameStore, type MapTarget } from '../store/game';
import { openWindow } from '../store/windowManager';
import { worldDrag, type WorldDragKind } from '../store/worldDrag';
import { AnchoredMenu } from '../util/AnchoredMenu';
import { ChestFolderEditor } from './ChestFolderEditor';
import { inkOnDark } from '../util/playerColor';

// 'token' nodes live only in this tree and are not draggable, so the kind is
// not part of WorldDragKind. 'mapobject' IS draggable — for reordering among
// its siblings, never for re-homing (see the drop handler).
type Kind = WorldDragKind | 'token';

interface TreeNode {
  /** SWADE: three Wounds and a Wild Die, or an Extra. Drives the silhouette. */
  wildCard?: boolean;
  /** A marker colour the DM chose for this row, overriding the rule. */
  markerColor?: string;
  kind: Kind;
  id: string;
  name: string;
  parentId: string | null;
  sub: string; // secondary label (owner, kind, item count…)
  displayKind?: 'folder' | 'chest';
  /** For light nodes: the map the light lives on (for drag operations). */
  lightMapId?: string;
  /** For token-light nodes: the token carrying the light. */
  lightTokenId?: string;
  /** For mapobject nodes: the placed object's own kind (item/chest). */
  mapObjectKind?: 'item' | 'chest' | 'shop';
  /** A grouping row the tree invents (the per-map "Lights" folder) rather than
   *  a stored one. It has no row behind it, so it cannot be renamed, dragged,
   *  deleted or dropped into — every such action is refused by id. */
  virtual?: boolean;
  /** A character this viewer has discovered but does not own: clicking it
   *  opens the public-facing sheet, never the private one. */
  notMine?: boolean;
  /** For token nodes: where it stands and who runs it. */
  tokenMapId?: string;
  tokenCharacterId?: string | null;
  /** A player runs this one — light-blue silhouette rather than DM grey. */
  playerRun?: boolean;
  /** The token color this character/token wears on the map, when it has one.
   *  Paints the silhouette, so the tree matches the pieces at a glance. */
  color?: string;
  /** For map nodes: a scene, and whether a details preview exists. */
  isScene?: boolean;
  hasPreview?: boolean;
}

/**
 * The colour of a row's silhouette: the DM's choice if they made one, and
 * otherwise nothing — the class carries the Wild Card / Extra default, so a
 * theme can restyle both without this file being touched.
 */
/** A short, high-contrast palette for marker colours — enough to tell six
 *  factions apart at a glance without opening a colour wheel. */
const MARKER_COLORS = ['#4ea8ff', '#8a93a6', '#5cc98a', '#e8c86a', '#e06a6a', '#c07ae0', '#e08a4a', '#f0f0f0'];

function markerStyle(node: { kind: string; markerColor?: string }): { color: string } | undefined {
  if (node.markerColor) return { color: inkOnDark(node.markerColor) };
  return undefined;
}

/**
 * The character marker, drawn rather than typed.
 *
 * It used to be the 👤 emoji, and that quietly defeated every colour on this
 * row. A colour emoji is painted by the font in the font's own colours -- a
 * purple bust, on Windows -- and CSS `color` cannot reach inside it. So the
 * Wild Card blue, the Extra grey and the DM's own pick were all computed
 * correctly and then thrown away at the last step, which is why choosing a
 * colour appeared to do nothing at all.
 *
 * An inline SVG filled with currentColor obeys all three. Sized in `em` so it
 * still follows .wt-icon's font-size, and the neighbouring rows -- ⬢, ✦, ▮ --
 * are ordinary glyphs that were always colourable and are left alone.
 */
function PersonMarker() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', fill: 'currentColor' }}
    >
      <circle cx="8" cy="5" r="3.15" />
      <path d="M8 9.3c-3.15 0-5.3 1.95-5.3 4.15 0 .38.3.68.68.68h9.24c.38 0 .68-.3.68-.68C13.3 11.25 11.15 9.3 8 9.3z" />
    </svg>
  );
}

const ICON: Record<Kind, string> = { location: '📍', character: '👤', shop: '🏪', table: '🎲', handout: '📄', map: '🗺️', folder: '📁', chest: '📦', light: '💡', mapobject: '✦', counter: '▮', token: '⬢' } as Record<string, string>;

// Players have no dmGeometry; the selector must return this SAME array every
// time, not a fresh `?? []` — a fresh array per call is the Zustand
// getSnapshot infinite-loop crash (blank screen for every non-DM member).
const NO_LIGHTS: Light[] = [];
// Same rule as NO_LIGHTS: the selector must return a STABLE reference when
// there's no directory yet, or Zustand's getSnapshot loops forever.
const NO_DIR_CHARS: DirectoryPayload['characters'] = [];
const NO_DIR_MAPS: DirectoryPayload['maps'] = [];
const NO_DIR_TOKENS: DirectoryPayload['tokens'] = [];
const NO_MAPS: MapMeta[] = [];

/** One flat list of every world object, keyed for tree assembly. */
function buildNodes(
  locations: LocationNode[], characters: Character[], shops: Shop[], tables: RollableTable[], handouts: Handout[], maps: MapMeta[],
  folders: WorldFolder[], mapLights: Light[], mapId: string | null, allTokens: Record<string, Token>, mapObjects: MapObject[],
  allCounters: Counter[], directoryChars: DirectoryPayload['characters'],
  directoryMaps: DirectoryPayload['maps'], directoryTokens: DirectoryPayload['tokens'],
): TreeNode[] {
  const out: TreeNode[] = [];
  const mapIds = new Set<string>();
  for (const m of maps) {
    mapIds.add(m.id);
    out.push({ kind: 'map', id: m.id, name: m.name || 'Map', parentId: m.parentId ?? null, sub: m.isScene ? 'scene' : 'map', isScene: m.isScene, hasPreview: true });
  }
  // Players never receive the map LIST (DM scaffolding), so the maps and
  // scenes they have actually been to come from the directory instead.
  for (const m of directoryMaps) {
    if (mapIds.has(m.id)) continue;
    mapIds.add(m.id);
    out.push({
      kind: 'map', id: m.id, name: m.name || 'Map', parentId: m.parentId ?? null,
      sub: m.isScene ? 'scene' : 'map', isScene: m.isScene, hasPreview: m.hasPreview,
    });
  }
  // Where each character's token stands, so an unfiled character can nest
  // under its map. A character already IS a node in this tree — giving its
  // token a second node would list everyone twice, once in the DM's folder
  // and once under the map.
  const tokenHome = new Map<string, { mapId: string; playerRun: boolean }>();
  // The color each character's piece actually wears. Read off the TOKEN, not
  // the sheet: the sheet's color field is blank for most PCs and the real
  // color is inherited from the player, which the server has already resolved
  // onto the token. A character with pieces on several maps takes the first.
  const colorOfCharacter = new Map<string, string>();
  for (const t of Object.values(allTokens)) {
    if (t.characterId && t.color && !colorOfCharacter.has(t.characterId)) colorOfCharacter.set(t.characterId, t.color);
  }
  for (const t of directoryTokens) {
    if (!t.mapId || !mapIds.has(t.mapId)) continue;
    if (t.characterId) {
      if (!tokenHome.has(t.characterId)) tokenHome.set(t.characterId, { mapId: t.mapId, playerRun: t.playerRun === true });
      continue;
    }
    // A token with no character behind it (scenery, a prop) has no other
    // node, so it gets its own under the map.
    out.push({
      kind: 'token', id: t.id, name: t.name || 'Token', parentId: t.mapId,
      sub: t.gm ? 'GM layer' : '',
      tokenMapId: t.mapId, tokenCharacterId: null, playerRun: t.playerRun === true,
      color: allTokens[t.id]?.color,
    });
  }
  for (const l of locations) out.push({ kind: 'location', id: l.id, name: l.name || 'Location', parentId: l.parentId ?? null, sub: l.kind });
  const charIds = new Set<string>();
  // An unfiled character hangs under the map its token stands on, so the
  // tree mirrors the table; one the DM filed in a folder stays filed.
  const homeOf = (id: string, parentId: string | null | undefined) =>
    (parentId ?? null) ?? tokenHome.get(id)?.mapId ?? null;
  for (const c of characters) {
    charIds.add(c.id);
    out.push({
      kind: 'character', id: c.id, name: c.name || 'Character',
      parentId: homeOf(c.id, c.parentId), sub: c.ownerUserId ? '' : 'NPC',
      playerRun: c.ownerUserId != null,
      tokenMapId: tokenHome.get(c.id)?.mapId,
      tokenCharacterId: c.id,
      // Wild Card or Extra decides the silhouette, because that is the thing
      // a DM scanning this list actually wants to know: which of these can
      // take three Wounds and act like a person. SWADE marks it on the sheet
      // (PCs default to true). Other systems have no such split, so they keep
      // the older question that means the same thing there — is this someone's
      // character, or one of the DM's — rather than painting a whole tree one
      // colour and saying nothing.
      wildCard: c.system === 'swade' ? c.sheet.wildCard !== false : c.ownerUserId != null,
      // A colour the DM picked for this row. Blank means "follow the rule".
      markerColor: str(c.sheet, 'markerColor', '') || undefined,
      // The sheet's own color field is the fallback when no piece of theirs
      // is on the table yet; it is blank for most PCs, hence the `undefined`.
      color: colorOfCharacter.get(c.id) ?? (str(c.sheet, 'color', '') || undefined),
    });
  }
  // A player only ever receives the SHEETS they own, so everyone else's
  // character would be missing from the tree even after their token has been
  // stood in plain sight. The directory is the per-player record of what this
  // viewer has actually discovered — fold those in as nodes (name and nesting
  // only; the sheet stays server-side behind the public-sheet view).
  for (const c of directoryChars) {
    if (charIds.has(c.id)) continue;
    charIds.add(c.id);
    out.push({
      kind: 'character', id: c.id, name: c.name || 'Character',
      parentId: homeOf(c.id, c.parentId),
      sub: c.ownerUserId ? (c.owner ?? '') : 'NPC',
      notMine: true,
      playerRun: c.ownerUserId != null,
      // No sheet reaches this viewer, so Wild Card cannot be read off one.
      // Someone else's PC is the overwhelmingly common case here.
      wildCard: c.ownerUserId != null,
      tokenMapId: tokenHome.get(c.id)?.mapId,
      tokenCharacterId: c.id,
      // No sheet reaches this viewer, so the token is the only source.
      color: colorOfCharacter.get(c.id),
    });
  }
  for (const s of shops) out.push({ kind: 'shop', id: s.id, name: s.name || 'Shop', parentId: s.parentId ?? null, sub: `${s.items.length} items` });
  for (const t of tables) out.push({ kind: 'table', id: t.id, name: t.name || 'Table', parentId: t.parentId ?? null, sub: `${t.items.length}` });
  for (const h of handouts) out.push({ kind: 'handout', id: h.id, name: h.title || 'Handout', parentId: h.parentId ?? null, sub: '' });
  for (const f of folders) {
    const isChest = f.displayKind === 'chest';
    const sub = isChest && f.items.length ? `${f.items.length} items` : '';
    out.push({ kind: isChest ? 'folder' : 'folder', id: f.id, name: f.name || (isChest ? 'Chest' : 'Folder'), parentId: f.parentId ?? null, sub, displayKind: f.displayKind } as TreeNode);
  }
  // Counters nest under the map they belong to, like lights and loot.
  for (const c of allCounters) {
    out.push({
      kind: 'counter', id: c.id, name: c.name, parentId: c.mapId,
      sub: c.value + '/' + c.max + (c.visible ? '' : ' · hidden'),
    });
  }
  // Map lights gather in a "Lights" folder under their map.
  //
  // A lit room has a dozen of them, and loose in the map's children they
  // buried the handful of things a DM actually navigates to — the chests, the
  // NPCs. The folder is VIRTUAL: it exists exactly while the map has lights,
  // is not a row in any table, and cannot be renamed, dragged or deleted out
  // of step with them. Nothing to keep in sync, and nothing to clean up when
  // the last light goes.
  if (mapId && mapLights.length > 0) {
    const folderId = `lights-${mapId}`;
    out.push({
      kind: 'folder', id: folderId, name: 'Lights', parentId: mapId,
      sub: `${mapLights.length} light${mapLights.length === 1 ? '' : 's'}`,
      displayKind: 'folder', virtual: true,
    });
    for (const light of mapLights) {
      const name = light.name || 'Light';
      const sub = `bright ${light.brightRadius}, dim ${light.dimRadius}`;
      out.push({ kind: 'light', id: light.id, name, parentId: folderId, sub, lightMapId: mapId });
    }
  }
  // Loot & chests appear nested under whichever map they're placed on
  // (shop markers are skipped — the shop itself is already a tree node).
  //
  // A chest that stands for a world folder is skipped for the same reason: the
  // folder IS that chest, and its contents hang underneath it. Listing both
  // put two identical rows in the tree with a different window behind each —
  // the folder's rename box, and the real chest with its lock and its loot.
  const folderIds = new Set(folders.map((f) => f.id));
  for (const obj of mapObjects) {
    if (obj.kind === 'shop') continue;
    if (obj.worldFolderId && folderIds.has(obj.worldFolderId)) continue;
    const sub = obj.items.length ? `${obj.items.length} item${obj.items.length === 1 ? '' : 's'}` : '';
    // A chest somebody CARRIES hangs under them, not under the map: it is
    // their pockets, it goes where they go, and three identically-named
    // "Robo-Velociraptor's effects" rows loose in a map's children say
    // nothing about which raptor is which. Only when the bearer is actually
    // in the tree — a character on another map, or one this viewer cannot
    // see, would otherwise take its chest out of the tree with it.
    const bearer = obj.linkedCharacterId && charIds.has(obj.linkedCharacterId)
      ? obj.linkedCharacterId
      : null;
    // Filed by hand, if it still has somewhere to be filed. A folder that has
    // since been deleted would otherwise take the chest out of the tree with
    // it — so a dangling parent falls back to the map, where it can be seen
    // and re-filed rather than silently lost.
    const filed = obj.parentId && !bearer
      && (folderIds.has(obj.parentId) || charIds.has(obj.parentId) || mapIds.has(obj.parentId))
      ? obj.parentId
      : null;
    out.push({
      kind: 'mapobject', id: obj.id,
      name: obj.name || (obj.kind === 'chest' ? 'Chest' : 'Loot'),
      parentId: bearer ?? filed ?? obj.mapId, sub, mapObjectKind: obj.kind,
    });
  }
  // Token-carried lights appear under their character
  for (const tok of Object.values(allTokens)) {
    if (!tok.light || !tok.characterId) continue;
    const id = `tlight-${tok.id}`;
    const name = tok.name ? `${tok.name}'s light` : 'Token light';
    const sub = `bright ${tok.light.bright}, dim ${tok.light.dim}`;
    out.push({ kind: 'light', id, name, parentId: tok.characterId, sub, lightTokenId: tok.id, lightMapId: tok.mapId });
  }
  return out;
}

export function WorldTreePanel() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const characters = useGameStore((s) => s.characters);
  const locations = useGameStore((s) => s.locationList);
  const shops = useGameStore((s) => s.shopList);
  const tables = useGameStore((s) => s.tableList);
  const handouts = useGameStore((s) => s.handoutList);
  const maps = useGameStore((s) => s.mapsMeta);
  const folders = useGameStore((s) => s.worldFolderList);
  const isDm = useGameStore((s) => s.isDm());

  const allTokens = useGameStore((s) => s.tokens);
  const dmLights = useGameStore((s) => s.dmGeometry?.lights ?? NO_LIGHTS);
  const currentMapId = useGameStore((s) => s.map?.id ?? null);
  const mapObjectsById = useGameStore((s) => s.mapObjects);
  const allCounters = useGameStore((s) => s.allCounters);
  const directoryChars = useGameStore((s) => s.directory?.characters ?? NO_DIR_CHARS);
  const directoryMaps = useGameStore((s) => s.directory?.maps ?? NO_DIR_MAPS);
  const directoryTokens = useGameStore((s) => s.directory?.tokens ?? NO_DIR_TOKENS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<TreeNode | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  /** Right-clicked character row: where the marker-colour menu hangs. */
  const [markerMenu, setMarkerMenu] = useState<{ x: number; y: number; characterId: string } | null>(null);
  const [folderEdit, setFolderEdit] = useState<string | null>(null);
  const [chestEdit, setChestEdit] = useState<string | null>(null);
  // The dragged item lives in a module-level ref (not state) so `drop` reads
  // it synchronously and so a drop on the map canvas — a different panel
  // entirely — can read it too.
  const dragRef = worldDrag;
  // 'into' nests under the hovered row (bottom half); 'above' inserts the
  // dragged item just before it among its siblings (top half).
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: 'into' | 'above' } | 'root' | null>(null);
  const worldSort = useGameStore((s) => s.worldSort);
  const worldSelectedKey = useGameStore((s) => s.worldSelectedKey);

  // "View as" has to bend the world tree too, not just the map. The server
  // already re-scopes every payload to the previewed player (viewerFor), but
  // three sources are DM-only client state that no player payload can correct:
  // the map LIST, every character sheet, and the lights. Standing in for them
  // is what makes the preview honest rather than nearly-honest.
  const viewingAs = useGameStore((s) => s.viewingAs);
  const omniscient = isDm && !viewingAs;
  // Exactly the sheets that player's own client would be holding.
  const ownSheets = useMemo(
    () => (viewingAs ? characters.filter((c) => c.ownerUserId === viewingAs) : characters),
    [characters, viewingAs],
  );
  // Players never receive the map list; the maps they know come via directory.
  const ownMaps = omniscient ? maps : NO_MAPS;
  const mapObjectList = useMemo(
    () => (omniscient ? Object.values(mapObjectsById) : []),
    [omniscient, mapObjectsById],
  );
  const nodes = useMemo(
    () => buildNodes(locations, ownSheets, shops, tables, handouts, ownMaps, folders, omniscient ? dmLights : [], currentMapId, allTokens, mapObjectList, allCounters, directoryChars, directoryMaps, directoryTokens),
    [locations, ownSheets, shops, tables, handouts, ownMaps, folders, omniscient, dmLights, currentMapId, allTokens, mapObjectList, allCounters, directoryChars, directoryMaps, directoryTokens],
  );
  // Players only see a folder once something they can see lives under it —
  // an empty folder (or a chain of them) is DM scaffolding, not discovered
  // world. Every other collection reaching this client is already server-
  // filtered to what this player may see, so "has any visible non-folder
  // descendant" is exactly the right test. Chest-folders with loot count.
  const visibleNodes = useMemo(() => {
    if (isDm) return nodes;
    const kids = new Map<string, TreeNode[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      if (!kids.has(n.parentId)) kids.set(n.parentId, []);
      kids.get(n.parentId)!.push(n);
    }
    const memo = new Map<string, boolean>();
    const hasContent = (id: string): boolean => {
      if (memo.has(id)) return memo.get(id)!;
      memo.set(id, false); // cycle guard
      const lootInside = (folders.find((f) => f.id === id)?.items.length ?? 0) > 0;
      const res = lootInside || (kids.get(id) ?? []).some((c) => c.kind !== 'folder' || hasContent(c.id));
      memo.set(id, res);
      return res;
    };
    return nodes.filter((n) => n.kind !== 'folder' || hasContent(n.id));
  }, [nodes, isDm, folders]);
  const byId = useMemo(() => new Map(visibleNodes.map((n) => [n.id, n])), [visibleNodes]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      // An item whose parent no longer exists floats to the top level.
      const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(n);
    }
    // Hand-ranked items first (in their dragged order), then the rest A→Z.
    const rank = (n: TreeNode) => worldSort[`${n.kind}:${n.id}`] ?? Number.MAX_SAFE_INTEGER;
    for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return m;
  }, [nodes, byId, worldSort]);

  function toggle(id: string) {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // The "open editor" action (right-click / double-click).
  function open(node: TreeNode) {
    if (node.kind === 'counter') {
      // Jump to the counter's map — its banner bar (with the full
      // right-click menu: show/hide, edit, delete) lives there.
      const c = allCounters.find((x) => x.id === node.id);
      if (c) intents.viewMap(c.mapId);
      return;
    }
    if (node.kind === 'character') {
      // Someone else's character: the public-facing view, the same one a
      // right-click on their token gives. Never the private sheet.
      if (node.notMine) openWindow('publicSheet', node.id, {}, node.name);
      else useGameStore.getState().openSheet(node.id);
      // If their piece is on the map already on screen, select it there too.
      if (node.tokenMapId && node.tokenMapId === currentMapId) {
        const tok = Object.values(useGameStore.getState().tokens)
          .find((t) => t.characterId === node.id && t.mapId === currentMapId);
        if (tok) useGameStore.getState().selectToken(tok.id, false);
      }
      return;
    }
    if (node.kind === 'map') {
      // A player clicking a map is asking ABOUT it, not asking to be taken
      // there — yanking their camera off whatever they were watching would be
      // the opposite of helpful. They get a details window instead.
      if (isDm) openWindow('mapEditor', node.id, {}, node.name || 'Edit map');
      else openWindow('mapDetails', node.id, {}, node.name || 'Map');
      return;
    }
    if (node.kind === 'token') {
      // Open whichever sheet this viewer is entitled to...
      const chId = node.tokenCharacterId;
      if (chId) {
        const mine = characters.some((c) => c.id === chId);
        if (mine) useGameStore.getState().openSheet(chId);
        else openWindow('publicSheet', chId, {}, node.name);
      }
      // ...and, when the token is on the map already on screen, select it
      // there too, so the world tab and the table stay in step.
      if (node.tokenMapId && node.tokenMapId === currentMapId) {
        useGameStore.getState().selectToken(node.id, false);
      }
      return;
    }
    if (node.kind === 'folder') {
      if (!isDm) return;
      // The invented "Lights" folder has no record behind it: opening its
      // rename box would be offering to rename nothing.
      if (node.virtual) return;
      // A chest with a box standing on a map opens THAT — the window with the
      // lock, the key, the contents and the compendium button, which is the
      // one worth having. Rename, convert and delete are still a right-click
      // away, so nothing the folder box offered has been lost.
      const linked = Object.values(useGameStore.getState().mapObjects)
        .find((o) => o.kind === 'chest' && o.worldFolderId === node.id);
      if (linked) { useGameStore.getState().openObjectInspector(linked.id); return; }
      // A chest with no piece on the ground yet is still a chest: it holds
      // its loot on the folder row, and the one thing a new chest is for —
      // putting things in it — should not wait on placing it somewhere.
      if (node.displayKind === 'chest') { setChestEdit(node.id); return; }
      setFolderEdit(node.id);
      return;
    }
    if (node.kind === 'light') {
      if (!isDm || !node.lightMapId) return;
      // A light carried by a token is a property OF that token — its editor is
      // the token inspector, which already has the radius controls and the
      // unlink. Sending it anywhere else would be a second editor for one thing.
      if (node.lightTokenId) {
        useGameStore.getState().openInspector(node.lightTokenId);
        return;
      }
      // A light lives on a map and is edited on that map, so bring the map up
      // first — the inspector reads the light out of the CURRENT map's
      // geometry and would otherwise find nothing to show.
      if (node.lightMapId !== currentMapId) intents.viewMap(node.lightMapId);
      useGameStore.getState().selectLight(node.id);
      return;
    }
    if (node.kind === 'mapobject') {
      if (isDm) useGameStore.getState().openObjectInspector(node.id);
      return;
    }
    // The DM edits (each in its own draggable window); players get a
    // read-only view of what they can see.
    if (isDm) openWindow(node.kind as 'location' | 'shop' | 'table' | 'handout', node.id, {}, node.name);
    else setReading(node);
  }

  /**
   * The piece on the CURRENT map that this row stands for, if any — a token,
   * or the chest/shop/prop object representing a world entity. A handout or a
   * folder of notes has nothing on the map and resolves to null.
   *
   * Shared by selection and hover so the two can never disagree about which
   * piece a row means.
   */
  function mapTargetFor(node: TreeNode): MapTarget {
    const s = useGameStore.getState();
    const onThisMap = (mapId: string | null | undefined) => !!mapId && mapId === currentMapId;

    const tokenId = node.kind === 'token' && onThisMap(node.tokenMapId) ? node.id
      : node.kind === 'character' && onThisMap(node.tokenMapId)
        ? Object.values(s.tokens).find((t) => t.characterId === node.id && t.mapId === currentMapId)?.id ?? null
        : null;
    if (tokenId) return { kind: 'token', id: tokenId };

    const obj = node.kind === 'mapobject'
      ? s.mapObjects[node.id]
      : Object.values(s.mapObjects).find((o) =>
        (node.kind === 'shop' && o.shopId === node.id)
        || (node.kind === 'folder' && o.worldFolderId === node.id));
    return obj && obj.mapId === currentMapId ? { kind: 'object', id: obj.id } : null;
  }

  /** Mark a row as the selection, and ring its piece on the map if it has one. */
  function selectNode(node: TreeNode) {
    const s = useGameStore.getState();
    const target = mapTargetFor(node);

    // Both map setters clear the tree key (they are also what a click on the
    // MAP goes through), so the row is claimed last and wins either way.
    if (target?.kind === 'token') s.selectToken(target.id, false);
    else if (target?.kind === 'object') s.selectObject(target.id);
    // Nothing on this map answers to this row — drop any stale ring rather
    // than leaving the map pointing at whatever was picked before.
    else { s.selectObject(null); s.selectToken(null); }
    s.setWorldSelection(`${node.kind}:${node.id}`);
  }

  // The primary left-click action. `selectNode` runs LAST everywhere: `open`
  // does its own token selecting, which would otherwise move the highlight off
  // the row that was actually clicked and onto that token's row.
  function activate(node: TreeNode, hasKids: boolean) {
    // The DM jumps their view to the map they clicked. A player instead gets
    // the details window — viewMap is DM-only server-side, so asking for it
    // only ever earned them an error, and yanking their camera would be wrong
    // even if it were allowed.
    if (node.kind === 'map') {
      if (isDm) intents.viewMap(node.id);
      else openWindow('mapDetails', node.id, {}, node.name || 'Map');
    } else if (hasKids) {
      toggle(node.id);
    } else {
      open(node);
    }
    selectNode(node);
  }

  /** True if `maybeAncestorId` is at or above `nodeId` in the tree (cycle guard). */
  function isAncestor(maybeAncestorId: string, nodeId: string): boolean {
    let cur: string | null = nodeId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === maybeAncestorId) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  }

  /** Collect character node IDs that are direct children of `folderId`. */
  function folderCharacters(folderId: string): string[] {
    return (childrenOf.get(folderId) ?? []).filter((n) => n.kind === 'character').map((n) => n.id);
  }

  function placeFolderOnMap(folderId: string, mapId: string) {
    intents.dropFolderOnMap(folderId, mapId);
    intents.viewMap(mapId);
  }

  function setFolderTokensLayer(folderId: string, layer: 'token' | 'gm') {
    const charIds = new Set(folderCharacters(folderId));
    for (const t of Object.values(allTokens)) {
      if (t.characterId && charIds.has(t.characterId) && t.layer !== layer) {
        intents.updateToken(t.id, { layer });
      }
    }
  }

  function drop(targetId: string | null, mode: 'into' | 'above' = 'into') {
    const drag = dragRef.current;
    dragRef.current = null;
    setDropTarget(null);
    if (!drag) return;
    // Nothing can be dropped on or above an invented row: it is not anyone's
    // parent and has no place among siblings to be sorted into.
    if (targetId && byId.get(targetId)?.virtual) return;
    // Can't parent an item under itself or its own descendant.
    if (targetId && (targetId === drag.id || isAncestor(drag.id, targetId))) return;

    // Dropped on a row's top half: insert just above it among its siblings
    // (re-parenting first if it came from elsewhere). Lights keep their
    // special link/unlink semantics; everything else reorders.
    if (mode === 'above' && targetId && drag.kind !== 'light') {
      const anchor = byId.get(targetId);
      const dragNode = byId.get(drag.id);
      if (!anchor || !dragNode) return;
      const parentKey = anchor.parentId && byId.has(anchor.parentId) ? anchor.parentId : null;
      if (parentKey && isAncestor(drag.id, parentKey)) return;
      const dragParent = dragNode.parentId && byId.has(dragNode.parentId) ? dragNode.parentId : null;
      if (dragParent !== parentKey) {
        // Counters live on maps and nowhere else, so an above-drop can only
        // sort them where they already are. Placed loot now files freely.
        if (drag.kind === 'counter') return;
        intents.setParent(drag.kind, drag.id, parentKey);
      }
      const sibs = (childrenOf.get(parentKey) ?? []).filter((n) => n.id !== drag.id);
      const idx = Math.max(0, sibs.findIndex((n) => n.id === targetId));
      const ordered = [...sibs.slice(0, idx), dragNode, ...sibs.slice(idx)];
      intents.worldReorder(ordered.map((n) => `${n.kind}:${n.id}`));
      return;
    }

    // --- Light drag operations ---
    if (drag.kind === 'light') {
      const dragNode = byId.get(drag.id);
      if (!dragNode) return;
      const target = targetId ? byId.get(targetId) : null;

      if (dragNode.lightTokenId) {
        // Dragging a token-carried light off its character → unlink
        if (!target || target.kind !== 'character' || target.id !== dragNode.parentId) {
          const tok = allTokens[dragNode.lightTokenId];
          if (tok) intents.unlinkLightFromToken(tok.id, tok.mapId);
        }
        return;
      }

      // Map light dragged onto a character → find a token for that character and link
      if (target?.kind === 'character' && dragNode.lightMapId) {
        const charToken = Object.values(allTokens).find((t) => t.characterId === target.id);
        if (charToken) intents.linkLightToToken(drag.id, dragNode.lightMapId, charToken.id);
        return;
      }

      // Map light dragged onto a different map → move to that map
      if (target?.kind === 'map' && dragNode.lightMapId && target.id !== dragNode.lightMapId) {
        intents.moveLightToMap(drag.id, dragNode.lightMapId, target.id);
        return;
      }
      return;
    }

    // Counters live ON a map: dropping one on (or inside) another map moves
    // it there — the banner bar simply appears over the new map's pane.
    if (drag.kind === 'counter') {
      let t = targetId ? byId.get(targetId) ?? null : null;
      while (t && t.kind !== 'map') t = t.parentId ? byId.get(t.parentId) ?? null : null;
      if (t?.kind === 'map') intents.counterUpdate(drag.id, { mapId: t.id });
      return;
    }

    // Dropping a folder ONTO A MAP deploys it: every character inside is
    // relocated to that map, spread around its spawn point, and anyone
    // controlling one of them is pulled to that map too. (Only loot folders
    // become a chest on the ground — organizing never mints chest objects.)
    // Nesting a folder anywhere else is pure organization.
    if (drag.kind === 'folder' && targetId && byId.get(targetId)?.kind === 'map') {
      placeFolderOnMap(drag.id, targetId);
      return;
    }
    // Placed loot files like anything else. It still STANDS where it stands —
    // filing it changes the tree, never the map — but a temple with thirty
    // chests loose under it is a list nobody can read, and the folders were
    // right there. Dropping it on a map re-homes nothing; that is what
    // dragging the piece across the map is for.
    intents.setParent(drag.kind, drag.id, targetId);
    // Dragging a character onto a map relocates its token there server-side;
    // switch the DM's view to that map so the new token is immediately
    // visible instead of silently landing on a map nobody is looking at.
    if (drag.kind === 'character' && targetId && byId.get(targetId)?.kind === 'map') {
      intents.viewMap(targetId);
    }
  }

  // A plain recursive render function (NOT a nested component) so that the
  // setState calls fired during a native drag don't remount the row being
  // dragged — which would silently abort the drag.
  function renderNode(node: TreeNode, depth: number): ReactNode {
    const kids = childrenOf.get(node.id) ?? [];
    const isOpen = expanded.has(node.id);
    const isDropOn = typeof dropTarget === 'object' && dropTarget?.id === node.id && dropTarget.mode === 'into';
    const isDropAbove = typeof dropTarget === 'object' && dropTarget?.id === node.id && dropTarget.mode === 'above';
    const isSelected = worldSelectedKey === `${node.kind}:${node.id}`;
    return (
      <div key={`${node.kind}:${node.id}`}>
        <div
          className={`wt-row ${isSelected ? 'selected' : ''} ${isDropOn ? 'drop-on' : ''} ${isDropAbove ? 'drop-above' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          {...(node.kind === 'map' ? { 'data-map-id': node.id } : {})}
          draggable={isDm && !node.virtual}
          onDragStart={isDm && !node.virtual ? (e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
            dragRef.current = { kind: node.kind as WorldDragKind, id: node.id };
          } : undefined}
          onDragOver={isDm ? (e) => {
            e.preventDefault();
            // Without this the tree container's own dragover runs straight
            // after this one and overwrites the target with 'root' on every
            // tick, so the only thing that ever showed was the big dashed
            // outline round the whole pane.
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const mode = e.clientY < rect.top + rect.height / 2 ? 'above' as const : 'into' as const;
            if (typeof dropTarget !== 'object' || dropTarget?.id !== node.id || dropTarget.mode !== mode) {
              setDropTarget({ id: node.id, mode });
            }
          } : undefined}
          onDrop={isDm ? (e) => {
            e.preventDefault(); e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            drop(node.id, e.clientY < rect.top + rect.height / 2 ? 'above' : 'into');
          } : undefined}
          onDragEnd={isDm ? () => { dragRef.current = null; setDropTarget(null); } : undefined}
          // Mousing down the tree flashes each row's piece on the map in turn,
          // so "where is this actually placed?" is answered by hovering rather
          // than by clicking through everything.
          onMouseEnter={() => useGameStore.getState().setWorldHover(mapTargetFor(node))}
          onMouseLeave={() => useGameStore.getState().setWorldHover(null)}
          onClick={() => activate(node, kids.length > 0)}
          onDoubleClick={() => { open(node); selectNode(node); }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isDm && node.kind === 'folder' && !node.virtual) setCtxMenu({ x: e.clientX, y: e.clientY, folderId: node.id });
            else if (isDm && node.kind === 'character' && !node.notMine) {
              setMarkerMenu({ x: e.clientX, y: e.clientY, characterId: node.id });
            } else open(node);
            selectNode(node);
          }}
          title={node.kind === 'map' ? 'Click to open in the viewer · double/right-click to edit · drag to re-parent or re-order' : 'Click to expand · double/right-click to open · drag onto a row to nest, onto its top edge to re-order'}
        >
          <span
            className="wt-caret"
            onClick={kids.length ? (e) => { e.stopPropagation(); toggle(node.id); } : undefined}
          >
            {kids.length ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span
            className={`wt-icon${node.kind === 'token' || node.kind === 'character' ? (node.wildCard ? ' wt-wild' : ' wt-extra') : ''}`}
            // What the silhouette SAYS is what a DM scanning the list wants to
            // know: bright blue for a Wild Card, grey for an Extra. It used to
            // wear the piece's own token colour, which made a whole tree one
            // shade of whatever the party had picked and told nobody anything.
            // A colour chosen deliberately still wins — lifted off pure black
            // first, since a fill that reads on a lit map can vanish as a
            // glyph on dark chrome.
            style={markerStyle(node)}
            title={node.kind === 'token' || node.kind === 'character' ? (node.playerRun ? 'Run by a player' : 'Run by the DM') : undefined}
          >
            {/* A folder shows what it HOLDS when that is the whole point of
                it: a chest of loot, a map's drawer of lights. */}
            {(node.kind === 'folder' && node.displayKind === 'chest') || node.mapObjectKind === 'chest' ? '📦'
              : node.kind === 'folder' && node.virtual ? '💡'
                : node.kind === 'character' ? <PersonMarker />
                  : ICON[node.kind]}
          </span>
          <span className="wt-name">{node.name}</span>
          {node.sub && <span className="wt-sub">{node.sub}</span>}
          {/* No inline delete on any row. Destroying something is a decision
              you make with its editor open and its properties in front of you,
              not a red ✕ sitting a stray click away from every name in the
              list. Folders, lights and everything else all work this way. */}
        </div>
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf.get(null) ?? [];

  return (
    <div className="dock-panel world-tree">
      <div className="dock-header">
        <h3>World</h3>
      </div>

      {isDm && (
        <div className="wt-toolbar">
          <button className="btn btn-sm" onClick={() => openWindow('mapEditor', 'new', {}, 'New map')}>+ Map</button>
          <button className="btn btn-sm" onClick={() => intents.createLocation('New location', null)}>+ Location</button>
          <button className="btn btn-sm" onClick={() => openWindow('npcLibrary', 'main', {}, 'NPC Library')}>+ Character</button>
          <button className="btn btn-sm" onClick={() => intents.createShop('New shop')}>+ Shop</button>
          <button className="btn btn-sm" onClick={() => intents.createTable('New table')}>+ Table</button>
          <button className="btn btn-sm" onClick={() => openWindow('handout', 'new', {}, 'New handout')}>+ Handout</button>
          <button className="btn btn-sm" onClick={() => intents.createWorldFolder('New folder', null)}>+ Folder</button>
          <button className="btn btn-sm" onClick={() => intents.createWorldFolder('Chest', null, { displayKind: 'chest' })}>+ Chest</button>
          <button className="btn btn-sm" title="A giant segmented banner bar over the map (doom clock, boss HP) — hidden from players until you reveal it" onClick={() => { const m = useGameStore.getState().map; if (m) intents.counterCreate(m.id); }}>+ Counter</button>
          <button className="btn btn-sm" onClick={() => openWindow('randomizeNpc', 'main', {}, 'Randomize an NPC')}>🎲 Random NPC</button>
        </div>
      )}
      {/* Players get the character creator only when the DM sends it to them. */}

      <div
        className={`wt-tree ${dropTarget === 'root' ? 'drop-on' : ''}`}
        onDragOver={isDm ? (e) => { e.preventDefault(); setDropTarget('root'); } : undefined}
        onDrop={isDm ? (e) => { e.preventDefault(); drop(null); } : undefined}
      >
        {roots.map((n) => renderNode(n, 0))}
        {roots.length === 0 && <p className="dim" style={{ padding: 8 }}>Nothing here yet.{isDm ? ' Use the buttons above to add locations, NPCs, shops, tables, and handouts.' : ''}</p>}
      </div>
      {roots.length > 0 && (
        <p className="dim wt-hint" style={{ display: 'flex', gap: 12 }}>
          <button className="link dim" style={{ fontSize: 11 }} onClick={() => setExpanded(new Set([...childrenOf.keys()].filter((k): k is string => k !== null)))}>
            Expand All
          </button>
          <button className="link dim" style={{ fontSize: 11 }} onClick={() => setExpanded(new Set())}>
            Collapse All
          </button>
        </p>
      )}
      {isDm && <p className="dim wt-hint">Drag an item onto another to nest it, onto a row’s top edge to re-order, or to empty space for the top level.</p>}

      {reading && <ReadModal node={reading} onClose={() => setReading(null)} />}
      {folderEdit && <FolderDetailsModal folderId={folderEdit} onClose={() => setFolderEdit(null)} />}
      {chestEdit && <ChestFolderEditor folderId={chestEdit} onClose={() => setChestEdit(null)} />}

      {markerMenu && (
        <div className="wt-ctx-backdrop" onClick={() => setMarkerMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMarkerMenu(null); }}>
          <AnchoredMenu x={markerMenu.x} y={markerMenu.y} className="wt-ctx-menu" onClick={(e) => e.stopPropagation()}>
            <span className="wt-ctx-head">Marker colour</span>
            <div className="wt-marker-swatches">
              {MARKER_COLORS.map((c) => (
                <button
                  key={c}
                  className="wt-marker-swatch"
                  style={{ background: c }}
                  title={c}
                  onClick={() => {
                    intents.updateCharacter(markerMenu.characterId, { markerColor: c });
                    setMarkerMenu(null);
                  }}
                />
              ))}
              <label className="wt-marker-swatch wt-marker-custom" title="Any colour at all">
                🎨
                <input
                  type="color"
                  onChange={(e) => {
                    intents.updateCharacter(markerMenu.characterId, { markerColor: e.target.value });
                    setMarkerMenu(null);
                  }}
                />
              </label>
            </div>
            <button onClick={() => {
              // Back to the rule: blue for a Wild Card, grey for an Extra.
              intents.updateCharacter(markerMenu.characterId, { markerColor: '' });
              setMarkerMenu(null);
            }}>Reset to default</button>
            <hr />
            <button onClick={() => { const n = byId.get(markerMenu.characterId); if (n) open(n); setMarkerMenu(null); }}>Open sheet</button>
          </AnchoredMenu>
        </div>
      )}
      {ctxMenu && (
        <div className="wt-ctx-backdrop" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
          <AnchoredMenu x={ctxMenu.x} y={ctxMenu.y} className="wt-ctx-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { placeFolderOnMap(ctxMenu.folderId, useGameStore.getState().map?.id ?? ''); setCtxMenu(null); }}
              disabled={!useGameStore.getState().map}
            >Place all on current map</button>
            <button onClick={() => { setFolderTokensLayer(ctxMenu.folderId, 'gm'); setCtxMenu(null); }}>Hide all tokens</button>
            <button onClick={() => { setFolderTokensLayer(ctxMenu.folderId, 'token'); setCtxMenu(null); }}>Show all tokens</button>
            {(() => {
              const f = byId.get(ctxMenu.folderId);
              const isChest = f?.displayKind === 'chest';
              return (
                <button onClick={() => {
                  intents.updateWorldFolder(ctxMenu.folderId, { displayKind: isChest ? 'folder' : 'chest' });
                  setCtxMenu(null);
                }}>{isChest ? 'Convert to Folder' : 'Convert to Chest'}</button>
              );
            })()}
            <hr />
            {byId.get(ctxMenu.folderId)?.displayKind === 'chest' && (
              <button onClick={() => { setChestEdit(ctxMenu.folderId); setCtxMenu(null); }}>Chest contents…</button>
            )}
            <button onClick={() => { setFolderEdit(ctxMenu.folderId); setCtxMenu(null); }}>Folder details…</button>
          </AnchoredMenu>
        </div>
      )}
    </div>
  );
}

/** DM window for one folder: rename, convert folder↔chest, delete — all
 *  in-platform (no browser prompt/confirm dialogs). */
function FolderDetailsModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const folder = useGameStore((s) => s.worldFolderList.find((f) => f.id === folderId));
  const [name, setName] = useState(folder?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!folder) return null;
  const isChest = folder.displayKind === 'chest';
  const save = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== folder.name) intents.updateWorldFolder(folder.id, { name: trimmed });
    onClose();
  };
  return (
    <div className="sheet-backdrop" style={{ zIndex: 80 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup" style={{ maxWidth: 380 }}>
        <div className="dock-header">
          <h3>{isChest ? '📦 Chest' : '📁 Folder'} details</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>
        <label>Name
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
        </label>
        <div className="row" style={{ marginTop: 8, gap: 6, alignItems: 'center' }}>
          <button className="primary" style={{ width: 'auto' }} onClick={save}>Save</button>
          <button onClick={() => intents.updateWorldFolder(folder.id, { displayKind: isChest ? 'folder' : 'chest' })}>
            {isChest ? 'Convert to Folder' : 'Convert to Chest'}
          </button>
          <span className="spacer" />
          {confirmDelete ? (
            <button className="btn btn-sm btn-danger" onClick={() => { intents.deleteWorldFolder(folder.id); onClose(); }}>
              Really delete?
            </button>
          ) : (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>Delete…</button>
          )}
        </div>
        <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
          Deleting moves the {isChest ? 'chest' : 'folder'}&rsquo;s contents up one level — nothing inside is lost.
        </p>
      </div>
    </div>
  );
}

/** Read-only view a player gets when opening a non-character world item. */
function ReadModal({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  // Where the reader has dragged it. Null means "wherever the backdrop centres
  // it", which is where it opens and where most of them stay.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const locations = useGameStore((s) => s.locationList);
  const shops = useGameStore((s) => s.shopList);
  const tables = useGameStore((s) => s.tableList);
  const handouts = useGameStore((s) => s.handoutList);

  const loc = node.kind === 'location' ? locations.find((l) => l.id === node.id) : undefined;
  const shop = node.kind === 'shop' ? shops.find((s) => s.id === node.id) : undefined;
  const table = node.kind === 'table' ? tables.find((t) => t.id === node.id) : undefined;
  const handout = node.kind === 'handout' ? handouts.find((h) => h.id === node.id) : undefined;

  /**
   * Drag it by the title bar.
   *
   * A centred window has no stored x/y to pick up from, so the first grab
   * reads where it actually sits and pins it there — the same trick the
   * floating windows use. Listeners go on the window rather than the header so
   * a fast drag that outruns the pointer does not drop the window mid-move.
   */
  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).closest('.panel')?.getBoundingClientRect();
    const width = rect?.width ?? 320;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: pos ? pos.x : (rect?.left ?? 0), originY: pos ? pos.y : (rect?.top ?? 0),
    };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // Always leave a grabbable strip on screen: a window dragged off the
      // edge cannot be dragged back.
      const EDGE = 60;
      setPos({
        x: Math.min(window.innerWidth - EDGE, Math.max(EDGE - width, d.originX + ev.clientX - d.startX)),
        y: Math.min(window.innerHeight - EDGE, Math.max(0, d.originY + ev.clientY - d.startY)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="panel levelup"
        style={pos ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 } : undefined}
      >
        <div className="dock-header world-read-grip" onPointerDown={startDrag}>
          <h3>{node.kind === 'folder' && node.virtual ? '💡' : ICON[node.kind]} {node.name}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>
        {loc && <p style={{ whiteSpace: 'pre-wrap' }}>{loc.notes || <span className="dim">No description.</span>}</p>}
        {handout && (
          <>
            <HandoutImages handout={handout} className="world-handout-img" />
            <p style={{ whiteSpace: 'pre-wrap' }}>{handout.bodyMd || <span className="dim">(empty)</span>}</p>
          </>
        )}
        {table && (
          <>
            {table.playersCanRoll && <button className="btn btn-sm" onClick={() => intents.rollTable(table.id)}>🎲 Roll</button>}
            <ul className="dim" style={{ fontSize: 12 }}>{table.items.map((it, i) => <li key={i}>{it.text}</li>)}</ul>
          </>
        )}
        {shop && (
          <>
            {shop.description && <p className="dim">{shop.description}</p>}
            {/* Three bare columns of numbers said nothing about what they
                were. The same three words the storefront uses, so a price
                reads as a price in both places. */}
            <table className="sheet-list">
              <thead><tr><th>Item</th><th>{shop.currency}</th><th>stock</th></tr></thead>
              <tbody>
                {shop.items.map((it, i) => (
                  <tr key={i}><td>{it.name}</td><td>{it.price} {shop.currency}</td><td>{it.qty < 0 ? '∞' : it.qty}</td></tr>
                ))}
                {shop.items.length === 0 && <tr><td colSpan={3} className="dim">The shelves are bare.</td></tr>}
              </tbody>
            </table>
            {!shop.playersCanBuy && <p className="dim" style={{ fontSize: 11 }}>The DM presents this shop when it’s open for business.</p>}
          </>
        )}
      </div>
    </div>
  );
}
