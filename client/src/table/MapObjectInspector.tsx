import { useMemo, useRef, useState } from 'react';
import { contentForSystem, type ContentEntry } from 'shared';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

export function MapObjectInspector() {
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((st) => st.characters);
  const campaign = useGameStore((s) => s.campaign);
  const obj = useGameStore((s) => (s.inspectedObjectId ? s.mapObjects[s.inspectedObjectId] : null));
  const customItems = useGameStore((s) => s.customItems);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { progress, upload } = useUploadProgress();
  const [newItemName, setNewItemName] = useState('');

  // Compendium + campaign custom items, so a chest item typed by name links
  // its contentId (full apply-on-take logic downstream) instead of being a
  // plain string. Typing suggests via the datalist below.
  const catalog = useMemo<ContentEntry[]>(() => {
    if (!campaign) return [];
    const custom = customItems.map((c) => {
      try { return JSON.parse(c.entryJson) as ContentEntry; } catch { return null; }
    }).filter((e): e is ContentEntry => !!e);
    return [...contentForSystem(campaign.system), ...custom];
  }, [campaign, customItems]);

  if (!obj || you?.role !== 'dm' || !campaign) return null;

  async function onArt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !obj || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await upload(file, campaign.id, 'token');
      intents.updateMapObject(obj.id, { artAssetId: assetId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function addItem() {
    if (!newItemName.trim() || !obj) return;
    const id = crypto.randomUUID();
    const name = newItemName.trim();
    // A name matching a compendium/custom entry links its id, so taking the
    // item can apply the real thing (weapon, potion…) rather than a label.
    const entry = catalog.find((e) => e.name.toLowerCase() === name.toLowerCase());
    intents.updateMapObject(obj.id, {
      items: [...obj.items, { id, name, description: entry?.subtitle ?? '', ...(entry ? { contentId: entry.id } : {}) }],
    });
    setNewItemName('');
  }

  function removeItem(itemId: string) {
    if (!obj) return;
    intents.updateMapObject(obj.id, { items: obj.items.filter((i) => i.id !== itemId) });
  }

  function updateItemName(itemId: string, name: string) {
    if (!obj) return;
    intents.updateMapObject(obj.id, { items: obj.items.map((i) => (i.id === itemId ? { ...i, name } : i)) });
  }

  return (
    <div className="token-inspector">
      <div className="dock-header">
        <strong>{obj.kind === 'chest' ? '📦 Chest' : obj.kind === 'shop' ? '🏪 Shop' : '✦ Item'}</strong>
        <span className="spacer" />
        <button className="link" onClick={() => useGameStore.getState().openObjectInspector(null)}>✕</button>
      </div>

      <label>
        Name
        <input
          value={obj.name}
          onChange={(e) => intents.updateMapObject(obj.id, { name: e.target.value })}
        />
      </label>

      <label>
        Description
        <textarea
          value={obj.description}
          onChange={(e) => intents.updateMapObject(obj.id, { description: e.target.value })}
          rows={2}
        />
      </label>

      <h4>Art</h4>
      {obj.artAssetId && (
        <img
          src={`/uploads/${obj.artAssetId}`}
          alt=""
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }}
        />
      )}
      <input type="file" accept="image/*" ref={fileRef} onChange={onArt} style={{ fontSize: 12 }} />
      {uploading && <UploadProgressBar progress={progress} />}
      {obj.artAssetId && (
        <button className="small" style={{ marginTop: 4 }} onClick={() => intents.updateMapObject(obj.id, { artAssetId: '' })}>
          Remove art
        </button>
      )}

      {obj.kind === 'shop' && (
        <label>
          Interact range (hexes)
          <input
            type="number" min={1} max={20}
            value={obj.interactRange}
            onChange={(e) => intents.updateMapObject(obj.id, { interactRange: Math.max(1, +e.target.value || 1) })}
            style={{ width: 60 }}
          />
        </label>
      )}

      {obj.kind === 'chest' && (
        <>
          {/* Locks work exactly like a door's: holding the named item is
              enough, it isn't consumed, and the DM always gets in. */}
          <label className="mo-lock">
            <input
              type="checkbox"
              checked={obj.locked === true}
              onChange={(e) => intents.updateMapObject(obj.id, {
                locked: e.target.checked,
                ...(e.target.checked && !obj.keyName ? { keyName: 'Key' } : {}),
              })}
            />
            <span>🔒 Locked</span>
          </label>
          {obj.locked && (
            <label>
              Key required
              <input
                key={`${obj.id}-key`}
                defaultValue={obj.keyName ?? 'Key'}
                placeholder="Key"
                title="An inventory item with this name opens it. Leave as “Key” for a generic key, or name a specific one."
                onBlur={(e) => intents.updateMapObject(obj.id, { keyName: e.target.value.trim() || 'Key' })}
              />
            </label>
          )}
          {/* A chest can be carried by a character instead of sitting on the
              floor — the same relationship a shop has with its shopkeeper. */}
          <label>
            Carried by
            <select
              value={obj.linkedCharacterId ?? ''}
              onChange={(e) => intents.updateMapObject(obj.id, { linkedCharacterId: e.target.value || null })}
              title="Whose token IS this container. Leave unset for a chest on the ground."
            >
              <option value="">— on the ground —</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <h4>Items in Chest</h4>
          {obj.items.length === 0 && <p className="dim" style={{ fontSize: 12 }}>No items yet.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
            {obj.items.map((item) => (
              <li key={item.id} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                <input
                  value={item.name}
                  onChange={(e) => updateItemName(item.id, e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="small danger" onClick={() => removeItem(item.id)}>✕</button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              placeholder="Add item (compendium names autocomplete)…"
              list="chest-item-catalog"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              style={{ flex: 1, fontSize: 12 }}
            />
            <datalist id="chest-item-catalog">
              {catalog.map((e) => <option key={e.id} value={e.name} />)}
            </datalist>
            <button className="small" onClick={addItem}>Add</button>
          </div>
        </>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
        <button className="small danger" onClick={() => { intents.deleteMapObject(obj.id); useGameStore.getState().openObjectInspector(null); }}>
          Delete
        </button>
      </div>
    </div>
  );
}
