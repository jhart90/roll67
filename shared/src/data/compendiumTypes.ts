import type { AoeShape, GameSystem, SheetData } from '../types.js';

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
  /** Damage type for damage-dealing spells, e.g. "fire". */
  damageType?: string;
  /** True if `damage` is healing rather than harm. */
  heal?: boolean;
  /** Area shape/size, for spells that hit a zone rather than one target. */
  aoe?: { shape: AoeShape; sizeFt: number; widthFt?: number };
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

/** Pull a healing dice expression out of item text ("Regain 2d4+2 hit points"). */
function healAmountFrom(text: string): string | null {
  const m = text.match(/regain\s+(\d*d\d+(?:\s*\+\s*\d+)?)\s+hit\s+points/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}

/**
 * A spell's numeric range in feet, from its free-text range ("150 ft",
 * "Touch", "Self", "Self (15-ft cone)", "1 mile"). Self-origin spells (the
 * template always starts at the caster, even if it then reaches out in a
 * cone/line/cube) have no separate "how far can I place this" distance, so
 * they resolve to 0.
 */
function parseSpellRangeFt(range: string): number {
  if (/^self\b/i.test(range)) return 0;
  if (/^touch$/i.test(range)) return 5;
  const ft = range.match(/(\d+)\s*ft/i);
  if (ft) return Number(ft[1]);
  if (/mile/i.test(range)) return 5280;
  return 5;
}

/** A spell's save text ("DEX half", "WIS negates") into ability + effect on a save. */
function parseSpellSave(save: string | undefined): { ability: string; onSave: 'half' | 'negate' } | null {
  if (!save) return null;
  const ability = save.match(/\b(STR|DEX|CON|INT|WIS|CHA)\b/i);
  if (!ability) return null;
  return { ability: ability[1].toLowerCase(), onSave: /half/i.test(save) ? 'half' : 'negate' };
}

/** Rough default shop prices by kind; the DM can adjust after adding. */
const KIND_PRICE: Record<ContentKind, number> = {
  weapon: 25, armor: 75, gear: 10, magicitem: 150, spell: 25, power: 0,
};

/**
 * Build a shop-stock item from a compendium entry. The item keeps a contentId
 * so that buying it applies the entry's full logic (a weapon becomes the
 * buyer's attack, a healing potion becomes a usable item) to the character.
 */
export function shopItemFromEntry(entry: ContentEntry): {
  name: string; price: number; qty: number; notes: string; contentId: string;
} {
  return {
    name: entry.name,
    price: KIND_PRICE[entry.kind] ?? 10,
    qty: -1,
    notes: entry.subtitle,
    contentId: entry.id,
  };
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
    const saveInfo = parseSpellSave(s.save);
    const note = [s.school, s.range, s.concentration ? 'concentration' : ''].filter(Boolean).join(' · ');
    const common = {
      effect: s.heal ? 'heal' : 'damage',
      damage: s.damage ?? '',
      dtype: s.heal ? '' : (s.damageType ?? ''),
      save: saveInfo?.ability ?? '',
      onSave: saveInfo?.onSave ?? 'half',
      range: parseSpellRangeFt(s.range),
      notes: note,
      ...(s.aoe ? { aoeShape: s.aoe.shape, aoeSize: s.aoe.sizeFt, aoeWidth: s.aoe.widthFt ?? 0 } : {}),
    };
    if (s.level === 0) {
      return {
        listId: 'cantrips',
        row: { name: entry.name, ...common },
        label: `${entry.name} added to cantrips`,
      };
    }
    return {
      listId: 'spells',
      row: { name: entry.name, level: s.level, prepared: false, conc: s.concentration, ...common },
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

  // gear + magic items -> inventory. Healing consumables become usable.
  if (entry.kind === 'gear' || entry.kind === 'magicitem') {
    const heal = healAmountFrom(`${entry.subtitle} ${entry.detail ?? ''}`);
    const usable = heal ? { effect: 'heal', amount: heal, range: 5 } : {};
    return {
      listId: 'inventory',
      row: is5e
        ? { name: entry.name, qty: 1, weight: entry.gear?.weight ?? 0, ...usable, notes: entry.subtitle }
        : { name: entry.name, qty: 1, enc: 1, ...usable, notes: entry.subtitle },
      label: `${entry.name} added to inventory`,
    };
  }

  return null;
}
