import { useEffect, useRef, useState } from 'react';
import { uploadFile } from '../api';
import { intents, useGameStore } from '../store/game';

/** DM jukebox controls; players see now-playing + a local mute. */
export function Jukebox({ onClose }: { onClose: () => void }) {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const tracks = useGameStore((s) => s.audioTracks);
  const state = useGameStore((s) => s.audioState);
  const assets = useGameStore((s) => s.assetList);
  const clientMuted = useGameStore((s) => s.clientMuted);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isDm = you?.role === 'dm';

  useEffect(() => { if (isDm) intents.requestAssets(); }, [isDm]);
  if (!campaign) return null;

  const audioAssets = assets.filter((a) => a.kind === 'audio');
  const nowPlaying = state.trackId ? tracks.find((t) => t.id === state.trackId) : undefined;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !campaign) return;
    setUploading(true);
    try {
      for (const f of files) {
        const { assetId } = await uploadFile(f, campaign.id, 'audio', { title: f.name });
        intents.addAudio(assetId, f.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="dock-panel jukebox">
      <div className="dock-header">
        <h3>Jukebox</h3>
        <button className="link" onClick={onClose}>close</button>
      </div>

      <div className="now-playing">
        <span className="dim">Now playing</span>
        <strong>{state.playing && nowPlaying ? nowPlaying.title : 'Nothing'}</strong>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={clientMuted} onChange={(e) => useGameStore.getState().setClientMuted(e.target.checked)} />
        Mute on my device
      </label>

      {isDm && (
        <>
          <div className="jukebox-master">
            <span className="dim">Volume</span>
            <input
              type="range" min={0} max={1} step={0.05} value={state.volume}
              onChange={(e) => intents.audioControl({ action: state.playing ? 'play' : 'pause', volume: Number(e.target.value) })}
            />
            <label className="loop-toggle">
              <input type="checkbox" checked={state.loop} onChange={(e) => intents.audioControl({ action: state.playing ? 'play' : 'pause', loop: e.target.checked })} />
              loop
            </label>
            <button onClick={() => intents.audioControl({ action: 'stop' })}>■ stop all</button>
          </div>

          <ul className="track-list">
            {tracks.map((t) => {
              const active = state.trackId === t.id && state.playing;
              return (
                <li key={t.id} className={active ? 'active' : ''}>
                  <button className="track-play" onClick={() => intents.audioControl({ trackId: t.id, action: 'play' })}>
                    {active ? '▮▮' : '▶'}
                  </button>
                  <span className="track-title">{t.title}</span>
                  <button className="link danger" onClick={() => intents.removeAudio(t.id)}>✕</button>
                </li>
              );
            })}
            {tracks.length === 0 && <p className="dim">No tracks yet — upload audio below.</p>}
          </ul>

          <label className="asset-upload">
            <input ref={fileRef} type="file" accept="audio/*" multiple onChange={onUpload} disabled={uploading} />
            {uploading ? 'uploading…' : 'Upload audio (mp3, ogg, wav)'}
          </label>

          {audioAssets.length > tracks.length && (
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              Uploaded audio is added to the playlist automatically.
            </div>
          )}
        </>
      )}
    </div>
  );
}
