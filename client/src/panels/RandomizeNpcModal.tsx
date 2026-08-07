import { npcFlavorHint, type CustomNpcView, type NpcEntry } from 'shared';
import { intents, useGameStore } from '../store/game';
import { npcStatCols, type NpcStatCol } from './npcStatCols';
import { useNpcPicker } from './useNpcPicker';

/** Pick a compendium NPC to model a randomized NPC after: stats jitter a
 *  little, and the new name/description fit what the model actually is (a
 *  dragon doesn't end up with a townsfolk's name). */
export function RandomizeNpcModal({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const customNpcs = useGameStore((s) => s.customNpcs);
  const system = campaign?.system ?? 'dnd5e';
  const { search, setSearch, category, setCategory, categories, sort, setSort, entries } = useNpcPicker(system);

  const q = search.trim().toLowerCase();
  const filteredCustom = customNpcs.filter((c) => !q || c.name.toLowerCase().includes(q));

  function pick(entry: NpcEntry | CustomNpcView) {
    intents.createRandomNpc(1, entry.id);
    onClose();
  }

  const statCols = npcStatCols(system);
  // Name + Challenge + stat columns + the pick-button column.
  const colSpan = statCols.length + 3;
  let lastCategory = '';

  return (
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>Randomize an NPC</h3>
          <span className="dim">pick a model to base stats, name &amp; flavor on</span>
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
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="category">Sort: category</option>
            <option value="name">Sort: name</option>
            <option value="challenge">Sort: challenge</option>
            <option value="hp">{system === 'swade' ? 'Sort: Toughness' : 'Sort: HP'}</option>
          </select>
        </div>

        <div className="npc-list">
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
                return <ModelRow key={n.id} entry={n} header={header} onPick={pick} statCols={statCols} colSpan={colSpan} />;
              })}
              {filteredCustom.length > 0 && (
                <>
                  <tr className="npc-category-row"><td colSpan={colSpan}>Player Added</td></tr>
                  {filteredCustom.map((c) => (
                    <tr key={c.id}>
                      <td className="npc-name">{c.name}</td>
                      <td>{c.challengeLabel || '—'}</td>
                      {statCols.map((col) => <td key={col.label}>{col.cell(c)}</td>)}
                      <td><button className="link" onClick={() => pick(c)}>🎲 use as model</button></td>
                    </tr>
                  ))}
                </>
              )}
              {entries.length === 0 && filteredCustom.length === 0 && (
                <tr><td colSpan={colSpan} className="dim">Nothing matches that search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
  );
}

function ModelRow({ entry, header, onPick, statCols, colSpan }: {
  entry: NpcEntry; header: string | null; onPick: (e: NpcEntry) => void;
  statCols: NpcStatCol[]; colSpan: number;
}) {
  return (
    <>
      {header && (
        <tr className="npc-category-row"><td colSpan={colSpan}>{header}</td></tr>
      )}
      <tr>
        <td className="npc-name" title={npcFlavorHint(entry)}>{entry.name}</td>
        <td>{entry.challengeLabel}</td>
        {statCols.map((c) => <td key={c.label}>{c.cell(entry)}</td>)}
        <td><button className="link" onClick={() => onPick(entry)}>🎲 use as model</button></td>
      </tr>
    </>
  );
}
