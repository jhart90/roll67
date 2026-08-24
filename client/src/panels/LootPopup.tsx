import { intents, useGameStore } from '../store/game';

export function LootPopup() {
  const obj = useGameStore((s) => (s.lootPopupId ? s.mapObjects[s.lootPopupId] : null));

  if (!obj) return null;

  function close() { useGameStore.setState({ lootPopupId: null }); }

  if (obj.kind === 'item') {
    return (
      <div className="loot-popup-backdrop" onClick={close}>
        <div className="loot-popup" onClick={(e) => e.stopPropagation()}>
          <h3>{obj.name}</h3>
          {obj.detailUrl && <img className="detail-brief" src={obj.detailUrl} alt="" />}
          {obj.description && <p className="loot-desc">{obj.description}</p>}
          <div className="loot-actions">
            <button onClick={() => { intents.takeMapItem(obj.id); close(); }}>Take</button>
            <button className="secondary" onClick={close}>Leave</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="loot-popup-backdrop" onClick={close}>
      <div className="loot-popup chest-popup" onClick={(e) => e.stopPropagation()}>
        <h3>{obj.name}</h3>
        {/* The DM's briefing, read before the contents: what this thing looks
            like, or what is written on it. */}
        {obj.detailUrl && <img className="detail-brief" src={obj.detailUrl} alt="" />}
        {obj.description && <p className="loot-desc">{obj.description}</p>}
        {obj.items.length === 0 ? (
          <p className="dim">This chest is empty.</p>
        ) : (
          <>
            <ul className="chest-items">
              {obj.items.map((item) => (
                <li key={item.id}>
                  {/* How many are in the pile. Without this a stack of fifteen
                      looked exactly like a single sheet, so Take appeared to do
                      nothing and Take All appeared to invent things. */}
                  <span className="chest-item-name">
                    {item.name}
                    {(item.qty ?? 1) > 1 && <b className="chest-item-qty">&times;{item.qty}</b>}
                  </span>
                  {item.description && <span className="chest-item-desc">{item.description}</span>}
                  <button
                    className="small"
                    title={(item.qty ?? 1) > 1 ? 'Take one of these — Take All empties the chest' : undefined}
                    onClick={() => intents.takeChestItem(obj.id, item.id)}
                  >
                    {(item.qty ?? 1) > 1 ? 'Take one' : 'Take'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="loot-actions">
              <button onClick={() => { intents.takeAllChest(obj.id); close(); }}>Take All</button>
              <button className="secondary" onClick={close}>Close</button>
            </div>
          </>
        )}
        {obj.items.length === 0 && (
          <div className="loot-actions">
            <button className="secondary" onClick={close}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
