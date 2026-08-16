import { useMemo, useState } from 'react';
import type { Character, CombatAction, GameSystem, SheetData } from 'shared';
import {
  AMMO_BY_ROF, applyArcaneBackground, canEditCharacter, castableLevels, combatActions, conditionsOf, num, playerColorFor, rows, spellSlots, str, swadeAmmoLeft, swadeStowedRollable, swnReloadCheck, systemFor,
  type DerivedSection, type FieldDef, type ListSection, type Rollable, type SectionDef, type SheetCard,
} from 'shared';
import { COVER_LABEL, COVER_OPTIONS, COVER_PENALTY, type CoverGrade } from 'shared';
import { intents, useGameStore, CALLED_SHOT_PENDING } from '../store/game';
import { CardBackFieldPreview } from './CardBackEditor';
import { OwnerSelect } from '../util/OwnerSelect';
import { openWindow } from '../store/windowManager';
import { ClassFeatures } from './ClassFeatures';
import { SwnFeatures } from './SwnFeatures';
import { CombatStatus } from './CombatStatus';
import { SheetTerm } from '../util/Term';
import { RollStatsTab } from './RollStats';
import { NotesTab } from './NotesTab';
import { ConfirmButton } from '../util/ConfirmButton';

/** The neutral token color a sheet shows before anyone picks one. */
const DEFAULT_TOKEN_COLOR = '#6c9bd2';

/** Synthetic tab ids for views that aren't part of the system schema. */
const STATS_TAB = '__stats';
const NOTES_TAB = '__notes';

/**
 * The attack-mode toggle. 'called' is a UI mode only — it decides which
 * prompt opens, and the roll it produces goes out with adv=null plus a
 * calledShot aim, so it must never reach the server in the adv slot.
 */
type AdvMode = null | 'adv' | 'dis' | 'called';
/** adv as the wire accepts it: 'called' is not one of its values. */
const wireAdv = (m: AdvMode): 'adv' | 'dis' | null => (m === 'adv' || m === 'dis' ? m : null);

function FieldInput({
  field, system, sheet, derived, readOnly, onPatch, onEditImage, onEditCardBack, inheritedColor,
}: {
  field: FieldDef;
  system: GameSystem;
  sheet: SheetData;
  derived: Record<string, number | string>;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
  onEditImage?: (fieldId: string) => void;
  /** Opens the card-back studio window — the field itself only previews. */
  onEditCardBack?: () => void;
  /** What this character's color actually is when the sheet hasn't set one:
   *  their player's own color. Showing the app default here would lie. */
  inheritedColor?: string;
}) {
  const value = sheet[field.id];
  const derivedText = derived[field.id] !== undefined ? String(derived[field.id]) : null;
  // A derived value shown INSIDE the empty box rather than on a badge beside
  // the label — see FieldDef.derivedAs. It is what the field holds until
  // somebody types over it, so that is where it belongs.
  const derivedPlaceholder = field.derivedAs === 'placeholder' ? derivedText : null;
  const derivedBadge = field.derivedAs === 'placeholder' ? null : derivedText;

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

  if (field.type === 'color') {
    // Blank means "no choice made" — show the swatch at the neutral default
    // rather than black, which reads as a deliberate pick.
    const current = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value
      : (inheritedColor ?? DEFAULT_TOKEN_COLOR);
    const inherited = !(typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value));
    return (
      <label className={`sheet-field w-${field.width ?? 'half'} color-field`}>
        <span><SheetTerm system={system} label={field.label} /></span>
        <span className="color-row">
          <input
            type="color"
            value={current}
            disabled={readOnly}
            onChange={(e) => onPatch({ [field.id]: e.target.value })}
          />
          <span className="dim">{current}{inherited ? ' · from your player color' : ''}</span>
        </span>
      </label>
    );
  }

  if (field.type === 'cardback') {
    // The sheet shows only the card as it currently is; the sixteen patterns,
    // sixteen borders and the paint live in their own window. A studio is a
    // browse, and a browse does not belong crammed into a sheet row.
    return (
      <div className={`sheet-field w-${field.width ?? 'full'} cardback-field`}>
        <span><SheetTerm system={system} label={field.label} /></span>
        <CardBackFieldPreview value={value} readOnly={readOnly} onOpen={() => onEditCardBack?.()} />
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
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'multiselect') {
    // Stored as one comma-separated string, the same shape the plain text
    // field it replaces used, so nothing downstream had to change. Values
    // already on a sheet that are no longer offered still show as chips and
    // can still be removed — a schema that drops an option must never strand
    // a creature holding it.
    const picked = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const remaining = (field.options ?? []).filter((o) => o && !picked.includes(o));
    const set = (list: string[]) => onPatch({ [field.id]: list.join(', ') });
    return (
      <label className={`sheet-field w-${field.width ?? 'full'} multiselect-field`}>
        <span><SheetTerm system={system} label={field.label} />{derivedBadge && <span className="derived-badge">{derivedBadge}</span>}</span>
        <span className="ms-row">
          {picked.map((p) => (
            <span key={p} className="ms-chip">
              {field.optionLabels?.[p] ?? p}
              {!readOnly && (
                <button type="button" title={`Remove ${p}`} onClick={() => set(picked.filter((x) => x !== p))}>×</button>
              )}
            </span>
          ))}
          {!readOnly && remaining.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) set([...picked, e.target.value]); }}
            >
              <option value="">{picked.length ? '+ add…' : 'none — add…'}</option>
              {remaining.map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>)}
            </select>
          )}
          {readOnly && picked.length === 0 && <span className="dim">none</span>}
        </span>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className={`sheet-field w-full`}>
        <span><SheetTerm system={system} label={field.label} /></span>
        <textarea
          rows={8}
          maxLength={field.maxLength}
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
        // A field standing at its derived value shows nothing of its own, so
        // the placeholder can be read: 0 in an override box means "not set".
        defaultValue={value === undefined || value === null || (derivedPlaceholder && value === 0) ? '' : String(value)}
        placeholder={derivedPlaceholder ?? undefined}
        readOnly={readOnly}
        maxLength={field.type === 'number' ? undefined : field.maxLength}
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

/**
 * What the tick box says when it is OFF.
 *
 * An unticked box beside the word "Equipped" is ambiguous at a glance — it
 * reads as a label for the row as easily as a state. Saying the negative
 * outright means the card always states the fact rather than naming the
 * question, whichever way the box is set.
 */
const UNSET_EQUIP_LABEL: Record<string, string> = {
  Equipped: 'Unequipped',
  Worn: 'Not being worn',
  Wielded: 'Not being wielded',
};
function equipLabel(label: string, on: boolean): string {
  if (on) return label;
  return UNSET_EQUIP_LABEL[label] ?? `Not ${label.toLowerCase()}`;
}

const ATTACK_DETAIL_COLS = new Set(['save', 'onSave', 'saveDc', 'aoeShape', 'aoeSize', 'aoeHexes', 'aoeWidth', 'condition', 'conditionSave', 'conditionDc', 'evadable']);

/** Does this attack carry a rider effect (forced save, inflicted condition,
 *  or AoE template)? Lights up the ⚡ button so configured attacks stand out. */
function attackHasRider(row: SheetData): boolean {
  return Boolean(str(row, 'save', '') || str(row, 'condition', '') || str(row, 'aoeShape', '')
    || row.evadable === true);
}

/**
 * Card sections that get a "show this in chat" button: the kit and the
 * character traits — the things a table asks each other about mid-session.
 * Spells and powers are left out; those already have their own roll buttons,
 * which post far more than a description.
 */
const POSTABLE_SECTIONS = new Set([
  'attacks', 'armor', 'inventory', 'cyberware',
  'edges', 'hindrances', 'racialTraits', 'features', 'foci',
]);

/** Sections that stay a compact table: skill lists are die ratings the table
 *  flips through constantly mid-session — cards would slow that down. */
const TABLE_SECTIONS = new Set(['skills']);

/** Facts a card must never hide even when they match the column default —
 *  a weapon with no damage listed reads as broken, not as clean. */
/**
 * A card chip's classes.
 *
 * Severity is the one tone that splits by its own text: a Minor hindrance is
 * red and a Major one is black, because "how bad is this" is the question the
 * chip exists to answer and two shades of the same violet made the reader
 * work it out from the word. Exported so the chat log's copy of a card and
 * the sheet's own cannot drift apart.
 */
export function chipClass(tone: string, text: string): string {
  const sev = text === 'Major' ? ' chip-major' : text === 'Minor' ? ' chip-minor' : '';
  return `sc-chip tone-${tone}${sev}`;
}

const ALWAYS_SHOW = new Set(['damage', 'die', 'severity']);

/** The "is this in my hands / on my body" flag, by section. Surfaced as a
 *  checkbox on the card itself rather than buried in the editor, because it
 *  is the one field that changes constantly during play. */
/**
 * Cards that are always-on parts of the character read in their own color,
 * matching what "equipped" already means elsewhere: green for an advantage
 * you have (an Edge, a wielded weapon), red for something working against you.
 */
const SECTION_THEME: Record<string, string> = {
  edges: 'card-good',        // green — an advantage you have
  hindrances: 'card-bad',    // red — something working against you
  racialTraits: 'card-info', // blue — what you were born with
  powers: 'card-info',       // blue — the same 'what you can do' family
};

const EQUIP_COL: Record<string, string> = {
  attacks: 'wielded', inventory: 'equipped', armor: 'equipped',
};

/**
 * How an open weapon editor is laid out: what the thing IS, how far it
 * reaches, what feeds it, and what it does to whoever it lands on.
 *
 * A flat grid of eighteen boxes put Poison next to Parry mod and buried the
 * ammunition between them, so finding a field meant reading all of them. The
 * order here is the order the questions get asked, and anything a schema adds
 * that this does not name still appears — under "More", never dropped.
 */
const ATTACK_GROUPS: Array<{ title: string | null; ids: string[] }> = [
  { title: null, ids: ['name', 'skill', 'damage', 'dtype'] },
  { title: 'Reach & bite', ids: ['range', 'ap', 'rof', 'parryBonus', 'heavy', 'swat', 'hardRange'] },
  { title: 'Ammunition', ids: ['ammo', 'maxAmmo', 'caliber'] },
  { title: 'Venom', ids: ['poison', 'infection', 'poisonMod', 'poisonEffect'] },
  { title: 'Bookkeeping', ids: ['weight', 'notes'] },
];

interface FieldGroup { title: string | null; cols: FieldDef[] }

function fieldGroups(section: ListSection, cols: FieldDef[], equipId?: string): FieldGroup[] {
  // The equip tick is drawn in the card's own corner, so it is not a field.
  const usable = cols.filter((c) => c.id !== equipId);
  if (section.id !== 'attacks') return [{ title: null, cols: usable }];
  const byId = new Map(usable.map((c) => [c.id, c]));
  const out: FieldGroup[] = [];
  const claimed = new Set<string>();
  for (const g of ATTACK_GROUPS) {
    const picked = g.ids.flatMap((id) => {
      const col = byId.get(id);
      if (!col) return [];
      claimed.add(id);
      return [col];
    });
    if (picked.length > 0) out.push({ title: g.title, cols: picked });
  }
  const rest = usable.filter((c) => !claimed.has(c.id));
  if (rest.length > 0) out.push({ title: 'More', cols: rest });
  return out;
}

/** These ids pair up into one chip instead of appearing as two. */
const PAIRED = new Set(['bonusAmt', 'maxAmmo', 'amount']);

/** Chip label: the column label minus any parenthetical hint —
 *  'Armor (+Toughness)' → 'Armor', but 'Armor vs ranged' stays whole. */
const chipLabel = (label: string) => label.replace(/\s*\(.*?\)/g, '').trim();

/**
 * Every fact on a card gets a tone, so a glance separates a damage die from a
 * range from a penalty. Tones are semantic, not decorative: the same kind of
 * fact wears the same color on every card in every system.
 */
type ChipTone =
  | 'damage' | 'skill' | 'range' | 'ammo' | 'bonus' | 'penalty'
  | 'severity' | 'qty' | 'weight' | 'use' | 'flag' | 'plain';
interface Chip { text: string; tone: ChipTone }

const NUMERIC_TONE: Record<string, ChipTone> = {
  range: 'range', rof: 'ammo', ap: 'damage', qty: 'qty', weight: 'weight',
  armor: 'bonus', rangedArmor: 'bonus', level: 'plain', cost: 'use',
};
const TEXT_TONE: Record<string, ChipTone> = {
  damage: 'damage', die: 'damage', skill: 'skill', dtype: 'damage',
  severity: 'severity', caliber: 'ammo', amount: 'use', discipline: 'skill',
  arcaneSkill: 'skill', duration: 'plain',
};

/** Long free-text columns render as the card's footnote line, not a chip. */
const NOTE_COLS = new Set(['notes', 'description', 'effect_text']);

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * The card face: every meaningful fact as a compact chip, nothing for blank
 * fields. Pairs collapse (trait bonus + amount → "+2 Notice"; ammo + mag →
 * "Ammo 3/8"), signed modifiers keep their sign, checkboxes appear only when
 * ticked, and anything still at its default stays silent — except the
 * ALWAYS_SHOW facts that define the row.
 */
function cardChips(section: ListSection, row: SheetData): { chips: Chip[]; notes: string[] } {
  const chips: Chip[] = [];
  const notes: string[] = [];
  const push = (text: string, tone: ChipTone) => chips.push({ text, tone });
  for (const col of section.columns) {
    if (col.id === 'name' || PAIRED.has(col.id) || (section.id === 'attacks' && ATTACK_DETAIL_COLS.has(col.id))) continue;
    const v = row[col.id];
    if (NOTE_COLS.has(col.id)) {
      if (typeof v === 'string' && v.trim()) notes.push(v.trim());
      continue;
    }
    if (col.type === 'checkbox') {
      // The equip flag has its own checkbox on the card.
      if (col.id === EQUIP_COL[section.id]) continue;
      if (v === true) push(col.label, 'flag');
      continue;
    }
    if (col.id === 'bonusSkill') {
      const amt = num(row, 'bonusAmt', 0);
      const skill = typeof v === 'string' ? v.trim() : '';
      if (skill && amt !== 0) push(`${signed(amt)} ${skill}`, amt < 0 ? 'penalty' : 'bonus');
      continue;
    }
    if (col.id === 'ammo') {
      const mag = num(row, 'maxAmmo', 0);
      if (mag > 0) push(`Ammo ${num(row, 'ammo', 0)}/${mag}`, 'ammo');
      continue;
    }
    if (col.id === 'effect') {
      // A usable item reads as its action: "heal 2d6".
      const use = typeof v === 'string' ? v.trim() : '';
      if (use && use !== 'none') push(`${use} ${str(row, 'amount', '')}`.trim(), 'use');
      continue;
    }
    if (v === undefined || v === null || v === '' || v === 'none') continue;
    if (!ALWAYS_SHOW.has(col.id) && v === (col.default ?? (col.type === 'number' ? 0 : undefined))) continue;
    if (col.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) continue;
      // Modifier columns read as "+1 Parry"; plain quantities as "Qty 3".
      if (/bonus|mod/i.test(col.id)) push(`${signed(n)} ${chipLabel(col.label)}`, n < 0 ? 'penalty' : 'bonus');
      else push(`${chipLabel(col.label)} ${n}`, NUMERIC_TONE[col.id] ?? 'qty');
      continue;
    }
    const s = String(v).trim();
    if (!s) continue;
    // Selects and short texts: severity/damage-type read alone; the rest get
    // their label so a bare value like "12ga" stays decipherable.
    const bare = col.id === 'severity' || col.id === 'dtype' || col.id === 'skill' || col.id === 'damage' || col.id === 'die';
    push(bare ? s : `${chipLabel(col.label)} ${s}`, TEXT_TONE[col.id] ?? 'plain');
  }
  return { chips, notes };
}

/** One-line summary of an attack's rider for the card face. */
function riderSummary(row: SheetData): string {
  const parts: string[] = [];
  const save = str(row, 'save', '');
  const cond = str(row, 'condition', '');
  const shape = str(row, 'aoeShape', '');
  if (save) parts.push(`${save} save`);
  if (cond) parts.push(cond);
  if (shape) parts.push(`${shape} ${str(row, 'aoeSize', '')}`.trim());
  return parts.join(' · ');
}

const RIDER_BTN_TITLE = 'Save / condition / AoE — rider effects this attack forces on its target (e.g. Vigor roll or be Stunned, a cone template)';

function ListEditor({
  section, system, sheet, readOnly, onPatch, onEquipChange, onPostCard,
}: {
  section: ListSection;
  system: GameSystem;
  sheet: SheetData;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
  /** Announce a kit change at the table (equipping is public information). */
  onEquipChange?: (itemName: string, verbLabel: string, on: boolean) => void;
  /** Put this card in the chat log — its name, its chips, and its notes.
   *  Absent for sections where a card has nothing worth reading out. */
  onPostCard?: (card: SheetCard) => void;
}) {
  const rows = Array.isArray(sheet[section.id]) ? (sheet[section.id] as SheetData[]) : [];
  // Index of the card whose pencil is open (full editor), or null.
  const [editIdx, setEditIdx] = useState<number | null>(null);
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
    // Open the new card's editor straight away — it has nothing to show yet.
    setEditIdx(rows.length);
    setRows([...rows, row]);
  }

  /**
   * A locked row's cell: what the value SAYS, not a control to change it.
   * The skills table spends its life being read — a die rating glanced at
   * mid-roll — and a grid of live inputs invites the mis-click that quietly
   * rewrites a character.
   */
  function renderStatic(col: FieldDef, row: SheetData, sheetData: SheetData) {
    if (col.compute) return renderComputed(col, row, sheetData);
    const v = row[col.id];
    if (col.type === 'checkbox') return <span className="cell-static">{v === true ? '✓' : '—'}</span>;
    const text = v === undefined || v === '' ? '' : String(v);
    return <span className="cell-static">{text || <span className="dim">—</span>}</span>;
  }

  function renderComputed(col: FieldDef, row: SheetData, sheetData: SheetData) {
    const out = col.compute!(row, sheetData);
    return (
      <span className={`cell-static${out.tone === 'warn' ? ' cell-warn' : ''}`} title={out.title}>
        {out.text}
      </span>
    );
  }

  function renderCell(col: FieldDef, row: SheetData, i: number) {
    // Worked out from the rest of the sheet — there is nothing here to edit.
    if (col.compute) return renderComputed(col, row, sheet);
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
    // A weapon with no magazine does not count rounds at all — a claw, a
    // bite, a built-in laser. Its Ammo left box is not a thing to fill in,
    // and leaving it looking fillable is how a 0 there gets read as "empty".
    const noMag = section.id === 'attacks' && col.id === 'ammo' && num(row, 'maxAmmo', 0) <= 0;
    return (
      <>
        <input
          type={col.type === 'number' ? 'number' : 'text'}
          defaultValue={noMag || row[col.id] === undefined ? '' : String(row[col.id])}
          placeholder={noMag ? 'unlimited' : undefined}
          disabled={noMag}
          title={noMag ? 'No magazine, so nothing to count — set Mag above to make this weapon spend rounds.' : undefined}
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
        {col.suggestions && (i === 0 || editIdx === i) && (
          <datalist id={`dl-${section.id}-${col.id}`}>
            {col.suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
      </>
    );
  }

  // Skill-style sections keep the compact table. Rows are LOCKED by default:
  // this table is read far more often than it is written — a die rating
  // glanced at mid-roll — and a grid of live inputs is an invitation to
  // quietly rewrite a character with a stray click. The pencil unlocks one
  // row at a time, and deleting lives inside that unlocked row, where it
  // cannot be hit by accident.
  if (TABLE_SECTIONS.has(section.id)) {
    return (
      <div className="sheet-list">
        <table>
          <thead>
            <tr>
              {mainCols.map((c) => <th key={c.id}><SheetTerm system={system} label={c.label} /></th>)}
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const editing = editIdx === i;
              return (
                <tr key={i} className={editing ? 'row-editing' : ''}>
                  {mainCols.map((col) => (
                    <td key={col.id}>
                      {editing ? renderCell(col, row, i) : renderStatic(col, row, sheet)}
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="row-tools">
                      {editing ? (
                        <>
                          <button
                            className="link"
                            title="Done editing this row"
                            onClick={() => setEditIdx(null)}
                          >✓</button>
                          <ConfirmButton
                            className="link danger"
                            title={`Remove ${String(row.name || 'this row')}`}
                            confirmLabel="×?"
                            onConfirm={() => { setEditIdx(null); setRows(rows.filter((_, j) => j !== i)); }}
                          >×</ConfirmButton>
                        </>
                      ) : (
                        <button
                          className="link sc-pencil"
                          title={`Edit ${String(row.name || 'this row')}`}
                          onClick={() => setEditIdx(i)}
                        >✎</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && <button className="link" onClick={addRow}>+ add {section.title.toLowerCase()}</button>}
      </div>
    );
  }

  // Everything else: a card per item. The face shows only filled-in facts;
  // the pencil opens the full editor with every field.
  function removeRow(i: number) {
    if (editIdx === i) setEditIdx(null);
    else if (editIdx !== null && editIdx > i) setEditIdx(editIdx - 1);
    setRows(rows.filter((_, j) => j !== i));
  }

  /**
   * Swap a card with its neighbour. The order of these rows is the order the
   * right-hand action pane lists them in, so moving a weapon up here promotes
   * its attack there — which is the whole point of being able to do it.
   */
  function moveRow(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    // Keep the pencil on the card the user was editing, not on the slot.
    if (editIdx === i) setEditIdx(j);
    else if (editIdx === j) setEditIdx(i);
    setRows(next);
  }

  /** The ▲▼ grip shown on every card when there is something to reorder. */
  function moveGrip(i: number) {
    if (readOnly || rows.length < 2) return null;
    return (
      <span className="sc-move">
        <button
          className="link" disabled={i === 0}
          title="Move up — also moves it up the action list"
          onClick={() => moveRow(i, -1)}
        >
          ▲
        </button>
        <button
          className="link" disabled={i === rows.length - 1}
          title="Move down — also moves it down the action list"
          onClick={() => moveRow(i, 1)}
        >
          ▼
        </button>
      </span>
    );
  }

  const nameFallback = mainCols[0]?.label ?? 'Item';

  return (
    <div className="sheet-list">
      <div className="card-grid">
        {rows.map((row, i) => {
          const editing = editIdx === i;
          const { chips, notes } = cardChips(section, row);
          const rider = hasDetail ? riderSummary(row) : '';
          const equipId = EQUIP_COL[section.id];
          const equipCol = equipId ? mainCols.find((c) => c.id === equipId) : undefined;
          const isEquipped = !!equipCol && row[equipCol.id] === true;
          // One control, drawn in the same corner whether the card is open or
          // shut — it is the same tick either way, and the editor losing it to
          // a row of checkboxes in the middle of the form made it feel like a
          // different object.
          const equipToggle = equipCol ? (
            <label className={`sc-equip${isEquipped ? ' on' : ''}`} title={`${equipCol.label} — announced in chat`}>
              <span>{equipLabel(equipCol.label, isEquipped)}</span>
              <input
                type="checkbox"
                checked={isEquipped}
                disabled={readOnly}
                onChange={(e) => {
                  const on = e.target.checked;
                  setRows(rows.map((r, j) => (j === i ? { ...r, [equipCol.id]: on } : r)));
                  onEquipChange?.(String(row.name || nameFallback), equipCol.label, on);
                }}
              />
              <span className="sc-box" aria-hidden="true" />
            </label>
          ) : null;
          if (editing && !readOnly) {
            const groups = fieldGroups(section, mainCols, equipCol?.id);
            return (
              // The open editor is the same card, opened: it keeps the green
              // it wears when the thing is in hand.
              <div key={i} className={`sheet-card sheet-card-edit${isEquipped ? ' card-good' : ''}`}>
                <div className="sheet-card-head">
                  <span className="sc-title">✎ {String(row.name || nameFallback)}</span>
                  <span className="spacer" />
                  <button className="link" onClick={() => setEditIdx(null)}>done</button>
                  {moveGrip(i)}
                </div>
                {groups.map((g) => (
                  <div key={g.title ?? '·'} className="sc-group">
                    {g.title && <div className="sc-group-title">{g.title}</div>}
                    <div className="sc-group-box">
                      <div className="sc-fields">
                        {g.cols.map((col) => (
                          <label key={col.id} className={`sc-field ${col.type === 'checkbox' ? 'sc-check' : ''}`}>
                            <span className="sc-label"><SheetTerm system={system} label={col.label} /></span>
                            {renderCell(col, row, i)}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {hasDetail && (
                  <div className="sc-group">
                    <div className="sc-group-title rider" title={RIDER_BTN_TITLE}>
                      ⚡ Rider effects (save / condition / AoE)
                    </div>
                    <div className="sc-group-box rider">
                      <div className="sc-fields">
                        {section.columns.filter((col) => ATTACK_DETAIL_COLS.has(col.id)).map((col) => (
                          <label key={col.id} className={`sc-field ${col.type === 'checkbox' ? 'sc-check' : ''}`}>
                            <span className="sc-label"><SheetTerm system={system} label={col.label} /></span>
                            {renderCell(col, row, i)}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="sheet-card-foot">
                  <button className="link danger" onClick={() => removeRow(i)}>delete</button>
                  <span className="spacer" />
                  {equipToggle}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={`sheet-card${isEquipped ? ' card-good' : ''}${SECTION_THEME[section.id] ? ' ' + SECTION_THEME[section.id] : ''}`}>
              <div className="sheet-card-head">
                <span className="sc-title">{String(row.name || nameFallback)}</span>
                <span className="spacer" />
                {hasDetail && attackHasRider(row) && (
                  <span className="sc-chip sc-rider" title={RIDER_BTN_TITLE}>⚡</span>
                )}
                {onPostCard && (
                  <button
                    className="link sc-post"
                    title="Show this card in chat, so the table can see what it is"
                    onClick={() => onPostCard({
                      name: String(row.name || nameFallback),
                      chips: chips.map((c) => ({ text: c.text, tone: c.tone })),
                      notes,
                      // Equipped kit reads green on the sheet; keep that in chat.
                      ...(isEquipped ? { theme: 'card-good' } : SECTION_THEME[section.id] ? { theme: SECTION_THEME[section.id] } : {}),
                    })}
                  >
                    🗨
                  </button>
                )}
                {!readOnly && (
                  <button className="link sc-pencil" title="Edit all details" onClick={() => setEditIdx(i)}>✎</button>
                )}
                {moveGrip(i)}
              </div>
              {(chips.length > 0 || rider) && (
                <div className="sc-chips">
                  {chips.map((c, j) => (
                    <span key={j} className={chipClass(c.tone, c.text)}>{c.text}</span>
                  ))}
                  {rider && <span className="sc-chip sc-rider" title={RIDER_BTN_TITLE}>⚡ {rider}</span>}
                </div>
              )}
              {notes.map((n, j) => <div key={j} className="sc-notes">{n}</div>)}
              {equipToggle}
            </div>
          );
        })}
      </div>
      {!readOnly && <button className="link" onClick={addRow}>+ add {section.title.toLowerCase()}</button>}
    </div>
  );
}

function DerivedBlocks({
  section, system, derived, characterId,
}: {
  section: DerivedSection;
  system: GameSystem;
  derived: Record<string, number | string>;
  characterId?: string;
}) {
  // Mid-turn, Pace is not a constant — it is an allowance being spent. The
  // budget the map draws its reach from is the same one shown here, so the
  // sheet and the board can never disagree about how far is left.
  const budget = useGameStore((st) => {
    if (!characterId) return undefined;
    const tok = Object.values(st.tokens).find((t) => t.characterId === characterId);
    return tok ? st.moveBudgets[tok.id] : undefined;
  });
  return (
    <div className="derived-row">
      {section.items.map((item) => {
        const spendable = item.key === 'pace' && budget
          ? { left: Math.max(0, budget.pace - budget.moved), total: budget.pace }
          : null;
        return (
          <div key={item.key} className={`stat-block${spendable ? ' stat-spendable' : ''}`}>
            <span className="stat-value">
              {spendable
                ? <><span className={spendable.left === 0 ? 'stat-spent' : ''}>{spendable.left}</span>
                    <span className="stat-of">/{spendable.total}</span></>
                : derived[item.key] ?? '—'}
            </span>
            <span className="stat-label"><SheetTerm system={system} label={item.label} /></span>
          </div>
        );
      })}
    </div>
  );
}

function Section({
  section, system, sheet, derived, readOnly, onPatch, onEditImage, onEditCardBack, inheritedColor, onEquipChange, onPostCard, characterId,
}: {
  section: SectionDef;
  system: GameSystem;
  sheet: SheetData;
  derived: Record<string, number | string>;
  characterId?: string;
  readOnly: boolean;
  onPatch: (patch: SheetData) => void;
  onEditImage?: (fieldId: string) => void;
  onEditCardBack?: () => void;
  inheritedColor?: string;
  onEquipChange?: (itemName: string, verbLabel: string, on: boolean) => void;
  onPostCard?: (card: SheetCard) => void;
}) {
  return (
    <section className="sheet-section">
      <h4>{section.title}</h4>
      {section.kind === 'fields' && (
        <div className="sheet-grid">
          {section.fields.map((f) => (
            <FieldInput key={f.id} field={f} system={system} sheet={sheet} derived={derived} readOnly={readOnly} onPatch={onPatch} onEditImage={onEditImage} onEditCardBack={onEditCardBack} inheritedColor={inheritedColor} />
          ))}
        </div>
      )}
      {section.kind === 'list' && (
        <ListEditor
          section={section} system={system} sheet={sheet} readOnly={readOnly} onPatch={onPatch}
          onEquipChange={onEquipChange}
          onPostCard={POSTABLE_SECTIONS.has(section.id) ? onPostCard : undefined}
        />
      )}
      {section.kind === 'derived' && <DerivedBlocks section={section} system={system} derived={derived} characterId={characterId} />}
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
      {/* Cover lives with the attack controls rather than down in the sheet
          body: it is a thing you change mid-fight, in the same breath as
          picking wild attack or a called shot. */}
      {character.system === 'swade' && (
        <label className="cover-row">
          <span className="dim">Cover</span>
          <select
            value={str(character.sheet, 'cover', 'none')}
            title="Cover the map cannot see — furniture, a crowd, a raised shield. Attacks use whichever is deeper, this or what the walls give."
            onChange={(e) => intents.updateCharacter(character.id, { cover: e.target.value })}
          >
            {COVER_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {COVER_LABEL[c as CoverGrade]}
                {COVER_PENALTY[c as CoverGrade] ? ` (${COVER_PENALTY[c as CoverGrade]})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="adv-toggle">
        {(character.system === 'swade'
          ? [null, 'adv', 'dis', 'called']
          : [null, 'adv', 'dis']).map((mode) => (
          <button
            key={String(mode)}
            className={adv === mode ? 'active' : ''}
            title={character.system === 'swade' && mode === 'adv'
              ? 'Melee only: Wild Attack (+2 to hit and damage, but you become Vulnerable). For ranged bonuses, use the 🎯 Aim action.'
              : mode === 'called'
                ? 'Aim at a specific part — you pick what before the roll, and take its Scale as a penalty.'
                : undefined}
            onClick={() => setAdv(mode as AdvMode)}
          >
            {character.system === 'swade'
              ? mode === null ? 'normal' : mode === 'adv' ? 'wild attack' : mode === 'dis' ? 'penalty −2' : '🎯 called shot'
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
            // Only a weapon with a magazine counts rounds; a claw has none,
            // and a 0 sitting in its Ammo Left box is not an empty gun.
            const atkRow = a.source === 'attack' ? rows(character.sheet, 'attacks')[a.index] ?? {} : null;
            const ammoLeft = atkRow
              ? (character.system === 'swade' ? swadeAmmoLeft(atkRow) : num(atkRow, 'ammo', -1))
              : -1;
            const maxRof = a.rof ?? 1;
            const minNeeded = a.suppressive ? 3 * AMMO_BY_ROF[Math.min(6, maxRof)] : 1;
            const dry = ammoLeft >= 0 && ammoLeft < minNeeded;
            // Not in hand. Left in the list rather than hidden, because a
            // weapon that vanishes reads as broken while a greyed one names
            // its own fix.
            const stowed = a.stowed === true;
            return (
            <div key={a.id} className="roll-row">
              <button
                className={`roll-btn action-btn ${a.effect}${stowed ? ' action-stowed' : ''}`}
                disabled={!canRoll || !myToken || dry || stowed}
                title={stowed ? `${a.label} isn't in hand — tick Wielded on its card to use it`
                  : !myToken ? "Place this character's token on the map first"
                  : dry ? `Needs ${minNeeded} round${minNeeded === 1 ? '' : 's'} — only ${ammoLeft} left. Reload!`
                    : maxRof >= 2 && !a.suppressive ? 'Choose a rate of fire, then pick a target'
                      : a.effect === 'heal' ? `${a.label} — choose who to treat`
                      : (a.aoe ? `${a.aoe.shape} ${a.aoe.sizeFt}ft — aim it on the map` : `Range ${a.rangeFt} ft — pick a target`)}
                onClick={() => {
                  if (!myToken) return;
                  // Aim first, then pick the victim: the part decides the
                  // penalty and the player should see it before committing.
                  // Flag the run; the aim prompt comes once a target is
                  // picked, because the part's Scale is read off the DEFENDER.
                  // A Called Shot is a place to aim a weapon. There is no
                  // eye or leg to pick on a bandage, so a heal ignores the
                  // toggle rather than dragging the player through a prompt
                  // asking where on their patient they would like to hit.
                  if (adv === 'called' && a.attackExpr && a.effect !== 'heal') {
                    useGameStore.getState().beginTargeting(character.id, myToken.id, a, null, undefined, CALLED_SHOT_PENDING);
                    return;
                  }
                  if (maxRof >= 2 && !a.suppressive) { setRofPrompt({ action: a, ammoLeft }); return; }
                  if (a.aoe) useGameStore.getState().beginAoeTargeting(character.id, myToken.id, a, a.attackExpr ? wireAdv(adv) : null);
                  else useGameStore.getState().beginTargeting(character.id, myToken.id, a, a.attackExpr ? wireAdv(adv) : null, undefined);
                }}
              >
                <span>{a.effect === 'heal' ? '🧪' : a.aoe ? '💥' : '⚔️'} {a.label}</span>
                <span className="action-meta">
                  {/* A SWADE heal has no amount: the Healing roll's margin is
                      the healing, and printing the row's vestigial 0 made a
                      working potion look broken. */}
                  {a.healsWounds ? 'mends Wounds' : `${a.effect === 'heal' ? 'heal ' : ''}${a.amountExpr}`}
                  {a.rangeFt > 5 ? ` · ${a.rangeFt}ft` : ''}
                  {maxRof >= 2 && !a.suppressive ? ` · RoF ${maxRof}` : ''}
                  {a.suppressive ? ` · ${minNeeded} rounds` : ''}
                  {stowed ? ' · not wielded' : ''}
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
          {character.system === 'swade' && (
            <div className="roll-row">
              {/* A jump is free and short. What it BUYS on a map is the ground
                  it clears — the rough patch, the rubble — since the distance
                  itself still comes out of Pace. */}
              <button
                className="roll-btn action-btn"
                disabled={!canRoll || !myToken}
                title="Free action: leap 1″ from standing, or 2″ with at least 2″ of run-up first. The distance still costs Pace, but rough ground under the jump costs nothing extra."
                onClick={() => { if (myToken) intents.jumpRoll(myToken.id, false, false); }}
              >
                <span>🤸 Jump</span>
                <span className="action-meta">free · 1″</span>
              </button>
              <button
                className="roll-btn action-btn"
                disabled={!canRoll || !myToken}
                title="Jump with a run-up of at least 2″: 2″ cleared instead of 1″."
                onClick={() => { if (myToken) intents.jumpRoll(myToken.id, true, false); }}
              >
                <span>🏃 Running jump</span>
                <span className="action-meta">free · 2″</span>
              </button>
              <button
                className="roll-btn action-btn"
                disabled={!canRoll || !myToken}
                title="Spend your ACTION on an Athletics roll to jump further: +1″ on a success, +2″ on a raise, on top of the run-up."
                onClick={() => { if (myToken) intents.jumpRoll(myToken.id, true, true); }}
              >
                <span>🤸 Athletics jump</span>
                <span className="action-meta">action · +1-2″</span>
              </button>
            </div>
          )}
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
            // The Attacks group is built off the same rows as the action pane,
            // so a weapon that isn't in hand greys out in both or the two lists
            // disagree about what you can do with it.
            const stowed = character.system === 'swade' && swadeStowedRollable(character.sheet, r.id);
            return (
              <div key={r.id} className="roll-row">
                <button
                  className={`roll-btn${stowed ? ' action-stowed' : ''}`}
                  disabled={!canRoll || noSlots || stowed}
                  title={stowed ? `${r.label} isn't in hand — tick Wielded on its card to use it`
                    : noSlots ? `No level-${r.slotLevel}+ spell slot available` : r.expr}
                  onClick={() => r.slotLevel
                    ? useGameStore.getState().beginCast(character.id, r.id, r.slotLevel, r.label)
                    : intents.sheetRoll(character.id, r.id, r.d20 ? wireAdv(adv) : null)}
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
                    useGameStore.getState().beginTargeting(character.id, myToken.id, a, a.attackExpr ? wireAdv(adv) : null, r);
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
  const members = useGameStore((s) => s.members);
  const character = useGameStore((s) => s.characters.find((c) => c.id === characterId));
  const [tabId, setTabId] = useState<string | null>(null);

  if (!character || !you) return null;
  const schema = systemFor(character.system);
  const derived = schema.derive(character.sheet);
  const editable = canEditCharacter(you.role, you.userId, character);
  // A character with no color of its own wears its player's color.
  const owner = members.find((m) => m.userId === character.ownerUserId);
  const inheritedColor = owner ? playerColorFor(owner) : undefined;
  // A vehicle renders the machine's tab set: Handling and Top Speed, not
  // Smarts and Spirit. Same schema plumbing either way.
  const sheetTabs = character.sheet.vehicle === true && schema.vehicleTabs ? schema.vehicleTabs : schema.tabs;
  const activeTab = sheetTabs.find((t) => t.id === tabId) ?? sheetTabs[0];

  function patch(p: SheetData) {
    if (!character) return;
    // An Arcane Background decides the skill and the Power Points, so setting
    // one sets those too rather than leaving three fields to be looked up.
    // Sent as one patch so the sheet never sits half-updated.
    const next = typeof p.arcaneBackground === 'string' && character.system === 'swade'
      ? { ...p, ...applyArcaneBackground(p.arcaneBackground) }
      : p;
    intents.updateCharacter(character.id, next);
  }

  /** Kit changes are table-visible: say so in chat, in the item's own words
   *  ("Wielded" for a weapon, "Worn" for armour, "Equipped" for gear). */
  /**
   * Read a card out to the table: its name, its chips, and its notes, on one
   * chat line. What the card already shows, in the one place everybody is
   * looking — rather than the owner describing their own gear from memory.
   */
  function postCard(card: SheetCard) {
    if (!character) return;
    intents.postSheetCard(character.id, card);
  }

  function announceEquip(itemName: string, verbLabel: string, on: boolean) {
    if (!character) return;
    const verb = on ? verbLabel.toLowerCase() : `un${verbLabel.toLowerCase()}`;
    intents.chat(`${character.name} ${verb} ${itemName}.`);
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
          {/* Both open as their own windows rather than modals over this one:
              picking an Advance means reading the sheet underneath it. */}
          {editable && (
            <button
              className="link"
              onClick={() => openWindow('levelUp', character.id,
                {}, `${character.system === 'swade' ? 'Advance' : 'Level Up'} — ${character.name}`)}
            >
              {character.system === 'swade' ? '⬆ Advance' : '⬆ Level Up'}
            </button>
          )}
          {/* Handing out gear is the DM's call — players don't shop the
              compendium straight onto their own sheets. */}
          {you.role === 'dm' && (
            <button className="link" onClick={() => openWindow('compendium', character.id, {}, `Compendium — ${character.name}`)}>
              + Compendium
            </button>
          )}
          {/* Who runs this one, in their own colour — the same control the
              token inspector shows, so the answer can be read and changed
              from either place. DM-only: handing a character to somebody is
              not a thing that character's player decides. */}
          {you.role === 'dm' && (
            <OwnerSelect characterId={character.id} ownerUserId={character.ownerUserId} compact />
          )}
        </div>

        <div className="sheet-tabs">
          {sheetTabs.map((t) => (
            <button key={t.id} className={t.id === activeTab.id && tabId !== STATS_TAB && tabId !== NOTES_TAB ? 'active' : ''} onClick={() => setTabId(t.id)}>
              {t.title}
            </button>
          ))}
          <button className={tabId === NOTES_TAB ? 'active' : ''} onClick={() => setTabId(NOTES_TAB)}>
            📝 Notes
          </button>
          <button className={tabId === STATS_TAB ? 'active' : ''} onClick={() => setTabId(STATS_TAB)}>
            📊 Stats
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
                characterId={character.id}
                readOnly={!editable}
                onPatch={patch}
                onEditImage={(fieldId) => openWindow('assetPicker', `${fieldId}:${character.id}`, {},
                  fieldId === 'tokenImage' ? `Token image — ${character.name}` : `Portrait — ${character.name}`)}
                onEditCardBack={() => openWindow('cardBack', character.id, {}, `Card back — ${character.name}`)}
                inheritedColor={inheritedColor}
                onEquipChange={announceEquip}
                onPostCard={postCard}
              />
            ))}

            {you.role === 'dm' && (
              <div className="sheet-delete-row">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    intents.saveToCompendium(character.id);
                    useGameStore.getState().toast(`"${character.name}" added to your compendium.`, 'info');
                  }}
                >
                  Add to Compendium
                </button>
                <ConfirmButton
                  className="btn btn-sm btn-danger"
                  title="Delete this character — this can't be undone"
                  confirmLabel="Really delete? This can't be undone"
                  onConfirm={() => { intents.deleteCharacter(character.id); onClose(); }}
                >
                  Delete character
                </ConfirmButton>
              </div>
            )}
          </div>
          <RollsColumn character={character} canRoll={editable} />
        </div>
        )}
      </div>

    </>
  );
}
