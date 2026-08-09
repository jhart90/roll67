import type { AoeShape, GameSystem, SheetData } from '../types.js';

import { weightFor } from './weights.js';

export type ContentKind = 'weapon' | 'armor' | 'gear' | 'magicitem' | 'spell' | 'power' | 'edge' | 'hindrance' | 'racialTrait';

/** SWADE Edges and Hindrances: a character trait with live sheet modifiers. */
export interface TraitData {
  /** Hindrances only. */
  severity?: 'Minor' | 'Major';
  /** A flat bonus (or penalty) to a named skill/attribute roll. */
  bonusSkill?: string;
  bonusAmt?: number;
  parryBonus?: number;
  toughnessBonus?: number;
  paceBonus?: number;
  /** Requirements, for the compendium's subtitle. */
  requires?: string;
}

export interface WeaponData {
  damage: string;         // base dice, e.g. "1d8"
  damageType: string;     // "slashing", "kinetic", ...
  /** How the attack bonus/damage ability is chosen (5e). */
  ability: 'str' | 'dex' | 'finesse' | 'ranged' | 'none';
  props: string[];        // ["versatile (1d10)", "thrown (20/60)", ...]
}

export interface ArmorData {
  baseAc: number;         // e.g. 14 for scale mail; SWN AC directly; SWADE armor/Parry bonus
  addDex: boolean;        // 5e: add Dex mod
  maxDex?: number;        // 5e: cap on Dex (e.g. 2 for medium)
  /** SWADE: extra armor that counts only against ranged attacks (shields). */
  rangedArmor?: number;
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
  aoe?: { shape: AoeShape; sizeFt?: number; sizeHexes?: number; widthFt?: number };
  /** Status condition (id from effects.ts CONDITIONS) the spell inflicts on
   *  its target — on a failed save when `save` is set, else automatically
   *  (e.g. Invisibility). Duration/expiry stays manual (no turn clock). */
  condition?: string;
}

export interface PowerData {
  /** SWN: psychic discipline. SWADE: required Rank. */
  discipline: string;
  /** SWN: power level 1-4. SWADE: Power Point cost. */
  level: number;
  notes?: string;
  /** Rollable damage/heal expression, for powers with a direct combat effect. */
  damage?: string;
  /** True if `damage` is healing rather than harm. */
  heal?: boolean;
  /** Save the power forces (SWN save names: physical/evasion/mental). */
  save?: string;
  /** Damage type, e.g. "kinetic". */
  damageType?: string;
  /** SWADE: the power's range in feet. */
  rangeFt?: number;
  /** SWADE: outcome of a successful resistance roll. */
  onSave?: 'half' | 'negate';
  /** SWADE: area template (Burst's cone, Blast's sphere). */
  aoe?: { shape: AoeShape; sizeFt?: number; sizeHexes?: number; widthFt?: number };
  /** SWADE: status condition the power inflicts (effects.ts CONDITIONS id). */
  condition?: string;
}

export interface GearData {
  weight?: number;
  cost?: string;
  notes?: string;
  /** Ammo batches land in inventory with this quantity (rounds per purchase). */
  qty?: number;
  /** Ammunition type this item feeds / this weapon chambers (see AMMUNITION). */
  caliber?: string;
  /** SWADE: equipped-gear bonus to a named trait ("Thievery", "Athletics", "Strength"). */
  traitBonus?: { trait: string; amount: number };
  /** SWN cyberware: system strain the implant costs. */
  strain?: number;
  /** SWN cyberware: initiative bonus (Boosted Reflexes). */
  initBonus?: number;
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
  trait?: TraitData;
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

/** Pull a healing dice expression out of item text — 5e's "Regain 2d4+2 hit
 *  points" or SWADE's "2d6 healing" (which the server converts to Wounds,
 *  one per full 4 points, steadying the Shaken). */
function healAmountFrom(text: string): string | null {
  const m = text.match(/regain\s+(\d*d\d+(?:\s*\+\s*\d+)?)\s+hit\s+points/i)
    ?? text.match(/(\d*d\d+(?:\s*\+\s*\d+)?)\s+healing/i);
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

/** A spell's save text ("DEX half", "WIS negates") into ability + effect on a
 *  save. The special marker 'attack' (a spell-ATTACK spell like Fire Bolt or
 *  Scorching Ray, no save at all) passes through as-is -- combatActions()
 *  turns that into a to-hit roll; dropping it here made those spells resolve
 *  as auto-applied damage that could never miss. */
function parseSpellSave(save: string | undefined): { ability: string; onSave: 'half' | 'negate' } | null {
  if (!save) return null;
  if (/^\s*attack\s*$/i.test(save)) return { ability: 'attack', onSave: 'negate' };
  const ability = save.match(/\b(STR|DEX|CON|INT|WIS|CHA)\b/i);
  if (!ability) return null;
  return { ability: ability[1].toLowerCase(), onSave: /half/i.test(save) ? 'half' : 'negate' };
}

/**
 * A 5e weapon's reach/range in feet, from its property tags: "thrown (20/60)"
 * or "ammunition (80/320)" use the short-range number; "reach" melee weapons
 * get 10 ft; everything else is plain 5-ft melee.
 */
export function weaponRangeFt5e(props: string[]): number {
  const ranged = props.find((p) => /^(thrown|ammunition)\b/i.test(p));
  if (ranged) {
    const m = ranged.match(/\((\d+)/);
    if (m) return Number(m[1]);
  }
  return props.some((p) => /reach/i.test(p)) ? 10 : 5;
}

/**
 * A SWN weapon's range in feet, from a "range 30/100" property tag. Thrown
 * items with no explicit number (grenades) default to a short throw.
 */
export function weaponRangeFtSwn(props: string[]): number {
  const tag = props.find((p) => /^range\b/i.test(p));
  if (tag) {
    const m = tag.match(/(\d+)/);
    if (m) return Number(m[1]);
  }
  return props.some((p) => /thrown/i.test(p)) ? 30 : 5;
}

/** A SWN weapon's "shock N/AC M" property tag into its shock-damage number. */
function weaponShockSwn(props: string[]): number {
  const tag = props.find((p) => /^shock\b/i.test(p));
  if (!tag) return 0;
  const m = tag.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Pull an "equip this and get a flat AC/save bonus" number out of a magic
 * item's free-text summary ("+1 AC and saving throws", "+2 Con save",
 * "+1 armor"). Items whose benefit isn't a flat numeric bonus (stat-setting,
 * advantage grants, unique actions) intentionally fall through to {0, 0}
 * rather than guessing a number that isn't in the source text.
 */
function parseAcSaveBonus(text: string): { ac: number; save: number } {
  const both = text.match(/\+(\d+)\s*AC\s*and\s*saving\s*throws/i);
  if (both) return { ac: Number(both[1]), save: Number(both[1]) };
  const acMatch = text.match(/\+(\d+)\s*(?:AC|armor)\b/i);
  const saveMatch = text.match(/\+(\d+)\s*(?:\w+\s+)?sav(?:e|ing throws?)\b/i);
  return { ac: acMatch ? Number(acMatch[1]) : 0, save: saveMatch ? Number(saveMatch[1]) : 0 };
}

/** Rough default shop prices by kind; the DM can adjust after adding. */
const KIND_PRICE: Record<ContentKind, number> = {
  weapon: 25, armor: 75, gear: 10, magicitem: 150, spell: 25, power: 0,
  // Edges, Hindrances, and racial abilities are character traits, never stock.
  edge: 0, hindrance: 0, racialTrait: 0,
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
  const isSwade = entry.system === 'swade';

  if (entry.kind === 'weapon' && entry.weapon) {
    const w = entry.weapon;
    if (isSwade) {
      // Melee damage is Strength die + weapon die, all acing; ranged weapons
      // roll their own dice alone. The attack roll itself comes from the
      // sheet's Fighting/Shooting/Athletics trait (the row's skill column).
      // Mechanical props become live columns: "AP n" pierces ranged armor,
      // "±1 Parry" feeds derived Parry once the weapon is marked wielded,
      // and "mag n" pre-fills the server-enforced ammo counter.
      const melee = w.ability === 'str';
      const strDie = /^d\d+$/.test(String(sheet.strength ?? '')) ? String(sheet.strength) : 'd6';
      const damage = melee ? (w.damage ? `1${strDie}!+${w.damage}` : `1${strDie}!`) : w.damage;
      const propText = w.props.join(', ');
      const ap = Number(propText.match(/\bAP (\d+)/i)?.[1] ?? 0);
      const parryUp = propText.match(/\+(\d+) Parry/i);
      const parryDown = propText.match(/Parry [−-](\d+)/i);
      const parryBonus = parryUp ? Number(parryUp[1]) : parryDown ? -Number(parryDown[1]) : 0;
      const mag = propText.match(/\bmag (\d+)/i);
      // SWADE template weapons: the props already say which template the book
      // gives them — 'small/medium/large blast' becomes a tile-sized sphere
      // (2/4/6 tiles counting the target), 'cone template' the Cone. A weapon
      // whose props promise a Vigor-or-Stunned rider gets it mechanically too.
      const rofMatch = propText.match(/\bRoF (\d)/i);
      const caliberMatch = propText.match(/caliber: ([a-z-]+)/i);
      const blastMatch = propText.match(/\b(small|medium|large) blast/i);
      const blastHexes = blastMatch ? ({ small: 1, medium: 3, large: 5 } as Record<string, number>)[blastMatch[1].toLowerCase()] : 0;
      const coneTemplate = /cone template/i.test(propText);
      const stunRider = /vigor roll or stunned/i.test(propText);
      const thrown = propText.toLowerCase().includes('thrown');
      return {
        listId: 'attacks',
        row: {
          // A thrown weapon is lobbed with Athletics, and has no Extreme band.
          name: entry.name, skill: melee ? 'Fighting' : (thrown ? 'Athletics' : 'Shooting'), damage,
          dtype: w.damageType, range: melee ? 5 : weaponRangeFtSwn(w.props),
          ap, parryBonus, wielded: false,
          // A grenade is one throw, not a magazine: it arrives with a single
          // use so the Actions pane counts it down and greys out when spent.
          ...(mag ? { ammo: Number(mag[1]), maxAmmo: Number(mag[1]) }
            : thrown ? { ammo: 1, maxAmmo: 1 } : {}),
          ...(rofMatch ? { rof: Number(rofMatch[1]) } : {}),
          ...(caliberMatch ? { caliber: caliberMatch[1].toLowerCase() } : {}),
          ...(blastHexes > 0 ? { aoeShape: 'sphere', aoeHexes: blastHexes } : {}),
          ...(coneTemplate ? { aoeShape: 'cone', aoeSize: 54 } : {}),
          ...(stunRider ? { save: 'vigor', onSave: 'negate', condition: 'stunned' } : {}),
          ...(thrown ? { thrown: true } : {}),
          weight: weightFor(entry.name, 'weapon', entry.gear?.weight),
          notes: propText,
        },
        label: `${entry.name} added to weapons`,
      };
    }
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
        row: {
          name: entry.name, bonus: mod + pb, damage: dmg,
          dtype: w.damageType, range: weaponRangeFt5e(w.props),
          notes: w.props.join(', '),
        },
        label: `${entry.name} added to attacks`,
      };
    }
    // SWN: weapon-specific bonus 0; sheet attackBonus applies in rollables.
    // Mechanical props become live stats: "shock N/AC M" fills both shock
    // columns (min damage on a miss vs AC ≤ M, server-resolved), "mag N" /
    // "N shots" pre-fills the enforced ammo counter (and its matching
    // reload item — a magazine for kinetic weapons, a cell for energy ones,
    // so the Reload action has something to consume from the sheet's
    // Gear list without the player configuring it by hand), and "blast"
    // weapons (grenades) become area attacks with an Evasion-for-half save.
    const swnProps = w.props.join(', ');
    const shockAcMatch = swnProps.match(/shock\s+\d+\s*\/\s*AC\s*(\d+)/i);
    const magMatch = swnProps.match(/\bmag (\d+)/i) ?? swnProps.match(/\b(\d+) shots/i);
    const isBlast = w.props.some((p) => /^blast$/i.test(p));
    return {
      listId: 'attacks',
      row: {
        name: entry.name, bonus: 0, damage: w.damage,
        dtype: w.damageType, range: weaponRangeFtSwn(w.props), shock: weaponShockSwn(w.props),
        ...(shockAcMatch ? { shockAc: Number(shockAcMatch[1]) } : {}),
        ...(magMatch ? {
          ammo: Number(magMatch[1]), maxAmmo: Number(magMatch[1]),
          ammoItem: w.damageType === 'energy' ? 'Ammo, Type A Cell' : 'Spare Magazine',
        } : {}),
        ...(isBlast ? { aoeShape: 'sphere', aoeSize: 20, save: 'evasion', onSave: 'half' } : {}),
        notes: swnProps,
      },
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
      ...(s.condition ? { condition: s.condition } : {}),
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
    const p = entry.power;
    if (isSwade) {
      return {
        listId: 'powers',
        row: {
          name: entry.name, cost: p.level, notes: p.notes ?? '',
          effect: p.heal ? 'heal' : 'damage',
          damage: p.damage ?? '',
          dtype: p.heal ? '' : (p.damageType ?? ''),
          range: p.rangeFt ?? 0,
          save: p.save ?? '',
          onSave: p.onSave ?? 'negate',
          ...(p.aoe ? { aoeShape: p.aoe.shape, aoeSize: p.aoe.sizeFt ?? 0, aoeHexes: p.aoe.sizeHexes ?? 0 } : { aoeShape: '', aoeSize: 0 }),
          condition: p.condition ?? '',
        },
        label: `${entry.name} added to powers`,
      };
    }
    return {
      listId: 'powers',
      row: {
        name: entry.name, discipline: p.discipline, level: p.level, notes: p.notes ?? '',
        ...(p.damage ? {
          effect: p.heal ? 'heal' : 'damage',
          damage: p.damage,
          dtype: p.heal ? '' : (p.damageType ?? ''),
          save: p.heal ? '' : (p.save ?? ''),
          ...(p.rangeFt !== undefined ? { range: p.rangeFt } : {}),
        } : {}),
      },
      label: `${entry.name} added to psychic powers`,
    };
  }

  if (entry.kind === 'armor' && entry.armor) {
    if (isSwade) {
      const shield = entry.category === 'Shield';
      return {
        listId: 'armor',
        row: {
          name: entry.name,
          armor: shield ? 0 : entry.armor.baseAc,
          parryBonus: shield ? entry.armor.baseAc : 0,
          rangedArmor: entry.armor.rangedArmor ?? 0,
          equipped: false, weight: weightFor(entry.name, 'armor', entry.gear?.weight),
          notes: entry.armor.notes ?? '',
        },
        label: `${entry.name} added to armor`,
      };
    }
    if (is5e) {
      return {
        listId: 'armor',
        row: {
          name: entry.name, baseAc: entry.armor.baseAc, addDex: entry.armor.addDex,
          maxDex: entry.armor.maxDex ?? -1, shield: entry.category === 'Shield',
          equipped: false, notes: entry.armor.notes ?? '',
        },
        label: `${entry.name} added to armor`,
      };
    }
    // SWN: a Shield row is flagged so derived AC treats it by the shield
    // rule (AC 13 alone, +1 on top of better armor) instead of as a
    // base-AC-1 body armor that would clobber the real armor.
    const swnShield = entry.category === 'Shield';
    return {
      listId: 'armor',
      row: {
        name: entry.name, ac: swnShield ? 13 : entry.armor.baseAc,
        ...(swnShield ? { shield: true } : {}),
        equipped: false, notes: entry.armor.notes ?? '',
      },
      label: `${entry.name} added to armor`,
    };
  }

  // A racial ability picked up after creation. Natural weapons (Bite, Claws,
  // Horns) become real attacks with the character's own Strength die folded
  // in; everything else lands in the Ancestry Traits list with whatever live
  // modifier columns it carries.
  if (entry.kind === 'racialTrait') {
    if (entry.weapon) {
      const strDie = /^d\d+$/.test(String(sheet.strength ?? '')) ? String(sheet.strength) : 'd6';
      const props = entry.weapon.props.join(', ');
      return {
        listId: 'attacks',
        row: {
          name: entry.name, skill: 'Fighting',
          damage: `1${strDie}!+1${entry.weapon.damage}!`,
          dtype: entry.weapon.damageType, range: 5,
          ap: Number(props.match(/\bAP (\d+)/i)?.[1] ?? 0),
          parryBonus: 0, wielded: false, notes: 'Natural weapon',
        },
        label: `${entry.name} added to weapons`,
      };
    }
    const t = entry.trait ?? {};
    return {
      listId: 'racialTraits',
      row: {
        name: entry.name,
        bonusSkill: t.bonusSkill ?? '', bonusAmt: t.bonusAmt ?? 0,
        parryBonus: t.parryBonus ?? 0, toughnessBonus: t.toughnessBonus ?? 0,
        paceBonus: t.paceBonus ?? 0, notes: entry.subtitle,
      },
      label: `${entry.name} added to Ancestry Traits`,
    };
  }

  // SWADE Edges / Hindrances land in their own lists carrying live modifier
  // columns, so taking one immediately moves Parry, Toughness, Pace, or the
  // affected trait roll — no manual bookkeeping.
  if (entry.kind === 'edge' || entry.kind === 'hindrance') {
    const t = entry.trait ?? {};
    const mods = {
      bonusSkill: t.bonusSkill ?? '',
      bonusAmt: t.bonusAmt ?? 0,
      parryBonus: t.parryBonus ?? 0,
      toughnessBonus: t.toughnessBonus ?? 0,
      paceBonus: t.paceBonus ?? 0,
      notes: entry.subtitle,
    };
    return entry.kind === 'edge'
      ? { listId: 'edges', row: { name: entry.name, ...mods }, label: `${entry.name} added to Edges` }
      : {
        listId: 'hindrances',
        row: { name: entry.name, severity: t.severity ?? 'Minor', ...mods },
        label: `${entry.name} added to Hindrances`,
      };
  }

  // SWN cyberware installs into the cyberware list: strain feeds the strain
  // total, an "+N armor" bonus feeds derived AC, an init bonus feeds the
  // initiative roll (implants are always active — no equipped flag).
  if (entry.system === 'swn' && entry.kind === 'magicitem' && entry.category === 'Cyberware') {
    const bonus = parseAcSaveBonus(entry.subtitle);
    return {
      listId: 'cyberware',
      row: {
        name: entry.name,
        strain: entry.gear?.strain ?? 1,
        acBonus: bonus.ac,
        initBonus: entry.gear?.initBonus ?? 0,
        notes: entry.subtitle,
      },
      label: `${entry.name} installed (system strain +${entry.gear?.strain ?? 1})`,
    };
  }

  // gear + magic items -> inventory. Healing consumables become usable; magic
  // items with a flat numeric AC/save bonus become equippable for it.
  if (entry.kind === 'gear' || entry.kind === 'magicitem') {
    const heal = healAmountFrom(`${entry.subtitle} ${entry.detail ?? ''}`);
    // SWADE healing has no amount to parse — the Healing roll's margin IS the
    // result — so a kit is recognised by treating Wounds rather than by
    // quoting dice. Without this, rewriting those descriptions to match the
    // rules would quietly stop the kits being usable at all.
    const swadeHeal = isSwade && /\bWound\b/i.test(`${entry.subtitle} ${entry.detail ?? ''}`)
      && /\bheal(ing)?\b/i.test(`${entry.subtitle} ${entry.detail ?? ''}`);
    const usable = heal
      ? { effect: 'heal', amount: heal, range: 5 }
      : swadeHeal ? { effect: 'heal', amount: '', range: 5 } : {};
    const bonus = entry.kind === 'magicitem' ? parseAcSaveBonus(entry.subtitle) : { ac: 0, save: 0 };
    const equip = { equipped: false, acBonus: bonus.ac, saveBonus: bonus.save };
    if (isSwade) {
      const tb = entry.gear?.traitBonus;
      return {
        listId: 'inventory',
        row: {
          name: entry.name, qty: entry.gear?.qty ?? 1,
          weight: weightFor(entry.name, entry.kind, entry.gear?.weight), ...usable,
          equipped: false,
          bonusSkill: tb?.trait ?? '', bonusAmt: tb?.amount ?? 0,
          ...(entry.gear?.caliber ? { caliber: entry.gear.caliber } : {}),
          notes: entry.subtitle,
        },
        label: `${entry.name} added to inventory`,
      };
    }
    return {
      listId: 'inventory',
      row: is5e
        ? { name: entry.name, qty: 1, weight: entry.gear?.weight ?? 0, ...usable, ...equip, notes: entry.subtitle }
        : { name: entry.name, qty: 1, enc: 1, ...usable, ...equip, notes: entry.subtitle },
      label: `${entry.name} added to inventory`,
    };
  }

  return null;
}
