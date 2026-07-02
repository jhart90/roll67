import { intents, useGameStore } from '../store/game';

/** Floating editor for the selected light (DM, light tool). */
export function LightInspector() {
  const map = useGameStore((s) => s.map);
  const isDm = useGameStore((s) => s.isDm());
  const light = useGameStore((s) =>
    s.selectedLightId ? s.dmGeometry?.lights.find((l) => l.id === s.selectedLightId) : undefined);

  if (!isDm || !map || !light) return null;

  function update(patch: Partial<{ brightRadius: number; dimRadius: number }>) {
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
      </div>
      <p className="dim" style={{ fontSize: 12 }}>
        Hexes lit by this light are visible to characters whose sight reaches them.
      </p>
    </div>
  );
}
