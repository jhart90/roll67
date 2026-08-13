import { useRef, useState } from 'react';
import type { TokenShape } from 'shared';
import { hexDistance, num, systemFor } from 'shared';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';
import { ConfirmButton } from '../util/ConfirmButton';

const SHAPES: Array<{ id: TokenShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'rect-v', label: 'Rectangle (vertical)' },
  { id: 'rect-h', label: 'Rectangle (horizontal)' },
  // The uploaded art at its own aspect ratio — scaled to one hex wide / tall.
  { id: 'original', label: 'Original (fit width)' },
  { id: 'original-alt', label: 'Original (fit height)' },
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

  const isDm = useGameStore((s) => s.isDm());

  const tokenMap = useGameStore((s) => s.tokens);
  if (!token || !you || !campaign) return null;
  // A player gets this panel only for a token they control, and only to
  // recolour it — the server enforces the same limit, this just avoids
  // showing controls that would be rejected.
  const mine = !!character && character.ownerUserId === you.userId;
  if (!isDm && !mine) return null;

  if (!isDm) {
    return (
      <div className="token-inspector">
        <div className="dock-header">
          <h3>{token.name}</h3>
          <button className="link" onClick={() => useGameStore.getState().openInspector(null)}>close</button>
        </div>
        <label>
          Color
          <input
            type="color"
            value={token.color}
            onChange={(e) => intents.updateToken(token.id, { color: e.target.value })}
          />
        </label>
      </div>
    );
  }

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
      useGameStore.getState().toast(err instanceof Error ? err.message : 'Upload failed');
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
        <ConfirmButton
          title={`Remove token "${token.name}" from the map`}
          confirmLabel="really remove?"
          onConfirm={() => intents.deleteToken(token.id)}
        >
          remove
        </ConfirmButton>
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
            step={0.5}
            value={token.size}
            onChange={(e) => intents.updateToken(token.id, { size: Math.max(1, Math.round((Number(e.target.value) || 1) * 2) / 2) })}
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

      {character && character.system === 'swade' ? (
        // SWADE has no hit points — the sheet tracks Wounds (Wild Cards carry
        // 3, Extras 1). Write straight to the sheet; the server mirrors the
        // remaining wound slots onto the token bar.
        <>
          <h4>Wounds (from character sheet)</h4>
          <div className="inspector-grid">
            <label>
              Wounds
              <input
                type="number"
                min={0}
                max={character.sheet.wildCard !== false ? 3 : 1}
                value={num(character.sheet, 'wounds', 0)}
                onChange={(e) => {
                  const max = character.sheet.wildCard !== false ? 3 : 1;
                  const wounds = Math.max(0, Math.min(max, Number(e.target.value) || 0));
                  intents.updateCharacter(character.id, { wounds });
                }}
              />
            </label>
            <label>
              Max wounds
              <input type="number" value={character.sheet.wildCard !== false ? 3 : 1} disabled />
            </label>
            <span className="dim" style={{ fontSize: 11, gridColumn: '1 / -1' }}>
              Wild Cards take 3 Wounds, Extras 1. Editing {character.name}&rsquo;s sheet.
            </span>
          </div>
        </>
      ) : (
        <>
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
        {/* Getting on and off. Offered here rather than as a drag gesture: a
            drag that sometimes means "move" and sometimes means "mount" is a
            drag nobody trusts. */}
        {(() => {
          const others = Object.values(tokenMap).filter((t) => t.id !== token.id);
          const carrier = token.mountedOn ? others.find((t) => t.id === token.mountedOn) : null;
          if (carrier) {
            return (
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="link" onClick={() => intents.mountToken(token.id, null)}>
                  🐎 Dismount from {carrier.name}
                </button>
              </div>
            );
          }
          // Only mounts the DM has marked, on this map, not already carrying
          // somebody, and standing within reach.
          const rideable = others.filter((t) => t.mountable
            && !others.some((o) => o.mountedOn === t.id)
            && hexDistance({ q: t.q, r: t.r }, { q: token.q, r: token.r }) <= 1);
          if (rideable.length === 0) return null;
          return (
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {rideable.map((m) => (
                <button key={m.id} className="link" onClick={() => intents.mountToken(token.id, m.id)}>
                  🐎 Mount {m.name}
                </button>
              ))}
            </div>
          );
        })()}
        {/* Nothing is rideable until the DM says so — otherwise every crate,
            corpse and campfire on the map is a horse. */}
        <label className="checkbox" style={{ gridColumn: '1 / -1' }}>
          <input
            type="checkbox"
            checked={token.mountable === true}
            onChange={(e) => intents.updateToken(token.id, { mountable: e.target.checked })}
          />
          <span>
            Can be ridden
            <span className="dim"> — riders share its hex and move with it</span>
          </span>
        </label>
        {token.mountable === true && (
          <label>
            Max riders
            <input
              type="number"
              min={1}
              value={token.maxRiders ?? 1}
              onChange={(e) => {
                const maxRiders = Math.max(1, Number(e.target.value) || 1);
                intents.updateToken(token.id, { maxRiders });
              }}
            />
          </label>
        )}
        {/* Who has the wheel. A boat with six aboard still owes one Parry and
            one control roll, and they come off this rider. */}
        {token.mountable === true && (() => {
          const riders = Object.values(tokenMap).filter((t) => t.mountedOn === token.id);
          if (riders.length === 0) return null;
          return (
            <label>
              Driver
              <select
                value={token.driverTokenId && riders.some((r) => r.id === token.driverTokenId) ? token.driverTokenId : ''}
                onChange={(e) => intents.updateToken(token.id, { driverTokenId: e.target.value || null })}
              >
                <option value="">{riders[0].name} (first aboard)</option>
                {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          );
        })()}
      </div>
        </>
      )}

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
          <>
            <button className="link" onClick={() => intents.updateToken(token.id, { light: null })}>
              turn off light
            </button>
            {/* Not the same as turning it off: this puts the light down where
                the token is standing and leaves it burning there, which is what
                you want for a dropped torch or a lantern set on a table. */}
            <button
              className="link"
              title="Leave the light behind on the map at this token's position"
              onClick={() => intents.unlinkLightFromToken(token.id, token.mapId)}
            >
              set it down here
            </button>
          </>
        )}
      </div>
    </div>
  );
}
