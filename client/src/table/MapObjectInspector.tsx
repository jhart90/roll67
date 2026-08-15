import { useMemo, useRef, useState } from 'react';
import type { LootItem } from 'shared';
import { intents, useGameStore } from '../store/game';
import { useCampaignKeyNames } from '../util/campaignKeys';
import { StockList, type KeyedStock } from '../panels/StockEditor';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

export function MapObjectInspector() {
  const keyNames = useCampaignKeyNames();
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((st) => st.characters);
  const campaign = useGameStore((s) => s.campaign);
  const obj = useGameStore((s) => (s.inspectedObjectId ? s.mapObjects[s.inspectedObjectId] : null));
  const fileRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { progress, upload } = useUploadProgress();

  // A chest's contents in the shared stock shape. The LootItem's own id IS the
  // row key, so editing a row can never lose track of which item it is — and
  // the server finds items by that id when someone takes one.
  const stock = useMemo<KeyedStock[]>(() => (obj?.items ?? []).map((it) => ({
    key: it.id,
    name: it.name,
    price: 0,
    qty: it.qty ?? 1,
    notes: it.description,
    ...(it.contentId ? { contentId: it.contentId } : {}),
  })), [obj?.items]);

  if (!obj || you?.role !== 'dm' || !campaign) return null;

  /** Back to LootItems, preserving each row's id (a new row gets its key). */
  function saveStock(next: KeyedStock[]) {
    if (!obj) return;
    intents.updateMapObject(obj.id, {
      items: next.map((row): LootItem => ({
        id: row.key,
        name: row.name,
        description: row.notes,
        qty: Math.max(1, row.qty),
        ...(row.contentId ? { contentId: row.contentId } : {}),
      })),
    });
  }

  /** The briefing image, uploaded as a handout rather than a token: it is read
   *  at full size above the contents, not drawn at hex scale on the map. */
  async function onDetail(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !obj || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await upload(file, campaign.id, 'handout');
      intents.updateMapObject(obj.id, { detailAssetId: assetId });
    } catch (err) {
      useGameStore.getState().toast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (detailRef.current) detailRef.current.value = '';
    }
  }

  async function onArt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !obj || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await upload(file, campaign.id, 'token');
      intents.updateMapObject(obj.id, { artAssetId: assetId });
    } catch (err) {
      useGameStore.getState().toast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
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
          src={obj.artUrl ?? ''}
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

      {/* Separate from the map art above: that is the piece on the board, this
          is what players READ when they open it. */}
      <h4>Briefing image <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}>— players see this above the contents</span></h4>
      {obj.detailUrl && (
        <img src={obj.detailUrl} alt="" className="detail-preview" />
      )}
      <input type="file" accept="image/*" ref={detailRef} onChange={onDetail} style={{ fontSize: 12 }} />
      {obj.detailAssetId && (
        <button className="small" style={{ marginTop: 4 }} onClick={() => intents.updateMapObject(obj.id, { detailAssetId: '' })}>
          Remove briefing image
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
              {/* The same list the door editor offers, from the same place:
                  every key that exists anywhere in the campaign. Typing is
                  still allowed — a DM may name a key before cutting it — but
                  the ones that already exist are one click away rather than
                  something to remember the spelling of. */}
              <input
                key={`${obj.id}-key`}
                list={`keys-${obj.id}`}
                defaultValue={obj.keyName ?? 'Key'}
                placeholder="Key"
                title="An inventory item with this name opens it. Leave as “Key” for a generic key, or pick one you have cut."
                onBlur={(e) => intents.updateMapObject(obj.id, { keyName: e.target.value.trim() || 'Key' })}
              />
              <datalist id={`keys-${obj.id}`}>
                {keyNames.map((n) => <option key={n} value={n} />)}
              </datalist>
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
          {/* The same stock surface a shop's shelves use — a chest is just a
              container whose contents are free, so the price column is off. */}
          <StockList
            items={stock}
            onChange={saveStock}
            system={campaign.system}
            title="Items in Chest"
            showPrice={false}
            unlimited={false}
            emptyText="Empty — add items below or from the compendium."
          />
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
