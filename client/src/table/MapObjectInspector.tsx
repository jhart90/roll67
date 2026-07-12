import { useRef, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

export function MapObjectInspector() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const obj = useGameStore((s) => (s.inspectedObjectId ? s.mapObjects[s.inspectedObjectId] : null));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { progress, upload } = useUploadProgress();
  const [newItemName, setNewItemName] = useState('');

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
    intents.updateMapObject(obj.id, { items: [...obj.items, { id, name: newItemName.trim(), description: '' }] });
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
              placeholder="New item name…"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              style={{ flex: 1, fontSize: 12 }}
            />
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
