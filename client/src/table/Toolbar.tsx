import { useRef, useState } from 'react';
import type { Character, Macro } from 'shared';
import { castableLevels, combatActions, swadeStowedRollable, systemFor } from 'shared';
import { intents, useGameStore } from '../store/game';
import { readableOn } from '../util/playerColor';
import { WHEEL_COLORS, WHEEL_NEUTRALS } from '../util/palette';

/** Whether a pill can currently fire, and why not (out of item / spell slot). */
function pillDisabled(m: Macro, characters: Character[]): { disabled: boolean; reason?: string } {
  if (!m.characterId) return { disabled: false };
  const char = characters.find((c) => c.id === m.characterId);
  if (!char) return { disabled: false }; // sheet not loaded here — let the server decide
  if (m.actionId) {
    const action = combatActions(char).find((a) => a.id === m.actionId);
    if (!action) return { disabled: true, reason: 'Out of stock / unavailable' };
    // A pinned weapon that has been put away. The server refuses it anyway;
    // saying so on the pill saves the round trip and the error toast.
    if (action.stowed) return { disabled: true, reason: `${action.label} isn't in hand — tick Wielded on its card` };
    return { disabled: false };
  }
  if (m.rollableId) {
    const r = systemFor(char.system).rollables(char.sheet).find((x) => x.id === m.rollableId);
    if (r?.slotLevel && castableLevels(char.sheet, r.slotLevel).length === 0) {
      return { disabled: true, reason: `No level-${r.slotLevel}+ spell slot` };
    }
    if (char.system === 'swade' && swadeStowedRollable(char.sheet, m.rollableId)) {
      return { disabled: true, reason: `${r?.label ?? 'That weapon'} isn't in hand — tick Wielded on its card` };
    }
  }
  return { disabled: false };
}

/** The shared wheel (see util/palette). Re-exported under the old name so the
 *  many existing imports keep working. */
export const PILL_COLORS = WHEEL_COLORS;
const PILL_NEUTRALS = WHEEL_NEUTRALS;

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

  // While previewing a player the row shows THEIR pills, so editing has to be
  // off: the buttons would write to the DM's own list while displaying someone
  // else's, and nothing on screen would say so.
  const previewing = useGameStore((s) => !!s.viewingAs);

  if (!you) return null;

  function addPill(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newCmd.trim()) return;
    const auto = PILL_COLORS[PILL_NEUTRALS + (macros.length % (PILL_COLORS.length - PILL_NEUTRALS))];
    intents.saveMacro({ name: newName.trim(), command: newCmd.trim(), color: auto });
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
              // The label used to be hardcoded near-black, which was safe while
              // every colour on offer was a pastel. Black is on offer now, so
              // the text has to follow the background's luminance.
              style={m.color
                ? { background: m.color, color: readableOn(m.color) }
                // Pre-dating the palette: a dark panel needs light text, not
                // the near-black the stylesheet assumes for a coloured pill.
                : { background: 'var(--panel-2)', color: 'var(--text)' }}
              disabled={disabled}
              onClick={() => intents.runMacro(m.id)}
              onContextMenu={(e) => { e.preventDefault(); if (!previewing) setEditingId((id) => (id === m.id ? null : m.id)); }}
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

      {previewing ? null : adding ? (
        <form className="pill-add-form" onSubmit={addPill}>
          <input placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <input placeholder="/r 1d20+5" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} />
          <button type="submit">✓</button>
          <button type="button" onClick={() => setAdding(false)}>✕</button>
        </form>
      ) : (
        <button className="toolbar-edit" title="Add a pill" onClick={() => { setAdding(true); setEditingId(null); }}>+</button>
      )}

      {macros.length === 0 && !adding && !previewing && (
        <span className="dim toolbar-hint">Pin rolls from a character sheet, or click + to add a pill · right-click a pill to edit</span>
      )}
    </div>
  );
}
