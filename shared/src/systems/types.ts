// Schema-driven character sheets. A system template is pure data + pure
// functions; the client renders any schema generically and the server uses
// derive()/rollables() to resolve sheet rolls and token vision.

import type { SheetData, VisionStats } from '../types.js';

export type FieldType = 'number' | 'text' | 'textarea' | 'checkbox' | 'select';

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
