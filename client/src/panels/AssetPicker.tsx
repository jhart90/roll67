import { useEffect, useRef, useState } from 'react';
import type { AssetInfo } from 'shared';
import { uploadFile } from '../api';
import { intents, useGameStore } from '../store/game';

/**
 * In-game image picker: browse the campaign's uploaded art, or upload a new
 * image from the computer (auto-selected on upload). Used to set a character's
 * token/detail image, and reusable anywhere an image is chosen.
 */
export function AssetPicker({ title = 'Choose an image', onPick, onClose }: {
  title?: string;
  onPick: (asset: AssetInfo) => void;
  onClose: () => void;
}) {
  const campaign = useGameStore((s) => s.campaign);
  const assets = useGameStore((s) => s.assetList).filter((a) => a.kind === 'token' || a.kind === 'map' || a.kind === 'handout');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { intents.requestAssets(); }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaign) return;
    setUploading(true);
    setError(null);
    try {
      const up = await uploadFile(file, campaign.id, 'token');
      intents.requestAssets();
      // Auto-select the freshly uploaded image.
      onPick({ id: up.assetId, kind: 'token', url: up.url, title: file.name, folderId: null, width: up.width, height: up.height, mime: file.type });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel asset-picker">
        <div className="dock-header"><h3>{title}</h3><button className="link" onClick={onClose}>close</button></div>
        <div className="asset-picker-top">
          <label className="btn btn-accent asset-upload-btn">
            {uploading ? 'Uploading…' : '⭱ Upload from computer'}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onUpload} />
          </label>
          <span className="dim" style={{ fontSize: 12 }}>or pick from the asset library:</span>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="asset-picker-grid">
          {assets.map((a) => (
            <button key={a.id} className="asset-pick" title={a.title} onClick={() => onPick(a)}>
              <img src={a.url} alt={a.title} />
              <span className="asset-pick-name">{a.title}</span>
            </button>
          ))}
          {assets.length === 0 && !uploading && <p className="dim">No images yet — upload one above.</p>}
        </div>
      </div>
    </div>
  );
}
