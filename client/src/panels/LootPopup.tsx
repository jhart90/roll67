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
        {obj.description && <p className="loot-desc">{obj.description}</p>}
        {obj.items.length === 0 ? (
          <p className="dim">This chest is empty.</p>
        ) : (
          <>
            <ul className="chest-items">
              {obj.items.map((item) => (
                <li key={item.id}>
                  <span className="chest-item-name">{item.name}</span>
                  {item.description && <span className="chest-item-desc">{item.description}</span>}
                  <button
                    className="small"
                    onClick={() => intents.takeChestItem(obj.id, item.id)}
                  >
                    Take
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
