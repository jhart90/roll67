import { useRef, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

const SLOT_COUNT = 16; // 4x4

/**
 * DM soundboard: a fixed 4x4 grid of one-shot effects.
 *
 * Click an empty square to upload a sound into it, click a filled one to fire
 * it to the whole table, right-click to clear it. Effects ride their own event
 * rather than the jukebox's playback state, so firing one never interrupts the
 * music that is already playing.
 */
export function Soundboard() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const slots = useGameStore((s) => s.soundboardSlots);
  const { progress, upload } = useUploadProgress();
  const fileRef = useRef<HTMLInputElement>(null);
  // Which square the pending file-picker will fill.
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const isDm = you?.role === 'dm';

  if (!campaign) return null;
  if (!isDm) {
    return (
      <div className="dock-panel">
        <p className="dim" style={{ fontSize: 12 }}>The soundboard is a DM tool.</p>
      </div>
    );
  }

  const byIndex = new Map(slots.map((s) => [s.slotIndex, s]));

  function pickFor(slotIndex: number) {
    setTarget(slotIndex);
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const slotIndex = target;
    // Reset immediately so picking the same file twice still fires a change.
    if (fileRef.current) fileRef.current.value = '';
    setTarget(null);
    if (!file || slotIndex === null || !campaign) return;
    setBusy(true);
    try {
      const label = file.name.replace(/\.[^.]+$/, '');
      const { assetId } = await upload(file, campaign.id, 'audio', { title: file.name });
      intents.setSoundboardSlot(slotIndex, assetId, label);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dock-panel soundboard">

      <div className="soundboard-grid">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const slot = byIndex.get(i);
          return (
            <button
              key={i}
              className={`soundboard-pad ${slot ? 'filled' : 'empty'}`}
              disabled={busy}
              title={slot ? `Play "${slot.label}" for everyone — right-click to clear` : 'Click to upload a sound'}
              onClick={() => (slot ? intents.playSfx(i) : pickFor(i))}
              onContextMenu={(e) => {
                e.preventDefault();
                if (slot) intents.clearSoundboardSlot(i);
              }}
            >
              {slot
                ? <><span className="soundboard-pad-icon">▶</span><span className="soundboard-pad-label">{slot.label}</span></>
                : <span className="soundboard-pad-icon dim">+</span>}
            </button>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      <UploadProgressBar progress={progress} />
      <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Click an empty pad to upload a short sound · click a pad to play it for everyone · right-click to clear it.
      </p>
    </div>
  );
}
