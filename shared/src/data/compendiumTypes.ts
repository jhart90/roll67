import type { GameSystem, SheetData } from '../types.js';

export type ContentKind = 'weapon' | 'armor' | 'gear' | 'magicitem' | 'spell' | 'power';

export interface WeaponData {
  damage: string;         // base dice, e.g. "1d8"
  damageType: string;     // "slashing", "kinetic", ...
  /** How the attack bonus/damage ability is chosen (5e). */
  ability: 'str' | 'dex' | 'finesse' | 'ranged' | 'none';
  props: string[];        // ["versatile (1d10)", "thrown (20/60)", ...]
}

export interface ArmorData {
  baseAc: number;         // e.g. 14 for scale mail; SWN AC directly
  addDex: boolean;        // 5e: add Dex mod
  maxDex?: number;        // 5e: cap on Dex (e.g. 2 for medium)
  notes?: string;
}

export interface SpellData {
  level: number;          // 0 = cantrip
  school: string;
  castTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  /** Rollable damage/heal expression, e.g. "8d6" or "1d8". */
  damage?: string;
  /** Save the spell forces, e.g. "DEX half". */
  save?: string;
}

export interface PowerData {
  discipline: string;
  level: number;          // SWN power level 1-4
  notes?: string;
}

export interface GearData {
  weight?: number;
  cost?: string;
  notes?: string;
}

export interface ContentEntry {
  id: string;
  system: GameSystem;
  kind: ContentKind;
  name: string;
  /** Grouping label for sort/filter: "Martial Melee", "Level 3", "Wondrous item". */
  category: string;
  /** Numeric sort key within a kind (spell level, weapon tier, etc.). */
  order: number;
  /** One-line mechanical summary shown in lists. */
  subtitle: string;
  /** Longer description (optional). */
  detail?: string;
  weapon?: WeaponData;
  armor?: ArmorData;
  spell?: SpellData;
  power?: PowerData;
  gear?: GearData;
}

export function contentSlug(system: string, kind: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${system}-${kind}-${slug}`;
}

// ---------- helpers used by the client to append a row to a sheet ----------

export type SheetRow = Record<string, unknown>;

function abilityMod5e(sheet: SheetData, id: string): number {
  const raw = sheet[id];
  const score = typeof raw === 'number' ? raw : Number(raw) || 10;
  return Math.floor((score - 10) / 2);
}

function profBonus5e(sheet: SheetData): number {
  const raw = sheet.level;
  const level = typeof raw === 'number' ? raw : Number(raw) || 1;
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** Which sheet list a content entry appends to, and the row to add. */
export interface ApplyResult {
  listId: string;
  row: SheetRow;
  /** Optional confirmation label for chat/toast. */
  label: string;
}

/**
 * Build the sheet row for adding a compendium entry to a character.
 * Weapons compute their 5e attack bonus/damage from the current sheet so
 * the new attack is immediately click-to-roll with the right modifiers.
 */
export function applyEntry(entry: ContentEntry, sheet: SheetData): ApplyResult | null {
  const is5e = entry.system === 'dnd5e';

  if (entry.kind === 'weapon' && entry.weapon) {
    const w = entry.weapon;
    if (is5e) {
      const strMod = abilityMod5e(sheet, 'str');
      const dexMod = abilityMod5e(sheet, 'dex');
      const mod =
        w.ability === 'dex' || w.ability === 'ranged' ? dexMod
          : w.ability === 'finesse' ? Math.max(strMod, dexMod)
            : w.ability === 'none' ? 0
              : strMod;
      const pb = profBonus5e(sheet);
      const dmg = mod !== 0 ? `${w.damage}${fmt(mod)}` : w.damage;
      return {
        listId: 'attacks',
        row: { name: entry.name, bonus: mod + pb, damage: dmg, notes: `${w.damageType}${w.props.length ? '; ' + w.props.join(', ') : ''}` },
        label: `${entry.name} added to attacks`,
      };
    }
    // SWN: weapon-specific bonus 0; sheet attackBonus applies in rollables.
    return {
      listId: 'attacks',
      row: { name: entry.name, bonus: 0, damage: w.damage, notes: `${w.damageType}${w.props.length ? '; ' + w.props.join(', ') : ''}` },
      label: `${entry.name} added to weapons`,
    };
  }

  if (entry.kind === 'spell' && entry.spell) {
    const s = entry.spell;
    const note = [s.school, s.range, s.save, s.concentration ? 'concentration' : '']
      .filter(Boolean).join(' · ');
    if (s.level === 0) {
      return {
        listId: 'cantrips',
        row: { name: entry.name, notes: note, damage: s.damage ?? '' },
        label: `${entry.name} added to cantrips`,
      };
    }
    return {
      listId: 'spells',
      row: { name: entry.name, level: s.level, prepared: false, notes: note, damage: s.damage ?? '' },
      label: `${entry.name} added to spells`,
    };
  }

  if (entry.kind === 'power' && entry.power) {
    return {
      listId: 'powers',
      row: { name: entry.name, discipline: entry.power.discipline, level: entry.power.level, notes: entry.power.notes ?? '' },
      label: `${entry.name} added to psychic powers`,
    };
  }

  if (entry.kind === 'armor' && entry.armor) {
    if (is5e) {
      return {
        listId: 'inventory',
        row: { name: entry.name, qty: 1, weight: entry.gear?.weight ?? 0, notes: entry.subtitle },
        label: `${entry.name} added to equipment`,
      };
    }
    return {
      listId: 'armor',
      row: { name: entry.name, ac: entry.armor.baseAc, notes: entry.armor.notes ?? '' },
      label: `${entry.name} added to armor`,
    };
  }

  // gear + magic items -> inventory
  if (entry.kind === 'gear' || entry.kind === 'magicitem') {
    return {
      listId: 'inventory',
      row: is5e
        ? { name: entry.name, qty: 1, weight: entry.gear?.weight ?? 0, notes: entry.subtitle }
        : { name: entry.name, qty: 1, enc: 1, notes: entry.subtitle },
      label: `${entry.name} added to inventory`,
    };
  }

  return null;
}
