import { useMemo, useState, type ReactNode } from 'react';
import type { Character, Counter, DirectoryPayload, Handout, Light, LocationNode, MapMeta, MapObject, RollableTable, Shop, Token, WorldFolder } from 'shared';
import { str } from 'shared';
import { intents, useGameStore, type MapTarget } from '../store/game';
import { openWindow } from '../store/windowManager';
import { worldDrag, type WorldDragKind } from '../store/worldDrag';
import { AnchoredMenu } from '../util/AnchoredMenu';
import { inkOnDark } from '../util/playerColor';

// 'mapobject' nodes (loot/chests placed on the current map) live only in
// this tree — they are not draggable, so the kind is not part of WorldDragKind.
type Kind = WorldDragKind | 'mapobject' | 'token';

interface TreeNode {
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
  /** A character this viewer has discovered but does not own: clicking it
   *  opens the public-facing sheet, never the private one. */
  notMine?: boolean;
  /** For token nodes: where it stands and who runs it. */
  tokenMapId?: string;
  tokenCharacterId?: string | null;
  /** A player runs this one — light-blue silhouette rather than DM grey. */
  playerRun?: boolean;
  /** The token colour this character/token wears on the map, when it has one.
   *  Paints the silhouette, so the tree matches the pieces at a glance. */
  color?: string;
  /** For map nodes: a scene, and whether a details preview exists. */
  isScene?: boolean;
  hasPreview?: boolean;
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
  // The colour each character's piece actually wears. Read off the TOKEN, not
  // the sheet: the sheet's colour field is blank for most PCs and the real
  // colour is inherited from the player, which the server has already resolved
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
      // The sheet's own colour field is the fallback when no piece of theirs
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
  // Map lights appear under their map
  if (mapId) {
    for (const light of mapLights) {
      const name = light.name || 'Light';
      const sub = `bright ${light.brightRadius}, dim ${light.dimRadius}`;
      out.push({ kind: 'light', id: light.id, name, parentId: mapId, sub, lightMapId: mapId });
    }
  }
  // Loot & chests appear nested under whichever map they're placed on
  // (shop markers are skipped — the shop itself is already a tree node).
  for (const obj of mapObjects) {
    if (obj.kind === 'shop') continue;
    const sub = obj.items.length ? `${obj.items.length} item${obj.items.length === 1 ? '' : 's'}` : '';
    out.push({
      kind: 'mapobject', id: obj.id,
      name: obj.name || (obj.kind === 'chest' ? 'Chest' : 'Loot'),
      parentId: obj.mapId, sub, mapObjectKind: obj.kind,
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
  const isDm = you?.role === 'dm';

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
  const [folderEdit, setFolderEdit] = useState<string | null>(null);
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
      if (isDm) setFolderEdit(node.id);
      return;
    }
    if (node.kind === 'light') {
      if (!isDm || !node.lightMapId) return;
      if (node.lightTokenId) return; // can't rename token-carried lights directly
      const name = prompt('Light name', node.name);
      if (name && name.trim()) intents.renameLight(node.id, node.lightMapId, name.trim());
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
        // Counters only live on maps — an above-drop can't re-home them.
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
          draggable={isDm && node.kind !== 'mapobject'}
          onDragStart={isDm && node.kind !== 'mapobject' ? (e) => {
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
            if (isDm && node.kind === 'folder') setCtxMenu({ x: e.clientX, y: e.clientY, folderId: node.id });
            else open(node);
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
            className={`wt-icon${node.kind === 'token' || node.kind === 'character' ? (node.playerRun ? ' wt-tok-player' : ' wt-tok-dm') : ''}`}
            // The silhouette wears the piece's own colour, so scanning the tree
            // and scanning the map are the same act. Lifted off pure black
            // first: a colour picked to read as a filled shape on a lit map can
            // be invisible as a glyph on dark chrome. Without one the class
            // above still says party-blue or DM-grey.
            style={node.color ? { color: inkOnDark(node.color) } : undefined}
            title={node.kind === 'token' || node.kind === 'character' ? (node.playerRun ? 'Run by a player' : 'Run by the DM') : undefined}
          >
            {(node.kind === 'folder' && node.displayKind === 'chest') || node.mapObjectKind === 'chest' ? '📦' : ICON[node.kind]}
          </span>
          <span className="wt-name">{node.name}</span>
          {node.sub && <span className="wt-sub">{node.sub}</span>}
          {/* Folders manage themselves from the details window (double/right-
              click) — no inline delete button cluttering every row. */}
          {isDm && node.kind === 'light' && !node.lightTokenId && node.lightMapId && (
            <button
              className="link danger"
              title="Delete light"
              onClick={(e) => {
                e.stopPropagation();
                intents.deleteLight(node.lightMapId!, node.id);
              }}
            >
              ✕
            </button>
          )}
          {isDm && node.kind === 'light' && node.lightTokenId && (
            <button
              className="link danger"
              title="Unlink light from character"
              onClick={(e) => {
                e.stopPropagation();
                const tok = allTokens[node.lightTokenId!];
                if (tok) intents.unlinkLightFromToken(tok.id, tok.mapId);
              }}
            >
              ⊘
            </button>
          )}
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
  const locations = useGameStore((s) => s.locationList);
  const shops = useGameStore((s) => s.shopList);
  const tables = useGameStore((s) => s.tableList);
  const handouts = useGameStore((s) => s.handoutList);

  const loc = node.kind === 'location' ? locations.find((l) => l.id === node.id) : undefined;
  const shop = node.kind === 'shop' ? shops.find((s) => s.id === node.id) : undefined;
  const table = node.kind === 'table' ? tables.find((t) => t.id === node.id) : undefined;
  const handout = node.kind === 'handout' ? handouts.find((h) => h.id === node.id) : undefined;

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>{ICON[node.kind]} {node.name}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>
        {loc && <p style={{ whiteSpace: 'pre-wrap' }}>{loc.notes || <span className="dim">No description.</span>}</p>}
        {handout && (
          <>
            {handout.imageUrl && <img src={handout.imageUrl} alt={handout.title} style={{ maxWidth: '100%', borderRadius: 6 }} />}
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
            <table className="sheet-list"><tbody>
              {shop.items.map((it, i) => (
                <tr key={i}><td>{it.name}</td><td>{it.price} {shop.currency}</td><td>{it.qty < 0 ? '∞' : it.qty}</td></tr>
              ))}
            </tbody></table>
            {!shop.playersCanBuy && <p className="dim" style={{ fontSize: 11 }}>The DM presents this shop when it’s open for business.</p>}
          </>
        )}
      </div>
    </div>
  );
}
