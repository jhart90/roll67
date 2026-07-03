import { useMemo, useState } from 'react';
import { npcCategories, npcsForSystem, type NpcEntry } from 'shared';
import { intents, useGameStore } from '../store/game';

type SortKey = 'category' | 'name' | 'challenge' | 'hp';

export function NpcLibrary({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('category');
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const system = campaign?.system ?? 'dnd5e';
  const categories = useMemo(() => npcCategories(system), [system]);

  const entries = useMemo(() => {
    let list = npcsForSystem(system);
    if (category !== 'all') list = list.filter((n) => n.category === category);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((n) =>
        n.name.toLowerCase().includes(q) || n.category.toLowerCase().includes(q));
    }
    const sorted = [...list];
    switch (sort) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'challenge':
        sorted.sort((a, b) => a.challenge - b.challenge || a.name.localeCompare(b.name));
        break;
      case 'hp':
        sorted.sort((a, b) => a.hp - b.hp || a.name.localeCompare(b.name));
        break;
      default:
        // category order as authored (logical grouping), by challenge within
        sorted.sort((a, b) => {
          const ca = categories.indexOf(a.category);
          const cb = categories.indexOf(b.category);
          return ca - cb || a.challenge - b.challenge || a.name.localeCompare(b.name);
        });
    }
    return sorted;
  }, [system, category, search, sort, categories]);

  function add(entry: NpcEntry) {
    intents.createNpc(entry.id);
    setAdded((prev) => ({ ...prev, [entry.id]: true }));
  }

  let lastCategory = '';

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>NPC Library</h3>
          <span className="dim">{entries.length} of {npcsForSystem(system).length} · {system === 'dnd5e' ? 'D&D 5e' : 'Stars Without Number'}</span>
          <span className="spacer" />
          <button className="link" title="Generate a random townsfolk NPC" onClick={() => intents.createRandomNpc(1)}>🎲 Random NPC</button>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <div className="npc-controls">
          <input
            placeholder="Search by name or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="category">Sort: category</option>
            <option value="name">Sort: name</option>
            <option value="challenge">Sort: challenge</option>
            <option value="hp">Sort: HP</option>
          </select>
        </div>

        <div className="npc-list">
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
