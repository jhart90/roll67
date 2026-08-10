import { useEffect, useState } from 'react';
import type { ContentEntry, GameSystem } from 'shared';
import { shopItemFromEntry } from 'shared';
import { Compendium } from './Compendium';

/**
 * One surface for stocking a container, wherever the container lives. A shop's
 * shelves and a chest's contents were two different editors with two different
 * ideas of what an item is — the shop had prices, quantities, notes and a
 * compendium picker; the chest had a name box. They are the same job, so this
 * is the same component, and a chest simply runs it with the price column off.
 */
export interface StockValue {
  name: string;
  /** Always 0 for a chest: loot is free, only a shop charges for anything. */
  price: number;
  /** In a shop, -1 means unlimited stock. In a chest it is how many are piled up. */
  qty: number;
  notes: string;
  /** Compendium entry: taking or buying it applies its full logic. */
  contentId?: string;
  effect?: 'heal' | 'damage';
  amount?: string;
  range?: number;
}

/** Identity belongs to the owner of the list — a shop's editor-local key, a
 *  chest item's real id — so rows survive edits and deletes either way. */
export interface KeyedStock extends StockValue { key: string }

const draftOf = (item: StockValue, unlimited: boolean) => ({
  name: item.name,
  price: String(item.price),
  qty: unlimited && item.qty < 0 ? '' : String(item.qty),
  notes: item.notes,
});

const EMPTY_DRAFT = { name: '', price: '', qty: '', notes: '' };

/** Blank quantity means "unlimited" on a shelf and "one of them" in a chest. */
function parseQty(raw: string, unlimited: boolean): number {
  if (raw === '') return unlimited ? -1 : 1;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return unlimited ? -1 : 1;
  return unlimited ? n : Math.max(1, n);
}

/** One row of stock: read-only with edit/delete, or inline-editing. */
function StockRow({ item, showPrice, unlimited, editing, onEdit, onSave, onDelete, onCancel }: {
  item: StockValue; showPrice: boolean; unlimited: boolean; editing: boolean;
  onEdit: () => void; onSave: (it: StockValue) => void; onDelete: () => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(item, unlimited));
  // Re-seed from the CURRENT item every time editing begins — never trust a
  // draft captured at mount to still match what this row displays.
  useEffect(() => { if (editing) setDraft(draftOf(item, unlimited)); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <div className="stock-row editing">
        <input className="stk-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" />
        {showPrice && (
          <input className="stk-price" type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="Price" />
        )}
        <input className="stk-qty" type="number" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} placeholder={unlimited ? '∞' : '1'} />
        <input className="stk-notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Description" />
        <button className="icon-btn" title="Save" onClick={() => onSave({
          ...item,
          name: draft.name.trim() || item.name,
          price: showPrice ? Number(draft.price) || 0 : 0,
          qty: parseQty(draft.qty, unlimited),
          notes: draft.notes,
        })}>✓</button>
        <button className="icon-btn" title="Cancel" onClick={onCancel}>✕</button>
      </div>
    );
  }

  return (
    <div className="stock-row">
      <span className="stk-name">
        {item.name}
        {item.contentId && <span className="stk-tag" title="Predefined — taking it transfers its effects">◆</span>}
        {item.effect && <span className="stk-tag heal" title={`Usable: ${item.effect} ${item.amount ?? ''}`}>✦</span>}
      </span>
      {showPrice && <span className="stk-price">{item.price}</span>}
      <span className="stk-qty">{unlimited && item.qty < 0 ? '∞' : item.qty}</span>
      <span className="stk-notes dim">{item.notes}</span>
      <button className="icon-btn" title="Edit" onClick={onEdit}>✎</button>
      <button className="icon-btn danger" title="Delete" onClick={onDelete}>🗑</button>
    </div>
  );
}

/**
 * The whole stock section: column headings, the rows, the add row, and the
 * compendium picker. The caller owns the list and its keys; this owns the
 * editing state and the drafts.
 */
export function StockList({
  items, onChange, system, title = 'Stock', showPrice = true, unlimited = true, emptyText,
}: {
  items: KeyedStock[];
  onChange: (next: KeyedStock[]) => void;
  system: GameSystem;
  title?: string;
  /** Chests turn this off — their loot is free, so the column is noise. */
  showPrice?: boolean;
  /** Shops stock ∞ of a thing; a chest holds a countable pile. */
  unlimited?: boolean;
  emptyText?: string;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showCompendium, setShowCompendium] = useState(false);

  function addDraft() {
    if (!draft.name.trim()) return;
    onChange([...items, {
      key: crypto.randomUUID(),
      name: draft.name.trim(),
      price: showPrice ? Number(draft.price) || 0 : 0,
      qty: parseQty(draft.qty, unlimited),
      notes: draft.notes.trim(),
    }]);
    setDraft(EMPTY_DRAFT);
  }

  function addEntry(entry: ContentEntry) {
    const base = shopItemFromEntry(entry);
    onChange([...items, {
      ...base,
      key: crypto.randomUUID(),
      price: showPrice ? base.price : 0,
      qty: unlimited ? base.qty : 1,
    }]);
  }

  return (
    <>
      <div className="stock-head">
        <h4>{title}</h4>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setShowCompendium(true)}>+ From compendium</button>
      </div>

      <div className="stock-cols dim">
        <span className="stk-name">Item</span>
        {showPrice && <span className="stk-price">Price</span>}
        <span className="stk-qty">Qty</span>
        <span className="stk-notes">Description</span>
        <span style={{ width: 56 }} />
      </div>
      <div className="stock-list">
        {items.map((it) => (
          <StockRow
            key={it.key}
            item={it}
            showPrice={showPrice}
            unlimited={unlimited}
            editing={editingKey === it.key}
            onEdit={() => setEditingKey(it.key)}
            onCancel={() => setEditingKey(null)}
            onDelete={() => { onChange(items.filter((x) => x.key !== it.key)); setEditingKey(null); }}
            onSave={(next) => {
              onChange(items.map((x) => (x.key === it.key ? { ...next, key: it.key } : x)));
              setEditingKey(null);
            }}
          />
        ))}
        {items.length === 0 && (
          <p className="dim" style={{ margin: '4px 0' }}>
            {emptyText ?? 'Nothing here yet — add items below or from the compendium.'}
          </p>
        )}
      </div>

      <div className="stock-row add">
        <input className="stk-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name"
          onKeyDown={(e) => { if (e.key === 'Enter') addDraft(); }} />
        {showPrice && (
          <input className="stk-price" type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="Price" />
        )}
        <input className="stk-qty" type="number" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} placeholder={unlimited ? '∞' : '1'} />
        <input className="stk-notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Description"
          onKeyDown={(e) => { if (e.key === 'Enter') addDraft(); }} />
        <button className="btn btn-sm btn-accent" title="Add item" onClick={addDraft} disabled={!draft.name.trim()}>+</button>
      </div>

      {showCompendium && (
        <Compendium
          system={system}
          onClose={() => setShowCompendium(false)}
          onPick={addEntry}
        />
      )}
    </>
  );
}
