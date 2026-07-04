import { npcFlavorHint, type NpcEntry } from 'shared';
import { intents, useGameStore } from '../store/game';
import { useNpcPicker } from './useNpcPicker';

/** Pick a compendium NPC to model a randomized NPC after: stats jitter a
 *  little, and the new name/description fit what the model actually is (a
 *  dragon doesn't end up with a townsfolk's name). */
export function RandomizeNpcModal({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const system = campaign?.system ?? 'dnd5e';
  const { search, setSearch, category, setCategory, categories, sort, setSort, entries } = useNpcPicker(system);

  function pick(entry: NpcEntry) {
    intents.createRandomNpc(1, entry.id);
    onClose();
  }

  let lastCategory = '';

  return (
    <div className="sheet-backdrop" style={{ zIndex: 65 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>Randomize an NPC</h3>
          <span className="dim">pick a model to base stats, name &amp; flavor on</span>
          <span className="spacer" />
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
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
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
                return <ModelRow key={n.id} entry={n} header={header} onPick={pick} />;
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

function ModelRow({ entry, header, onPick }: {
  entry: NpcEntry; header: string | null; onPick: (e: NpcEntry) => void;
}) {
  return (
    <>
      {header && (
        <tr className="npc-category-row"><td colSpan={5}>{header}</td></tr>
      )}
      <tr>
        <td className="npc-name" title={npcFlavorHint(entry)}>{entry.name}</td>
        <td>{entry.challengeLabel}</td>
        <td>{entry.ac}</td>
        <td>{entry.hp}</td>
        <td><button className="link" onClick={() => onPick(entry)}>🎲 use as model</button></td>
      </tr>
    </>
  );
}
