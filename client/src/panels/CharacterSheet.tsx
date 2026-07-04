import { useMemo, useState } from 'react';
import type { Character, SheetData } from 'shared';
import {
  canEditCharacter, castableLevels, combatActions, spellSlots, systemFor,
  type DerivedSection, type FieldDef, type ListSection, type Rollable, type SectionDef,
} from 'shared';
import { intents, useGameStore } from '../store/game';
import { Compendium } from './Compendium';
import { AssetPicker } from './AssetPicker';
import { LevelUpWizard } from './LevelUpWizard';
import { ClassFeatures } from './ClassFeatures';
import { SwnLevelUpWizard } from './SwnLevelUpWizard';
import { SwnFeatures } from './SwnFeatures';
import { CombatStatus } from './CombatStatus';

type AdvMode = null | 'adv' | 'dis';

function FieldInput({
  field, sheet, derived, readOnly, onPatch, onEditImage,
}: {
  field: FieldDef;
  sheet: SheetData;
  derived: Record<string, number | string>;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
  onEditImage?: (fieldId: string) => void;
}) {
  const value = sheet[field.id];
  const derivedBadge = derived[field.id] !== undefined ? String(derived[field.id]) : null;

  if (field.type === 'image') {
    const url = typeof value === 'string' ? value : '';
    return (
      <div className={`sheet-field w-${field.width ?? 'half'} image-field`}>
        <span>{field.label}</span>
        <div className="image-slot">
          {url ? <img src={url} alt={field.label} /> : <div className="image-empty">No image</div>}
          {!readOnly && (
            <button className="link" onClick={() => onEditImage?.(field.id)}>{url ? 'Change image' : 'Set image'}</button>
          )}
        </div>
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <label className={`sheet-field w-${field.width ?? 'third'} checkbox`}>
        <input
          type="checkbox"
          checked={value === true}
          disabled={readOnly}
          onChange={(e) => onPatch({ [field.id]: e.target.checked })}
        />
        <span>{field.label}</span>
        {derivedBadge && <span className="derived-badge">{derivedBadge}</span>}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className={`sheet-field w-${field.width ?? 'third'}`}>
        <span>{field.label}{derivedBadge && <span className="derived-badge">{derivedBadge}</span>}</span>
        <select
          value={typeof value === 'string' ? value : String(field.default ?? '')}
          disabled={readOnly}
          onChange={(e) => onPatch({ [field.id]: e.target.value })}
        >
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className={`sheet-field w-full`}>
        <span>{field.label}</span>
        <textarea
          rows={8}
          defaultValue={typeof value === 'string' ? value : ''}
          readOnly={readOnly}
          onBlur={(e) => {
            if (e.target.value !== value) onPatch({ [field.id]: e.target.value });
          }}
        />
      </label>
    );
  }

  // number / text: commit on blur or Enter.
  const listId = field.suggestions ? `dl-${field.id}` : undefined;
  return (
    <label className={`sheet-field w-${field.width ?? 'third'}`}>
      <span>{field.label}{derivedBadge && <span className="derived-badge">{derivedBadge}</span>}</span>
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        key={`${field.id}-${String(value)}`}
        defaultValue={value === undefined || value === null ? '' : String(value)}
        readOnly={readOnly}
        list={listId}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onBlur={(e) => {
          const raw = e.target.value;
          const next = field.type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw;
          if (field.type === 'number' && Number.isNaN(next)) return;
          if (next !== value) onPatch({ [field.id]: next });
        }}
      />
      {listId && (
        <datalist id={listId}>
          {field.suggestions!.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </label>
  );
}

function ListEditor({
  section, sheet, readOnly, onPatch,
}: {
  section: ListSection;
  sheet: SheetData;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
}) {
  const rows = Array.isArray(sheet[section.id]) ? (sheet[section.id] as SheetData[]) : [];

  function setRows(next: SheetData[]) {
    onPatch({ [section.id]: next });
  }

  function addRow() {
    const row: SheetData = {};
    for (const col of section.columns) {
      row[col.id] = col.default ?? (col.type === 'number' ? 0 : col.type === 'checkbox' ? false : '');
    }
    setRows([...rows, row]);
  }

  return (
    <div className="sheet-list">
      <table>
        <thead>
          <tr>
            {section.columns.map((c) => <th key={c.id}>{c.label}</th>)}
            {!readOnly && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {section.columns.map((col) => (
                <td key={col.id}>
                  {col.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={row[col.id] === true}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = rows.map((r, j) => (j === i ? { ...r, [col.id]: e.target.checked } : r));
                        setRows(next);
                      }}
                    />
                  ) : col.type === 'select' ? (
                    <select
                      value={typeof row[col.id] === 'string' ? String(row[col.id]) : String(col.default ?? '')}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = rows.map((r, j) => (j === i ? { ...r, [col.id]: e.target.value } : r));
                        setRows(next);
                      }}
                    >
                      {(col.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <>
                      <input
                        type={col.type === 'number' ? 'number' : 'text'}
                        defaultValue={row[col.id] === undefined ? '' : String(row[col.id])}
                        readOnly={readOnly}
                        list={col.suggestions ? `dl-${section.id}-${col.id}` : undefined}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => {
                          const raw = e.target.value;
                          const val = col.type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw;
                          if (col.type === 'number' && Number.isNaN(val)) return;
                          if (val === row[col.id]) return;
                          const next = rows.map((r, j) => (j === i ? { ...r, [col.id]: val } : r));
                          setRows(next);
                        }}
                      />
                      {col.suggestions && i === 0 && (
                        <datalist id={`dl-${section.id}-${col.id}`}>
                          {col.suggestions.map((s) => <option key={s} value={s} />)}
                        </datalist>
                      )}
                    </>
                  )}
                </td>
              ))}
              {!readOnly && (
                <td>
                  <button className="link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && <button className="link" onClick={addRow}>+ add {section.title.toLowerCase()}</button>}
    </div>
  );
}

function DerivedBlocks({
  section, derived,
}: {
  section: DerivedSection;
  derived: Record<string, number | string>;
}) {
  return (
    <div className="derived-row">
      {section.items.map((item) => (
        <div key={item.key} className="stat-block">
          <span className="stat-value">{derived[item.key] ?? '—'}</span>
          <span className="stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function Section({
  section, sheet, derived, readOnly, onPatch, onEditImage,
}: {
  section: SectionDef;
  sheet: SheetData;
  derived: Record<string, number | string>;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
  onEditImage?: (fieldId: string) => void;
}) {
  return (
    <section className="sheet-section">
      <h4>{section.title}</h4>
      {section.kind === 'fields' && (
        <div className="sheet-grid">
          {section.fields.map((f) => (
            <FieldInput key={f.id} field={f} sheet={sheet} derived={derived} readOnly={readOnly} onPatch={onPatch} onEditImage={onEditImage} />
          ))}
        </div>
      )}
      {section.kind === 'list' && (
        <ListEditor section={section} sheet={sheet} readOnly={readOnly} onPatch={onPatch} />
      )}
      {section.kind === 'derived' && <DerivedBlocks section={section} derived={derived} />}
    </section>
  );
}

function RollsColumn({ character, canRoll }: { character: Character; canRoll: boolean }) {
  const [adv, setAdv] = useState<AdvMode>(null);
  const schema = systemFor(character.system);
  const rollables = useMemo(() => schema.rollables(character.sheet), [schema, character.sheet]);
  const actions = useMemo(() => combatActions(character), [character]);
  const tokens = useGameStore((s) => s.tokens);
  const mapId = useGameStore((s) => s.map?.id ?? null);
  const myToken = useMemo(
    () => Object.values(tokens).find((t) => t.characterId === character.id && t.mapId === mapId),
    [tokens, character.id, mapId],
  );

  const groups = useMemo(() => {
    const out = new Map<string, Rollable[]>();
    for (const r of rollables) {
      if (!out.has(r.group)) out.set(r.group, []);
      out.get(r.group)!.push(r);
    }
    return out;
  }, [rollables]);

  return (
    <div className="rolls-column">
      <div className="adv-toggle">
        {([null, 'adv', 'dis'] as AdvMode[]).map((mode) => (
          <button
            key={String(mode)}
            className={adv === mode ? 'active' : ''}
            onClick={() => setAdv(mode)}
          >
            {mode === null ? 'normal' : mode === 'adv' ? 'advantage' : 'disadvantage'}
          </button>
        ))}
      </div>

      {actions.length > 0 && (
        <div className="roll-group">
          <h5>Actions</h5>
          {actions.map((a) => (
            <div key={a.id} className="roll-row">
              <button
                className={`roll-btn action-btn ${a.effect}`}
                disabled={!canRoll || !myToken}
                title={myToken ? `Range ${a.rangeFt} ft — pick a target` : "Place this character's token on the map first"}
                onClick={() => myToken && useGameStore.getState().beginTargeting(character.id, myToken.id, a, a.attackExpr ? adv : null)}
              >
                <span>{a.effect === 'heal' ? '🧪' : '⚔️'} {a.label}</span>
                <span className="action-meta">
                  {a.effect === 'heal' ? 'heal ' : ''}{a.amountExpr}{a.rangeFt > 5 ? ` · ${a.rangeFt}ft` : ''}
                </span>
              </button>
              {canRoll && (
                <button
                  className="roll-pin"
                  title="Pin to your toolbar"
                  onClick={() => intents.saveMacro({
                    name: a.label, command: '', characterId: character.id, actionId: a.id,
                    color: PIN_COLORS[Math.abs(hashStr(a.id)) % PIN_COLORS.length],
                  })}
                >
                  📌
                </button>
              )}
            </div>
          ))}
          {!myToken && <span className="dim action-hint">Place this token on the map to use actions.</span>}
        </div>
      )}
      {[...groups.entries()].map(([group, rolls]) => (
        <div key={group} className="roll-group">
          <h5>{group}</h5>
          {rolls.map((r) => {
            // Leveled spells spend a slot: disable when none is available.
            const options = r.slotLevel ? castableLevels(character.sheet, r.slotLevel) : null;
            const noSlots = options !== null && options.length === 0;
            return (
              <div key={r.id} className="roll-row">
                <button
                  className="roll-btn"
                  disabled={!canRoll || noSlots}
                  title={noSlots ? `No level-${r.slotLevel}+ spell slot available` : r.expr}
                  onClick={() => r.slotLevel
                    ? useGameStore.getState().beginCast(character.id, r.id, r.slotLevel, r.label)
                    : intents.sheetRoll(character.id, r.id, r.d20 ? adv : null)}
                >
                  <span>{r.label}{r.slotLevel ? <span className="slot-tag">L{r.slotLevel}</span> : null}</span>
                  <span className="roll-btn-expr">{r.expr}</span>
                </button>
                {canRoll && (
                  <button
                    className="roll-pin"
                    title="Pin to your toolbar"
                    onClick={() => intents.saveMacro({
                      name: r.label, command: '', characterId: character.id, rollableId: r.id,
                      color: PIN_COLORS[Math.abs(hashStr(r.id)) % PIN_COLORS.length],
                    })}
                  >
                    📌
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Spell-slot pips per level, with spend/regain and a long-rest reset. */
function SpellSlotTracker({ character, editable }: { character: Character; editable: boolean }) {
  const slots = spellSlots(character.sheet);
  if (slots.length === 0) return null;

  function setUsed(level: number, used: number) {
    intents.updateCharacter(character.id, { [`slotsUsed${level}`]: Math.max(0, used) });
  }
  function longRest() {
    const patch: SheetData = {};
    for (const s of slots) patch[`slotsUsed${s.level}`] = 0;
    intents.updateCharacter(character.id, patch);
  }

  return (
    <section className="sheet-section slot-tracker">
      <h4>
        Spell Slots
        {editable && <button className="link slot-rest" onClick={longRest}>Long rest ⟳</button>}
      </h4>
      <div className="slot-grid">
        {slots.map((s) => {
          const used = s.total - s.remaining;
          return (
            <div key={s.level} className="slot-cell">
              <span className="slot-lvl">L{s.level}</span>
              <span className="slot-pips">
                {Array.from({ length: s.total }).map((_, i) => (
                  <span key={i} className={`slot-pip ${i < s.remaining ? 'open' : 'used'}`} />
                ))}
              </span>
              <span className="slot-count">{s.remaining}/{s.total}</span>
              {editable && (
                <span className="slot-btns">
                  <button className="icon-btn" title="Spend a slot" disabled={s.remaining <= 0} onClick={() => setUsed(s.level, used + 1)}>−</button>
                  <button className="icon-btn" title="Regain a slot" disabled={used <= 0} onClick={() => setUsed(s.level, used - 1)}>+</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PIN_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8'];
function hashStr(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export function CharacterSheet() {
  const you = useGameStore((s) => s.you);
  const character = useGameStore((s) =>
    s.sheetCharacterId ? s.characters.find((c) => c.id === s.sheetCharacterId) : undefined);
  const [tabId, setTabId] = useState<string | null>(null);
  const [showCompendium, setShowCompendium] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [pickingField, setPickingField] = useState<string | null>(null);

  if (!character || !you) return null;
  const schema = systemFor(character.system);
  const derived = schema.derive(character.sheet);
  const editable = canEditCharacter(you.role, you.userId, character);
  const activeTab = schema.tabs.find((t) => t.id === tabId) ?? schema.tabs[0];

  function patch(p: SheetData) {
    if (character) intents.updateCharacter(character.id, p);
  }

  function applyImage(fieldId: string, url: string, assetId: string) {
    if (!character) return;
    // Setting the token image also carries the assetId so the server can
    // repaint this character's tokens on every map.
    const p: SheetData = { [fieldId]: url };
    if (fieldId === 'tokenImage') p.tokenImageAssetId = assetId;
    intents.updateCharacter(character.id, p);
    setPickingField(null);
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => {
      if (e.target === e.currentTarget) useGameStore.getState().openSheet(null);
    }}>
      <div className="sheet-window">
        <div className="sheet-header">
          <input
            className="sheet-name"
            key={character.id}
            defaultValue={character.name}
            readOnly={!editable}
            onBlur={(e) => {
              if (editable && e.target.value.trim() && e.target.value !== character.name) {
                intents.updateCharacter(character.id, {}, e.target.value.trim());
              }
            }}
          />
          <span className="dim">{schema.name}{character.ownerUserId ? '' : ' · NPC'}</span>
          <span className="spacer" />
          {editable && <button className="link" onClick={() => setShowLevelUp(true)}>⬆ Level Up</button>}
          {editable && <button className="link" onClick={() => setShowCompendium(true)}>+ Compendium</button>}
          <button className="link" onClick={() => useGameStore.getState().openSheet(null)}>close</button>
        </div>

        {showCompendium && <Compendium character={character} onClose={() => setShowCompendium(false)} />}
        {showLevelUp && (character.system === 'swn'
          ? <SwnLevelUpWizard character={character} onClose={() => setShowLevelUp(false)} />
          : <LevelUpWizard character={character} onClose={() => setShowLevelUp(false)} />)}

        <div className="sheet-tabs">
          {schema.tabs.map((t) => (
            <button key={t.id} className={t.id === activeTab.id ? 'active' : ''} onClick={() => setTabId(t.id)}>
              {t.title}
            </button>
          ))}
        </div>

        <div className="sheet-body">
          <div className="sheet-main">
            {activeTab.id === 'spells' && <SpellSlotTracker character={character} editable={editable} />}
            {activeTab.id === 'core' && character.system === 'dnd5e' && <ClassFeatures character={character} editable={editable} />}
            {activeTab.id === 'core' && character.system === 'swn' && <SwnFeatures character={character} editable={editable} />}
            {activeTab.id === 'core' && <CombatStatus character={character} editable={editable} />}
            {activeTab.sections.map((s) => (
              <Section
                key={s.id}
                section={s}
                sheet={character.sheet}
                derived={derived}
                readOnly={!editable}
                onPatch={patch}
                onEditImage={setPickingField}
              />
            ))}
          </div>
          <RollsColumn character={character} canRoll={editable} />
        </div>

        {you.role === 'dm' && (
          <div className="sheet-footer">
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (confirm(`Delete character "${character.name}"? This can't be undone.`)) {
                  intents.deleteCharacter(character.id);
                  useGameStore.getState().openSheet(null);
                }
              }}
            >
              Delete character
            </button>
          </div>
        )}
      </div>

      {pickingField && (
        <AssetPicker
          title={pickingField === 'tokenImage' ? 'Choose a token image' : 'Choose a portrait image'}
          onPick={(a) => applyImage(pickingField, a.url, a.id)}
          onClose={() => setPickingField(null)}
        />
      )}
    </div>
  );
}
