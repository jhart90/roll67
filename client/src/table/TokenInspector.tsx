import { useRef, useState } from 'react';
import type { TokenShape } from 'shared';
import { num, systemFor } from 'shared';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

const SHAPES: Array<{ id: TokenShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'rect-v', label: 'Rectangle (vertical)' },
  { id: 'rect-h', label: 'Rectangle (horizontal)' },
];

/** DM-only floating panel for a token — opened by right-clicking it. */
export function TokenInspector() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const members = useGameStore((s) => s.members);
  const token = useGameStore((s) => (s.inspectorTokenId ? s.tokens[s.inspectorTokenId] : undefined));
  const character = useGameStore((s) => s.characters.find((c) => c.id === token?.characterId));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { progress, upload } = useUploadProgress();

  if (!token || you?.role !== 'dm' || !campaign) return null;

  const vision = token.vision;
  // A token linked to a character reads/writes its vision straight from the
  // sheet; unlinked NPC tokens keep a per-token override instead.
  const sheetVision = character ? systemFor(character.system).vision(character.sheet) : null;

  async function onArt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token || !campaign) return;
    setUploading(true);
    try {
      const { assetId } = await upload(file, campaign.id, 'token');
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
        <span className="spacer" />
        <button
          className="link danger"
          onClick={() => {
            if (confirm(`Remove token "${token.name}" from the map?`)) intents.deleteToken(token.id);
          }}
        >
          remove
        </button>
        <button className="link" onClick={() => useGameStore.getState().openInspector(null)}>close</button>
      </div>
      <div className="inspector-grid">
        <label>
          Name
          <input
            key={`${token.id}-${token.name}`}
            defaultValue={token.name}
            onBlur={(e) => {
              const trimmed = e.target.value.trim();
              if (trimmed && trimmed !== token.name) {
                intents.updateToken(token.id, { name: trimmed });
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
        {character && (
          <label>
            Controlled by
            <select
              value={character.ownerUserId ?? ''}
              onChange={(e) => intents.setCharacterOwner(character.id, e.target.value || null)}
            >
              <option value="">DM only (NPC)</option>
              {members.filter((m) => m.role === 'player').map((m) => (
                <option key={m.userId} value={m.userId}>{m.username}</option>
              ))}
            </select>
          </label>
        )}
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
          Shape
          <select
            value={token.shape ?? 'circle'}
            onChange={(e) => intents.updateToken(token.id, { shape: e.target.value as TokenShape })}
          >
            {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label>
          Art
          <input ref={fileRef} type="file" accept="image/*" onChange={onArt} disabled={uploading} />
          <UploadProgressBar progress={progress} />
        </label>
      </div>

      <h4>Health {character ? '(from character sheet)' : ''}</h4>
      <div className="inspector-grid">
        <label>
          HP
          <input
            type="number"
            value={character ? num(character.sheet, 'hp', 0) : token.bar?.hp ?? ''}
            placeholder="—"
            onChange={(e) => {
              const hp = Number(e.target.value);
              if (Number.isNaN(hp)) return;
              // Linked to a character: the sheet is authoritative — write it
              // there (the server mirrors sheet HP back onto every token bar),
              // so the sheet and this panel can never drift apart.
              if (character) intents.updateCharacter(character.id, { hp });
              else intents.updateToken(token.id, { bar: { hp, maxHp: token.bar?.maxHp ?? hp } });
            }}
          />
        </label>
        <label>
          Max HP
          <input
            type="number"
            value={character ? num(character.sheet, 'maxHp', 0) : token.bar?.maxHp ?? ''}
            placeholder="—"
            onChange={(e) => {
              const maxHp = Number(e.target.value);
              if (Number.isNaN(maxHp)) return;
              if (character) intents.updateCharacter(character.id, { maxHp });
              else intents.updateToken(token.id, { bar: { hp: token.bar?.hp ?? maxHp, maxHp } });
            }}
          />
        </label>
        {character && (
          <span className="dim" style={{ fontSize: 11, gridColumn: '1 / -1' }}>
            Editing {character.name}&rsquo;s sheet.
          </span>
        )}
      </div>

      <h4>Vision {sheetVision ? '(from character sheet)' : '(override)'}</h4>
      {sheetVision ? (
        // Linked to a character: edit the sheet's own vision fields so the two
        // stay in sync (the sheet is authoritative for a PC/NPC token).
        <div className="inspector-grid">
          <label>
            Range (hexes)
            <input
              type="number"
              min={0}
              value={sheetVision.visionRange}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (character && !Number.isNaN(v)) intents.updateCharacter(character.id, { visionRange: v });
              }}
            />
          </label>
          <label>
            Darkvision
            <input
              type="number"
              min={0}
              value={sheetVision.darkvision}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (character && !Number.isNaN(v)) intents.updateCharacter(character.id, { darkvision: v });
              }}
            />
          </label>
          <span className="dim" style={{ fontSize: 11, gridColumn: '1 / -1' }}>
            Editing {character?.name}&rsquo;s sheet.
          </span>
        </div>
      ) : (
        <div className="inspector-grid">
          <label>
            Range (hexes)
            <input
              type="number"
              min={0}
              value={vision?.visionRange ?? ''}
              placeholder="24"
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
              placeholder="0"
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
        </div>
      )}

      <h4>Light source {token.light ? '(on)' : '(off)'}</h4>
      <div className="inspector-grid">
        <label>
          Bright (hexes)
          <input
            type="number"
            min={0}
            value={token.light?.bright ?? ''}
            placeholder="0"
            onChange={(e) => {
              const bright = Math.max(0, Number(e.target.value) || 0);
              const dim = Math.max(bright, token.light?.dim ?? 0);
              intents.updateToken(token.id, { light: bright <= 0 && dim <= 0 ? null : { bright, dim } });
            }}
          />
        </label>
        <label>
          Dim (hexes)
          <input
            type="number"
            min={0}
            value={token.light?.dim ?? ''}
            placeholder="0"
            onChange={(e) => {
              const dim = Math.max(0, Number(e.target.value) || 0);
              const bright = token.light?.bright ?? 0;
              intents.updateToken(token.id, { light: bright <= 0 && dim <= 0 ? null : { bright, dim } });
            }}
          />
        </label>
        {token.light && (
          <button className="link" onClick={() => intents.updateToken(token.id, { light: null })}>
            turn off light
          </button>
        )}
      </div>
    </div>
  );
}
