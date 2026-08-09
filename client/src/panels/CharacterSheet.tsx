import { useMemo, useState, type ReactNode } from 'react';
import type { Character, CombatAction, GameSystem, SheetData } from 'shared';
import {
  AMMO_BY_ROF, canEditCharacter, castableLevels, combatActions, conditionsOf, needsNpcBoost, num, rows, spellSlots, str, swnReloadCheck, systemFor,
  type DerivedSection, type FieldDef, type ListSection, type Rollable, type SectionDef,
} from 'shared';
import { intents, useGameStore } from '../store/game';
import { Compendium } from './Compendium';
import { AssetPicker } from './AssetPicker';
import { LevelUpWizard } from './LevelUpWizard';
import { NpcBoostWizard } from './NpcBoostWizard';
import { ClassFeatures } from './ClassFeatures';
import { SwnLevelUpWizard } from './SwnLevelUpWizard';
import { SwnFeatures } from './SwnFeatures';
import { SwadeAdvanceWizard } from './SwadeAdvanceWizard';
import { CombatStatus } from './CombatStatus';
import { SheetTerm } from '../util/Term';
import { RollStatsTab } from './RollStats';
import { NotesTab } from './NotesTab';

/** Synthetic tab ids for views that aren't part of the system schema. */
const STATS_TAB = '__stats';
const NOTES_TAB = '__notes';

type AdvMode = null | 'adv' | 'dis';

function FieldInput({
  field, system, sheet, derived, readOnly, onPatch, onEditImage,
}: {
  field: FieldDef;
  system: GameSystem;
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
        <span><SheetTerm system={system} label={field.label} /></span>
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
        <span><SheetTerm system={system} label={field.label} /></span>
        {derivedBadge && <span className="derived-badge">{derivedBadge}</span>}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className={`sheet-field w-${field.width ?? 'third'}`}>
        <span><SheetTerm system={system} label={field.label} />{derivedBadge && <span className="derived-badge">{derivedBadge}</span>}</span>
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
        <span><SheetTerm system={system} label={field.label} /></span>
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
      <span><SheetTerm system={system} label={field.label} />{derivedBadge && <span className="derived-badge">{derivedBadge}</span>}</span>
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

const ATTACK_DETAIL_COLS = new Set(['save', 'onSave', 'saveDc', 'aoeShape', 'aoeSize', 'aoeWidth', 'condition', 'conditionSave', 'conditionDc']);

/** SWADE weapons carry too many fields for one table row — these move to a
 *  second line of the per-weapon card (identity/attack stats stay on the first). */
const SECONDARY_WEAPON_COLS = new Set(['parryBonus', 'wielded', 'ammo', 'maxAmmo', 'caliber', 'rof', 'notes']);

/** Does this attack carry a rider effect (forced save, inflicted condition,
 *  or AoE template)? Lights up the ⚡ button so configured attacks stand out. */
function attackHasRider(row: SheetData): boolean {
  return Boolean(str(row, 'save', '') || str(row, 'condition', '') || str(row, 'aoeShape', ''));
}

const RIDER_BTN_TITLE = 'Save / condition / AoE — rider effects this attack forces on its target (e.g. Vigor roll or be Stunned, a cone template)';

function ListEditor({
  section, system, sheet, readOnly, onPatch,
}: {
  section: ListSection;
  system: GameSystem;
  sheet: SheetData;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
}) {
  const rows = Array.isArray(sheet[section.id]) ? (sheet[section.id] as SheetData[]) : [];
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const hasDetail = section.id === 'attacks';

  const mainCols = hasDetail ? section.columns.filter((c) => !ATTACK_DETAIL_COLS.has(c.id)) : section.columns;

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

  function renderCell(col: FieldDef, row: SheetData, i: number) {
    if (col.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={row[col.id] === true}
          disabled={readOnly}
          onChange={(e) => {
            const next = rows.map((r, j) => (j === i ? { ...r, [col.id]: e.target.checked } : r));
            setRows(next);
          }}
        />
      );
    }
    if (col.type === 'select') {
      return (
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
      );
    }
    return (
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
    );
  }

  const detailRow = detailIdx !== null && detailIdx < rows.length ? rows[detailIdx] : null;
  // SWADE weapons: 13 fields is unreadable as one table row — render each
  // weapon as a two-line card instead (attack stats up top, logistics below).
  const twoRow = hasDetail && system === 'swade';

  if (twoRow) {
    return (
      <div className="sheet-list">
        {rows.map((row, i) => (
          <div key={i} className="weapon-card">
            <div className="weapon-card-row">
              {mainCols.filter((c) => !SECONDARY_WEAPON_COLS.has(c.id)).map((col) => (
                <label key={col.id} className={`wc-field ${col.id === 'name' ? 'wc-grow' : ''}`}>
                  <span className="wc-label"><SheetTerm system={system} label={col.label} /></span>
                  {renderCell(col, row, i)}
                </label>
              ))}
              <span className="spacer" />
              <button
                className="link"
                title={RIDER_BTN_TITLE}
                style={{ fontSize: 14, padding: '0 4px', opacity: detailIdx === i || attackHasRider(row) ? 1 : 0.4 }}
                onClick={() => setDetailIdx(detailIdx === i ? null : i)}
              >
                ⚡
              </button>
              {!readOnly && (
                <button className="link danger" onClick={() => {
                  if (detailIdx === i) setDetailIdx(null);
                  else if (detailIdx !== null && detailIdx > i) setDetailIdx(detailIdx - 1);
                  setRows(rows.filter((_, j) => j !== i));
                }}>×</button>
              )}
            </div>
            <div className="weapon-card-row">
              {mainCols.filter((c) => SECONDARY_WEAPON_COLS.has(c.id)).map((col) => (
                <label key={col.id} className={`wc-field ${col.id === 'notes' ? 'wc-grow' : ''} ${col.type === 'checkbox' ? 'wc-check' : ''}`}>
                  <span className="wc-label"><SheetTerm system={system} label={col.label} /></span>
                  {renderCell(col, row, i)}
                </label>
              ))}
            </div>
          </div>
        ))}
        {!readOnly && <button className="link" onClick={addRow}>+ add {section.title.toLowerCase()}</button>}
        {detailRow && detailIdx !== null && (
          <AttackDetailPopover
            section={section} system={system} readOnly={readOnly}
            rows={rows} detailRow={detailRow} detailIdx={detailIdx}
            renderCell={renderCell} setRows={setRows} onClose={() => setDetailIdx(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="sheet-list">
      <table>
        <thead>
          <tr>
            {mainCols.map((c) => <th key={c.id}><SheetTerm system={system} label={c.label} /></th>)}
            {hasDetail && <th />}
            {!readOnly && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {mainCols.map((col) => (
                <td key={col.id}>{renderCell(col, row, i)}</td>
              ))}
              {hasDetail && (
                <td>
                  <button
                    className="link"
                    title={RIDER_BTN_TITLE}
                    style={{ fontSize: 14, padding: '0 4px', opacity: detailIdx === i || attackHasRider(row) ? 1 : 0.4 }}
                    onClick={() => setDetailIdx(detailIdx === i ? null : i)}
                  >
                    ⚡
                  </button>
                </td>
              )}
              {!readOnly && (
                <td>
                  <button className="link danger" onClick={() => {
                    if (detailIdx === i) setDetailIdx(null);
                    else if (detailIdx !== null && detailIdx > i) setDetailIdx(detailIdx - 1);
                    setRows(rows.filter((_, j) => j !== i));
                  }}>×</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && <button className="link" onClick={addRow}>+ add {section.title.toLowerCase()}</button>}

      {hasDetail && detailRow && detailIdx !== null && (
        <AttackDetailPopover
          section={section} system={system} readOnly={readOnly}
          rows={rows} detailRow={detailRow} detailIdx={detailIdx}
          renderCell={renderCell} setRows={setRows} onClose={() => setDetailIdx(null)}
        />
      )}
    </div>
  );
}

/** The full-field editor for one attack row, shared by the table and the
 *  two-line SWADE weapon-card layouts. */
function AttackDetailPopover({
  section, system, readOnly, rows, detailRow, detailIdx, renderCell, setRows, onClose,
}: {
  section: ListSection;
  system: GameSystem;
  readOnly: boolean;
  rows: SheetData[];
  detailRow: SheetData;
  detailIdx: number;
  renderCell: (col: FieldDef, row: SheetData, i: number) => ReactNode;
  setRows: (next: SheetData[]) => void;
  onClose: () => void;
}) {
  return (
    <div className="attack-detail-popover">
      <div className="dock-header" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0, textTransform: 'none', color: 'var(--text)' }}>
          ⚡ {String(detailRow.name || 'Attack')} — Save / Condition / AoE
        </h4>
        <button className="link" onClick={onClose}>close</button>
      </div>
      <p className="dim" style={{ fontSize: 11, margin: '0 0 8px' }}>
        Rider effects the engine automates on a hit: a forced trait roll (with what a success
        spares), a condition inflicted on failure, and/or an area template instead of a single
        target. Leave blank for a plain weapon.
      </p>
      <div className="attack-detail-grid">
        {section.columns.filter((col) => ATTACK_DETAIL_COLS.has(col.id)).map((col) => (
          <label key={col.id} className={`${ATTACK_DETAIL_COLS.has(col.id) ? 'detail-field' : ''}${col.width === 'full' ? ' detail-full' : ''}`}>
            <SheetTerm system={system} label={col.label} />
            {col.width === 'full' ? (
              <textarea
                defaultValue={detailRow[col.id] === undefined ? '' : String(detailRow[col.id])}
                readOnly={readOnly}
                rows={2}
                style={{ resize: 'vertical', width: '100%' }}
                onBlur={(e) => {
                  const val = e.target.value;
                  if (val === detailRow[col.id]) return;
                  const next = rows.map((r, j) => (j === detailIdx ? { ...r, [col.id]: val } : r));
                  setRows(next);
                }}
              />
            ) : renderCell(col, detailRow, detailIdx)}
          </label>
        ))}
      </div>
    </div>
  );
}

function DerivedBlocks({
  section, system, derived,
}: {
  section: DerivedSection;
  system: GameSystem;
  derived: Record<string, number | string>;
}) {
  return (
    <div className="derived-row">
      {section.items.map((item) => (
        <div key={item.key} className="stat-block">
          <span className="stat-value">{derived[item.key] ?? '—'}</span>
          <span className="stat-label"><SheetTerm system={system} label={item.label} /></span>
        </div>
      ))}
    </div>
  );
}

function Section({
  section, system, sheet, derived, readOnly, onPatch, onEditImage,
}: {
  section: SectionDef;
  system: GameSystem;
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
            <FieldInput key={f.id} field={f} system={system} sheet={sheet} derived={derived} readOnly={readOnly} onPatch={onPatch} onEditImage={onEditImage} />
          ))}
        </div>
      )}
      {section.kind === 'list' && (
        <ListEditor section={section} system={system} sheet={sheet} readOnly={readOnly} onPatch={onPatch} />
      )}
      {section.kind === 'derived' && <DerivedBlocks section={section} system={system} derived={derived} />}
    </section>
  );
}

function RollsColumn({ character, canRoll }: { character: Character; canRoll: boolean }) {
  const [adv, setAdv] = useState<AdvMode>(null);
  /** Burst-capable action awaiting its rate-of-fire choice (modal). */
  const [rofPrompt, setRofPrompt] = useState<{ action: CombatAction; ammoLeft: number } | null>(null);
  const schema = systemFor(character.system);
  const rollables = useMemo(() => schema.rollables(character.sheet), [schema, character.sheet]);
  const actions = useMemo(() => combatActions(character), [character]);
  // SWN weapons with a magazine size get a self-only Reload action here —
  // it has no target, so it doesn't belong in combatActions()'s targeted list.
  const reloadable = useMemo(() => {
    // SWADE: any weapon with a magazine reloads as an action — no tracked
    // ammo boxes, but it feeds the Multi-Action penalty.
    if (character.system === 'swade') {
      return rows(character.sheet, 'attacks')
        .map((atk, i) => {
          // Rounds come from matching-caliber ammunition in inventory;
          // caliber-less legacy weapons still reload free.
          const caliber = str(atk, 'caliber', '').trim().toLowerCase();
          const rounds = caliber
            ? rows(character.sheet, 'inventory')
              .filter((it) => str(it, 'caliber', '').toLowerCase() === caliber)
              .reduce((a, it) => a + Math.max(0, num(it, 'qty', 0)), 0)
            : Infinity;
          const check = num(atk, 'ammo', 0) >= num(atk, 'maxAmmo', 0)
            ? { ok: false, reason: 'Already fully loaded.' }
            : rounds <= 0
              ? { ok: false, reason: `No ${caliber} rounds in inventory — add ammunition from the compendium.` }
              : { ok: true, ammoItemName: caliber ? `${caliber} rounds in inventory — an action` : 'the magazine — an action' };
          return { atk, i, check: check as ReturnType<typeof swnReloadCheck> };
        })
        .filter(({ atk }) => num(atk, 'maxAmmo', 0) > 0);
    }
    if (character.system !== 'swn') return [];
    return rows(character.sheet, 'attacks')
      .map((atk, i) => ({ atk, i, check: swnReloadCheck(character.sheet, i) }))
      .filter(({ atk }) => num(atk, 'maxAmmo', 0) > 0);
  }, [character]);
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
            title={character.system === 'swade' && mode === 'adv'
              ? 'Melee only: Wild Attack (+2 to hit and damage, but you become Vulnerable). For ranged bonuses, use the 🎯 Aim action.'
              : undefined}
            onClick={() => setAdv(mode)}
          >
            {character.system === 'swade'
              ? mode === null ? 'normal' : mode === 'adv' ? 'wild attack' : 'penalty −2'
              : mode === null ? 'normal' : mode === 'adv' ? 'advantage' : 'disadvantage'}
          </button>
        ))}
      </div>

      {actions.length > 0 && (
        <div className="roll-group">
          <h5>Actions</h5>
          {actions.map((a) => {
            // SWADE burst weapons: clicking the trigger opens a rate-of-fire
            // picker (a modal — the pane is too narrow for inline controls)
            // before targeting begins. The trigger greys only when even a
            // single shot (or the suppressive burst) can't be paid.
            const ammoLeft = a.source === 'attack'
              ? num(rows(character.sheet, 'attacks')[a.index] ?? {}, 'ammo', -1)
              : -1;
            const maxRof = a.rof ?? 1;
            const minNeeded = a.suppressive ? 3 * AMMO_BY_ROF[Math.min(6, maxRof)] : 1;
            const dry = ammoLeft >= 0 && ammoLeft < minNeeded;
            return (
            <div key={a.id} className="roll-row">
              <button
                className={`roll-btn action-btn ${a.effect}`}
                disabled={!canRoll || !myToken || dry}
                title={!myToken ? "Place this character's token on the map first"
                  : dry ? `Needs ${minNeeded} round${minNeeded === 1 ? '' : 's'} — only ${ammoLeft} left. Reload!`
                    : maxRof >= 2 && !a.suppressive ? 'Choose a rate of fire, then pick a target'
                      : (a.aoe ? `${a.aoe.shape} ${a.aoe.sizeFt}ft — aim it on the map` : `Range ${a.rangeFt} ft — pick a target`)}
                onClick={() => {
                  if (!myToken) return;
                  if (maxRof >= 2 && !a.suppressive) { setRofPrompt({ action: a, ammoLeft }); return; }
                  if (a.aoe) useGameStore.getState().beginAoeTargeting(character.id, myToken.id, a, a.attackExpr ? adv : null);
                  else useGameStore.getState().beginTargeting(character.id, myToken.id, a, a.attackExpr ? adv : null, undefined);
                }}
              >
                <span>{a.effect === 'heal' ? '🧪' : a.aoe ? '💥' : '⚔️'} {a.label}</span>
                <span className="action-meta">
                  {a.effect === 'heal' ? 'heal ' : ''}{a.amountExpr}{a.rangeFt > 5 ? ` · ${a.rangeFt}ft` : ''}
                  {maxRof >= 2 && !a.suppressive ? ` · RoF ${maxRof}` : ''}
                  {a.suppressive ? ` · ${minNeeded} rounds` : ''}
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
            );
          })}
          {character.system === 'swade' && actions.some((a) => a.ranged) && (() => {
            const aiming = conditionsOf(character.sheet).includes('aiming');
            return (
              <div className="roll-row">
                <button
                  className="roll-btn action-btn"
                  disabled={!canRoll || !myToken || aiming}
                  title={aiming
                    ? 'Already aiming — the bonus rides your FIRST action next turn if it’s a ranged attack.'
                    : 'Spend the WHOLE turn drawing a bead: no moving, nothing else. Your FIRST action next turn — if it’s a ranged attack — ignores up to 4 points of range/cover penalties (+2 if none). Moving or doing anything else first loses it.'}
                  onClick={() => { if (myToken) intents.combatAim(character.id, myToken.id); }}
                >
                  <span>🎯 Aim{aiming ? 'ing…' : ''}</span>
                  <span className="action-meta">whole turn · next shot</span>
                </button>
              </div>
            );
          })()}
          {!myToken && <span className="dim action-hint">Place this token on the map to use actions.</span>}
        </div>
      )}
      {reloadable.length > 0 && (
        <div className="roll-group">
          <h5>Reload</h5>
          {reloadable.map(({ atk, i, check }) => (
            <div key={i} className="roll-row">
              <button
                className="roll-btn"
                disabled={!canRoll || !check.ok}
                title={check.ok ? `Reload from ${check.ammoItemName}` : check.reason}
                onClick={() => intents.reloadWeapon(character.id, i)}
              >
                <span>🔄 Reload {str(atk, 'name', 'Weapon')}</span>
                <span className="roll-btn-expr">{num(atk, 'ammo', 0)}/{num(atk, 'maxAmmo', 0)}</span>
              </button>
            </div>
          ))}
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

      {rofPrompt && myToken && (
        <div className="sheet-backdrop" style={{ zIndex: 80 }} onPointerDown={(e) => { if (e.target === e.currentTarget) setRofPrompt(null); }}>
          <div className="panel levelup rof-modal">
            <div className="dock-header"><h3>🔫 {rofPrompt.action.label} — rate of fire</h3></div>
            <p className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>
              How many Shooting dice this attack throws. RoF 2+ takes <b>−2 Recoil</b> and burns the
              ammo table below; a raise lands an extra hit.
              {rofPrompt.ammoLeft >= 0 ? ` (${rofPrompt.ammoLeft} rounds loaded.)` : ''}
            </p>
            {Array.from({ length: rofPrompt.action.rof ?? 1 }, (_, i) => i + 1).map((r) => {
              const cost = AMMO_BY_ROF[Math.min(6, r)];
              const short = rofPrompt.ammoLeft >= 0 && rofPrompt.ammoLeft < cost;
              return (
                <button
                  key={r}
                  className="roll-btn"
                  disabled={short}
                  title={short ? `Needs ${cost} rounds — only ${rofPrompt.ammoLeft} left.` : undefined}
                  onClick={() => {
                    const a = rofPrompt.action;
                    setRofPrompt(null);
                    useGameStore.getState().beginTargeting(character.id, myToken.id, a, a.attackExpr ? adv : null, r);
                  }}
                >
                  <span>RoF {r}{r >= 2 ? ' · −2 Recoil' : ''}</span>
                  <span className="roll-btn-expr">{cost} round{cost === 1 ? '' : 's'}{short ? ' — not enough' : ''}</span>
                </button>
              );
            })}
            <button onClick={() => setRofPrompt(null)}>Cancel</button>
          </div>
        </div>
      )}
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

export function CharacterSheetWindow({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const you = useGameStore((s) => s.you);
  const character = useGameStore((s) => s.characters.find((c) => c.id === characterId));
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
    <>
      <div className="sheet-window">
        <div className="sheet-header">
          <input
            className="sheet-name"
            key={`${character.id}-${character.name}`}
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
          {editable && (
            <button className="link" onClick={() => setShowLevelUp(true)}>
              {character.system === 'swade' ? '⬆ Advance' : '⬆ Level Up'}
            </button>
          )}
          {/* Handing out gear is the DM's call — players don't shop the
              compendium straight onto their own sheets. */}
          {you.role === 'dm' && <button className="link" onClick={() => setShowCompendium(true)}>+ Compendium</button>}
        </div>

        {showCompendium && you.role === 'dm' && <Compendium character={character} onClose={() => setShowCompendium(false)} />}
        {showLevelUp && (character.system === 'swade'
          ? <SwadeAdvanceWizard character={character} onClose={() => setShowLevelUp(false)} />
          : character.system === 'swn'
            ? <SwnLevelUpWizard character={character} onClose={() => setShowLevelUp(false)} />
            : needsNpcBoost(String(character.sheet.class ?? ''))
              ? <NpcBoostWizard character={character} onClose={() => setShowLevelUp(false)} />
              : <LevelUpWizard character={character} onClose={() => setShowLevelUp(false)} />)}

        <div className="sheet-tabs">
          {schema.tabs.map((t) => (
            <button key={t.id} className={t.id === activeTab.id && tabId !== STATS_TAB && tabId !== NOTES_TAB ? 'active' : ''} onClick={() => setTabId(t.id)}>
              {t.title}
            </button>
          ))}
          <button className={tabId === NOTES_TAB ? 'active' : ''} onClick={() => setTabId(NOTES_TAB)}>
            📝 Notes
          </button>
          <button className={tabId === STATS_TAB ? 'active' : ''} onClick={() => setTabId(STATS_TAB)}>
            📊 Roll Stats
          </button>
        </div>

        {tabId === STATS_TAB || tabId === NOTES_TAB ? (
          <div className="sheet-body">
            <div className="sheet-main">
              {tabId === STATS_TAB
                ? <RollStatsTab characterId={character.id} />
                : <NotesTab character={character} editable={editable} />}
            </div>
          </div>
        ) : (
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
                system={character.system}
                sheet={character.sheet}
                derived={derived}
                readOnly={!editable}
                onPatch={patch}
                onEditImage={setPickingField}
              />
            ))}

            {you.role === 'dm' && (
              <div className="sheet-delete-row">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    intents.saveToCompendium(character.id);
                    alert(`"${character.name}" added to your compendium.`);
                  }}
                >
                  Add to Compendium
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (confirm(`Delete character "${character.name}"? This can't be undone.`)) {
                      intents.deleteCharacter(character.id);
                      onClose();
                    }
                  }}
                >
                  Delete character
                </button>
              </div>
            )}
          </div>
          <RollsColumn character={character} canRoll={editable} />
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
    </>
  );
}
