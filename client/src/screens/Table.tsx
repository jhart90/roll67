import { useEffect, useState } from 'react';
import { intents, useGameStore, wireSocket, type Tool } from '../store/game';
import { MapStage } from '../table/MapStage';
import { MapManager } from '../table/dm/MapManager';
import { TokenInspector } from '../table/TokenInspector';
import { LightInspector } from '../table/LightInspector';
import { CharactersPanel } from '../panels/CharactersPanel';
import { ChatPanel } from '../panels/ChatPanel';
import { CharacterSheet } from '../panels/CharacterSheet';
import { InitiativePanel } from '../panels/InitiativePanel';
import { DirectoryPanel } from '../panels/DirectoryPanel';
import { DRAW_COLORS } from '../table/DrawingLayer';
import { DiceOverlay } from '../table/DiceOverlay';
import { PresenceBar } from '../table/PresenceBar';
import { DiceRoller } from '../table/DiceRoller';
import { Toolbar } from '../table/Toolbar';

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
];

type DockTab = 'chat' | 'characters' | 'directory' | 'initiative';

export function Table({ campaignId, onExit }: { campaignId: string; onExit: () => void }) {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const map = useGameStore((s) => s.map);
  const members = useGameStore((s) => s.members);
  const tool = useGameStore((s) => s.tool);
  const viewingAs = useGameStore((s) => s.viewingAs);
  const errorToast = useGameStore((s) => s.errorToast);
  const drawColor = useGameStore((s) => s.drawColor);
  const drawLayer = useGameStore((s) => s.drawLayer);
  const [showMaps, setShowMaps] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('characters');

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
          </>
        )}
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
            {(['characters', 'chat', 'initiative', 'directory'] as DockTab[]).map((t) => (
              <button
                key={t}
                className={dockTab === t ? 'active' : ''}
                onClick={() => setDockTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {dockTab === 'characters' && <CharactersPanel />}
          {dockTab === 'chat' && <ChatPanel />}
          {dockTab === 'initiative' && <InitiativePanel />}
          {dockTab === 'directory' && <DirectoryPanel />}
        </aside>

        {showMaps && isDm && (
          <div className="overlay-panel">
            <MapManager onClose={() => setShowMaps(false)} />
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

        <TokenInspector />
        <LightInspector />
        <CharacterSheet />
        <DiceOverlay />
        <Toolbar />
        <PresenceBar />
      </div>

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
    </div>
  );
}
