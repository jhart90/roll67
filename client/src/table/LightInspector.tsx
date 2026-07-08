import { intents, useGameStore } from '../store/game';

/** Floating editor for the selected light (DM, light tool). */
export function LightInspector() {
  const map = useGameStore((s) => s.map);
  const isDm = useGameStore((s) => s.isDm());
  const light = useGameStore((s) =>
    s.selectedLightId ? s.dmGeometry?.lights.find((l) => l.id === s.selectedLightId) : undefined);

  if (!isDm || !map || !light) return null;

  function update(patch: Partial<{ brightRadius: number; dimRadius: number; color: string }>) {
    if (!light || !map) return;
    intents.upsertLight(map.id, { ...light, ...patch });
  }

  return (
    <div className="token-inspector">
      <div className="dock-header">
        <h3>Light</h3>
        <button
          className="link danger"
          onClick={() => {
            intents.deleteLight(map.id, light.id);
            useGameStore.getState().selectLight(null);
          }}
        >
          delete
        </button>
      </div>
      <div className="inspector-grid">
        <label>
          Bright radius (hexes)
          <input
            type="number"
            min={0}
            value={light.brightRadius}
            onChange={(e) => update({ brightRadius: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label>
          Dim radius (hexes)
          <input
            type="number"
            min={0}
            value={light.dimRadius}
            onChange={(e) => update({ dimRadius: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label>
          Color
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={light.color || '#ffffff'}
              onChange={(e) => update({ color: e.target.value })}
              style={{ width: 36, height: 28, border: 'none', padding: 0, cursor: 'pointer' }}
            />
            {light.color && (
              <button className="link" style={{ fontSize: 11 }} onClick={() => update({ color: undefined })}>
                reset to white
              </button>
            )}
          </div>
        </label>
      </div>
      <p className="dim" style={{ fontSize: 12 }}>
        Hexes lit by this light are visible to characters whose sight reaches them.
        {light.color ? ' Colored lights blend additively where they overlap.' : ''}
      </p>
    </div>
  );
}
