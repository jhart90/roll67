import { useState } from 'react';
import { CLASS_LIST_5E, npcsForSystem, SWN_CLASS_LIST, type NpcEntry } from 'shared';
import { intents, useGameStore } from '../store/game';
import { openWindow } from '../store/windowManager';
import { useNpcPicker } from './useNpcPicker';

export function NpcLibrary({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const system = campaign?.system ?? 'dnd5e';
  const { search, setSearch, category, setCategory, categories, sort, setSort, entries } = useNpcPicker(system);
  const classRows = system === 'dnd5e'
    ? CLASS_LIST_5E.map((c) => ({ id: c.id, name: c.name }))
    : SWN_CLASS_LIST.map((c) => ({ id: c.id, name: c.name }));

  // The same search box also narrows the "quick add" rows above the main
  // compendium table -- otherwise typing e.g. "goblin" still leaves the
  // blank-sheet/class rows cluttering the top of an otherwise-filtered list.
  const q = search.trim().toLowerCase();
  const showBlank = !q || 'blank character sheet'.includes(q);
  const filteredClassRows = classRows.filter((c) => !q || c.name.toLowerCase().includes(q));

  function add(entry: NpcEntry) {
    intents.createNpc(entry.id);
    setAdded((prev) => ({ ...prev, [entry.id]: true }));
  }

  function createBlank() {
    intents.createCharacter('New Character', system);
    setAdded((prev) => ({ ...prev, __blank: true }));
  }

  function createClass(className: string, classId: string) {
    intents.createCharacter(`New ${className}`, system, undefined, className);
    setAdded((prev) => ({ ...prev, [`class:${classId}`]: true }));
  }

  let lastCategory = '';

  return (
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>NPC Library</h3>
          <span className="dim">{entries.length} of {npcsForSystem(system).length} · {system === 'dnd5e' ? 'D&D 5e' : 'Stars Without Number'}</span>
          <span className="spacer" />
          <button className="link" title="Randomize an NPC based on a compendium model" onClick={() => openWindow('randomizeNpc', 'main', {}, 'Randomize an NPC')}>🎲 Random NPC</button>
        </div>

        <div className="npc-controls">
          <input
            placeholder="Search by name or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="category">Sort: category</option>
            <option value="name">Sort: name</option>
            <option value="challenge">Sort: challenge</option>
            <option value="hp">Sort: HP</option>
          </select>
        </div>

        <div className="npc-list">
          <div className="npc-quickadd">
            {showBlank && (
              <>
                <div className="npc-quickadd-hint">New character</div>
                <table>
                  <tbody>
                    <tr>
                      <td className="npc-name">Blank character sheet</td>
                      <td className="dim" colSpan={3}>Start from a fresh, empty sheet</td>
                      <td><button className="link" disabled={!!added.__blank} onClick={createBlank}>{added.__blank ? 'created ✓' : '+ create'}</button></td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
            {filteredClassRows.length > 0 && (
              <>
                <div className="npc-quickadd-hint">New player character</div>
                <table>
                  <tbody>
                    {filteredClassRows.map((c) => (
                      <tr key={c.id}>
                        <td className="npc-name">{c.name}</td>
                        <td className="dim" colSpan={3}>A blank sheet with class pre-filled</td>
                        <td>
                          <button className="link" disabled={!!added[`class:${c.id}`]} onClick={() => createClass(c.name, c.id)}>
                            {added[`class:${c.id}`] ? 'created ✓' : '+ create'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Challenge</th>
                <th>AC</th>
                <th>HP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((n) => {
                const header = sort === 'category' && n.category !== lastCategory
                  ? (lastCategory = n.category)
                  : null;
                return (
                  <NpcRows key={n.id} entry={n} header={header} added={!!added[n.id]} onAdd={add} />
                );
              })}
              {entries.length === 0 && (
                <tr><td colSpan={5} className="dim">Nothing matches that search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
  );
}

function NpcRows({ entry, header, added, onAdd }: {
  entry: NpcEntry; header: string | null; added: boolean; onAdd: (e: NpcEntry) => void;
}) {
  return (
    <>
      {header && (
        <tr className="npc-category-row"><td colSpan={5}>{header}</td></tr>
      )}
      <tr>
        <td className="npc-name" title={String(entry.sheet.notes ?? '')}>{entry.name}</td>
        <td>{entry.challengeLabel}</td>
        <td>{entry.ac}</td>
        <td>{entry.hp}</td>
        <td>
          <button className="link" disabled={added} onClick={() => onAdd(entry)}>
            {added ? 'added ✓' : '+ add'}
          </button>
        </td>
      </tr>
    </>
  );
}
