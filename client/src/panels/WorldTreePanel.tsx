import { useMemo, useState, type ReactNode } from 'react';
import type { Character, Handout, LocationNode, MapMeta, RollableTable, Shop } from 'shared';
import { intents, useGameStore } from '../store/game';
import { openWindow } from '../store/windowManager';
import { worldDrag, type WorldDragKind } from '../store/worldDrag';

type Kind = WorldDragKind;

interface TreeNode {
  kind: Kind;
  id: string;
  name: string;
  parentId: string | null;
  sub: string; // secondary label (owner, kind, item count…)
}

const ICON: Record<Kind, string> = { location: '📍', character: '👤', shop: '🏪', table: '🎲', handout: '📄', map: '🗺️' };

/** One flat list of every world object, keyed for tree assembly. */
function buildNodes(
  locations: LocationNode[], characters: Character[], shops: Shop[], tables: RollableTable[], handouts: Handout[], maps: MapMeta[],
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const m of maps) out.push({ kind: 'map', id: m.id, name: m.name || 'Map', parentId: m.parentId ?? null, sub: 'map' });
  for (const l of locations) out.push({ kind: 'location', id: l.id, name: l.name || 'Location', parentId: l.parentId ?? null, sub: l.kind });
  for (const c of characters) out.push({ kind: 'character', id: c.id, name: c.name || 'Character', parentId: c.parentId ?? null, sub: c.ownerUserId ? '' : 'NPC' });
  for (const s of shops) out.push({ kind: 'shop', id: s.id, name: s.name || 'Shop', parentId: s.parentId ?? null, sub: `${s.items.length} items` });
  for (const t of tables) out.push({ kind: 'table', id: t.id, name: t.name || 'Table', parentId: t.parentId ?? null, sub: `${t.items.length}` });
  for (const h of handouts) out.push({ kind: 'handout', id: h.id, name: h.title || 'Handout', parentId: h.parentId ?? null, sub: '' });
  return out;
}

export function WorldTreePanel() {
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((s) => s.characters);
  const locations = useGameStore((s) => s.locationList);
  const shops = useGameStore((s) => s.shopList);
  const tables = useGameStore((s) => s.tableList);
  const handouts = useGameStore((s) => s.handoutList);
  const maps = useGameStore((s) => s.mapsMeta);
  const isDm = you?.role === 'dm';

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<TreeNode | null>(null);
  // The dragged item lives in a module-level ref (not state) so `drop` reads
  // it synchronously and so a drop on the map canvas — a different panel
  // entirely — can read it too.
  const dragRef = worldDrag;
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);

  const nodes = useMemo(
    () => buildNodes(locations, characters, shops, tables, handouts, maps),
    [locations, characters, shops, tables, handouts, maps],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      // An item whose parent no longer exists floats to the top level.
      const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(n);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [nodes, byId]);

  function toggle(id: string) {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // The "open editor" action (right-click / double-click).
  function open(node: TreeNode) {
    if (node.kind === 'character') { useGameStore.getState().openSheet(node.id); return; }
    if (node.kind === 'map') {
      if (isDm) openWindow('mapEditor', node.id, {}, node.name || 'Edit map');
      else intents.viewMap(node.id);
      return;
    }
    // The DM edits (each in its own draggable window); players get a
    // read-only view of what they can see.
    if (isDm) openWindow(node.kind as 'location' | 'shop' | 'table' | 'handout', node.id, {}, node.name);
    else setReading(node);
  }

  // The primary left-click action.
  function activate(node: TreeNode, hasKids: boolean) {
    if (node.kind === 'map') { intents.viewMap(node.id); return; } // open in the viewer
    if (hasKids) toggle(node.id);
    else open(node);
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

  function drop(targetId: string | null) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDropTarget(null);
    if (!drag) return;
    // Can't parent an item under itself or its own descendant.
    if (targetId && (targetId === drag.id || isAncestor(drag.id, targetId))) return;
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
    const isDropOn = dropTarget === node.id;
    return (
      <div key={`${node.kind}:${node.id}`}>
        <div
          className={`wt-row ${isDropOn ? 'drop-on' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={isDm}
          onDragStart={isDm ? (e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
            dragRef.current = { kind: node.kind, id: node.id };
          } : undefined}
          onDragOver={isDm ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropTarget !== node.id) setDropTarget(node.id); } : undefined}
          onDrop={isDm ? (e) => { e.preventDefault(); e.stopPropagation(); drop(node.id); } : undefined}
          onDragEnd={isDm ? () => { dragRef.current = null; setDropTarget(null); } : undefined}
          onClick={() => activate(node, kids.length > 0)}
          onDoubleClick={() => open(node)}
          onContextMenu={(e) => { e.preventDefault(); open(node); }}
          title={node.kind === 'map' ? 'Click to open in the viewer · double/right-click to edit · drag to re-parent' : 'Click to expand · double/right-click to open · drag to re-parent'}
        >
          <span
            className="wt-caret"
            onClick={kids.length ? (e) => { e.stopPropagation(); toggle(node.id); } : undefined}
          >
            {kids.length ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span className="wt-icon">{ICON[node.kind]}</span>
          <span className="wt-name">{node.name}</span>
          {node.sub && <span className="wt-sub">{node.sub}</span>}
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
          <button className="btn btn-sm" onClick={() => openWindow('randomizeNpc', 'main', {}, 'Randomize an NPC')}>🎲 Random NPC</button>
        </div>
      )}

      <div
        className={`wt-tree ${dropTarget === 'root' ? 'drop-on' : ''}`}
        onDragOver={isDm ? (e) => { e.preventDefault(); setDropTarget('root'); } : undefined}
        onDrop={isDm ? (e) => { e.preventDefault(); drop(null); } : undefined}
      >
        {roots.map((n) => renderNode(n, 0))}
        {roots.length === 0 && <p className="dim" style={{ padding: 8 }}>Nothing here yet.{isDm ? ' Use the buttons above to add locations, NPCs, shops, tables, and handouts.' : ''}</p>}
      </div>
      {isDm && <p className="dim wt-hint">Drag an item onto another to nest it; drag to empty space to move it to the top level.</p>}

      {reading && <ReadModal node={reading} onClose={() => setReading(null)} />}
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
