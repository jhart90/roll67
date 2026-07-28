import { useRef, useState } from 'react';
import type { TokenShape } from 'shared';
import { useGameStore } from '../store/game';
import { useUploadProgress } from '../util/useUploadProgress';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { DiceColorPicker, DiceTextColorPicker, SwadeDicePalettePicker } from '../table/DiceRoller';
import { DieShape } from '../table/DiceShapes';
import { DEFAULT_DIE_COLORS, DICE_ROLE_DEFAULTS } from '../table/dice3d';
import { readableOn } from '../util/playerColor';

/** What the Customize Appearance step collects. Written into the new sheet as
 *  tokenColor / tokenShape / tokenSize / tokenImageAssetId, which
 *  placeCharacterToken reads when it drops the token. */
export interface AppearanceChoice {
  tokenColor: string | null;
  tokenShape: TokenShape;
  tokenSize: number;
  tokenImageAssetId: string | null;
  artPreviewUrl: string | null;
}

export const DEFAULT_APPEARANCE: AppearanceChoice = {
  tokenColor: null, tokenShape: 'circle', tokenSize: 1, tokenImageAssetId: null, artPreviewUrl: null,
};

/** Sheet fields for a finished choice — spread into the creator's sheetPatch. */
export function appearancePatch(a: AppearanceChoice): Record<string, unknown> {
  return {
    ...(a.tokenColor ? { tokenColor: a.tokenColor } : {}),
    ...(a.tokenShape !== 'circle' ? { tokenShape: a.tokenShape } : {}),
    ...(a.tokenSize !== 1 ? { tokenSize: a.tokenSize } : {}),
    ...(a.tokenImageAssetId ? { tokenImageAssetId: a.tokenImageAssetId } : {}),
  };
}

const SHAPES: Array<{ id: TokenShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'rect-v', label: 'Rectangle (vertical)' },
  { id: 'rect-h', label: 'Rectangle (horizontal)' },
  { id: 'original', label: 'Original (fit width)' },
  { id: 'original-alt', label: 'Original (fit height)' },
];

/**
 * Two d6 glyphs showing faces 1 and 6, live in the colours currently picked —
 * so the pickers below have an immediate "this is what the table will see".
 * In SWADE the pair is the trait die and the Wild Die; elsewhere both wear
 * the single custom colour.
 */
function DicePreview() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const isSwade = useGameStore((s) => s.campaign?.system) === 'swade';
  const me = you ? members.find((m) => m.userId === you.userId) : undefined;
  const pair = isSwade
    ? [
      { label: 'Trait', fill: me?.diceTraitColor ?? DICE_ROLE_DEFAULTS.trait, value: 1 },
      { label: 'Wild', fill: me?.diceWildColor ?? DICE_ROLE_DEFAULTS.wild, value: 6 },
    ]
    : [
      { label: '', fill: me?.diceColor ?? DEFAULT_DIE_COLORS[6], value: 1 },
      { label: '', fill: me?.diceColor ?? DEFAULT_DIE_COLORS[6], value: 6 },
    ];
  const text = !isSwade && me?.diceTextColor ? me.diceTextColor : undefined;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
      {pair.map((d, i) => (
        <div key={i} style={{ textAlign: 'center' }}>
          <DieShape sides={6} size={54} value={d.value} fill={d.fill} textFill={text ?? readableOn(d.fill)} />
          {d.label && <span className="dim" style={{ fontSize: 10 }}>{d.label}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The last step of every character creator: how your piece looks on the map,
 * and what your dice look like when you roll. Token choices ride the sheet;
 * dice choices are the same account-wide settings the dice panel edits.
 */
export function AppearanceStep({ value, onChange }: {
  value: AppearanceChoice;
  onChange: (next: AppearanceChoice) => void;
}) {
  const campaign = useGameStore((s) => s.campaign);
  const { progress, upload } = useUploadProgress();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const isSwade = campaign?.system === 'swade';

  async function onArt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaign) return;
    setUploading(true);
    try {
      const { assetId, url } = await upload(file, campaign.id, 'token', { title: file.name });
      onChange({ ...value, tokenImageAssetId: assetId, artPreviewUrl: url });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="stack">
      <h4>Your token</h4>
      <div className="inspector-grid">
        <label>
          Color
          <input
            type="color"
            value={value.tokenColor ?? '#6c9bd2'}
            onChange={(e) => onChange({ ...value, tokenColor: e.target.value })}
          />
        </label>
        <label>
          Shape
          <select
            value={value.tokenShape}
            onChange={(e) => onChange({ ...value, tokenShape: e.target.value as TokenShape })}
          >
            {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label>
          Size (hexes)
          <input
            type="number" min={1} max={4}
            value={value.tokenSize}
            onChange={(e) => onChange({ ...value, tokenSize: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })}
          />
        </label>
        <label>
          Token image
          <input ref={fileRef} type="file" accept="image/*" onChange={onArt} disabled={uploading} />
          <UploadProgressBar progress={progress} />
        </label>
      </div>
      {value.artPreviewUrl && (
        <img src={value.artPreviewUrl} alt="token art" style={{ maxWidth: 96, maxHeight: 96, borderRadius: 8 }} />
      )}
      {(value.tokenShape === 'original' || value.tokenShape === 'original-alt') && !value.tokenImageAssetId && (
        <p className="dim" style={{ fontSize: 11 }}>The Original shapes need an uploaded image; without one the token stays a circle.</p>
      )}

      <h4>Your dice</h4>
      <DicePreview />
      {isSwade ? <SwadeDicePalettePicker /> : (
        <>
          <DiceColorPicker />
          <DiceTextColorPicker />
        </>
      )}
      <p className="dim" style={{ fontSize: 11 }}>
        Dice colours apply to every roll you make; you can change them any time from the 🎲 panel.
      </p>
    </div>
  );
}
