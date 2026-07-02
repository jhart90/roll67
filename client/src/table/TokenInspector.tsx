import { useRef, useState } from 'react';
import { uploadFile } from '../api';
import { intents, useGameStore } from '../store/game';

/** DM-only floating panel for the selected token. */
export function TokenInspector() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const token = useGameStore((s) => (s.selectedTokenId ? s.tokens[s.selectedTokenId] : undefined));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!token || you?.role !== 'dm' || !campaign) return null;

  const vision = token.vision;

  async function onArt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await uploadFile(file, campaign.id, 'token');
      intents.updateToken(token.id, { artAssetId: assetId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="token-inspector">
      <div className="dock-header">
        <h3>{token.name}</h3>
        <button
          className="link danger"
          onClick={() => {
            if (confirm(`Remove token "${token.name}" from the map?`)) intents.deleteToken(token.id);
          }}
        >
          remove
        </button>
      </div>
      <div className="inspector-grid">
        <label>
          Name
          <input
            key={token.id}
            defaultValue={token.name}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== token.name) {
                intents.updateToken(token.id, { name: e.target.value.trim() });
              }
            }}
          />
        </label>
        <label>
          Layer
          <select
            value={token.layer}
            onChange={(e) => intents.updateToken(token.id, { layer: e.target.value })}
          >
            <option value="token">Token (players see it)</option>
            <option value="gm">GM only (hidden)</option>
          </select>
        </label>
        <label>
          Color
          <input
            type="color"
            value={token.color}
            onChange={(e) => intents.updateToken(token.id, { color: e.target.value })}
          />
        </label>
        <label>
          Size (hexes)
          <input
            type="number"
            min={1}
            max={4}
            value={token.size}
            onChange={(e) => intents.updateToken(token.id, { size: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label>
          Art
          <input ref={fileRef} type="file" accept="image/*" onChange={onArt} disabled={uploading} />
        </label>
        <label>
          HP
          <input
            type="number"
            value={token.bar?.hp ?? ''}
            placeholder="—"
            onChange={(e) => {
              const hp = Number(e.target.value);
              if (!Number.isNaN(hp)) {
                intents.updateToken(token.id, { bar: { hp, maxHp: token.bar?.maxHp ?? hp } });
              }
            }}
          />
        </label>
        <label>
          Max HP
          <input
            type="number"
            value={token.bar?.maxHp ?? ''}
            placeholder="—"
            onChange={(e) => {
              const maxHp = Number(e.target.value);
              if (!Number.isNaN(maxHp)) {
                intents.updateToken(token.id, { bar: { hp: token.bar?.hp ?? maxHp, maxHp } });
              }
            }}
          />
        </label>
      </div>

      <h4>Vision {token.characterId && !vision ? '(from character sheet)' : '(override)'}</h4>
      <div className="inspector-grid">
        <label>
          Range (hexes)
          <input
            type="number"
            min={0}
            value={vision?.visionRange ?? ''}
            placeholder="sheet"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) {
                intents.updateToken(token.id, {
                  vision: { visionRange: v, darkvision: vision?.darkvision ?? 0 },
                });
              }
            }}
          />
        </label>
        <label>
          Darkvision
          <input
            type="number"
            min={0}
            value={vision?.darkvision ?? ''}
            placeholder="sheet"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) {
                intents.updateToken(token.id, {
                  vision: { visionRange: vision?.visionRange ?? 24, darkvision: v },
                });
              }
            }}
          />
        </label>
        {vision && (
          <button className="link" onClick={() => intents.updateToken(token.id, { vision: null })}>
            clear override
          </button>
        )}
      </div>
    </div>
  );
}
