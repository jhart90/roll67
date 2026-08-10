import { useEffect, useState } from 'react';
import { intents, useGameStore, wireSocket, type DockTab, type Tool, type TerrainBrush } from '../store/game';
import { openWindow } from '../store/windowManager';
import { MapStage } from '../table/MapStage';
import { MapManager } from '../table/dm/MapManager';
import { TokenInspector } from '../table/TokenInspector';
import { LightInspector } from '../table/LightInspector';
import { WallInspector } from '../table/WallInspector';
import { DoorInspector } from '../table/DoorInspector';
import { ChatPanel } from '../panels/ChatPanel';
import { InitiativePanel } from '../panels/InitiativePanel';
import { WorldTreePanel } from '../panels/WorldTreePanel';
import { ShopStorefront } from '../panels/ShopStorefront';
import { TargetPopup } from '../panels/TargetPopup';
import { CastLevelPopup } from '../panels/CastLevelPopup';
import { LootPopup } from '../panels/LootPopup';
import { MapObjectInspector } from '../table/MapObjectInspector';
import { DRAW_COLORS } from '../table/DrawingLayer';
import { DiceOverlay } from '../table/DiceOverlay';
import { InitiativeFloat } from '../table/InitiativeFloat';
import { TokenNameplateCard } from '../table/TokenNameplateCard';
import { CardDrawOverlay } from '../table/CardDrawOverlay';
import { InitiativeRollPrompt } from '../table/InitiativeRollPrompt';
import { SoakPrompt } from '../table/SoakPrompt';
import { BennyMenu } from '../table/BennyMenu';
import { BleedPrompt } from '../table/BleedPrompt';
import { ShakenPrompt } from '../table/ShakenPrompt';
import { StunPrompt } from '../table/StunPrompt';
import { IncapPrompt } from '../table/IncapPrompt';
import { RoundCardsOverlay } from '../table/RoundCardsOverlay';
import { CountersOverlay } from '../table/CountersOverlay';
import { RunPrompt } from '../table/RunPrompt';
import { PresenceBar } from '../table/PresenceBar';
import { DiceRoller } from '../table/DiceRoller';
import { Toolbar } from '../table/Toolbar';
import { AudioPlayer } from '../table/AudioPlayer';
import { Jukebox } from '../panels/Jukebox';
import { WindowHost } from '../window/WindowHost';
import { SwadeCharacterCreator } from '../panels/SwadeCharacterCreator';
import { SwnCharacterCreator } from '../panels/SwnCharacterCreator';
import { Dnd5eCharacterCreator } from '../panels/Dnd5eCharacterCreator';
import { TurnBanner, useTurnTint } from '../panels/TurnBanner';

const PLAYER_TOOLS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'select', icon: '➤', label: 'Select / move (pan with drag)' },
  { id: 'measure', icon: '📏', label: 'Measure distance' },
  { id: 'ping', icon: '📍', label: 'Ping' },
  { id: 'draw', icon: '✏️', label: 'Draw' },
  { id: 'erase', icon: '🧽', label: 'Erase your drawings' },
];

/** Fonts offered for map labels — web-safe stacks, so every client renders
 *  the same label the DM placed. */
const LABEL_FONTS = [
  { name: 'Sans', css: 'sans-serif' },
  { name: 'Serif', css: 'Georgia, serif' },
  { name: 'Slab', css: '"Times New Roman", serif' },
  { name: 'Mono', css: '"Courier New", monospace' },
  { name: 'Display', css: 'Impact, sans-serif' },
  { name: 'Script', css: '"Brush Script MT", cursive' },
];

const DM_TOOLS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'wall', icon: '🧱', label: 'Walls (block movement & sight)' },
  { id: 'door', icon: '🚪', label: 'Doors' },
  { id: 'light', icon: '💡', label: 'Lights' },
  { id: 'loot', icon: '💰', label: 'Place loot (items & chests)' },
  { id: 'spawn', icon: '🎯', label: 'Set token spawn point (where dropped tokens appear)' },
  { id: 'terrain', icon: '🏔️', label: 'Paint rough terrain' },
  { id: 'text', icon: '🅣', label: 'Place a text label on the map (right-click a label to remove it)' },
];

export function Table({ campaignId, onExit }: { campaignId: string; onExit: () => void }) {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const map = useGameStore((s) => s.map);
  const members = useGameStore((s) => s.members);
  const characters = useGameStore((s) => s.characters);
  const tool = useGameStore((s) => s.tool);
  const viewingAs = useGameStore((s) => s.viewingAs);
  const targeting = useGameStore((s) => s.targeting);
  const errorToast = useGameStore((s) => s.errorToast);
  const drawColor = useGameStore((s) => s.drawColor);
  const drawLayer = useGameStore((s) => s.drawLayer);
  const wallType = useGameStore((s) => s.wallType);
  const wallFlip = useGameStore((s) => s.wallFlip);
  const wallGlassColor = useGameStore((s) => s.wallGlassColor);
  const wallRainbow = useGameStore((s) => s.wallRainbow);
  const doorType = useGameStore((s) => s.doorType);
  const lootKind = useGameStore((s) => s.lootKind);
  const textStyle = useGameStore((s) => s.textStyle);
  const selectedTextId = useGameStore((s) => s.selectedTextId);
  const terrainBrush = useGameStore((s) => s.terrainBrush);
  const terrainErase = useGameStore((s) => s.terrainErase);
  const terrainKind = useGameStore((s) => s.terrainKind);
  const terrainRadius = useGameStore((s) => s.terrainRadius);
  const [showMaps, setShowMaps] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const dockTab = useGameStore((s) => s.dockTab);
  const setDockTab = useGameStore((s) => s.setDockTab);
  const turnTint = useTurnTint();
  const showCharacterCreator = useGameStore((s) => s.showCharacterCreator);

  useEffect(() => {
    wireSocket();
    useGameStore.getState().join(campaignId);
    return () => useGameStore.getState().leave();
  }, [campaignId]);

  // The creator wizard opens for players only when the DM deploys it to them
  // (right-click their presence pill → "Send character creator") — no
  // auto-open on join, no player-side launch button.

  // Changing a style control restyles the selected label as you go; with
  // nothing selected it just arms the next label you place.
  function applyTextStyle(patch: Partial<typeof textStyle>) {
    useGameStore.getState().setTextStyle(patch);
    const sel = map?.texts?.find((t) => t.id === selectedTextId);
    if (map && sel) intents.upsertMapText(map.id, { ...sel, ...textStyle, ...patch });
  }

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
      <header className={`topbar ${turnTint ? 'in-combat' : ''}`} style={turnTint ? { background: turnTint.bg, color: turnTint.fg } : undefined}>
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
        <TurnBanner />
        <button onClick={() => setShowAudio((v) => !v)} title="Jukebox">🎵</button>
        <button className="user-chip" onClick={() => openWindow('accountDetails', 'me', {}, 'Account Details')} title="Account settings">{you.username} ({you.role})</button>
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
        <TokenNameplateCard />

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
            {(['solid', 'window', 'oneway', 'stainedglass'] as const).map((t) => (
              <button
                key={t}
                className={wallType === t ? 'active' : ''}
                style={{ fontSize: 12 }}
                title={t === 'solid' ? 'Blocks movement & sight' : t === 'window' ? 'Blocks movement, see-through' : t === 'oneway' ? 'One-way: see out, not in' : 'Stained glass: tints light passing through'}
                onClick={() => useGameStore.getState().setWallType(t)}
              >
                {t === 'solid' ? 'Solid' : t === 'window' ? 'Window' : t === 'oneway' ? 'One-way' : 'Stained Glass'}
              </button>
            ))}
            {wallType === 'oneway' && (
              <button className={wallFlip ? 'active' : ''} style={{ fontSize: 12 }} onClick={() => useGameStore.getState().toggleWallFlip()}>
                flip side
              </button>
            )}
            {wallType === 'stainedglass' && (
              <>
                <input
                  type="color"
                  value={wallGlassColor}
                  onChange={(e) => useGameStore.setState({ wallGlassColor: e.target.value })}
                  style={{ width: 28, height: 22, border: 'none', padding: 0, cursor: 'pointer', verticalAlign: 'middle' }}
                  title="Glass tint color"
                />
                <button
                  className={wallRainbow ? 'active' : ''}
                  style={{ fontSize: 12 }}
                  title="Rainbow: splits light into 6 color bands"
                  onClick={() => useGameStore.setState({ wallRainbow: !wallRainbow })}
                >
                  Rainbow
                </button>
              </>
            )}
            <span className="dim" style={{ fontSize: 11 }}>click points · double-click/Enter to finish</span>
          </div>
        )}

        {tool === 'door' && map && isDm && (
          <div className="draw-options">
            <span className="dim" style={{ fontSize: 12 }}>Door:</span>
            {(['door', 'gate'] as const).map((t) => (
              <button
                key={t}
                className={doorType === t ? 'active' : ''}
                style={{ fontSize: 12 }}
                title={t === 'door' ? 'Blocks movement & sight when closed' : 'Blocks movement when closed, always see-through'}
                onClick={() => useGameStore.getState().setDoorType(t)}
              >
                {t === 'door' ? 'Door' : 'Gate'}
              </button>
            ))}
            <span className="dim" style={{ fontSize: 11 }}>click 2 points to place</span>
          </div>
        )}

        {tool === 'loot' && map && isDm && (
          <div className="draw-options">
            <span className="dim" style={{ fontSize: 12 }}>Place:</span>
            {(['item', 'chest'] as const).map((k) => (
              <button
                key={k}
                className={lootKind === k ? 'active' : ''}
                style={{ fontSize: 12 }}
                onClick={() => useGameStore.getState().setLootKind(k)}
              >
                {k === 'item' ? '✦ Item' : '📦 Chest'}
              </button>
            ))}
            <span className="dim" style={{ fontSize: 11 }}>click map to place · right-click to edit</span>
          </div>
        )}

        {tool === 'text' && map && isDm && (
          <div className="draw-options">
            <span className="dim" style={{ fontSize: 12 }}>Font:</span>
            <select
              style={{ fontSize: 12, width: 'auto' }}
              value={textStyle.font}
              onChange={(e) => applyTextStyle({ font: e.target.value })}
            >
              {LABEL_FONTS.map((f) => (
                <option key={f.css} value={f.css} style={{ fontFamily: f.css }}>{f.name}</option>
              ))}
            </select>
            <span className="dim" style={{ fontSize: 12 }}>Size:</span>
            <input
              type="number" min={6} max={400} step={2}
              style={{ fontSize: 12, width: 64, margin: 0 }}
              value={textStyle.size}
              onChange={(e) => applyTextStyle({ size: Number(e.target.value) || 28 })}
            />
            <button
              className={textStyle.bold ? 'active' : ''}
              style={{ fontSize: 12, fontWeight: 700 }}
              title="Bold"
              onClick={() => applyTextStyle({ bold: !textStyle.bold })}
            >
              B
            </button>
            <button
              className={textStyle.italic ? 'active' : ''}
              style={{ fontSize: 12, fontStyle: 'italic' }}
              title="Italic"
              onClick={() => applyTextStyle({ italic: !textStyle.italic })}
            >
              I
            </button>
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${textStyle.color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => applyTextStyle({ color: c })}
              />
            ))}
            <input
              type="color"
              className="dice-color-custom"
              value={textStyle.color}
              title="Custom colour"
              onChange={(e) => applyTextStyle({ color: e.target.value })}
            />
            <span className="dim" style={{ fontSize: 11 }}>click map to place · right-click a label to remove</span>
          </div>
        )}

        {tool === 'terrain' && map && isDm && (
          <div className="draw-options">
            <span className="dim" style={{ fontSize: 12 }}>Paint:</span>
            <button
              className={terrainKind === 'rough' ? 'active' : ''}
              style={{ fontSize: 12 }}
              title="Difficult ground — costs extra movement, but can be crossed."
              onClick={() => useGameStore.getState().setTerrainKind('rough')}
            >
              ⛰️ Difficult
            </button>
            <button
              className={terrainKind === 'blocked' ? 'active' : ''}
              style={{ fontSize: 12 }}
              title="Impassable — a chasm, lava, deep water. No token can stand here at all."
              onClick={() => useGameStore.getState().setTerrainKind('blocked')}
            >
              ⛔ Inaccessible
            </button>
            <span style={{ width: 8, display: 'inline-block' }} />
            <span className="dim" style={{ fontSize: 12 }}>Shape:</span>
            {(['brush', 'rect', 'circle'] as TerrainBrush[]).map((b) => (
              <button
                key={b}
                className={terrainBrush === b ? 'active' : ''}
                style={{ fontSize: 12 }}
                onClick={() => useGameStore.getState().setTerrainBrush(b)}
              >
                {b === 'brush' ? '🖌️ Brush' : b === 'rect' ? '▬ Rect' : '⬤ Circle'}
              </button>
            ))}
            {terrainBrush === 'brush' && (
              <span className="brush-shelf">
                <span className="dim">Size</span>
                <button
                  title="Smaller brush"
                  disabled={terrainRadius <= 0}
                  onClick={() => useGameStore.getState().setTerrainRadius(terrainRadius - 1)}
                >−</button>
                <span className="brush-size">{terrainRadius * 2 + 1}<span className="dim"> tile{terrainRadius ? 's' : ''}</span></span>
                <button
                  title="Bigger brush"
                  disabled={terrainRadius >= 6}
                  onClick={() => useGameStore.getState().setTerrainRadius(terrainRadius + 1)}
                >+</button>
              </span>
            )}
            <span style={{ width: 8, display: 'inline-block' }} />
            <button
              className={terrainErase ? 'active' : ''}
              style={{ fontSize: 12, color: terrainErase ? '#d26c6c' : undefined }}
              onClick={() => useGameStore.getState().setTerrainErase(!terrainErase)}
            >
              {terrainErase ? '🧹 Erasing' : '🧹 Erase'}
            </button>
            <button
              style={{ fontSize: 12 }}
              onClick={() => { if (map) intents.setTerrain(map.id, []); }}
            >
              🗑️ Erase All
            </button>
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
        <WallInspector />
        <DoorInspector />
        <MapObjectInspector />
        <WindowHost />
        <DiceOverlay />
        <Toolbar />
        <InitiativeFloat />
        <CardDrawOverlay />
        <RoundCardsOverlay />
        <CountersOverlay />
        <InitiativeRollPrompt />
        <SoakPrompt />
        <BleedPrompt />
        <ShakenPrompt />
        <StunPrompt />
        <IncapPrompt />
        <RunPrompt />
        <BennyMenu />
        <PresenceBar />
        <AudioPlayer />
        <ShopStorefront />
        <TargetPopup />
        <CastLevelPopup />
        <LootPopup />
        {showCharacterCreator && campaign.system === 'swade' && (
          <SwadeCharacterCreator onClose={() => useGameStore.getState().setShowCharacterCreator(false)} />
        )}
        {showCharacterCreator && campaign.system === 'swn' && (
          <SwnCharacterCreator onClose={() => useGameStore.getState().setShowCharacterCreator(false)} />
        )}
        {showCharacterCreator && campaign.system === 'dnd5e' && (
          <Dnd5eCharacterCreator onClose={() => useGameStore.getState().setShowCharacterCreator(false)} />
        )}
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
