import { useEffect, useRef, useState } from 'react';
import type { GridConfig } from 'shared';
import { intents, useGameStore } from '../../store/game';
import { openWindow } from '../../store/windowManager';
import { UploadProgressBar } from '../../util/UploadProgressBar';
import { useUploadProgress } from '../../util/useUploadProgress';
import { authHeaders } from '../../api';

function GridField({
  label, value, onCommit, step = 1, min, max,
}: {
  label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="grid-field">
      {label}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null && text !== '' && !Number.isNaN(Number(text))) {
            let v = Number(text);
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onCommit(v);
          }
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/**
 * A pop-up window to create a map (name only) or edit an existing map's name,
 * background, and hex grid. Editing operates on the currently-viewed map, so
 * the window views the target map first and waits for it to load.
 */
export function MapEditorWindow({ mapId, onClose }: { mapId: string | 'new' | 'new-scene'; onClose: () => void }) {
  // 'new-scene' is the same form, creating a fully-visible map instead.
  const creatingScene = mapId === 'new-scene';
  const creating = mapId === 'new' || creatingScene;
  const campaign = useGameStore((s) => s.campaign);
  const map = useGameStore((s) => s.map);
  const [newName, setNewName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tracing, setTracing] = useState(false);
  const { progress, upload } = useUploadProgress();
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the target map so its grid/details are available to edit.
  useEffect(() => {
    if (!creating && map?.id !== mapId) intents.viewMap(mapId);
  }, [mapId]);

  if (!campaign) return null;
  const loaded = !creating && map && map.id === mapId ? map : null;
  const grid = loaded?.grid;

  function setGrid(patch: Partial<GridConfig>) {
    if (loaded) intents.setGrid(loaded.id, patch);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !loaded || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await upload(file, campaign.id, 'map');
      intents.updateMap(loaded.id, { bgAssetId: assetId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
      <div className="panel levelup map-window">
        <div className="dock-header">
          <h3>{creatingScene ? 'New scene' : creating ? 'New map' : 'Edit map'}</h3>
        </div>

        {creating ? (
          <form
            className="stack"
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { intents.createMap(newName.trim(), creatingScene); onClose(); } }}
          >
            <label>
              Name
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={creatingScene ? 'e.g. The throne room' : 'e.g. Tavern interior'} autoFocus />
            </label>
            <p className="dim" style={{ fontSize: 12 }}>
              {creatingScene
                ? 'A scene is fully visible to every player — no fog. Stage it by keeping pieces on the GM layer and moving them across to fade them in.'
                : 'Create the map, then click its ✏️ to set a background and align the hex grid.'}
            </p>
            <div className="row">
              <button type="submit" className="primary" style={{ width: 'auto' }} disabled={!newName.trim()}>{creatingScene ? 'Create scene' : 'Create map'}</button>
              <button type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        ) : !loaded || !grid ? (
          <p className="dim" style={{ padding: 12 }}>Loading map…</p>
        ) : (
          <>
            <label>
              Name
              <input
                defaultValue={loaded.name}
                key={loaded.id}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== loaded.name) intents.updateMap(loaded.id, { name: e.target.value.trim() });
                }}
              />
            </label>
            <label className="upload-label">
              Background image
              <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
              {uploading && <span className="dim">uploading…</span>}
              <UploadProgressBar progress={progress} />
            </label>
            {loaded.bgUrl && <img className="handout-img" src={loaded.bgUrl} alt={loaded.name} />}
            {loaded.bgUrl && (
              <button
                className="btn"
                disabled={tracing}
                onClick={() => {
                  setTracing(true);
                  intents.autoTraceWalls(loaded.id);
                  setTimeout(() => setTracing(false), 8000);
                }}
              >
                {tracing ? 'Tracing…' : 'Auto-trace walls'}
              </button>
            )}

            <h4>Hex grid</h4>
            <label className="check-row">
              <input
                type="checkbox"
                checked={grid.gridEnabled}
                onChange={(e) => setGrid({ gridEnabled: e.target.checked })}
              />
              Show hex grid
            </label>
            {grid.gridEnabled && (
              <div className="grid-fields">
                <GridField label="Hex size" value={grid.hexSize} onCommit={(v) => setGrid({ hexSize: v })} min={8} />
                <GridField label="Feet per hex" value={grid.feetPerHex} onCommit={(v) => setGrid({ feetPerHex: v })} min={1} />
                <GridField label="Columns" value={grid.cols} onCommit={(v) => setGrid({ cols: v })} min={1} max={200} />
                <GridField label="Rows" value={grid.rows} onCommit={(v) => setGrid({ rows: v })} min={1} max={200} />
                <GridField label="Origin X" value={grid.originX} onCommit={(v) => setGrid({ originX: v })} />
                <GridField label="Origin Y" value={grid.originY} onCommit={(v) => setGrid({ originY: v })} />
              </div>
            )}
            {grid.gridEnabled && (
              <div className="row" style={{ alignItems: 'center', gap: 12 }}>
                <label className="lu-field" style={{ flex: '0 0 auto' }}>
                  Hex color
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(grid.gridColor ?? '') ? grid.gridColor : '#ffffff'}
                    onChange={(e) => setGrid({ gridColor: e.target.value })}
                  />
                </label>
                <label className="lu-field" style={{ flex: 1 }}>
                  Hex opacity ({Math.round((grid.gridOpacity ?? 0.16) * 100)}%)
                  <input
                    type="range" min={0} max={100}
                    value={Math.round((grid.gridOpacity ?? 0.16) * 100)}
                    onChange={(e) => setGrid({ gridOpacity: Number(e.target.value) / 100 })}
                  />
                </label>
              </div>
            )}
            <label className="lu-field">
              Lighting
              <select value={grid.lighting} onChange={(e) => setGrid({ lighting: e.target.value as GridConfig['lighting'] })}>
                <option value="dark">Dark</option>
                <option value="dim">Dim</option>
                <option value="light">Light</option>
              </select>
            </label>
          </>
        )}
      </div>
  );
}

/**
 * Download a map as a .r67 pack. Goes through fetch rather than a plain link
 * because the endpoint is bearer-authenticated — a bare href would arrive
 * without the token and bounce.
 */
async function exportMap(mapId: string, name: string): Promise<void> {
  try {
    const res = await fetch(`/api/maps/${mapId}/export`, { headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Export failed');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'map'}.r67`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Export failed');
  }
}

export function MapManager({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const mapsMeta = useGameStore((s) => s.mapsMeta);
  const map = useGameStore((s) => s.map);
  const activeMapId = campaign?.activeMapId ?? null;
  const [importing, setImporting] = useState(false);

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so re-picking the same file still fires
    if (!file || !campaign) return;
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('campaignId', campaign.id);
      const res = await fetch('/api/maps/import', { method: 'POST', headers: authHeaders(), body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      // The map list is pushed over the socket, so it refreshes on its own.
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  if (!campaign) return null;

  return (
    <div className="dock-panel">
      <div className="dock-header">
        <h3>Maps</h3>
        <button className="link" onClick={onClose}>close</button>
      </div>

      <ul className="map-list">
        {mapsMeta.map((m) => (
          <li key={m.id} className={m.id === map?.id ? 'active' : ''}>
            <button
              className="map-row"
              title="View/edit this map (players stay where they are)"
              onClick={() => intents.viewMap(m.id)}
            >
              {m.name}
              {m.isScene && <span className="dim" style={{ fontSize: 10, marginLeft: 6 }} title="Scene — fully visible to all players">🎬</span>}
              <span className="map-badges">
                {m.id === activeMapId && <span className="tag party-tag">party</span>}
                {m.id === map?.id && <span className="tag">viewing</span>}
              </span>
            </button>
            <button
              className="link"
              title="Edit this map's name, background, and grid"
              onClick={() => openWindow('mapEditor', m.id, {}, m.name || 'Edit map')}
            >
              ✏️
            </button>
            {m.id !== activeMapId && (
              <button
                className="link"
                title="Make this the party map — players without a personal assignment move here"
                onClick={() => intents.switchMap(m.id)}
              >
                ⭐
              </button>
            )}
            <button
              className="link"
              title="Export as a .r67 pack — image, grid and geometry only"
              onClick={() => exportMap(m.id, m.name)}
            >
              ⭳
            </button>
            <button
              className="link danger"
              title="Delete map"
              onClick={() => {
                if (confirm(`Delete map "${m.name}"? This removes its tokens and fog.`)) intents.deleteMap(m.id);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <p className="dim" style={{ fontSize: 11, margin: '0 0 10px' }}>
        Click a map to view it · ✏️ edits its details · ⭐ makes it the party map for players.
      </p>

      <div className="map-actions">
        <button className="btn" onClick={() => openWindow('mapEditor', 'new', {}, 'New map')}>+ New map</button>
        <button
          className="btn"
          title="A scene is fully visible to every player — no fog. Stage it by moving pieces off the GM layer."
          onClick={() => openWindow('mapEditor', 'new-scene', {}, 'New scene')}
        >
          + New scene
        </button>
        <label className="btn" title="Import a .r67 map pack from another campaign">
          {importing ? 'importing…' : '⭱ Import .r67'}
          <input type="file" accept=".r67,application/json" style={{ display: 'none' }} disabled={importing} onChange={onImport} />
        </label>
      </div>
    </div>
  );
}
