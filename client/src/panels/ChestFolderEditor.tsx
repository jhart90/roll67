import { useMemo } from 'react';
import type { LootItem, WorldFolder } from 'shared';
import { intents, useGameStore } from '../store/game';
import { StockList, type KeyedStock } from './StockEditor';

/**
 * The editor for a chest that exists in the World tab but is not standing on
 * any map yet.
 *
 * A chest made from the World tab is a world folder wearing a chest's coat: it
 * holds its loot in the folder row, and only becomes a piece on the ground
 * when it is dragged onto a map. Clicking it used to open the plain folder
 * box — a name and nothing else — so the one thing a new chest is for, putting
 * things in it, was the one thing you could not do until you had placed it
 * somewhere. This is the same window a placed chest gets, minus the parts that
 * only mean something once it has a position: art, locks, and who carries it.
 */
export function ChestFolderEditor({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const folder = useGameStore((s) => s.worldFolderList.find((f) => f.id === folderId));
  const campaign = useGameStore((s) => s.campaign);
  const isDm = useGameStore((s) => s.isDm());

  // Rows keep their id as the React key, so editing one can never lose track
  // of which item it is — the same contract the placed chest's editor keeps.
  const stock = useMemo<KeyedStock[]>(() => (folder?.items ?? []).map((it) => ({
    key: it.id,
    name: it.name,
    price: 0,
    qty: it.qty ?? 1,
    notes: it.description,
    ...(it.contentId ? { contentId: it.contentId } : {}),
  })), [folder?.items]);

  if (!folder || !isDm || !campaign) return null;

  function saveStock(next: KeyedStock[]) {
    intents.updateWorldFolder(folderId, {
      items: next.map((row): LootItem => ({
        id: row.key,
        name: row.name,
        description: row.notes ?? '',
        qty: Math.max(1, row.qty),
        ...(row.contentId ? { contentId: row.contentId } : {}),
      })),
    });
  }

  return (
    <div className="dock-panel chest-folder-editor">
      <div className="dock-header">
        <h3>📦 {folder.name || 'Chest'}</h3>
        <span className="spacer" />
        <button className="link" onClick={onClose}>close</button>
      </div>
      <label>
        Name
        <input
          key={`${folder.id}-name`}
          defaultValue={folder.name}
          onBlur={(e) => intents.updateWorldFolder(folderId, { name: e.target.value.trim() || 'Chest' })}
        />
      </label>
      <p className="dim" style={{ fontSize: 12, margin: '2px 0 6px' }}>
        Not on a map yet — drag it onto one to put it on the ground, where it
        gains art, a lock, and a carrier.
      </p>
      <StockList
        items={stock}
        onChange={saveStock}
        system={campaign.system}
        title="Items in chest"
        showPrice={false}
        unlimited={false}
        emptyText="Empty — add items below or from the compendium."
      />
    </div>
  );
}

/** Does this folder stand for a chest rather than a plain folder? */
export function isChestFolder(f: WorldFolder | undefined): boolean {
  return f?.displayKind === 'chest';
}
