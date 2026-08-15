// Schema-driven character sheets. A system template is pure data + pure
// functions; the client renders any schema generically and the server uses
// derive()/rollables() to resolve sheet rolls and token vision.

import type { AoeSpec, SheetData, VisionStats } from '../types.js';

/**
 * `multiselect` holds any number of `options`, stored as one comma-separated
 * string so it stays the same shape on the sheet a plain text field had —
 * every reader of these lists already splits on commas.
 */
export type FieldType = 'number' | 'text' | 'textarea' | 'checkbox' | 'select' | 'multiselect' | 'image' | 'color' | 'cardback';

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Display text per option value, when the label should say more than the
   *  stored value does ("Focus (Spirit)" for the value "Focus"). */
  optionLabels?: Record<string, string>;
  /** For text fields: dropdown of known values, but free typing still allowed. */
  suggestions?: string[];
  /** Grid width hint for the renderer. */
  width?: 'full' | 'half' | 'third' | 'sixth';
  default?: unknown;
  /**
   * A column the sheet works out rather than stores: it renders as static
   * text and is never editable. Returns the text, an optional tooltip, and
   * an optional tone the renderer can color ('warn' for something the
   * player should notice, like a skill that has outgrown its attribute).
   */
  compute?: (row: SheetData, sheet: SheetData) => { text: string; title?: string; tone?: 'warn' };
  /** Hard cap for text/textarea fields, enforced by the sheet renderer.
   *  Used where something downstream has a fixed amount of room for the value
   *  (see CONCEPT_MAX_LEN and the nameplate). */
  maxLength?: number;
  /**
   * Where this field's derived value goes.
   *
   * The default is a badge beside the label — good for a note about what a
   * number MEANS. But where the derived value is what the field would hold if
   * nobody touched it, a badge is the wrong shape: it wraps onto its own line,
   * shoves the input out of step with its neighbours, and still leaves the box
   * looking empty. 'placeholder' puts the worked-out value INSIDE the empty
   * box instead, where it reads as "this is what you have unless you say
   * otherwise" — and typing over it is how you say otherwise.
   */
  derivedAs?: 'badge' | 'placeholder';
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
  /** SWADE: spends this many Power Points on use. */
  ppCost?: number;
  /** SWADE: the power's DUR column. A round count starts a countdown on the
   *  caster's sheet; anything else is left to the table. */
  duration?: string;
  /** SWADE: the weapon is on the sheet but not in hand. The action still
   *  shows — hiding it makes a forgotten tick box look like a broken
   *  weapon — but it is greyed out and the server refuses it. */
  stowed?: true;
  /** SWADE: armor piercing — reduces the target's ranged-armor soak. */
  ap?: number;
  /** SWADE: Swat — this attack ignores up to 4 points of Scale penalty
   *  against something smaller. Per-attack, because the book grants it only
   *  for the abilities a creature's own description names. */
  swat?: boolean;
  /** SWADE: a Heavy Weapon — a cannon, a torpedo, a dragon's breath. The only
   *  thing that can hurt Heavy Armor, which every Gargantuan creature has. */
  heavy?: boolean;
  /** SWADE: venomous, or infectious. Both work the same way and the book
   *  writes them the same way — a hit that at least Shakes forces a Vigor
   *  roll at the given modifier, and failing it costs `effect`. `kind` only
   *  decides what the chat card calls it. */
  poison?: { mod: number; effect: 'fatigue' | 'shaken' | 'incapacitated' | 'paralyzed'; kind: 'poison' | 'infection' };
  /** SWADE: lobbed rather than fired (a grenade). Thrown weapons have no
   *  Extreme band — past Long they are simply out of range. */
  thrown?: boolean;
  /** SWN: shock — this much damage lands even on a MISS against targets
   *  whose AC is at or below shockAc (the "shock N/AC M" weapon tag). */
  shockDamage?: number;
  shockAc?: number;
  /** SWADE: the to-hit roll beats this fixed target number (4) instead of
   *  the target's AC/Parry; beating it by 4+ is a raise (+1d6! damage). */
  fixedTn?: number;
  /** SWADE: this action's roll mends Wounds rather than dealing an amount —
   *  one on a success, two on a raise, none on a failure. There is no HP
   *  pool to top up, so the roll's margin IS the healing. */
  healsWounds?: boolean;
  /** This template leaves a cloud behind rather than hurting anyone: smoke. */
  obscures?: boolean;
  /** The skill this attack actually rolls — so a penalty can be named after
   *  the roll it applies to rather than assumed to be Shooting. */
  skillName?: string;
  /** Name of the trait this action rolls, for the chat card ("Healing"). */
  traitName?: string;
  /** SWADE: the weapon's Rate of Fire (parsed from its notes). RoF 2+ fires
   *  a burst: −2 Recoil, extra hits on a raise, table-based ammo use. */
  rof?: number;
  /** SWADE: Suppressive Fire — a medium blast of lead that Distracts anyone
   *  who fails to keep their head down. Burns 3× the autofire ammo. */
  suppressive?: boolean;
  /** SWADE combat maneuver: resolved as an opposed roll / special attack
   *  instead of the normal to-hit + damage pipeline. */
  maneuver?: 'push' | 'grapple' | 'test' | 'support' | 'touch';
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
  /** SWADE: this attack is slow or telegraphed enough to be dived away from
   *  — an Agility roll at −2 for no damage at all. The book is explicit that
   *  it is a property the attack has to claim: "if an attack doesn't say it
   *  can be evaded, it can't". */
  evadable?: boolean;
  conditionDc?: number;
  /** SWADE: `rangeFt` is a HARD maximum rather than the Short band. Suppresses
   *  the Medium/Long/Extreme ladder on both the client's targeting ring and
   *  the server's gate, which must agree or the ring lies. */
  hardRange?: boolean;
  /** SWADE: only Wild Cards may be targeted. Wound-mending aimed at the people
   *  who actually track Wounds — every PC, and the NPCs the DM built as Wild
   *  Cards. Enforced server-side; the targeting ring greys out the rest. */
  wildCardOnly?: boolean;
}

export interface SystemSchema {
  id: 'dnd5e' | 'swn' | 'swade';
  name: string;
  tabs: SheetTab[];
  /** The tab set a sheet with `vehicle: true` renders instead — a machine's
   *  stat block, not a creature's. Only SWADE defines one so far. */
  vehicleTabs?: SheetTab[];
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
