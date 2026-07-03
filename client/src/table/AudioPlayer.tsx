import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/game';

/** Hidden audio element that plays the DM's synced jukebox state on every
 * client. Stays mounted for the whole session so music survives tab switches. */
export function AudioPlayer() {
  const audioState = useGameStore((s) => s.audioState);
  const tracks = useGameStore((s) => s.audioTracks);
  const clientMuted = useGameStore((s) => s.clientMuted);
  const ref = useRef<HTMLAudioElement>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const track = audioState.trackId ? tracks.find((t) => t.id === audioState.trackId) : undefined;

  // Load + play/pause when the track or playing state changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!track || !audioState.playing) {
      el.pause();
      return;
    }
    if (!el.src.endsWith(track.url)) el.src = track.url;
    el.loop = audioState.loop;
    const startAt = () => {
      const offset = (Date.now() - audioState.startedAt) / 1000;
      const dur = el.duration;
      if (Number.isFinite(dur) && dur > 0 && offset > 0) el.currentTime = audioState.loop ? offset % dur : Math.min(offset, dur);
      el.play().then(() => setNeedsUnlock(false)).catch(() => setNeedsUnlock(true));
    };
    if (el.readyState >= 1) startAt();
    else el.addEventListener('loadedmetadata', startAt, { once: true });
    return () => el.removeEventListener('loadedmetadata', startAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.url, audioState.playing, audioState.startedAt]);

  // Live volume / mute / loop updates.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = audioState.volume;
    el.muted = clientMuted;
    el.loop = audioState.loop;
  }, [audioState.volume, audioState.loop, clientMuted]);

  return (
    <>
      <audio ref={ref} />
      {needsUnlock && audioState.playing && (
        <button
          className="audio-unlock"
          onClick={() => ref.current?.play().then(() => setNeedsUnlock(false)).catch(() => undefined)}
        >
          🔊 Click to enable audio
        </button>
      )}
    </>
  );
}
