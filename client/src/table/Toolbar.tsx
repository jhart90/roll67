import { useState } from 'react';
import type { Macro } from 'shared';
import { intents, useGameStore } from '../store/game';

export const PILL_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#d2d26c', '#8a93a6'];

function EditPill({ macro, index, total, onClose }: { macro: Macro; index: number; total: number; onClose: () => void }) {
  const macros = useGameStore((s) => s.macroList);
  const [name, setName] = useState(macro.name);

  function move(dir: -1 | 1) {
    const ids = macros.map((m) => m.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    intents.reorderMacros(ids);
  }

  return (
    <div className="pill-editor">
      <input
        className="pill-name-input"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== macro.name) intents.saveMacro({ ...macro, name: name.trim() }); }}
      />
      <div className="pill-colors">
        {PILL_COLORS.map((c) => (
          <button
            key={c}
            className={`pill-swatch ${macro.color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => intents.saveMacro({ ...macro, color: c })}
          />
        ))}
      </div>
      <div className="pill-edit-actions">
        <button className="link" disabled={index === 0} onClick={() => move(-1)}>◀</button>
        <button className="link" disabled={index === total - 1} onClick={() => move(1)}>▶</button>
        <button className="link danger" onClick={() => { intents.deleteMacro(macro.id); onClose(); }}>delete</button>
        <button className="link" onClick={onClose}>done</button>
      </div>
    </div>
  );
}

/** Bottom toolbar of the player's saved roll pills. */
export function Toolbar() {
  const you = useGameStore((s) => s.you);
  const macros = useGameStore((s) => s.macroList);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCmd, setNewCmd] = useState('');

  if (!you) return null;

  function addPill(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newCmd.trim()) return;
    intents.saveMacro({ name: newName.trim(), command: newCmd.trim(), color: PILL_COLORS[macros.length % PILL_COLORS.length] });
    setNewName('');
    setNewCmd('');
    setAdding(false);
  }

  return (
    <div className="toolbar">
      {macros.map((m, i) => (
        <div key={m.id} className="pill-wrap">
          <button
            className="roll-pill"
            style={{ background: m.color ?? 'var(--panel-2)' }}
            onClick={() => intents.runMacro(m.id)}
            onContextMenu={(e) => { e.preventDefault(); setEditingId((id) => (id === m.id ? null : m.id)); }}
            title={m.characterId ? 'Sheet roll · right-click to edit' : `${m.command} · right-click to edit`}
          >
            {m.name}
          </button>
          {editingId === m.id && (
            <EditPill macro={m} index={i} total={macros.length} onClose={() => setEditingId(null)} />
          )}
        </div>
      ))}

      {adding ? (
        <form className="pill-add-form" onSubmit={addPill}>
          <input placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <input placeholder="/r 1d20+5" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} />
          <button type="submit">✓</button>
          <button type="button" onClick={() => setAdding(false)}>✕</button>
        </form>
      ) : (
        <button className="toolbar-edit" title="Add a pill" onClick={() => { setAdding(true); setEditingId(null); }}>+</button>
      )}

      {macros.length === 0 && !adding && (
        <span className="dim toolbar-hint">Pin rolls from a character sheet, or click + to add a pill · right-click a pill to edit</span>
      )}
    </div>
  );
}
