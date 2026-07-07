// Schema-driven character sheets. A system template is pure data + pure
// functions; the client renders any schema generically and the server uses
// derive()/rollables() to resolve sheet rolls and token vision.

import type { AoeSpec, SheetData, VisionStats } from '../types.js';

export type FieldType = 'number' | 'text' | 'textarea' | 'checkbox' | 'select' | 'image';

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** For text fields: dropdown of known values, but free typing still allowed. */
  suggestions?: string[];
  /** Grid width hint for the renderer. */
  width?: 'full' | 'half' | 'third' | 'sixth';
  default?: unknown;
}

export interface FieldsSection {
  kind: 'fields';
  id: string;
  title: string;
  fields: FieldDef[];
}

/** Repeating rows (inventory, spells, attacks); stored as an array in sheet[id]. */
export interface ListSection {
  kind: 'list';
  id: string;
  title: string;
  columns: FieldDef[];
}

/** Read-only computed stat blocks, sourced from derive() output by key. */
export interface DerivedSection {
  kind: 'derived';
  id: string;
  title: string;
  items: { key: string; label: string }[];
}

export type SectionDef = FieldsSection | ListSection | DerivedSection;

export interface SheetTab {
  id: string;
  title: string;
  sections: SectionDef[];
}

export interface Rollable {
  id: string;
  label: string;
  /** Concrete dice expression with modifiers baked in, e.g. "1d20+5". */
  expr: string;
  group: string;
  /** True when the roll starts with 1d20 and supports advantage/disadvantage. */
  d20: boolean;
  /** Spell level whose slot this roll spends (>=1). Absent = no slot cost. */
  slotLevel?: number;
}

/**
 * A targeted combat action: an attack (roll to hit, deal damage) or a usable
 * item (heal/damage that auto-applies). Derived from the sheet so it stays in
 * sync with the character's current stats and inventory.
 */
export interface CombatAction {
  /** Stable id encoding its source + row, e.g. "attack:0" or "item:3". */
  id: string;
  label: string;
  /** How it changes the target's HP. */
  effect: 'damage' | 'heal';
  /** To-hit roll for weapons (compared to target AC); null = auto-applies. */
  attackExpr: string | null;
  /** Damage/heal dice expression, e.g. "1d8+3" or "2d4+2". */
  amountExpr: string;
  /** Reach/range in feet (0 = self only). */
  rangeFt: number;
  /** Damage type for resistance/vulnerability/immunity ('' = untyped). */
  damageType: string;
  /** True for a ranged weapon (affects prone advantage, etc.). */
  ranged: boolean;
  /** Decrement the inventory row's quantity when used (consumables). */
  consumesItem: boolean;
  source: 'attack' | 'item' | 'spell' | 'power';
  index: number;
  /** Spends a spell slot of this level on use (leveled spells). */
  slotLevel?: number;
  /** Target rolls this saving throw vs the caster's DC instead of a to-hit. */
  saveId?: string;
  /** Outcome of a successful save for a save-based spell. */
  onSave?: 'half' | 'negate';
  /** Casting this becomes the caster's active concentration. */
  concentration?: boolean;
  /** Spell name (for concentration + chat). */
  spellName?: string;
  /** SWN: commits this much Effort on use (psychic powers). */
  effortCost?: number;
  /** SWN: the power's discipline, for skill-check/mishap resolution. */
  disciplineId?: string;
  /** Area this action affects, if it hits a zone rather than one target. */
  aoe?: AoeSpec;
  /** A save DC baked into the stat block (monster breath weapons) rather
   *  than derived from the caster's ability/proficiency (PC spells). Wins
   *  over the derived spellDc when resolving a saveId action. */
  fixedDc?: number;
  /** Status condition (by id, see effects.ts CONDITIONS) inflicted on the
   *  target: on a FAILED save for save-based actions, on a HIT for attack-
   *  roll actions (optionally gated by its own rider save below), or
   *  unconditionally for actions with neither roll (e.g. Invisibility). */
  appliesCondition?: string;
  /** A to-hit attack's condition rider rolls this save vs `conditionDc`
   *  AFTER the hit lands (ghoul claws: hit, then CON save or be paralyzed).
   *  Absent = the condition applies automatically on a hit (grapples). */
  conditionSaveId?: string;
  conditionDc?: number;
}

export interface SystemSchema {
  id: 'dnd5e' | 'swn';
  name: string;
  tabs: SheetTab[];
  defaultSheet(): SheetData;
  /** Read-only computed values, keyed by id, shown next to fields. */
  derive(sheet: SheetData): Record<string, number | string>;
  rollables(sheet: SheetData): Rollable[];
  /** Vision stats the VTT engine reads from the sheet. */
  vision(sheet: SheetData): VisionStats;
  /** Initiative roll expression (used by the tracker's "roll" button). */
  initiativeExpr(sheet: SheetData): string;
  /** Current/max HP as stored on the sheet (mirrored onto token bars). */
  hp(sheet: SheetData): { hp: number; maxHp: number };
  /** Saving throws offered by the "call for save" tool. */
  saveIds(): { id: string; label: string }[];
  /**
   * Resolve a saving throw for the call-for-save tool: the dice expression to
   * roll and the number to meet-or-beat. `dc` is used by DC-based systems (5e);
   * target-number systems (SWN) derive their own threshold and ignore it.
   */
  saveCheck(sheet: SheetData, saveId: string, dc: number): { expr: string; threshold: number; label: string };
}

export function num(sheet: SheetData, id: string, fallback = 0): number {
  const v = sheet[id];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function str(sheet: SheetData, id: string, fallback = ''): string {
  const v = sheet[id];
  return typeof v === 'string' ? v : fallback;
}

export function bool(sheet: SheetData, id: string): boolean {
  return sheet[id] === true;
}

export function rows(sheet: SheetData, id: string): SheetData[] {
  const v = sheet[id];
  return Array.isArray(v) ? (v as SheetData[]) : [];
}

export function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/**
 * Whether a damage/heal amount string is actually usable as a roll: a dice
 * expression ("8d6", "1d8+3"), or a FLAT constant amount — Heal's fixed 70,
 * a potion's fixed 10 — i.e. constant arithmetic with a nonzero digit (the
 * dice roller evaluates plain constants fine; only the old dice-only gate
 * kept such spells out of the action list). A bare "0" (a placeholder, e.g.
 * a pure-condition spell like Hold Person) is NOT usable.
 */
export function usableAmount(expr: string): boolean {
  if (/\d*d\d+/i.test(expr)) return true;
  return /^[\d\s+*()-]+$/.test(expr) && /[1-9]/.test(expr);
}
