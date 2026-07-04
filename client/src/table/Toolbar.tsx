import { useRef, useState } from 'react';
import type { Character, Macro } from 'shared';
import { castableLevels, combatActions, systemFor } from 'shared';
import { intents, useGameStore } from '../store/game';

/** Whether a pill can currently fire, and why not (out of item / spell slot). */
function pillDisabled(m: Macro, characters: Character[]): { disabled: boolean; reason?: string } {
  if (!m.characterId) return { disabled: false };
  const char = characters.find((c) => c.id === m.characterId);
  if (!char) return { disabled: false }; // sheet not loaded here — let the server decide
  if (m.actionId) {
    const action = combatActions(char).find((a) => a.id === m.actionId);
    if (!action) return { disabled: true, reason: 'Out of stock / unavailable' };
    return { disabled: false };
  }
  if (m.rollableId) {
    const r = systemFor(char.system).rollables(char.sheet).find((x) => x.id === m.rollableId);
    if (r?.slotLevel && castableLevels(char.sheet, r.slotLevel).length === 0) {
      return { disabled: true, reason: `No level-${r.slotLevel}+ spell slot` };
    }
  }
  return { disabled: false };
}

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
  const characters = useGameStore((s) => s.characters);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCmd, setNewCmd] = useState('');
  // The dragged pill id lives in a ref (not state) so a fast drop reads it
  // synchronously — React batches setState, which can still be null on drop.
  const dragRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  if (!you) return null;

  function addPill(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newCmd.trim()) return;
    intents.saveMacro({ name: newName.trim(), command: newCmd.trim(), color: PILL_COLORS[macros.length % PILL_COLORS.length] });
    setNewName('');
    setNewCmd('');
    setAdding(false);
  }

  function dropOn(targetId: string) {
    const draggedId = dragRef.current;
    dragRef.current = null;
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const ids = macros.map((m) => m.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, draggedId);
    intents.reorderMacros(ids);
  }

  return (
    <div className="toolbar">
      {macros.map((m, i) => {
        const { disabled, reason } = pillDisabled(m, characters);
        const kind = m.actionId ? 'Action' : m.characterId ? 'Sheet roll' : m.command;
        return (
          <div
            key={m.id}
            className={`pill-wrap ${dragOverId === m.id ? 'pill-drop-target' : ''}`}
            draggable
            onDragStart={(e) => {
              dragRef.current = m.id;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', m.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverId !== m.id) setDragOverId(m.id);
            }}
            onDragLeave={() => setDragOverId((id) => (id === m.id ? null : id))}
            onDrop={(e) => { e.preventDefault(); dropOn(m.id); }}
            onDragEnd={() => { dragRef.current = null; setDragOverId(null); }}
          >
            <button
              className={`roll-pill ${disabled ? 'pill-disabled' : ''}`}
              style={{ background: m.color ?? 'var(--panel-2)' }}
              disabled={disabled}
              onClick={() => intents.runMacro(m.id)}
              onContextMenu={(e) => { e.preventDefault(); setEditingId((id) => (id === m.id ? null : m.id)); }}
              title={disabled ? `${reason} · drag to reorder · right-click to edit` : `${kind} · drag to reorder · right-click to edit`}
            >
              {m.name}
            </button>
            {editingId === m.id && (
              <EditPill macro={m} index={i} total={macros.length} onClose={() => setEditingId(null)} />
            )}
          </div>
        );
      })}

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
