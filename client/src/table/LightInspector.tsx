import { intents, useGameStore } from '../store/game';

/**
 * The one editor for a map light — reached by picking it with the light tool
 * or by clicking its row in the World pane. The World pane used to put up a
 * browser prompt() for the name and offer nothing else; the name lives here
 * now, alongside the properties it belongs with.
 */
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
        <span className="spacer" />
        <button className="link" onClick={() => useGameStore.getState().selectLight(null)}>close</button>
      </div>
      <div className="inspector-grid">
        <label>
          Name
          {/* Committed on blur/Enter, not per keystroke: the name rides its own
              socket message, and one per character typed would be a flood. The
              key re-seeds the field when a different light is picked. */}
          <input
            type="text"
            key={light.id}
            defaultValue={light.name ?? ''}
            placeholder="Light"
            maxLength={60}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== (light?.name ?? '')) intents.renameLight(light!.id, map!.id, next);
            }}
          />
        </label>
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
      {/* Deleting is a decision made here, with the light's properties in
          front of you — not from a ✕ beside its name in the World pane. */}
      <button
        className="link danger"
        onClick={() => {
          if (!confirm(`Delete "${light.name || 'Light'}"?`)) return;
          intents.deleteLight(map.id, light.id);
          useGameStore.getState().selectLight(null);
        }}
      >
        🗑 Delete light
      </button>
    </div>
  );
}
