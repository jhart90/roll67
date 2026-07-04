import { useState } from 'react';
import type { LocationNode } from 'shared';
import { intents, useGameStore } from '../store/game';

const KINDS: LocationNode['kind'][] = ['region', 'settlement', 'district', 'building', 'poi'];
const KIND_ICON: Record<string, string> = { region: '🗺️', settlement: '🏘️', district: '🏙️', building: '🏛️', poi: '📍' };

function LinkPicker<T extends { id: string; name?: string; title?: string }>(
  { label, options, selected, onChange }: { label: string; options: T[]; selected: string[]; onChange: (ids: string[]) => void },
) {
  const avail = options.filter((o) => !selected.includes(o.id));
  return (
    <div className="link-picker">
      <span className="dim">{label}</span>
      <div className="link-chips">
        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return <span key={id} className="link-chip">{o ? (o.name ?? o.title) : '?'}<button onClick={() => onChange(selected.filter((s) => s !== id))}>×</button></span>;
        })}
        {avail.length > 0 && (
          <select value="" onChange={(e) => { if (e.target.value) onChange([...selected, e.target.value]); }}>
            <option value="">+ add</option>
            {avail.map((o) => <option key={o.id} value={o.id}>{o.name ?? o.title}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function LocationEditor({ loc, onClose }: { loc: LocationNode; onClose: () => void }) {
  const all = useGameStore((s) => s.locationList);
  const characters = useGameStore((s) => s.characters);
  const shops = useGameStore((s) => s.shopList);
  const handouts = useGameStore((s) => s.handoutList);
  const [name, setName] = useState(loc.name);
  const [kind, setKind] = useState(loc.kind);
  const [notes, setNotes] = useState(loc.notes);
  const [visible, setVisible] = useState(loc.visibleToPlayers);
  const [parentId, setParentId] = useState(loc.parentId ?? '');
  const [npcIds, setNpcIds] = useState(loc.npcIds);
  const [shopIds, setShopIds] = useState(loc.shopIds);
  const [handoutIds, setHandoutIds] = useState(loc.handoutIds);

  const parentOptions = all.filter((l) => l.id !== loc.id);

  function save() {
    intents.updateLocation(loc.id, {
      name: name.trim() || 'Location', kind, notes, visibleToPlayers: visible,
      parentId: parentId || null, npcIds, shopIds, handoutIds,
    });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" style={{ width: 460, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="dock-header"><h3>Edit location</h3><button className="link" onClick={onClose}>close</button></div>
        <div className="row">
          <label style={{ flex: 1 }}>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ width: 130 }}>Type
            <select value={kind} onChange={(e) => setKind(e.target.value as LocationNode['kind'])}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        </div>
        <label>Inside
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— top level —</option>
            {parentOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label>Notes<textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="check-row">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to players
        </label>
        <LinkPicker label="NPCs" options={characters} selected={npcIds} onChange={setNpcIds} />
        <LinkPicker label="Shops" options={shops} selected={shopIds} onChange={setShopIds} />
        <LinkPicker label="Handouts" options={handouts} selected={handoutIds} onChange={setHandoutIds} />
        <div className="row">
          <button className="primary" style={{ width: 'auto' }} onClick={save}>Save</button>
          <button onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="link danger" onClick={() => { if (confirm(`Delete "${loc.name}"?`)) { intents.deleteLocation(loc.id); onClose(); } }}>delete</button>
        </div>
      </div>
    </div>
  );
}

/** Location manager for the World panel. */
export function LocationsPanel() {
  const you = useGameStore((s) => s.you);
  const locations = useGameStore((s) => s.locationList);
  const characters = useGameStore((s) => s.characters);
  const shops = useGameStore((s) => s.shopList);
  const handouts = useGameStore((s) => s.handoutList);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LocationNode | null>(null);
  const isDm = you?.role === 'dm';
  const open = locations.find((l) => l.id === openId);

  // Build a shallow tree (depth by walking parents present in the list).
  const byId = new Map(locations.map((l) => [l.id, l]));
  function depth(l: LocationNode): number {
    let d = 0, cur: LocationNode | undefined = l;
    while (cur?.parentId && byId.has(cur.parentId)) { d++; cur = byId.get(cur.parentId); if (d > 8) break; }
    return d;
  }
  const ordered = [...locations].sort((a, b) => a.name.localeCompare(b.name));

  if (open) {
    const npcs = open.npcIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean);
    const shopLinks = open.shopIds.map((id) => shops.find((s) => s.id === id)).filter(Boolean);
    const handoutLinks = open.handoutIds.map((id) => handouts.find((h) => h.id === id)).filter(Boolean);
    return (
      <div className="dir-section">
        <div className="dock-header">
          <h3>{KIND_ICON[open.kind]} {open.name}</h3>
          <span className="spacer" />
          {isDm && <button className="link" onClick={() => setEditing(open)}>edit</button>}
          <button className="link" onClick={() => setOpenId(null)}>back</button>
        </div>
        {isDm && !open.visibleToPlayers && <p className="dim" style={{ fontSize: 11 }}>Hidden from players</p>}
        {open.notes && <p className="handout-body">{open.notes}</p>}
        {npcs.length > 0 && <div className="loc-links"><span className="dim">NPCs:</span> {npcs.map((c) => <button key={c!.id} className="dir-link" onClick={() => useGameStore.getState().openSheet(c!.id)}>{c!.name}</button>)}</div>}
        {shopLinks.length > 0 && <div className="loc-links"><span className="dim">Shops:</span> {shopLinks.map((s) => <span key={s!.id} className="link-chip">{s!.name}</span>)}</div>}
        {handoutLinks.length > 0 && <div className="loc-links"><span className="dim">Handouts:</span> {handoutLinks.map((h) => <span key={h!.id} className="link-chip">{h!.title}</span>)}</div>}
        {editing && <LocationEditor loc={editing} onClose={() => setEditing(null)} />}
      </div>
    );
  }

  return (
    <div className="dir-section">
      <div className="dock-header">
        <h3>Locations</h3>
        {isDm && <button className="link" onClick={() => intents.createLocation('New location', null)}>+ Add</button>}
      </div>
      <ul className="loc-list">
        {ordered.map((l) => (
          <li key={l.id} style={{ paddingLeft: depth(l) * 14 }}>
            <button className="char-name" onClick={() => setOpenId(l.id)}>{KIND_ICON[l.kind]} {l.name}</button>
            {isDm && !l.visibleToPlayers && <span className="dim" style={{ fontSize: 10 }}>🔒</span>}
          </li>
        ))}
        {locations.length === 0 && <p className="dim">{isDm ? 'No locations yet — build your world.' : 'No locations revealed.'}</p>}
      </ul>
      {editing && <LocationEditor loc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
