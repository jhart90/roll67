import { useMemo, useState } from 'react';
import type { Character, ContentEntry, ContentKind, SheetData } from 'shared';
import { applyEntry, contentForSystem, contentKinds, KIND_LABEL } from 'shared';
import { intents, useGameStore } from '../store/game';

/** Browse the SRD compendium and add items/spells/weapons to a character. */
export function Compendium({ character, onClose }: { character: Character; onClose: () => void }) {
  const you = useGameStore((s) => s.you);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ContentKind | 'all'>('all');
  const [added, setAdded] = useState<Record<string, number>>({});

  const kinds = useMemo(() => contentKinds(character.system), [character.system]);

  const entries = useMemo(() => {
    let list = contentForSystem(character.system);
    if (kind !== 'all') list = list.filter((c) => c.kind === kind);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
    return [...list].sort((a, b) =>
      a.kind === b.kind
        ? (a.order - b.order || a.name.localeCompare(b.name))
        : kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  }, [character.system, kind, search, kinds]);

  const canEdit = !!you && (you.role === 'dm' || character.ownerUserId === you.userId);

  function add(entry: ContentEntry) {
    const result = applyEntry(entry, character.sheet as SheetData);
    if (!result) return;
    const existing = Array.isArray(character.sheet[result.listId])
      ? (character.sheet[result.listId] as SheetData[])
      : [];
    intents.updateCharacter(character.id, { [result.listId]: [...existing, result.row] });
    setAdded((p) => ({ ...p, [entry.id]: (p[entry.id] ?? 0) + 1 }));
  }

  let lastKind = '';

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>Compendium</h3>
          <span className="dim">add to {character.name}</span>
          <span className="spacer" />
          <button className="link" onClick={onClose}>close</button>
        </div>

        <div className="npc-controls">
          <input placeholder="Search weapons, spells, gear…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <select value={kind} onChange={(e) => setKind(e.target.value as ContentKind | 'all')}>
            <option value="all">All types</option>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>

        {!canEdit && <p className="dim" style={{ padding: '8px 16px' }}>You can only add to your own characters.</p>}

        <div className="npc-list">
          <table>
            <tbody>
              {entries.map((entry) => {
                const header = entry.kind !== lastKind ? (lastKind = entry.kind) : null;
                return (
                  <>
                    {header && (
                      <tr key={`h-${header}`} className="npc-category-row">
                        <td colSpan={3}>{KIND_LABEL[entry.kind]}</td>
                      </tr>
                    )}
                    <tr key={entry.id}>
                      <td>
                        <div className="compendium-name">{entry.name}</div>
                        <div className="compendium-sub">{entry.subtitle}</div>
                      </td>
                      <td className="compendium-cat">{entry.category}</td>
                      <td>
                        {canEdit && (
                          <button className="link" onClick={() => add(entry)}>
                            {added[entry.id] ? `added${added[entry.id] > 1 ? ` ×${added[entry.id]}` : ''} ✓` : '+ add'}
                          </button>
                        )}
                      </td>
                    </tr>
                  </>
                );
              })}
              {entries.length === 0 && <tr><td className="dim">Nothing matches that search.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
