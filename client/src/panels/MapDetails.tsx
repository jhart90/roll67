import { useEffect, useState } from 'react';
import { useGameStore } from '../store/game';
import { authHeaders } from '../api';

/**
 * What a player is shown when they click a map or scene in the world tab.
 *
 * A scene is a staged backdrop, so its art appears in full. A battlemap shows
 * only the ground this player has personally explored — and the masking is
 * done by the SERVER, which returns an already-cut PNG. The full background is
 * never sent here for the client to crop, because a client can decline to
 * crop. Opening this never moves the player's camera.
 */
export function MapDetailsWindow({ mapId }: { mapId: string }) {
  const entry = useGameStore((s) => s.directory?.maps.find((m) => m.id === mapId));
  const currentMapId = useGameStore((s) => s.map?.id ?? null);
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  const tokens = useGameStore((s) => s.directory?.tokens ?? []);
  const [art, setArt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const wantArt = entry?.hasPreview === true;
  useEffect(() => {
    if (!wantArt) return;
    let dead = false;
    let url: string | null = null;
    // Fetched with the auth header rather than a token in the query string —
    // the URL would otherwise end up in history and logs.
    (async () => {
      try {
        const res = await fetch(`/api/maps/${mapId}/preview.png`, { headers: authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (dead) return;
        url = URL.createObjectURL(blob);
        setArt(url);
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [mapId, wantArt]);

  // Same surface as the loaded state — an early return that skips .map-details
  // would render bare over the map.
  if (!entry) return <div className="map-details"><p className="dim md-empty">You don’t know that place.</p></div>;
  const isScene = entry.isScene === true;
  const here = tokens.filter((t) => t.mapId === mapId);

  return (
    <div className="map-details">
      <div className="md-head">
        <strong>{entry.name}</strong>
        <span className="dim">{isScene ? 'scene' : 'map'}</span>
        {mapId === currentMapId && <span className="md-here">you are here</span>}
      </div>

      {wantArt && art && <img className="map-details-art" src={art} alt={`${entry.name} preview`} />}
      {wantArt && !art && !failed && <p className="dim md-empty">Loading…</p>}
      {(!wantArt || failed) && (
        <p className="dim md-empty">
          {isScene ? 'This scene has no artwork yet.' : 'Nothing of this map has been revealed to you yet.'}
        </p>
      )}

      {!isScene && !isDm && wantArt && art && (
        <p className="dim md-note">Only the ground you have explored is shown.</p>
      )}

      {here.length > 0 && (
        <div className="md-roster">
          <h5>Here</h5>
          {here.map((t) => (
            <span key={t.id} className={`md-tok ${t.playerRun ? 'player' : 'dm'}`}>⬢ {t.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
