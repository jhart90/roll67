import { useEffect, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { defaultColorFor, playerColorFor } from '../util/playerColor';
import { WHEEL_COLORS } from '../util/palette';

/** Rename yourself + pick your player color -- shown when you click your own pill. */
function SelfProfileMenu({ userId, username, playerColor }: { userId: string; username: string; playerColor: string | null }) {
  const [name, setName] = useState(username);
  const current = playerColor ?? defaultColorFor(userId);

  function submitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== username) intents.setUsername(trimmed);
    else setName(username);
  }

  return (
    <span className="presence-menu" onPointerDown={(e) => e.stopPropagation()}>
      <span className="presence-menu-title">Your profile</span>
      <input
        className="presence-name-input"
        value={name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitName();
          if (e.key === 'Escape') setName(username);
        }}
        onBlur={submitName}
      />
      <div className="dice-color-row">
        <span className="dim" style={{ fontSize: 11 }}>Color:</span>
        {/* The same wheel the pinned pills offer — one palette across the app.
            Nobody has to reset to the automatic colour: it is what you get
            until you pick, and picking one of these IS the choice. */}
        <div className="player-colors">
          {WHEEL_COLORS.map((c) => (
            <button
              key={c}
              className={`pill-swatch ${current === c ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => intents.setPlayerColor(c)}
            />
          ))}
        </div>
        <input
          type="color"
          className="dice-color-custom"
          value={current}
          title="Custom color"
          onChange={(e) => intents.setPlayerColor(e.target.value)}
        />
      </div>
    </span>
  );
}

/** Bottom-of-screen pills showing who is connected right now. The DM can
 * click a player's pill to move them to another map; clicking your own pill
 * opens a small profile popover to rename yourself and pick your color. */
export function PresenceBar() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const mapsMeta = useGameStore((s) => s.mapsMeta);
  const campaign = useGameStore((s) => s.campaign);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [bootArmed, setBootArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor && !profileOpen) return;
    const close = () => {
      setMenuFor(null);
      setProfileOpen(false);
      setBootArmed(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor, profileOpen]);

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
        const clickable = (isDm && !isYou && m.role === 'player') || isYou;
        return (
          <span
            key={m.userId}
            className={`presence-pill ${m.online ? 'online' : 'offline'} ${isYou ? 'you' : ''} ${clickable ? 'clickable' : ''}`}
            onPointerDown={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              if (isYou) {
                setMenuFor(null);
                setProfileOpen((p) => !p);
              } else {
                setProfileOpen(false);
                setMenuFor(menuFor === m.userId ? null : m.userId);
              }
            }}
            title={
              (m.online ? 'Online' : 'Offline') +
              (isDm ? ` · on ${mapName(m.mapId)}` : '') +
              (isYou ? ' · click to edit your name/color' : clickable ? ' · click to move to another map' : '')
            }
          >
            {/* The pill's own content is wrapped so the offline dimming can
                apply to IT alone -- opacity on the pill itself would composite
                the child "move to..." menu translucent too (unreadable). */}
            <span className="presence-body">
              <span className="presence-dot" style={{ background: m.online ? playerColorFor(m) : 'var(--border)' }} />
              {m.username}
              {m.role === 'dm' && <span className="presence-role">DM</span>}
              {isDm && m.online && m.mapId !== campaign.activeMapId && m.role === 'player' && (
                <span className="presence-map">· {mapName(m.mapId)}</span>
              )}
            </span>
            {isYou && profileOpen && (
              <SelfProfileMenu userId={m.userId} username={m.username} playerColor={m.playerColor} />
            )}
            {!isYou && menuFor === m.userId && (
              <span className="presence-menu" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  className="link"
                  title="Open the guided character-creator wizard on this player's screen"
                  onClick={() => {
                    intents.sendCreator(m.userId);
                    setMenuFor(null);
                  }}
                >
                  🧙 Send character creator
                </button>
                <button
                  className="link"
                  title={`Wipe what ${m.username} has discovered — their world tab goes blank and they rediscover by looking. World memory belongs to the ACCOUNT, so rolling a new character does not reset it.`}
                  onClick={() => {
                    intents.forgetKnowledge(m.userId);
                    setMenuFor(null);
                  }}
                >
                  🧠 Reset world knowledge
                </button>
                {bootArmed === m.userId ? (
                  <button
                    className="link danger"
                    onClick={() => {
                      intents.bootPlayer(m.userId);
                      setBootArmed(null);
                      setMenuFor(null);
                    }}
                  >
                    ⛔ Really remove {m.username}?
                  </button>
                ) : (
                  <button
                    className="link danger"
                    title="Remove this player from the campaign: their characters revert to DM control and they must re-use the invite code to return"
                    onClick={() => setBootArmed(m.userId)}
                  >
                    ⛔ Remove from campaign…
                  </button>
                )}
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
