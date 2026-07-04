import { useEffect, useState } from 'react';
import { intents, useGameStore, wireSocket, type Tool } from '../store/game';
import { openWindow } from '../store/windowManager';
import { MapStage } from '../table/MapStage';
import { MapManager } from '../table/dm/MapManager';
import { TokenInspector } from '../table/TokenInspector';
import { LightInspector } from '../table/LightInspector';
import { ChatPanel } from '../panels/ChatPanel';
import { InitiativePanel } from '../panels/InitiativePanel';
import { WorldTreePanel } from '../panels/WorldTreePanel';
import { ShopStorefront } from '../panels/ShopStorefront';
import { TargetPopup } from '../panels/TargetPopup';
import { CastLevelPopup } from '../panels/CastLevelPopup';
import { DRAW_COLORS } from '../table/DrawingLayer';
import { DiceOverlay } from '../table/DiceOverlay';
import { PresenceBar } from '../table/PresenceBar';
import { DiceRoller } from '../table/DiceRoller';
import { Toolbar } from '../table/Toolbar';
import { AudioPlayer } from '../table/AudioPlayer';
import { Jukebox } from '../panels/Jukebox';
import { WindowHost } from '../window/WindowHost';

const PLAYER_TOOLS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'select', icon: '➤', label: 'Select / move (pan with drag)' },
  { id: 'measure', icon: '📏', label: 'Measure distance' },
  { id: 'ping', icon: '📍', label: 'Ping' },
  { id: 'draw', icon: '✏️', label: 'Draw' },
  { id: 'erase', icon: '🧽', label: 'Erase your drawings' },
];

const DM_TOOLS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'wall', icon: '🧱', label: 'Walls (block movement & sight)' },
  { id: 'door', icon: '🚪', label: 'Doors' },
  { id: 'light', icon: '💡', label: 'Lights' },
  { id: 'spawn', icon: '🎯', label: 'Set token spawn point (where dropped tokens appear)' },
];

type DockTab = 'chat' | 'initiative' | 'world';

export function Table({ campaignId, onExit }: { campaignId: string; onExit: () => void }) {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const map = useGameStore((s) => s.map);
  const members = useGameStore((s) => s.members);
  const tool = useGameStore((s) => s.tool);
  const viewingAs = useGameStore((s) => s.viewingAs);
  const targeting = useGameStore((s) => s.targeting);
  const errorToast = useGameStore((s) => s.errorToast);
  const drawColor = useGameStore((s) => s.drawColor);
  const drawLayer = useGameStore((s) => s.drawLayer);
  const wallType = useGameStore((s) => s.wallType);
  const wallFlip = useGameStore((s) => s.wallFlip);
  const [showMaps, setShowMaps] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('world');

  useEffect(() => {
    wireSocket();
    useGameStore.getState().join(campaignId);
    return () => useGameStore.getState().leave();
  }, [campaignId]);

  const isDm = you?.role === 'dm';
  const players = members.filter((m) => m.role === 'player');
  const tools = isDm ? [...PLAYER_TOOLS, ...DM_TOOLS] : PLAYER_TOOLS;

  if (!you || !campaign) {
    return (
      <div className="center-screen">
        <p className="dim">joining campaign…</p>
      </div>
    );
  }

  return (
    <div className="table-shell">
      <header className="topbar">
        <button className="link" onClick={onExit}>← campaigns</button>
        <span className="topbar-title">{campaign.name}</span>
        {map && <span className="dim">· {map.name}</span>}
        <span className="spacer" />
        {isDm && (
          <>
            <label className="viewas">
              View as
              <select
                value={viewingAs ?? ''}
                onChange={(e) => intents.dmViewAs(e.target.value || null)}
              >
                <option value="">God mode (DM)</option>
                {players.map((p) => (
                  <option key={p.userId} value={p.userId}>{p.username}</option>
                ))}
              </select>
            </label>
            <button onClick={() => setShowMaps((v) => !v)}>Maps</button>
            <button onClick={() => openWindow('assetLibrary', 'main', {}, 'Asset Library')}>Assets</button>
          </>
        )}
        <button onClick={() => setShowAudio((v) => !v)} title="Jukebox">🎵</button>
        <span className="user-chip">{you.username} ({you.role})</span>
      </header>

      <div className="table-main">
        <nav className="tool-rail">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? 'active' : ''}`}
              title={t.label}
              onClick={() => useGameStore.getState().setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
          <div className="rail-gap" />
          <button
            className={`tool-btn ${showDice ? 'active' : ''}`}
            title="Roll dice"
            onClick={() => setShowDice((v) => !v)}
          >
            🎲
          </button>
        </nav>

        <MapStage />

        <aside className="dock">
          <div className="dock-tabs">
            {(['world', 'chat', 'initiative'] as DockTab[]).map((t) => (
              <button
                key={t}
                className={dockTab === t ? 'active' : ''}
                onClick={() => setDockTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {dockTab === 'world' && <WorldTreePanel />}
          {dockTab === 'chat' && <ChatPanel />}
          {dockTab === 'initiative' && <InitiativePanel />}
        </aside>

        {showMaps && isDm && (
          <div className="overlay-panel">
            <MapManager onClose={() => setShowMaps(false)} />
          </div>
        )}

        {tool === 'wall' && map && isDm && (
          <div className="draw-options">
            <span className="dim" style={{ fontSize: 12 }}>Wall:</span>
            {(['solid', 'window', 'oneway'] as const).map((t) => (
              <button
                key={t}
                className={wallType === t ? 'active' : ''}
                style={{ fontSize: 12 }}
                title={t === 'solid' ? 'Blocks movement & sight' : t === 'window' ? 'Blocks movement, see-through' : 'One-way: see out, not in'}
                onClick={() => useGameStore.getState().setWallType(t)}
              >
                {t === 'solid' ? 'Solid' : t === 'window' ? 'Window' : 'One-way'}
              </button>
            ))}
            {wallType === 'oneway' && (
              <button className={wallFlip ? 'active' : ''} style={{ fontSize: 12 }} onClick={() => useGameStore.getState().toggleWallFlip()}>
                flip side
              </button>
            )}
            <span className="dim" style={{ fontSize: 11 }}>click points · double-click/Enter to finish</span>
          </div>
        )}

        {(tool === 'draw' || tool === 'erase') && map && (
          <div className="draw-options">
            {tool === 'draw' && DRAW_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${drawColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => useGameStore.getState().setDrawColor(c)}
              />
            ))}
            {tool === 'draw' && isDm && (
              <select value={drawLayer} onChange={(e) => useGameStore.getState().setDrawLayer(e.target.value as 'map' | 'gm')}>
                <option value="map">visible to all</option>
                <option value="gm">GM only</option>
              </select>
            )}
            {tool === 'erase' && isDm && (
              <>
                <button onClick={() => intents.clearDrawings(map.id, 'map')}>clear drawings</button>
                <button onClick={() => intents.clearDrawings(map.id, 'gm')}>clear GM drawings</button>
              </>
            )}
          </div>
        )}

        {showDice && <DiceRoller onClose={() => setShowDice(false)} />}

        {showAudio && (
          <div className="overlay-panel"><Jukebox onClose={() => setShowAudio(false)} /></div>
        )}

        <TokenInspector />
        <LightInspector />
        <WindowHost />
        <DiceOverlay />
        <Toolbar />
        <PresenceBar />
        <AudioPlayer />
        <ShopStorefront />
        <TargetPopup />
        <CastLevelPopup />
      </div>

      {targeting && targeting.action.source === 'attack' && (
        <div className="target-banner">
          Choose a target for <strong>{targeting.action.label}</strong> — click a highlighted token
          <button className="link" onClick={() => useGameStore.getState().cancelTargeting()}>cancel (Esc)</button>
        </div>
      )}

      {viewingAs && (
        <div className="viewas-banner">
          Viewing as {players.find((p) => p.userId === viewingAs)?.username ?? 'player'} —{' '}
          <button className="link" onClick={() => intents.dmViewAs(null)}>back to God mode</button>
        </div>
      )}

      {errorToast && (
        <div className="toast error-toast" onClick={() => useGameStore.getState().clearError()}>
          {errorToast}
        </div>
      )}

      <TableToasts />
    </div>
  );
}

/** Colored pills that flash a rollable-table result, then fade after ~3s. */
function TableToasts() {
  const toasts = useGameStore((s) => s.tableToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="table-toasts">
      {toasts.map((t) => (
        <div key={t.id} className="table-toast" style={{ background: t.color }}>
          🎲 {t.text}
        </div>
      ))}
    </div>
  );
}
