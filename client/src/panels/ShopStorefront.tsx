import { useState } from 'react';
import { intents, useGameStore } from '../store/game';

/** Full-screen storefront the DM presents to players; they buy from it live. */
export function ShopStorefront() {
  const you = useGameStore((s) => s.you);
  const presentedShopId = useGameStore((s) => s.presentedShopId);
  const shops = useGameStore((s) => s.shopList);
  const characters = useGameStore((s) => s.characters);
  const [charId, setCharId] = useState('');

  // Only players see the pop-up; the DM gets a badge in the shop panel instead.
  if (!you || you.role !== 'player' || !presentedShopId) return null;
  const shop = shops.find((s) => s.id === presentedShopId);
  if (!shop) return null;

  const mine = characters.filter((c) => c.ownerUserId === you.userId);
  const target = charId || mine[0]?.id;
  const character = characters.find((c) => c.id === target);
  const currencyField = character?.system === 'swn' ? 'credits' : character?.system === 'swade' ? 'dollars' : 'gp';
  const purse = character ? Number((character.sheet as Record<string, unknown>)[currencyField]) || 0 : 0;

  return (
    <div className="sheet-backdrop">
      <div className="sheet-window storefront">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>🛒 {shop.name}</h3>
          <span className="spacer" />
          <button className="link" onClick={() => useGameStore.getState().closePresentedShop()}>close</button>
        </div>

        {shop.description && <p className="dim" style={{ padding: '0 16px' }}>{shop.description}</p>}

        <div className="storefront-buyer">
          {mine.length > 1 ? (
            <label>Buying as
              <select value={target} onChange={(e) => setCharId(e.target.value)}>
                {mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : (
            <span className="dim">Buying as <strong>{character?.name ?? '—'}</strong></span>
          )}
          <span className="purse">Your {currencyField}: <strong>{purse}</strong></span>
        </div>

        <div className="storefront-items">
          <table className="shop-table">
            <thead><tr><th>Item</th><th>{shop.currency}</th><th>stock</th><th /></tr></thead>
            <tbody>
              {shop.items.map((it, i) => {
                const soldOut = it.qty === 0;
                const tooPoor = purse < it.price;
                return (
                  <tr key={i} className={soldOut ? 'sold-out' : ''}>
                    <td>{it.name}{it.notes ? <span className="dim"> · {it.notes}</span> : null}</td>
                    <td>{it.price}</td>
                    <td>{it.qty < 0 ? '∞' : it.qty}</td>
                    <td>
                      {soldOut ? <span className="dim">sold out</span> : (
                        <button
                          className="link"
                          disabled={!target || tooPoor}
                          title={tooPoor ? `Not enough ${currencyField}` : `Buy for ${it.price} ${shop.currency}`}
                          onClick={() => target && intents.buyItem(shop.id, i, target)}
                        >
                          buy
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shop.items.length === 0 && <tr><td colSpan={4} className="dim">The shelves are bare.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
