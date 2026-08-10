import { useEffect, useState } from 'react';
import type { Counter, CounterPosition } from 'shared';
import { intents, useGameStore } from '../store/game';
import { AnchoredMenu } from '../util/AnchoredMenu';

/** Gap left between a bottom-docked counter and the chrome beneath it. */
const BOTTOM_GAP = 12;
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
      for (const sel of ['.toolbar', '.presence-bar']) {
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
  const [editing, setEditing] = useState<Counter | null>(null);
  const bottomClearance = useBottomChrome();

  if (counters.length === 0) return null;

  const renderBar = (c: Counter) => (
    <div
      key={c.id}
      className={`counter-bar ${!c.visible ? 'counter-hidden' : ''}`}
      title={isDm && !c.visible ? `${c.name} — hidden from players (right-click to reveal)` : c.name}
      onContextMenu={isDm ? (e) => { e.preventDefault(); setMenu({ id: c.id, x: e.clientX, y: e.clientY }); } : undefined}
      draggable={isDm}
      onDragEnd={isDm ? (e) => {
        // Measure against the whole map pane, never the bar's own column: the
        // side columns are ~230px wide, so a drop in the middle of the map
        // read against one of them would land outside it and pick a side.
        const pane = e.currentTarget.closest('.counters-root')?.getBoundingClientRect();
        if (!pane) return;
        const pos = slotForDrop(e.clientX, e.clientY, pane);
        if (pos !== c.position) intents.counterUpdate(c.id, { position: pos });
      } : undefined}
    >
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
          {counters.filter((c) => c.position === 'top').map(renderBar)}
        </div>
        <div className="counters-edge counters-bottom" style={{ bottom: bottomClearance }}>
          {counters.filter((c) => c.position === 'bottom').map(renderBar)}
        </div>
        <div className="counters-side counters-left">
          {counters.filter((c) => c.position === 'left').map(renderBar)}
        </div>
        <div className="counters-side counters-right">
          {counters.filter((c) => c.position === 'right').map(renderBar)}
        </div>
      </div>

      {menu && menuCounter && (
        <div className="wt-ctx-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <AnchoredMenu x={menu.x} y={menu.y} className="wt-ctx-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { intents.counterUpdate(menu.id, { visible: !menuCounter.visible }); setMenu(null); }}>
              {menuCounter.visible ? '🙈 Hide from players' : '👁 Show to players'}
            </button>
            <button onClick={() => { setEditing(menuCounter); setMenu(null); }}>✏️ Edit…</button>
            <hr />
            <span className="wt-ctx-label">Move to…</span>
            <div className="counter-slot-picker">
              {SLOTS.map((s) => (
                <button
                  key={s.id}
                  className={menuCounter.position === s.id ? 'active' : ''}
                  disabled={menuCounter.position === s.id}
                  onClick={() => { intents.counterUpdate(menu.id, { position: s.id }); setMenu(null); }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <hr />
            <button onClick={() => {
              const mapsMeta = useGameStore.getState().mapsMeta;
              const pick = prompt(['Send counter to which map? (enter a number)', ...mapsMeta.map((m, i) => `${i + 1}. ${m.name}`)].join('\n'));
              const idx = Number(pick) - 1;
              if (mapsMeta[idx]) intents.counterUpdate(menu.id, { mapId: mapsMeta[idx].id });
              setMenu(null);
            }}>🗺 Send to another map…</button>
            <hr />
            <button onClick={() => { if (confirm(`Delete counter "${menuCounter.name}"?`)) intents.counterDelete(menu.id); setMenu(null); }}>
              🗑 Delete
            </button>
          </AnchoredMenu>
        </div>
      )}

      {editing && <CounterEditor counter={editing} onClose={() => setEditing(null)} />}
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
