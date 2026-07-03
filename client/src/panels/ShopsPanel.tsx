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
          <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete shop "${shop.name}"?`)) { intents.deleteShop(shop.id); onClose(); } }}>Delete</button>
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
      <button className="btn btn-sm btn-accent" disabled={!target} onClick={() => target && intents.buyItem(shop.id, itemIndex, target)}>buy</button>
    </span>
  );
}

/** DM pane for one shop: click the name to edit; present controls inline. */
function ShopPane({ shop, onEdit }: { shop: Shop; onEdit: () => void }) {
  const members = useGameStore((s) => s.members);
  const presentedShopId = useGameStore((s) => s.presentedShopId);
  const players = members.filter((m) => m.role === 'player');
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const presenting = presentedShopId === shop.id;
  const count = shop.items.length;

  return (
    <div className={`shop-pane ${presenting ? 'presenting' : ''}`}>
      <button className="shop-pane-head" onClick={onEdit} title="Open the shop editor">
        <span className="shop-pane-name">{shop.name}</span>
        <span className="shop-pane-meta">
          {count} item{count === 1 ? '' : 's'}{!shop.playersCanBuy ? ' · closed to players' : ''}
        </span>
      </button>

      <div className="shop-pane-status">
        {presenting
          ? <span className="present-badge">● showing to players</span>
          : <span className="dim" style={{ fontSize: 11 }}>Not shown to players</span>}
      </div>

      <div className="shop-pane-actions">
        <button className="btn btn-sm" onClick={onEdit}>Edit</button>
        <button className="btn btn-sm" onClick={() => { intents.presentShop(shop.id, 'all'); setPicking(false); }}>Show to all</button>
        <button className="btn btn-sm" onClick={() => setPicking((v) => !v)}>Show to…</button>
        {presenting && <button className="btn btn-sm btn-danger" onClick={() => intents.dismissShop()}>Stop</button>}
      </div>

      {picking && (
        <div className="present-picker present-picker-inline" onPointerDown={(e) => e.stopPropagation()}>
          {players.length === 0 && <span className="dim">No players online.</span>}
          {players.map((p) => (
            <label key={p.userId} className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={selected.includes(p.userId)}
                onChange={(e) => setSelected((s) => e.target.checked ? [...s, p.userId] : s.filter((x) => x !== p.userId))}
              />
              {p.username}{!p.online && <span className="dim"> (offline)</span>}
            </label>
          ))}
          <button
            className="btn btn-sm btn-accent"
            disabled={selected.length === 0}
            onClick={() => { intents.presentShop(shop.id, selected); setPicking(false); }}
          >
            Show to {selected.length || 0}
          </button>
        </div>
      )}
    </div>
  );
}

/** Player-facing card: click to open the buy view. */
function PlayerShopCard({ shop, onOpen }: { shop: Shop; onOpen: () => void }) {
  const count = shop.items.length;
  return (
    <button className="shop-pane shop-pane-card" onClick={onOpen} title="Browse this shop">
      <span className="shop-pane-name">{shop.name}</span>
      <span className="shop-pane-meta">{count} item{count === 1 ? '' : 's'} · priced in {shop.currency}</span>
    </button>
  );
}

/** Buy view (players): the item table with purchase buttons. */
function ShopBuyView({ shop, onBack }: { shop: Shop; onBack: () => void }) {
  return (
    <div className="shop-detail">
      <div className="dock-header">
        <h4 style={{ margin: 0 }}>{shop.name}</h4>
        <span className="spacer" />
        <button className="link" onClick={onBack}>back</button>
      </div>
      {shop.description && <p className="dim" style={{ fontSize: 12 }}>{shop.description}</p>}
      <table className="shop-table">
        <thead><tr><th>Item</th><th>{shop.currency}</th><th>stock</th><th /></tr></thead>
        <tbody>
          {shop.items.map((it, i) => (
            <tr key={i} className={it.qty === 0 ? 'sold-out' : ''}>
              <td>{it.name}{it.notes ? <span className="dim"> · {it.notes}</span> : null}</td>
              <td>{it.price}</td>
              <td>{it.qty < 0 ? '∞' : it.qty}</td>
              <td>{it.qty !== 0 && <BuyControls shop={shop} itemIndex={i} />}</td>
            </tr>
          ))}
          {shop.items.length === 0 && <tr><td colSpan={4} className="dim">Empty shelves.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Shops for the World panel. DM manages via panes; players browse & buy. */
export function ShopsPanel() {
  const you = useGameStore((s) => s.you);
  const shops = useGameStore((s) => s.shopList);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shop | null>(null);
  const isDm = you?.role === 'dm';
  const detailShop = shops.find((s) => s.id === detail);

  return (
    <div className="dir-section">
      <div className="dock-header">
        <h3>Shops</h3>
        {isDm && <button className="link" onClick={() => intents.createShop('New shop')}>+ Add</button>}
      </div>

      {detailShop && !isDm ? (
        <ShopBuyView shop={detailShop} onBack={() => setDetail(null)} />
      ) : (
        <div className="shop-panes">
          {shops.map((s) => (
            isDm
              ? <ShopPane key={s.id} shop={s} onEdit={() => setEditing(s)} />
              : <PlayerShopCard key={s.id} shop={s} onOpen={() => setDetail(s.id)} />
          ))}
          {shops.length === 0 && <p className="dim">{isDm ? 'No shops yet — click + Add to open one.' : 'No shops open.'}</p>}
        </div>
      )}

      {editing && <ShopEditor shop={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
