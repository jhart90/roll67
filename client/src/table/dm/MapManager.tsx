import { useRef, useState } from 'react';
import type { GridConfig } from 'shared';
import { uploadFile } from '../../api';
import { intents, useGameStore } from '../../store/game';

function GridField({
  label, value, onCommit, step = 1, min,
}: {
  label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="grid-field">
      {label}
      <input
        type="number"
        step={step}
        min={min}
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null && text !== '' && !Number.isNaN(Number(text))) onCommit(Number(text));
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function MapManager({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const mapsMeta = useGameStore((s) => s.mapsMeta);
  const map = useGameStore((s) => s.map);
  const [newName, setNewName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!campaign) return null;

  const grid = map?.grid;

  function setGrid(patch: Partial<GridConfig>) {
    if (map) intents.setGrid(map.id, patch);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !map || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await uploadFile(file, campaign.id, 'map');
      intents.updateMap(map.id, { bgAssetId: assetId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="dock-panel">
      <div className="dock-header">
        <h3>Maps</h3>
        <button className="link" onClick={onClose}>close</button>
      </div>

      <ul className="map-list">
        {mapsMeta.map((m) => (
          <li key={m.id} className={m.id === map?.id ? 'active' : ''}>
            <button className="map-row" onClick={() => intents.switchMap(m.id)}>
              {m.name}
              {m.id === map?.id && <span className="tag">active</span>}
            </button>
            <button
              className="link danger"
              title="Delete map"
              onClick={() => {
                if (confirm(`Delete map "${m.name}"? This removes its tokens and fog.`)) {
                  intents.deleteMap(m.id);
                }
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            intents.createMap(newName.trim());
            setNewName('');
          }
        }}
      >
        <input placeholder="New map name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit">Add</button>
      </form>

      {map && grid && (
        <>
          <div className="dock-header">
            <h3>Current map</h3>
          </div>
          <label>
            Name
            <input
              defaultValue={map.name}
              key={map.id}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== map.name) {
                  intents.updateMap(map.id, { name: e.target.value.trim() });
                }
              }}
            />
          </label>
          <label className="upload-label">
            Background image
            <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
            {uploading && <span className="dim">uploading…</span>}
          </label>

          <h4>Hex grid</h4>
          <div className="grid-fields">
            <GridField label="Hex size" value={grid.hexSize} onCommit={(v) => setGrid({ hexSize: v })} min={8} />
            <GridField label="Origin X" value={grid.originX} onCommit={(v) => setGrid({ originX: v })} />
            <GridField label="Origin Y" value={grid.originY} onCommit={(v) => setGrid({ originY: v })} />
            <GridField label="Columns" value={grid.cols} onCommit={(v) => setGrid({ cols: v })} min={1} />
            <GridField label="Rows" value={grid.rows} onCommit={(v) => setGrid({ rows: v })} min={1} />
            <GridField label="Feet per hex" value={grid.feetPerHex} onCommit={(v) => setGrid({ feetPerHex: v })} min={1} />
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={grid.globalIllumination}
              onChange={(e) => setGrid({ globalIllumination: e.target.checked })}
            />
            Global illumination (outdoor daylight)
          </label>
        </>
      )}
    </div>
  );
}
