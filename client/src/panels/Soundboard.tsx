import { useRef, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

const PAGE_SIZE = 16; // 4x4 per page
const PAGE_COUNT = 3;

/**
 * DM soundboard: three toggleable pages, each a 4x4 grid of one-shot effects.
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
  // Which pad is one click away from being wiped, if any.
  const [arming, setArming] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Which square the pending file-picker will fill.
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const isDm = useGameStore((s) => s.isDm());

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
      useGameStore.getState().toast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dock-panel soundboard">

      <div className="soundboard-pages">
        {Array.from({ length: PAGE_COUNT }, (_, p) => {
          const used = slots.filter((s) => s.slotIndex >= p * PAGE_SIZE && s.slotIndex < (p + 1) * PAGE_SIZE).length;
          return (
            <button
              key={p}
              className={`btn btn-sm ${page === p ? 'primary' : ''}`}
              title={used ? `${used} pad${used === 1 ? '' : 's'} filled` : 'Empty page'}
              onClick={() => setPage(p)}
            >
              {p + 1}{used ? ` · ${used}` : ''}
            </button>
          );
        })}
      </div>

      <div className="soundboard-grid">
        {Array.from({ length: PAGE_SIZE }, (_, cell) => {
          const i = page * PAGE_SIZE + cell;
          const slot = byIndex.get(i);
          const armed = arming === i;
          return (
            <button
              key={i}
              className={`soundboard-pad ${slot ? 'filled' : 'empty'} ${armed ? 'armed' : ''}`}
              disabled={busy}
              title={armed ? 'Click again to clear this pad'
                : slot ? `Play "${slot.label}" for everyone — right-click to clear` : 'Click to upload a sound'}
              onClick={() => {
                // Armed: EITHER button finishes the job, so the second click
                // does not have to be the same one that started it.
                if (armed) { intents.clearSoundboardSlot(i); setArming(null); return; }
                if (slot) intents.playSfx(i); else pickFor(i);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!slot) return;
                // Arming is a state, not an action: a stray right-click used to
                // wipe a sound outright with nothing to catch it.
                setArming(armed ? null : i);
              }}
              onPointerLeave={armed ? () => setArming(null) : undefined}
            >
              {armed ? (
                <span className="soundboard-pad-confirm">
                  <span className="soundboard-pad-icon">✕</span>
                  <span className="soundboard-pad-label">Delete?</span>
                </span>
              ) : slot
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
        Click an empty pad to upload a short sound · click a pad to play it for everyone · right-click to clear it (asks first).
      </p>
    </div>
  );
}
