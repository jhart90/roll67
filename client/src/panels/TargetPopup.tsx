import { hexDistance } from 'shared';
import { useGameStore } from '../store/game';

/**
 * Target picker for usable items (potions): "who is this used on?" Lists the
 * tokens within range on the current map; picking one fires the action.
 */
export function TargetPopup() {
  const targeting = useGameStore((s) => s.targeting);
  const tokens = useGameStore((s) => s.tokens);
  const map = useGameStore((s) => s.map);

  if (!targeting || targeting.action.source !== 'item' || !map) return null;
  const src = tokens[targeting.sourceTokenId];
  const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
  const rangeHexes = targeting.action.rangeFt <= 0 ? 0 : Math.max(1, Math.ceil(targeting.action.rangeFt / feetPerHex));
  const heal = targeting.action.effect === 'heal';

  const candidates = Object.values(tokens).filter(
    (t) => src && hexDistance({ q: src.q, r: src.r }, { q: t.q, r: t.r }) <= rangeHexes + (t.size >= 3 ? 1 : 0),
  );

  function cancel() { useGameStore.getState().cancelTargeting(); }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="panel target-popup">
        <div className="dock-header">
          <h3>{heal ? 'Use' : 'Throw'} {targeting.action.label}</h3>
          <button className="link" onClick={cancel}>cancel</button>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          {heal ? 'Heals' : 'Deals'} <strong>{targeting.action.amountExpr}</strong> — choose a target within {targeting.action.rangeFt} ft.
        </p>
        <ul className="target-list">
          {candidates.map((t) => (
            <li key={t.id}>
              <span className="target-name">{t.name}{t.id === src?.id ? ' (self)' : ''}</span>
              {t.bar && <span className="dim">{t.bar.hp}/{t.bar.maxHp} HP</span>}
              <span className="spacer" />
              <button className="btn btn-sm btn-accent" onClick={() => useGameStore.getState().resolveTarget(t.id)}>
                {heal ? 'Heal' : 'Use'}
              </button>
            </li>
          ))}
          {candidates.length === 0 && <li className="dim">No tokens in range — move closer.</li>}
        </ul>
      </div>
    </div>
  );
}
