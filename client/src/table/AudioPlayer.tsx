import { useEffect, useRef, useState } from 'react';
import { intents, useGameStore } from '../store/game';

/** Hidden audio element that plays the DM's synced jukebox state on every
 * client. Stays mounted for the whole session so music survives tab switches. */
export function AudioPlayer() {
  const audioState = useGameStore((s) => s.audioState);
  const tracks = useGameStore((s) => s.audioTracks);
  const clientMuted = useGameStore((s) => s.clientMuted);
  const localMusicVolume = useGameStore((s) => s.localMusicVolume);
  const ref = useRef<HTMLAudioElement>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const track = audioState.trackId ? tracks.find((t) => t.id === audioState.trackId) : undefined;

  /**
   * Advance the playlist when a track finishes.
   *
   * Only the DM drives this — audio state is theirs to set and everyone else
   * follows the broadcast, so having each client emit "next" would fire once
   * per person at the table. Shuffle picks any OTHER track on the playlist (a
   * one-track playlist repeats rather than deadlocking); in order, loop decides
   * whether the end wraps or falls silent.
   */
  const isDm = useGameStore((s) => s.isDm());
  function onEnded() {
    if (!isDm || !track) return;
    const list = tracks.filter((t) => (t.playlist ?? 0) === (track.playlist ?? 0));
    if (list.length === 0) return;
    // Repeat-one wins over everything: it is the setting that says "do not
    // move on", so neither shuffle nor the end of the playlist gets a say.
    if (audioState.loop && audioState.loopOne) {
      intents.audioControl({ trackId: track.id, action: 'play' });
      return;
    }
    const i = list.findIndex((t) => t.id === track.id);
    let next: typeof track | undefined;
    if (audioState.shuffle) {
      const others = list.filter((t) => t.id !== track.id);
      const pool = others.length ? others : list;
      next = pool[Math.floor(Math.random() * pool.length)];
    } else if (i >= 0 && i < list.length - 1) {
      next = list[i + 1];
    } else if (audioState.loop) {
      next = list[0];
    }
    if (next) intents.audioControl({ trackId: next.id, action: 'play' });
    else intents.audioControl({ action: 'stop' });
  }


  // Load + play/pause when the track or playing state changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!track || !audioState.playing) {
      el.pause();
      return;
    }
    if (!el.src.endsWith(track.url)) el.src = track.url;
    // Never el.loop: that repeats ONE track and suppresses `ended`, which is
    // the event the playlist advances on. Looping is handled at the playlist
    // level in onEnded below.
    el.loop = false;
    const startAt = () => {
      const offset = (Date.now() - audioState.startedAt) / 1000;
      const dur = el.duration;
      if (Number.isFinite(dur) && dur > 0 && offset > 0) el.currentTime = Math.min(offset, dur);
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
    // The DM's campaign-wide volume scaled by this device's own music slider.
    el.volume = audioState.volume * localMusicVolume;
    el.muted = clientMuted;
  }, [audioState.volume, clientMuted, localMusicVolume]);

  return (
    <>
      <audio ref={ref} onEnded={onEnded} />
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
