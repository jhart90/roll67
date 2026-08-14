import { intents, useGameStore } from '../store/game';
import { MAP_COLORS_DEFAULT, UI_THEMES, type MapColors } from '../util/appearance';
import { WHEEL_COLORS } from '../util/palette';

/**
 * Everything about how the game looks and sounds to YOU.
 *
 * Nothing here is campaign state — two people at the same table can run
 * different themes and different wall colors without arguing about it. What
 * IS shared with another surface (the volume sliders, your token color) reads
 * and writes the same store fields those surfaces do, so the two can never
 * disagree: there is one value, shown twice.
 */
export function SettingsWindow() {
  const audioState = useGameStore((s) => s.audioState);
  const tracks = useGameStore((s) => s.audioTracks);
  const musicVolume = useGameStore((s) => s.localMusicVolume);
  const sfxVolume = useGameStore((s) => s.localSfxVolume);
  // Read back off presence, which is where it lives — never chosen means on.
  const turnGuide = useGameStore((s) => {
    const me = s.members.find((m) => m.userId === s.you?.userId);
    return me?.turnGuide !== false;
  });
  const setMusic = useGameStore((s) => s.setLocalMusicVolume);
  const setSfx = useGameStore((s) => s.setLocalSfxVolume);
  const theme = useGameStore((s) => s.uiTheme);
  const setTheme = useGameStore((s) => s.setUiTheme);
  const colors = useGameStore((s) => s.mapColors);
  const setColors = useGameStore((s) => s.setMapColors);
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);

  const nowPlaying = tracks.find((t) => t.id === audioState.trackId);
  const myColor = members.find((m) => m.userId === you?.userId)?.playerColor ?? null;

  const patch = (over: Partial<MapColors>) => setColors({ ...colors, ...over });

  return (
    <div className="settings-window">
      <h4 className="settings-head">Sound</h4>

      <div className="settings-row">
        <span className="settings-label">Now playing</span>
        <span className="settings-value">
          {nowPlaying
            ? <>{audioState.playing ? '▶' : '❚❚'} {nowPlaying.title}</>
            : <span className="dim">nothing playing</span>}
        </span>
      </div>

      {/* The same two values the jukebox shows. One store field each, so
          moving either slider moves the other. */}
      <VolumeRow label="Music" value={musicVolume} onChange={setMusic} />
      <VolumeRow label="Effects" value={sfxVolume} onChange={setSfx} />

      <h4 className="settings-head">Visual</h4>

      <div className="settings-row">
        <span className="settings-label">Interface</span>
        <span className="settings-value settings-themes">
          {UI_THEMES.map((t) => (
            <button
              key={t.id}
              className={`settings-theme ${theme === t.id ? 'on' : ''}`}
              title={t.hint}
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </span>
      </div>

      {/* An account setting rather than a local one: a guide belongs to the
          person being taught, so the DM standing in for them sees what THEY
          would see. The label says what it is; the guide explains itself. */}
      <div className="settings-row">
        <span className="settings-label">Combat turn guide</span>
        <span className="settings-value">
          <input
            type="checkbox"
            checked={turnGuide}
            title="Show what is left to spend this turn, over the map, on your turn"
            onChange={(e) => intents.setTurnGuide(e.target.checked)}
          />
        </span>
      </div>

      <ColorRow
        label="Walls" color={colors.wall} opacity={colors.wallOpacity}
        onColor={(wall) => patch({ wall })} onOpacity={(wallOpacity) => patch({ wallOpacity })}
      />
      <ColorRow
        label="Doors (closed)" color={colors.doorClosed} opacity={colors.doorClosedOpacity}
        onColor={(doorClosed) => patch({ doorClosed })} onOpacity={(doorClosedOpacity) => patch({ doorClosedOpacity })}
      />
      <ColorRow
        label="Doors (open)" color={colors.doorOpen} opacity={colors.doorOpenOpacity}
        onColor={(doorOpen) => patch({ doorOpen })} onOpacity={(doorOpenOpacity) => patch({ doorOpenOpacity })}
      />
      <div className="settings-row">
        <span className="settings-label" />
        <span className="settings-value">
          <button className="link" onClick={() => setColors({ ...MAP_COLORS_DEFAULT })}>
            reset map colors
          </button>
        </span>
      </div>

      {/* Your token color — the same account setting the pill at the bottom
          of the screen edits, through the same intent, so they always agree. */}
      <div className="settings-row">
        <span className="settings-label">Your color</span>
        <span className="settings-value settings-swatches">
          {WHEEL_COLORS.map((c) => (
            <button
              key={c}
              className={`settings-swatch ${myColor === c ? 'on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => intents.setPlayerColor(c)}
            />
          ))}
        </span>
      </div>

      <p className="dim settings-note">
        These are yours alone — they are stored on this browser and change
        nothing for anyone else at the table.
      </p>
    </div>
  );
}

function VolumeRow({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      <span className="settings-value">
        <input
          type="range" min={0} max={1} step={0.01} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="settings-pct">{Math.round(value * 100)}%</span>
      </span>
    </label>
  );
}

function ColorRow({ label, color, opacity, onColor, onOpacity }: {
  label: string; color: string; opacity: number;
  onColor: (v: string) => void; onOpacity: (v: number) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      <span className="settings-value">
        <input type="color" value={color} onChange={(e) => onColor(e.target.value)} />
        <input
          type="range" min={0.05} max={1} step={0.05} value={opacity}
          title="Opacity"
          onChange={(e) => onOpacity(Number(e.target.value))}
        />
        <span className="settings-pct">{Math.round(opacity * 100)}%</span>
      </span>
    </label>
  );
}
