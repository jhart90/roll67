import { useMemo, useState } from 'react';
import type { Character, ContentEntry, ContentKind, GameSystem, SheetData } from 'shared';
import { applyEntry, contentForSystem, contentKinds, contentSlug, KIND_LABEL } from 'shared';
import { intents, useGameStore } from '../store/game';

function parseCustomEntries(customItems: Array<{ id: string; entryJson: string }>): ContentEntry[] {
  const out: ContentEntry[] = [];
  for (const ci of customItems) {
    try {
      const entry = JSON.parse(ci.entryJson) as ContentEntry;
      entry.id = ci.id;
      out.push(entry);
    } catch { /* skip corrupt */ }
  }
  return out;
}

function CustomItemEditor({ system, entry, onSave, onCancel }: {
  system: GameSystem;
  entry?: ContentEntry;
  onSave: (entry: ContentEntry) => void;
  onCancel: () => void;
}) {
  const kinds = useMemo(() => contentKinds(system), [system]);
  const [kind, setKind] = useState<ContentKind>(entry?.kind ?? 'gear');
  const [name, setName] = useState(entry?.name ?? '');
  const [category, setCategory] = useState(entry?.category ?? 'Custom');
  const [subtitle, setSubtitle] = useState(entry?.subtitle ?? '');
  const [detail, setDetail] = useState(entry?.detail ?? '');

  const [damage, setDamage] = useState(entry?.weapon?.damage ?? '');
  const [damageType, setDamageType] = useState(entry?.weapon?.damageType ?? '');
  const [ability, setAbility] = useState<'str' | 'dex' | 'finesse' | 'ranged' | 'none'>(entry?.weapon?.ability ?? 'str');
  const [props, setProps] = useState(entry?.weapon?.props?.join(', ') ?? '');

  const [baseAc, setBaseAc] = useState(entry?.armor?.baseAc ?? 10);
  const [addDex, setAddDex] = useState(entry?.armor?.addDex ?? true);
  const [maxDex, setMaxDex] = useState(entry?.armor?.maxDex ?? undefined);

  const [cost, setCost] = useState(entry?.gear?.cost ?? '');
  const [gearNotes, setGearNotes] = useState(entry?.gear?.notes ?? '');

  function save() {
    if (!name.trim()) return;
    const e: ContentEntry = {
      id: entry?.id ?? contentSlug(system, kind, name),
      system,
      kind,
      name: name.trim(),
      category: category.trim() || 'Custom',
      order: 999,
      subtitle: subtitle.trim(),
      detail: detail.trim() || undefined,
    };
    if (kind === 'weapon') {
      e.weapon = { damage, damageType, ability, props: props.split(',').map((s) => s.trim()).filter(Boolean) };
    } else if (kind === 'armor') {
      e.armor = { baseAc, addDex, maxDex };
    } else if (kind === 'gear' || kind === 'magicitem') {
      e.gear = { cost: cost || undefined, notes: gearNotes || undefined };
    }
    onSave(e);
  }

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as ContentKind)} style={{ width: 120 }}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} autoFocus />
      </div>
      <input placeholder="Category (e.g. Martial Melee, Wondrous Item)" value={category} onChange={(e) => setCategory(e.target.value)} />
      <input placeholder="Subtitle (1-line summary)" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      <textarea placeholder="Longer description (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} style={{ resize: 'vertical' }} />

      {kind === 'weapon' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input placeholder="Damage (e.g. 1d8)" value={damage} onChange={(e) => setDamage(e.target.value)} style={{ width: 80 }} />
          <input placeholder="Damage type" value={damageType} onChange={(e) => setDamageType(e.target.value)} style={{ width: 100 }} />
          <select value={ability} onChange={(e) => setAbility(e.target.value as 'str' | 'dex' | 'finesse' | 'ranged' | 'none')}>
            <option value="str">STR</option><option value="dex">DEX</option>
            <option value="finesse">Finesse</option><option value="ranged">Ranged</option>
            <option value="none">None</option>
          </select>
          <input placeholder="Properties (comma-sep)" value={props} onChange={(e) => setProps(e.target.value)} style={{ flex: 1 }} />
        </div>
      )}
      {kind === 'armor' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label>Base AC <input type="number" value={baseAc} onChange={(e) => setBaseAc(+e.target.value)} style={{ width: 50 }} /></label>
          <label><input type="checkbox" checked={addDex} onChange={(e) => setAddDex(e.target.checked)} /> +DEX</label>
          <label>Max DEX <input type="number" value={maxDex ?? ''} onChange={(e) => setMaxDex(e.target.value ? +e.target.value : undefined)} style={{ width: 40 }} /></label>
        </div>
      )}
      {(kind === 'gear' || kind === 'magicitem') && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input placeholder="Cost (e.g. 50 gp)" value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: 100 }} />
          <input placeholder="Notes" value={gearNotes} onChange={(e) => setGearNotes(e.target.value)} style={{ flex: 1 }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="link" onClick={onCancel}>cancel</button>
        <button className="btn" onClick={save} disabled={!name.trim()}>Save</button>
      </div>
    </div>
  );
}

/**
 * Browse the SRD compendium. In the default mode it adds entries to a
 * character; when `onPick` is given it instead hands the entry back to the
 * caller (used to stock a shop from the compendium).
 */
export function Compendium({ character, system, onClose, onPick }: {
  character?: Character;
  system?: GameSystem;
  onClose: () => void;
  onPick?: (entry: ContentEntry) => void;
}) {
  const you = useGameStore((s) => s.you);
  const customItemsList = useGameStore((s) => s.customItems);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ContentKind | 'all'>('all');
  const [added, setAdded] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const isDm = you?.role === 'dm';
  const sys = (character?.system ?? system ?? 'dnd5e') as GameSystem;
  const kinds = useMemo(() => contentKinds(sys), [sys]);

  const customEntries = useMemo(() => parseCustomEntries(customItemsList), [customItemsList]);

  const entries = useMemo(() => {
    let list = [...contentForSystem(sys), ...customEntries.filter((e) => e.system === sys)];
    if (kind !== 'all') list = list.filter((c) => c.kind === kind);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
    return [...list].sort((a, b) =>
      a.kind === b.kind
        ? (a.order - b.order || a.name.localeCompare(b.name))
        : kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  }, [sys, kind, search, kinds, customEntries]);

  const customIds = useMemo(() => new Set(customItemsList.map((ci) => ci.id)), [customItemsList]);

  const canEdit = !!onPick || (!!you && !!character && (you.role === 'dm' || character.ownerUserId === you.userId));

  function add(entry: ContentEntry) {
    if (onPick) { onPick(entry); setAdded((p) => ({ ...p, [entry.id]: (p[entry.id] ?? 0) + 1 })); return; }
    if (!character) return;
    const result = applyEntry(entry, character.sheet as SheetData);
    if (!result) return;
    const existing = Array.isArray(character.sheet[result.listId])
      ? (character.sheet[result.listId] as SheetData[])
      : [];
    intents.updateCharacter(character.id, { [result.listId]: [...existing, result.row] });
    setAdded((p) => ({ ...p, [entry.id]: (p[entry.id] ?? 0) + 1 }));
  }

  function handleSaveCustom(entry: ContentEntry) {
    intents.createCustomItem(JSON.stringify(entry));
    setCreating(false);
  }

  function handleUpdateCustom(entry: ContentEntry) {
    if (!editingId) return;
    intents.updateCustomItem(editingId, JSON.stringify(entry));
    setEditingId(null);
  }

  let lastKind = '';

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-window npc-library">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>Compendium</h3>
          <span className="dim">add to {character ? character.name : 'shop'}</span>
          <span className="spacer" />
          {isDm && !creating && <button className="link" onClick={() => setCreating(true)}>+ custom item</button>}
          <button className="link" onClick={onClose}>close</button>
        </div>

        {creating && (
          <CustomItemEditor system={sys} onSave={handleSaveCustom} onCancel={() => setCreating(false)} />
        )}

        <div className="npc-controls">
          <input placeholder="Search weapons, spells, gear…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus={!creating} />
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
                const isCustom = customIds.has(entry.id);
                if (editingId === entry.id) {
                  return (
                    <tr key={entry.id}>
                      <td colSpan={3}>
                        <CustomItemEditor
                          system={sys}
                          entry={entry}
                          onSave={handleUpdateCustom}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  );
                }
                return (
                  <>
                    {header && (
                      <tr key={`h-${header}`} className="npc-category-row">
                        <td colSpan={3}>{KIND_LABEL[entry.kind]}</td>
                      </tr>
                    )}
                    <tr key={entry.id}>
                      <td>
                        <div className="compendium-name">
                          {entry.name}
                          {isCustom && <span className="dim" style={{ marginLeft: 4, fontSize: '0.8em' }}>(custom)</span>}
                        </div>
                        <div className="compendium-sub">{entry.subtitle}</div>
                      </td>
                      <td className="compendium-cat">{entry.category}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canEdit && (
                          <button className="link" onClick={() => add(entry)}>
                            {added[entry.id] ? `added${added[entry.id] > 1 ? ` ×${added[entry.id]}` : ''} ✓` : '+ add'}
                          </button>
                        )}
                        {isDm && isCustom && (
                          <>
                            {' '}
                            <button className="link" onClick={() => setEditingId(entry.id)} title="Edit">✏️</button>
                            {' '}
                            <button className="link" onClick={() => intents.deleteCustomItem(entry.id)} title="Delete">🗑️</button>
                          </>
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
