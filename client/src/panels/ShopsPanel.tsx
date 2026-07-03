import { useState } from 'react';
import type { Shop } from 'shared';
import { intents, useGameStore } from '../store/game';

function ShopEditor({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const [name, setName] = useState(shop.name);
  const [description, setDescription] = useState(shop.description);
  const [currency, setCurrency] = useState(shop.currency);
  const [playersCanBuy, setPlayers] = useState(shop.playersCanBuy);
  // Items as text: "Name | price | qty" per line (qty blank = unlimited).
  const [items, setItems] = useState(
    shop.items.map((i) => `${i.name} | ${i.price} | ${i.qty < 0 ? '' : i.qty}`).join('\n'),
  );

  function save() {
    const parsed = items.split('\n').map((line) => {
      const [n, p, q] = line.split('|').map((s) => s.trim());
      if (!n) return null;
      return { name: n, price: Number(p) || 0, qty: q === '' || q === undefined ? -1 : Number(q) };
    }).filter(Boolean) as Array<{ name: string; price: number; qty: number }>;
    intents.updateShop(shop.id, { name: name.trim() || 'Shop', description, currency: currency.trim() || 'gp', playersCanBuy, items: parsed });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" style={{ width: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="dock-header"><h3>Edit shop</h3><button className="link" onClick={onClose}>close</button></div>
        <div className="row">
          <label style={{ flex: 1 }}>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ width: 80 }}>Currency<input value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
        </div>
        <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="check-row">
          <input type="checkbox" checked={playersCanBuy} onChange={(e) => setPlayers(e.target.checked)} />
          Players can buy from this shop
        </label>
        <label>
          Stock — one per line: <code>Name | price | qty</code> (blank qty = unlimited)
          <textarea rows={8} value={items} onChange={(e) => setItems(e.target.value)} placeholder={'Longsword | 15 | 3\nHealing Potion | 50 |\nRope (50 ft) | 1 | 10'} />
        </label>
        <div className="row">
          <button className="primary" style={{ width: 'auto' }} onClick={save}>Save</button>
          <button onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="link danger" onClick={() => { if (confirm(`Delete shop "${shop.name}"?`)) { intents.deleteShop(shop.id); onClose(); } }}>delete</button>
        </div>
      </div>
    </div>
  );
}

function BuyControls({ shop, itemIndex }: { shop: Shop; itemIndex: number }) {
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((s) => s.characters);
  const mine = characters.filter((c) => you && (you.role === 'dm' || c.ownerUserId === you.userId));
  const [charId, setCharId] = useState('');
  const target = charId || mine[0]?.id;
  if (mine.length === 0) return <span className="dim">no character</span>;
  return (
    <span className="buy-controls">
      {mine.length > 1 && (
        <select value={target} onChange={(e) => setCharId(e.target.value)}>
          {mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <button className="link" disabled={!target} onClick={() => target && intents.buyItem(shop.id, itemIndex, target)}>buy</button>
    </span>
  );
}

/** Shops for the World panel. DM manages; players buy. */
export function ShopsPanel() {
  const you = useGameStore((s) => s.you);
  const shops = useGameStore((s) => s.shopList);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shop | null>(null);
  const isDm = you?.role === 'dm';
  const openShop = shops.find((s) => s.id === open);

  return (
    <div className="dir-section">
      <div className="dock-header">
        <h3>Shops</h3>
        {isDm && <button className="link" onClick={() => intents.createShop('New shop')}>+ Add</button>}
      </div>

      {!openShop && (
        <ul className="shop-list">
          {shops.map((s) => (
            <li key={s.id}>
              <button className="char-name" onClick={() => setOpen(s.id)}>{s.name}</button>
              <span className="dim" style={{ fontSize: 11 }}>{s.items.length} items{isDm && !s.playersCanBuy ? ' · closed' : ''}</span>
            </li>
          ))}
          {shops.length === 0 && <p className="dim">{isDm ? 'No shops yet.' : 'No shops open.'}</p>}
        </ul>
      )}

      {openShop && (
        <div className="shop-detail">
          <div className="dock-header">
            <h4 style={{ margin: 0 }}>{openShop.name}</h4>
            <span className="spacer" />
            {isDm && <button className="link" onClick={() => setEditing(openShop)}>edit</button>}
            <button className="link" onClick={() => setOpen(null)}>back</button>
          </div>
          {openShop.description && <p className="dim" style={{ fontSize: 12 }}>{openShop.description}</p>}
          <table className="shop-table">
            <thead><tr><th>Item</th><th>{openShop.currency}</th><th>stock</th><th /></tr></thead>
            <tbody>
              {openShop.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}{it.notes ? <span className="dim"> · {it.notes}</span> : null}</td>
                  <td>{it.price}</td>
                  <td>{it.qty < 0 ? '∞' : it.qty}</td>
                  <td>{it.qty !== 0 && <BuyControls shop={openShop} itemIndex={i} />}</td>
                </tr>
              ))}
              {openShop.items.length === 0 && <tr><td colSpan={4} className="dim">Empty shelves.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ShopEditor shop={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
