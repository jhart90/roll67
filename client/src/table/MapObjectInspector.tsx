import { useMemo, useRef, useState } from 'react';
import type { LootItem } from 'shared';
import { intents, useGameStore } from '../store/game';
import { useCampaignKeyNames } from '../util/campaignKeys';
import { StockList, type KeyedStock } from '../panels/StockEditor';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';
import { ConfirmButton } from '../util/ConfirmButton';

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

  const noun = obj.kind === 'chest' ? 'chest' : obj.kind === 'shop' ? 'shop' : 'item';

  return (
    <div className="token-inspector">
      <div className="dock-header">
        <strong>{obj.kind === 'chest' ? '📦 Chest' : obj.kind === 'shop' ? '🏪 Shop' : '✦ Item'}</strong>
        <span className="spacer" />
        <button className="link" title="Close" aria-label="Close" onClick={() => useGameStore.getState().openObjectInspector(null)}>✕</button>
      </div>

      <label>
        Name
        <input
          value={obj.name}
          onChange={(e) => intents.updateMapObject(obj.id, { name: e.target.value })}
        />
      </label>

      {/* The contents come FIRST. They are what this window is for, and they
          used to sit below the name, the description, two file pickers and
          four switches — far enough down that adding an item meant scrolling
          to find the button that adds one. The same stock surface a shop's
          shelves use; a chest is a container whose contents are free, so the
          price column is off. */}
      {obj.kind === 'chest' && (
        <StockList
          items={stock}
          onChange={saveStock}
          system={campaign.system}
          title="Items in chest"
          showPrice={false}
          unlimited={false}
          emptyText="Empty — add an item below, or pull one from the compendium."
        />
      )}

      <h4>Who can reach it</h4>
      {/* This was a checkbox whose caption reported the CURRENT state instead
          of what ticking it would do, so "👁 Visible to players" sat beside an
          empty box — and ticking it hid the chest. A two-option list cannot
          say one thing and mean the other: you pick the state you want, the
          same way a token's layer is chosen. */}
      <label>
        Visibility
        <select
          value={obj.layer === 'gm' ? 'gm' : 'map'}
          onChange={(e) => intents.updateMapObject(obj.id, { layer: e.target.value === 'gm' ? 'gm' : 'map' })}
        >
          <option value="map">👁 Visible to players</option>
          <option value="gm">🙈 Hidden — only you can see it</option>
        </select>
      </label>
      <p className="dim mo-hint">
        {obj.layer === 'gm'
          ? 'On the GM layer. Reveal it the moment a Notice roll earns it — it keeps its contents, its lock and its position.'
          : 'On the table, where players can see it and reach it.'}
      </p>

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
            <span>🔒 Locked — needs a key to open</span>
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
              title="Whose token IS this container. A carried chest leaves the ground and travels with them."
            >
              <option value="">— on the ground —</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {obj.linkedCharacterId && (
            <p className="dim mo-hint">
              🫱 Carried, so it is off the map — players reach it through that token,
              and only once they are incapacitated or dead.
            </p>
          )}
        </>
      )}

      <h4>What players read</h4>
      <label>
        Description
        <textarea
          value={obj.description}
          onChange={(e) => intents.updateMapObject(obj.id, { description: e.target.value })}
          rows={2}
        />
      </label>
      {/* Separate from the map art below: that is the piece on the board, this
          is what players READ when they open it. */}
      <p className="dim mo-hint">A briefing image is shown above the contents when they open it.</p>
      {obj.detailUrl && (
        <img src={obj.detailUrl} alt="" className="detail-preview" />
      )}
      <input type="file" accept="image/*" ref={detailRef} onChange={onDetail} style={{ fontSize: 12 }} />
      {obj.detailAssetId && (
        <button className="small" style={{ marginTop: 4 }} onClick={() => intents.updateMapObject(obj.id, { detailAssetId: '' })}>
          Remove briefing image
        </button>
      )}

      <h4>Map art</h4>
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

      {/* One click used to delete a stocked chest outright — no question
          asked, and no word about what went with it. */}
      <div className="inspector-danger">
        <ConfirmButton
          title={`Delete this ${noun} and everything in it`}
          confirmLabel={`Really delete this ${noun}?`}
          onConfirm={() => { intents.deleteMapObject(obj.id); useGameStore.getState().openObjectInspector(null); }}
        >
          {`Delete this ${noun}`}
        </ConfirmButton>
        <span className="dim">
          {obj.kind === 'chest' && obj.items.length > 0
            ? <>Takes it off the map along with the <b>{obj.items.length} item{obj.items.length === 1 ? '' : 's'}</b> still inside. Anything players already took stays on their sheets.</>
            : <>Takes it off the map for good. Anything players already took stays on their sheets.</>}
        </span>
      </div>
    </div>
  );
}
