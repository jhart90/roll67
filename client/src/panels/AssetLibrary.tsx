import { useEffect, useRef, useState } from 'react';
import type { AssetInfo } from 'shared';
import { uploadFile } from '../api';
import { intents, useGameStore } from '../store/game';

/** DM art asset manager: upload, organize into folders, use as map bg / token. */
export function AssetLibrary({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  // Select the stable arrays and filter in render — a filtering selector
  // returns a fresh array each read and loops React into a crash.
  const allFolders = useGameStore((s) => s.assetFolders);
  const folders = allFolders.filter((f) => f.kind === 'art');
  const allAssets = useGameStore((s) => s.assetList);
  const map = useGameStore((s) => s.map);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { intents.requestAssets(); }, []);
  if (!campaign) return null;

  const assets = allAssets.filter((a) => (a.kind === 'map' || a.kind === 'token' || a.kind === 'handout') && (folderId === null ? true : a.folderId === folderId));

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !campaign) return;
    setUploading(true);
    try {
      for (const f of files) await uploadFile(f, campaign.id, 'token', { folderId });
      intents.requestAssets();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function useAsBackground(a: AssetInfo) {
    if (map) intents.updateMap(map.id, { bgAssetId: a.id });
  }

  function createTokenFromAsset(a: AssetInfo) {
    if (!map) return;
    const q = Math.floor(map.grid.cols / 2);
    const r = Math.floor(map.grid.rows / 2);
    intents.createToken({ mapId: map.id, name: a.title, q: q - (r - (r & 1)) / 2, r, artAssetId: a.id, layer: 'token' });
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>Asset Library</h3>
          <span className="dim">{assets.length} images</span>
          <span className="spacer" />
          <button className="link" onClick={onClose}>close</button>
        </div>

        <div className="asset-body">
          <div className="asset-folders">
            <button className={`asset-folder ${folderId === null ? 'active' : ''}`} onClick={() => setFolderId(null)}>All</button>
            {folders.map((f) => (
              <div key={f.id} className={`asset-folder-row ${folderId === f.id ? 'active' : ''}`}>
                <button className="asset-folder" onClick={() => setFolderId(f.id)}>{f.name}</button>
                <button className="link" title="Rename" onClick={() => { const n = prompt('Folder name', f.name); if (n) intents.renameFolder(f.id, n); }}>✎</button>
                <button className="link danger" title="Delete folder" onClick={() => { if (confirm(`Delete folder "${f.name}"? Its images become unfiled.`)) intents.deleteFolder(f.id); }}>✕</button>
              </div>
            ))}
            <button className="link" onClick={() => { const n = prompt('New folder name'); if (n) intents.createFolder(n, 'art'); }}>+ folder</button>
          </div>

          <div className="asset-main">
            <label className="asset-upload">
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={onUpload} disabled={uploading} />
              {uploading ? 'uploading…' : `Upload images${folderId ? ' to this folder' : ''}`}
            </label>
            <div className="asset-grid">
              {assets.map((a) => (
                <div key={a.id} className="asset-card">
                  <img src={a.url} alt={a.title} />
                  <div className="asset-title" title={a.title}>{a.title}</div>
                  <div className="asset-actions">
                    {map && <button className="link" onClick={() => useAsBackground(a)}>bg</button>}
                    {map && <button className="link" onClick={() => createTokenFromAsset(a)}>token</button>}
                    <select value={a.folderId ?? ''} onChange={(e) => intents.moveAsset(a.id, e.target.value || null)}>
                      <option value="">unfiled</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button className="link" onClick={() => { const t = prompt('Rename', a.title); if (t) intents.renameAsset(a.id, t); }}>✎</button>
                    <button className="link danger" onClick={() => { if (confirm(`Delete "${a.title}"?`)) intents.deleteAsset(a.id); }}>✕</button>
                  </div>
                </div>
              ))}
              {assets.length === 0 && <p className="dim">No images here yet — upload some.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
