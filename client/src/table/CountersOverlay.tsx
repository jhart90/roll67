import { useEffect, useState } from 'react';
import { isCounterPosition, type Counter, type CounterPosition } from 'shared';
import { intents, useGameStore } from '../store/game';
import { AnchoredMenu } from '../util/AnchoredMenu';
import { ConfirmButton } from '../util/ConfirmButton';

/**
 * Per-screen counter docks, by counter id. The DM's `position` is the table's
 * default; anyone who drags a counter somewhere else is overriding it for
 * themselves only. Local rather than server state on purpose — where a bar
 * sits on your monitor is a property of your monitor, and one player tidying
 * their sidebar should not rearrange everyone else's map.
 */
const DOCK_KEY = 'roll67.counterDocks';

function loadDocks(): Record<string, CounterPosition> {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, CounterPosition> = {};
    // Drop anything unrecognised rather than trusting the blob: a stale or
    // hand-edited key would otherwise land a counter in a dock that does not
    // render, and the bar would just vanish with no way to get it back.
    for (const [id, pos] of Object.entries(raw)) if (isCounterPosition(pos)) out[id] = pos;
    return out;
  } catch { return {}; }
}

/** Gap left between a counter and the chrome beneath it. */
const BOTTOM_GAP = 12;
/** Everything that occupies the foot of the map pane. The pill toolbar and the
 *  presence row both WRAP; the Benny and Keyring chips sit in the corner. */
const BOTTOM_CHROME = ['.toolbar', '.presence-bar', '.benny-menu', '.keyring-menu'];
/** Where the bottom dock sits when there is no chrome under it at all. */
const BOTTOM_FLOOR = 14;

/**
 * How much room the bottom-left furniture is taking right now: the presence
 * pills and the pinned-roll toolbar, both of which WRAP — a player with a lot
 * of pinned "move" pills grows the toolbar to several rows, and a counter
 * parked at a fixed offset would sit on top of them.
 *
 * Measured rather than guessed, because "however many rows they've made" has
 * no constant. Re-measured on resize and whenever the two elements change
 * size, which is exactly when a pill is pinned, unpinned, or rewraps.
 */
function useBottomChrome(): number {
  const [clearance, setClearance] = useState(BOTTOM_FLOOR);
  useEffect(() => {
    const measure = () => {
      let highest = 0;
      for (const sel of BOTTOM_CHROME) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // Empty flex containers still have a rect; ignore ones with no height.
        if (r.height <= 0) continue;
        highest = Math.max(highest, window.innerHeight - r.top);
      }
      setClearance(highest > 0 ? highest + BOTTOM_GAP : BOTTOM_FLOOR);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const sel of ['.toolbar', '.presence-bar']) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    // No dependency array on purpose: the toolbar and presence bar mount and
    // unmount independently of this component, so the observers have to be
    // re-attached each render to catch elements that were not there last time.
    // Self-limiting — measuring to the same number is a no-op setState, which
    // React bails out of rather than re-rendering.
  });
  return clearance;
}

/** The four docks, and what each is called in the move menu. */
const SLOTS: Array<{ id: CounterPosition; label: string }> = [
  { id: 'top', label: '⬆ Top' },
  { id: 'bottom', label: '⬇ Bottom' },
  { id: 'left', label: '⬅ Left' },
  { id: 'right', label: '➡ Right' },
];

/**
 * Which dock a drag ended over. The side columns are narrow, so the horizontal
 * bands that select them are measured against the MAP PANE's own edges (the
 * overlay's bounding box) rather than the window — dropping "on the left" has
 * to mean the left of the map, not the left of a screen whose tool rail and
 * chat dock eat 360px between them.
 */
function slotForDrop(x: number, y: number, pane: DOMRect): CounterPosition {
  const sideBand = Math.min(220, pane.width / 4);
  if (x < pane.left + sideBand) return 'left';
  if (x > pane.right - sideBand) return 'right';
  return y < pane.top + pane.height / 2 ? 'top' : 'bottom';
}

/**
 * DM counters: segmented bars docked to an edge of the map pane (doom clocks,
 * ritual progress, fortress HP). Top and bottom are wide banners; left and
 * right are narrow columns down the sides, held clear of the tool rail, the
 * chat dock, and the bottom pill/Benny/Keyring row. Players see only the ones
 * the DM has revealed; the DM gets −/+ buttons, drag between docks, and a
 * right-click menu to show/hide, edit, move, or delete.
 */
export function CountersOverlay() {
  const counters = useGameStore((s) => s.counters);
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Second page of the context menu: which map to send this counter to.
  const [sendingToMap, setSendingToMap] = useState(false);
  const [editing, setEditing] = useState<Counter | null>(null);
  const [docks, setDocks] = useState(loadDocks);
  const mapsMeta = useGameStore((s) => s.mapsMeta);
  const bottomClearance = useBottomChrome();

  /** Where THIS screen shows a counter: their own choice, else the DM's. */
  const dockOf = (c: Counter): CounterPosition => docks[c.id] ?? c.position;

  /** Park a counter on this screen only. `null` goes back to the DM's dock. */
  function setDock(id: string, pos: CounterPosition | null) {
    setDocks((cur) => {
      const next = { ...cur };
      if (pos) next[id] = pos; else delete next[id];
      try { localStorage.setItem(DOCK_KEY, JSON.stringify(next)); } catch { /* storage disabled */ }
      return next;
    });
  }

  /** Leaving the menu also leaves whatever page of it you were on. */
  const closeMenu = () => { setMenu(null); setSendingToMap(false); };

  if (counters.length === 0) return null;

  const renderBar = (c: Counter) => (
    <div
      key={c.id}
      className={`counter-bar ${!c.visible ? 'counter-hidden' : ''}`}
      title={!isDm ? c.name
        : !c.visible ? `${c.name} — hidden from players (right-click to share)`
          : c.sharedWith === null ? `${c.name} — shared with everyone`
            : `${c.name} — shared with ${c.sharedWith.length} player${c.sharedWith.length === 1 ? '' : 's'} (right-click to change)`}
      // Everyone can rearrange their own screen, so everyone gets the menu.
      onContextMenu={(e) => { e.preventDefault(); setMenu({ id: c.id, x: e.clientX, y: e.clientY }); }}
      draggable
      onDragEnd={(e) => {
        // Measure against the whole map pane, never the bar's own column: the
        // side columns are ~230px wide, so a drop in the middle of the map
        // read against one of them would land outside it and pick a side.
        const pane = e.currentTarget.closest('.counters-root')?.getBoundingClientRect();
        if (!pane) return;
        const pos = slotForDrop(e.clientX, e.clientY, pane);
        // A drag moves it for YOU. The DM pushes a dock to the whole table
        // from the menu instead, so nobody's arrangement is yanked about by
        // someone else tidying their own screen.
        if (pos !== dockOf(c)) setDock(c.id, pos);
      }}
    >
      {/* Wrapper so a side counter can stand the title alongside the track as
          a Y-axis label. It is `display: contents` in the top/bottom docks, so
          those keep the plain name-then-track row they always had. */}
      <div className="counter-gauge">
        <span className="counter-name">{c.name}</span>
        <div className="counter-track" style={{ gap: c.max > 40 ? 1 : 3 }}>
          {Array.from({ length: c.max }, (_, i) => (
            <div
              key={i}
              className="counter-seg"
              style={i < c.value ? { background: c.color } : undefined}
            />
          ))}
        </div>
      </div>
      <span className="counter-count">{c.value}/{c.max}</span>
      {isDm && (
        <span className="counter-btns">
          <button className="icon-btn" disabled={c.value <= 0} onClick={() => intents.counterUpdate(c.id, { value: c.value - 1 })}>−</button>
          <button className="icon-btn" disabled={c.value >= c.max} onClick={() => intents.counterUpdate(c.id, { value: c.value + 1 })}>+</button>
        </span>
      )}
    </div>
  );

  const menuCounter = menu ? counters.find((c) => c.id === menu.id) : null;
  return (
    <>
      {/* One root spanning the map pane — it owns the insets that keep every
          dock clear of the tool rail and the chat dock, and it is the rect a
          drag measures against. */}
      <div className="counters-root">
        <div className="counters-edge counters-top">
          {counters.filter((c) => dockOf(c) === 'top').map(renderBar)}
        </div>
        <div className="counters-edge counters-bottom" style={{ bottom: bottomClearance }}>
          {counters.filter((c) => dockOf(c) === 'bottom').map(renderBar)}
        </div>
        {/* The side docks run the full height of the pane, stopping at the
            same measured floor the bottom dock uses. */}
        <div className="counters-side counters-left" style={{ bottom: bottomClearance }}>
          {counters.filter((c) => dockOf(c) === 'left').map(renderBar)}
        </div>
        <div className="counters-side counters-right" style={{ bottom: bottomClearance }}>
          {counters.filter((c) => dockOf(c) === 'right').map(renderBar)}
        </div>
      </div>

      {menu && menuCounter && (
        <div className="wt-ctx-backdrop" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}>
          <AnchoredMenu x={menu.x} y={menu.y} className="wt-ctx-menu" onClick={(e) => e.stopPropagation()}>
            {isDm && (
              <>
                <SharePicker counter={menuCounter} />
                <button onClick={() => { setEditing(menuCounter); closeMenu(); }}>✏️ Edit…</button>
                <hr />
              </>
            )}
            <span className="wt-ctx-label">Move on your screen…</span>
            <div className="counter-slot-picker">
              {SLOTS.map((s) => (
                <button
                  key={s.id}
                  className={dockOf(menuCounter) === s.id ? 'active' : ''}
                  disabled={dockOf(menuCounter) === s.id}
                  onClick={() => { setDock(menu.id, s.id); closeMenu(); }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {docks[menu.id] && (
              <button
                title={`The table's default for this counter is ${menuCounter.position}`}
                onClick={() => { setDock(menu.id, null); closeMenu(); }}
              >
                ↩ Follow the table default
              </button>
            )}
            {isDm && dockOf(menuCounter) !== menuCounter.position && (
              <button
                title="Move it here for everyone who has not chosen their own spot"
                onClick={() => { intents.counterUpdate(menu.id, { position: dockOf(menuCounter) }); setDock(menu.id, null); closeMenu(); }}
              >
                📌 Make this the table default
              </button>
            )}
            {isDm && (
              <>
                <hr />
                {/* Second page of the menu rather than a browser prompt asking
                    you to TYPE a number off a list of map names. */}
                {sendingToMap ? (
                  <>
                    <span className="wt-ctx-label">Send to which map?</span>
                    <div className="wt-ctx-pane">
                      {mapsMeta.map((m) => (
                        <button
                          key={m.id}
                          disabled={m.id === menuCounter.mapId}
                          onClick={() => { intents.counterUpdate(menu.id, { mapId: m.id }); closeMenu(); }}
                        >
                          {m.name}{m.id === menuCounter.mapId ? ' · here now' : ''}
                        </button>
                      ))}
                      {mapsMeta.length === 0 && <span className="wt-ctx-label">No other maps.</span>}
                    </div>
                    <button onClick={() => setSendingToMap(false)}>← back</button>
                  </>
                ) : (
                  <button onClick={() => setSendingToMap(true)}>🗺 Send to another map…</button>
                )}
                <hr />
                <ConfirmButton
                  className=""
                  confirmLabel="🗑 Really delete?"
                  onConfirm={() => { intents.counterDelete(menu.id); closeMenu(); }}
                >
                  🗑 Delete
                </ConfirmButton>
              </>
            )}
          </AnchoredMenu>
        </div>
      )}

      {editing && <CounterEditor counter={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * Who can see this counter. Three states rolled into one control, because the
 * DM thinks of it as one question:
 *
 *   hidden           — `visible: false`
 *   the whole table  — `visible: true, sharedWith: null`
 *   named players    — `visible: true, sharedWith: [ids]`
 *
 * Ticking every player collapses back to null rather than freezing today's
 * roster into a list, so a player who joins next week still sees the doom
 * clock. Untick one from "everyone" and you get all-but-them, which is the
 * move you actually want when one character is out of the room.
 *
 * Whether a player then SEES it still depends on knowing the map — the server
 * checks both. Sharing a counter is not a way to leak a map's existence.
 */
function SharePicker({ counter }: { counter: Counter }) {
  const players = useGameStore((s) => s.members).filter((m) => m.role === 'player');
  const shownTo = (userId: string) =>
    counter.visible && (counter.sharedWith === null || counter.sharedWith.includes(userId));
  const shared = players.filter((p) => shownTo(p.userId));

  const setShare = (list: string[]) => intents.counterUpdate(counter.id, {
    visible: list.length > 0,
    // Everybody in the campaign ticked = "everyone", not a snapshot of them.
    sharedWith: list.length === players.length ? null : list,
  });

  const summary = !counter.visible || shared.length === 0 ? 'no one'
    : counter.sharedWith === null ? 'everyone'
      : shared.length === 1 ? shared[0].username
        : `${shared.length} players`;

  return (
    <>
      <span className="wt-ctx-label">Shared with {summary}</span>
      <div className="counter-slot-picker">
        <button
          className={counter.visible && counter.sharedWith === null ? 'active' : ''}
          onClick={() => intents.counterUpdate(counter.id, { visible: true, sharedWith: null })}
        >
          👁 Everyone
        </button>
        <button
          className={!counter.visible || shared.length === 0 ? 'active' : ''}
          onClick={() => intents.counterUpdate(counter.id, { visible: false, sharedWith: null })}
        >
          🙈 No one
        </button>
      </div>
      {players.length > 0 && (
        <div className="counter-share-list">
          {players.map((p) => {
            const on = shownTo(p.userId);
            return (
              // The app's own tick box (see .sc-equip): a native checkbox is
              // the one control that never matches a dark UI.
              <label
                key={p.userId}
                className={`counter-share-row ${on ? 'on' : ''}`}
                title={`${p.username} — ${p.online ? 'online' : 'offline'}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const next = new Set(shared.map((s) => s.userId));
                    if (next.has(p.userId)) next.delete(p.userId); else next.add(p.userId);
                    setShare(players.filter((x) => next.has(x.userId)).map((x) => x.userId));
                  }}
                />
                <span className="sc-box" aria-hidden="true" />
                <span className="counter-share-name">{p.username}</span>
                <span className={`counter-share-dot ${p.online ? 'online' : ''}`} />
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Small modal to edit a counter's name, color, and segment counts. */
function CounterEditor({ counter, onClose }: { counter: Counter; onClose: () => void }) {
  const [name, setName] = useState(counter.name);
  const [color, setColor] = useState(counter.color);
  const [max, setMax] = useState(counter.max);
  const [value, setValue] = useState(counter.value);
  return (
    <div className="sheet-backdrop" style={{ zIndex: 80 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup" style={{ maxWidth: 360 }}>
        <div className="dock-header"><h3>Edit counter</h3></div>
        <label>Name (players see this)
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>Bar color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <div className="row">
          <label>Segments
            <input type="number" min={1} max={100} value={max} onChange={(e) => setMax(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
          </label>
          <label>Filled
            <input type="number" min={0} max={max} value={value} onChange={(e) => setValue(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
          </label>
        </div>
        <div className="row">
          <button
            className="primary" style={{ width: 'auto' }}
            onClick={() => { intents.counterUpdate(counter.id, { name, color, max, value: Math.min(value, max) }); onClose(); }}
          >
            Save
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
