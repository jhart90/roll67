import { useState } from 'react';
import type { DiceSpeed } from 'shared';
import { authHeaders } from '../api';
import { intents, useGameStore } from '../store/game';
import {
  MAP_COLORS_DEFAULT, ROLL_DETAILS, UI_THEMES, readClosedSections, saveClosedSections, type MapColors,
} from '../util/appearance';
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
/**
 * One foldable section of the window.
 *
 * The header IS the control — the whole strip toggles, not just the caret, so
 * the target is the full width of the window rather than a 10px glyph. Which
 * sections are folded is remembered per browser, because a fold you have to
 * redo every time you open settings is worse than no fold at all.
 */
function Section({ title, closed, onToggle, children }: {
  title: string;
  closed: Set<string>;
  onToggle: (title: string) => void;
  children: React.ReactNode;
}) {
  const open = !closed.has(title);
  return (
    <>
      <button
        className="settings-head settings-head-btn"
        aria-expanded={open}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        onClick={() => onToggle(title)}
      >
        <span className="settings-caret">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="settings-section">{children}</div>}
    </>
  );
}

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
  const rollDetail = useGameStore((s) => s.rollDetail);
  const setRollDetail = useGameStore((s) => s.setRollDetail);
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const isDm = useGameStore((s) => s.isDm());

  const nowPlaying = tracks.find((t) => t.id === audioState.trackId);
  const myColor = members.find((m) => m.userId === you?.userId)?.playerColor ?? null;

  const [closed, setClosed] = useState<Set<string>>(() => new Set(readClosedSections()));
  function toggleSection(title: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      saveClosedSections([...next]);
      return next;
    });
  }

  const patch = (over: Partial<MapColors>) => setColors({ ...colors, ...over });

  return (
    <div className="settings-window">
      <Section title="Sound" closed={closed} onToggle={toggleSection}>

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

      </Section>

      <Section title="Visual" closed={closed} onToggle={toggleSection}>

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

      {/* Where a roll's modifier shows its working. The tooltip keeps the log
          compact; itemizing it in the card costs a few lines and asks nothing
          of the reader, which is the better trade on a touchscreen or a
          shared screen. Same words either way. */}
      <div className="settings-row">
        <span className="settings-label">Roll modifiers</span>
        <span className="settings-value settings-themes">
          {ROLL_DETAILS.map((d) => (
            <button
              key={d.id}
              className={`settings-theme ${rollDetail === d.id ? 'on' : ''}`}
              title={d.hint}
              onClick={() => setRollDetail(d.id)}
            >
              {d.label}
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

      </Section>

      {isDm && <DmSection closed={closed} onToggle={toggleSection} />}
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

/** The speeds, and what each is FOR — the tooltip is the whole explanation. */
const DICE_SPEEDS: Array<{ id: DiceSpeed; label: string; hint: string }> = [
  { id: 'cinematic', label: 'Cinematic', hint: 'Full throw, with a long beat between rolls to read each result. Best for a small table.' },
  { id: 'brisk', label: 'Brisk', hint: 'Full throw, short beat between rolls. Roughly halves the time a busy round spends on dice.' },
  { id: 'instant', label: 'Instant', hint: 'No dice thrown — results appear immediately. The card still shows every die.' },
];

/**
 * The DM's half of the settings window: the two things here that are not
 * personal preference.
 *
 * Dice speed is a CAMPAIGN setting on purpose. If one player runs instant and
 * another runs the full throw, the first knows the result several seconds
 * before the second — and reacts where everyone can see. One number for the
 * table, and the DM's to choose.
 */
function DmSection({ closed, onToggle }: { closed: Set<string>; onToggle: (t: string) => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const speed = campaign?.diceSpeed ?? 'cinematic';
  const [busy, setBusy] = useState(false);
  const [armWipe, setArmWipe] = useState(false);
  // null = not editing; a string = the draft in the rename box.
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  function submitRename() {
    const trimmed = (nameDraft ?? '').trim();
    if (trimmed && trimmed !== campaign?.name) intents.renameCampaign(trimmed);
    setNameDraft(null);
  }

  async function downloadBackup() {
    if (!campaign) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/backup`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Backup failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      const slug = campaign.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'campaign';
      a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.r67campaign`;
      a.click();
      URL.revokeObjectURL(url);
      useGameStore.getState().toast('Backup saved. Keep it somewhere that isn’t this server.', 'info');
    } catch (err) {
      useGameStore.getState().toast(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Table (DM)" closed={closed} onToggle={onToggle}>

      {/* A rename is just a new label on the same row — members, invite code,
          maps and history all stay exactly where they are. */}
      <div className="settings-row">
        <span className="settings-label">Campaign name</span>
        <span className="settings-value">
          {nameDraft === null ? (
            <>
              <span className="settings-campaign-name">{campaign?.name}</span>
              <button className="link" onClick={() => setNameDraft(campaign?.name ?? '')}>rename</button>
            </>
          ) : (
            <>
              <input
                className="settings-rename-input"
                value={nameDraft}
                maxLength={60}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') setNameDraft(null);
                }}
              />
              <button className="link" disabled={!nameDraft.trim()} onClick={submitRename}>save</button>
              <button className="link" onClick={() => setNameDraft(null)}>cancel</button>
            </>
          )}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Dice speed</span>
        <span className="settings-value settings-themes">
          {DICE_SPEEDS.map((s) => (
            <button
              key={s.id}
              className={`settings-theme ${speed === s.id ? 'on' : ''}`}
              title={s.hint}
              onClick={() => intents.setDiceSpeed(s.id)}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Chat log</span>
        <span className="settings-value">
          {/* Two clicks, not a browser confirm: the first arms it, and looking
              away disarms it. Erasing months of table history deserves exactly
              one deliberate second thought, and no more ceremony than that. */}
          {armWipe ? (
            <>
              <button className="link danger" onClick={() => { intents.chatWipe(); setArmWipe(false); }}>
                really wipe it all
              </button>
              <button className="link" onClick={() => setArmWipe(false)}>keep it</button>
            </>
          ) : (
            <button
              className="link"
              title="Erases the chat log for everyone, permanently. A backup captures it first if it matters."
              onClick={() => setArmWipe(true)}
            >wipe the whole log</button>
          )}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-label">Backup</span>
        <span className="settings-value">
          <button
            className="link"
            title="One file holding the whole campaign — sheets, maps, walls, chests, images, chat. Restores from the shelf screen."
            disabled={busy}
            onClick={downloadBackup}
          >
            {busy ? 'packing it up…' : 'download this campaign'}
          </button>
        </span>
      </div>
      </Section>
    </>
  );
}
