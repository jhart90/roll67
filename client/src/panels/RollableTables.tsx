import { useState } from 'react';
import type { RollableTable } from 'shared';
import { intents, useGameStore } from '../store/game';

function TableEditor({ table, onClose }: { table: RollableTable; onClose: () => void }) {
  const [name, setName] = useState(table.name);
  const [playersCanRoll, setPlayers] = useState(table.playersCanRoll);
  const [items, setItems] = useState(table.items.map((i) => i.text).join('\n'));

  function save() {
    const list = items.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ text, weight: 1 }));
    intents.updateTable(table.id, { name: name.trim() || 'Table', playersCanRoll, items: list });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" style={{ width: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="dock-header"><h3>Edit table</h3><button className="link" onClick={onClose}>close</button></div>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="check-row">
          <input type="checkbox" checked={playersCanRoll} onChange={(e) => setPlayers(e.target.checked)} />
          Players can roll from table
        </label>
        <label>
          Items (one per line)
          <textarea rows={10} value={items} onChange={(e) => setItems(e.target.value)} placeholder={'Double down!\nReluctant negotiation\nDeference to Tuomo'} />
        </label>
        <div className="row">
          <button className="primary" style={{ width: 'auto' }} onClick={save}>Save</button>
          <button onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="link danger" onClick={() => { if (confirm(`Delete table "${table.name}"?`)) { intents.deleteTable(table.id); onClose(); } }}>delete</button>
        </div>
      </div>
    </div>
  );
}

/** Rollable tables section for the Directory panel. */
export function RollableTables() {
  const you = useGameStore((s) => s.you);
  const tables = useGameStore((s) => s.tableList);
  const [editing, setEditing] = useState<RollableTable | null>(null);
  const isDm = you?.role === 'dm';

  return (
    <div className="dir-section">
      <div className="dock-header">
        <h3>Rollable Tables</h3>
        {isDm && <button className="link" onClick={() => intents.createTable('New table')}>+ Add</button>}
      </div>
      <table className="tables-grid">
        <tbody>
          {tables.map((t) => (
            <tr key={t.id}>
              <td className="tables-name">{t.name}</td>
              <td className="dim">{t.items.length}</td>
              <td>
                <button className="link" disabled={t.items.length === 0} onClick={() => intents.rollTable(t.id)}>Roll</button>
                {isDm && <button className="link" onClick={() => setEditing(t)}>edit</button>}
              </td>
            </tr>
          ))}
          {tables.length === 0 && <tr><td colSpan={3} className="dim">{isDm ? 'No tables yet — add one.' : 'No tables available.'}</td></tr>}
        </tbody>
      </table>
      {editing && <TableEditor table={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
