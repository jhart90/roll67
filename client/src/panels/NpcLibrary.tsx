import { useState } from 'react';
import { CLASS_LIST_5E, npcsForSystem, SWN_CLASS_LIST, type CustomNpcView, type NpcEntry } from 'shared';
import { intents, useGameStore } from '../store/game';
import { openWindow } from '../store/windowManager';
import { npcAttackSummary, npcStatCols, type NpcStatCol } from './npcStatCols';
import { useNpcPicker } from './useNpcPicker';

export function NpcLibrary({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const customNpcs = useGameStore((s) => s.customNpcs);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const system = campaign?.system ?? 'dnd5e';
  const { search, setSearch, category, setCategory, categories, sort, setSort, entries } = useNpcPicker(system);
  // SWADE has no classes — only the blank-sheet quick start applies.
  const classRows = system === 'dnd5e'
    ? CLASS_LIST_5E.map((c) => ({ id: c.id, name: c.name }))
    : system === 'swn'
      ? SWN_CLASS_LIST.map((c) => ({ id: c.id, name: c.name }))
      : [];

  const q = search.trim().toLowerCase();
  const showBlank = !q || 'blank character sheet'.includes(q);
  const filteredClassRows = classRows.filter((c) => !q || c.name.toLowerCase().includes(q));
  const filteredCustom = customNpcs.filter((c) => !q || c.name.toLowerCase().includes(q));

  // A brief "added ✓" flash, then the button re-arms — the DM may want five
  // Training Dummies in a row, so the confirmation never locks the button.
  function flash(key: string) {
    setAdded((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => setAdded((prev) => ({ ...prev, [key]: false })), 1100);
  }

  function add(entry: NpcEntry) {
    intents.createNpc(entry.id);
    flash(entry.id);
  }

  function addCustom(entry: CustomNpcView) {
    intents.createNpc(entry.id);
    flash(entry.id);
  }

  function createBlank() {
    intents.createCharacter('New Character', system);
    flash('__blank');
  }

  function createClass(className: string, classId: string) {
    intents.createCharacter(`New ${className}`, system, undefined, className);
    flash(`class:${classId}`);
  }

  const statCols = npcStatCols(system);
  // Name + Challenge + stat columns + the add-button column.
  const colSpan = statCols.length + 3;
  let lastCategory = '';

  return (
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>NPC Library</h3>
          <span className="dim">{entries.length} of {npcsForSystem(system).length} · {system === 'dnd5e' ? 'D&D 5e' : system === 'swn' ? 'Stars Without Number' : 'Savage Worlds'}</span>
          <span className="spacer" />
          <button
            className="link"
            title="Build an NPC step by step with the same guided character creator players use"
            onClick={() => useGameStore.getState().setShowCharacterCreator(true)}
          >
            🧙 Creator wizard
          </button>
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
            <option value="hp">{system === 'swade' ? 'Sort: Toughness' : 'Sort: HP'}</option>
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
                      <td className="dim" colSpan={colSpan - 2}>Start from a fresh, empty sheet</td>
                      <td><button className="link" onClick={createBlank}>{added.__blank ? 'created ✓' : '+ create'}</button></td>
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
                        <td className="dim" colSpan={colSpan - 2}>A blank sheet with class pre-filled</td>
                        <td>
                          <button className="link" onClick={() => createClass(c.name, c.id)}>
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
                {statCols.map((c) => <th key={c.label} title={c.title}>{c.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((n) => {
                const header = sort === 'category' && n.category !== lastCategory
                  ? (lastCategory = n.category)
                  : null;
                return (
                  <NpcRows key={n.id} entry={n} header={header} added={!!added[n.id]} onAdd={add} statCols={statCols} colSpan={colSpan} />
                );
              })}
              {entries.length === 0 && (
                <tr><td colSpan={colSpan} className="dim">Nothing matches that search.</td></tr>
              )}
            </tbody>
          </table>

          {filteredCustom.length > 0 && (
            <table>
              <tbody>
                <tr className="npc-category-row"><td colSpan={colSpan}>Player Added</td></tr>
                {filteredCustom.map((c) => (
                  <tr key={c.id}>
                    <td className="npc-name">{c.name}</td>
                    <td>{c.challengeLabel || '—'}</td>
                    {statCols.map((col) => <td key={col.label}>{col.cell(c)}</td>)}
                    <td>
                      <button className="link" onClick={() => addCustom(c)}>
                        {added[c.id] ? 'added ✓' : '+ add'}
                      </button>
                      <button
                        className="link danger"
                        style={{ marginLeft: 6 }}
                        onClick={() => { if (confirm(`Remove "${c.name}" from your compendium?`)) intents.deleteCustomNpc(c.id); }}
                        title="Remove from compendium"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
  );
}

function NpcRows({ entry, header, added, onAdd, statCols, colSpan }: {
  entry: NpcEntry; header: string | null; added: boolean; onAdd: (e: NpcEntry) => void;
  statCols: NpcStatCol[]; colSpan: number;
}) {
  const attacks = entry.system === 'swade' ? npcAttackSummary(entry.sheet) : '';
  const hint = [String(entry.sheet.notes ?? ''), attacks].filter(Boolean).join('\n');
  return (
    <>
      {header && (
        <tr className="npc-category-row"><td colSpan={colSpan}>{header}</td></tr>
      )}
      <tr>
        <td className="npc-name" title={hint}>{entry.name}</td>
        <td>{entry.challengeLabel}</td>
        {statCols.map((c) => <td key={c.label}>{c.cell(entry)}</td>)}
        <td>
          <button className="link" onClick={() => onAdd(entry)}>
            {added ? 'added ✓' : '+ add'}
          </button>
        </td>
      </tr>
    </>
  );
}
