import { useState } from 'react';
import type { Counter } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * DM counters: giant segmented banner bars spanning ~75% of the map pane,
 * pinned to its top or bottom edge (doom clocks, ritual progress, fortress
 * HP). Players see only the ones the DM has revealed; the DM gets −/+
 * increment buttons, drag between edges, and a right-click menu to show/
 * hide, edit, or delete. Multiple counters stack at either edge.
 */
export function CountersOverlay() {
  const counters = useGameStore((s) => s.counters);
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<Counter | null>(null);

  if (counters.length === 0) return null;

  const renderBar = (c: Counter) => (
    <div
      key={c.id}
      className={`counter-bar ${!c.visible ? 'counter-hidden' : ''}`}
      title={isDm && !c.visible ? `${c.name} — hidden from players (right-click to reveal)` : c.name}
      onContextMenu={isDm ? (e) => { e.preventDefault(); setMenu({ id: c.id, x: e.clientX, y: e.clientY }); } : undefined}
      draggable={isDm}
      onDragEnd={isDm ? (e) => {
        const half = window.innerHeight / 2;
        const pos = e.clientY < half ? 'top' : 'bottom';
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
      <div className="counters-edge counters-top">
        {counters.filter((c) => c.position === 'top').map(renderBar)}
      </div>
      <div className="counters-edge counters-bottom">
        {counters.filter((c) => c.position === 'bottom').map(renderBar)}
      </div>

      {menu && menuCounter && (
        <div className="wt-ctx-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="wt-ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { intents.counterUpdate(menu.id, { visible: !menuCounter.visible }); setMenu(null); }}>
              {menuCounter.visible ? '🙈 Hide from players' : '👁 Show to players'}
            </button>
            <button onClick={() => { setEditing(menuCounter); setMenu(null); }}>✏️ Edit…</button>
            <button onClick={() => {
              intents.counterUpdate(menu.id, { position: menuCounter.position === 'top' ? 'bottom' : 'top' });
              setMenu(null);
            }}>
              {menuCounter.position === 'top' ? '⬇ Move to bottom' : '⬆ Move to top'}
            </button>
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
          </div>
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
