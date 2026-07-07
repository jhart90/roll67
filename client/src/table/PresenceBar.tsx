import { useEffect, useState } from 'react';
import { intents, useGameStore } from '../store/game';

const PILL_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#d2d26c', '#d26cb0'];

function colorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PILL_COLORS[hash % PILL_COLORS.length];
}

/** Bottom-of-screen pills showing who is connected right now. The DM can
 * click a player's pill to move them to another map. */
export function PresenceBar() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const mapsMeta = useGameStore((s) => s.mapsMeta);
  const campaign = useGameStore((s) => s.campaign);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  if (!you || !campaign) return null;
  const isDm = you.role === 'dm';
  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);

  function mapName(mapId: string | null | undefined): string {
    if (!mapId) return 'no map';
    return mapsMeta.find((m) => m.id === mapId)?.name ?? 'a map';
  }

  return (
    <div className="presence-bar">
      {[...online, ...offline].map((m) => {
        const isYou = m.userId === you.userId;
        const clickable = isDm && !isYou && m.role === 'player';
        return (
          <span
            key={m.userId}
            className={`presence-pill ${m.online ? 'online' : 'offline'} ${isYou ? 'you' : ''} ${clickable ? 'clickable' : ''}`}
            onPointerDown={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              setMenuFor(menuFor === m.userId ? null : m.userId);
            }}
            title={
              (m.online ? 'Online' : 'Offline') +
              (isDm ? ` · on ${mapName(m.mapId)}` : '') +
              (clickable ? ' · click to move to another map' : '')
            }
          >
            {/* The pill's own content is wrapped so the offline dimming can
                apply to IT alone -- opacity on the pill itself would composite
                the child "move to..." menu translucent too (unreadable). */}
            <span className="presence-body">
              <span className="presence-dot" style={{ background: m.online ? colorFor(m.userId) : 'var(--border)' }} />
              {m.username}
              {m.role === 'dm' && <span className="presence-role">DM</span>}
              {isDm && m.online && m.mapId !== campaign.activeMapId && m.role === 'player' && (
                <span className="presence-map">· {mapName(m.mapId)}</span>
              )}
            </span>
            {menuFor === m.userId && (
              <span className="presence-menu" onPointerDown={(e) => e.stopPropagation()}>
                <span className="presence-menu-title">Move {m.username} to…</span>
                <button
                  className="link"
                  onClick={() => {
                    intents.assignPlayerMap(m.userId, null);
                    setMenuFor(null);
                  }}
                >
                  Party map ({mapName(campaign.activeMapId)})
                </button>
                {mapsMeta.map((mp) => (
                  <button
                    key={mp.id}
                    className="link"
                    onClick={() => {
                      intents.assignPlayerMap(m.userId, mp.id);
                      setMenuFor(null);
                    }}
                  >
                    {mp.name}{mp.id === m.mapId ? ' ✓' : ''}
                  </button>
                ))}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
