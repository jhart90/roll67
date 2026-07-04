import type { SheetData, VisionStats } from '../types.js';
import {
  fmtMod, num, rows, str,
  type FieldDef, type Rollable, type SheetTab, type SystemSchema,
} from './types.js';
import { DAMAGE_TYPES } from './effects.js';
import type { RNG } from '../dice/roller.js';

const ATTRIBUTES = [
  { id: 'str', label: 'STR' },
  { id: 'dex', label: 'DEX' },
  { id: 'con', label: 'CON' },
  { id: 'int', label: 'INT' },
  { id: 'wis', label: 'WIS' },
  { id: 'cha', label: 'CHA' },
] as const;

/** SWN attribute modifier bands: 3 => -2, 4-7 => -1, 8-13 => 0, 14-17 => +1, 18 => +2. */
export function swnMod(score: number): number {
  if (score <= 3) return -2;
  if (score <= 7) return -1;
  if (score <= 13) return 0;
  if (score <= 17) return 1;
  return 2;
}

const SAVES = [
  { id: 'physical', label: 'Physical', attrs: ['str', 'con'] },
  { id: 'evasion', label: 'Evasion', attrs: ['dex', 'int'] },
  { id: 'mental', label: 'Mental', attrs: ['wis', 'cha'] },
] as const;

// ---------- Known values for combo fields (typing custom values still works) ----------

export const BACKGROUNDS_SWN = [
  'Barbarian', 'Clergy', 'Courtesan', 'Criminal', 'Dilettante', 'Entertainer',
  'Merchant', 'Noble', 'Official', 'Peasant', 'Physician', 'Pilot', 'Politician',
  'Scholar', 'Soldier', 'Spacer', 'Technician', 'Thug', 'Vagabond', 'Worker',
];

export const SKILLS_SWN = [
  'Administer', 'Connect', 'Exert', 'Fix', 'Heal', 'Know', 'Lead', 'Notice',
  'Perform', 'Pilot', 'Program', 'Punch', 'Shoot', 'Sneak', 'Stab', 'Survive',
  'Talk', 'Trade', 'Work',
  'Biopsionics', 'Metapsionics', 'Precognition', 'Telekinesis', 'Telepathy', 'Teleportation',
];

export const PSYCHIC_DISCIPLINES_SWN = [
  'Biopsionics', 'Metapsionics', 'Precognition', 'Telekinesis', 'Telepathy', 'Teleportation',
];

// ---------- psionics: Effort, discipline gating, mishaps ----------

/** The character's best trained discipline-skill level, or -1 if untrained
 *  in every discipline (SWN's "untrained" floor). */
export function bestPsychicSkillLevel(sheet: SheetData): number {
  const levels = rows(sheet, 'skills')
    .filter((sk) => PSYCHIC_DISCIPLINES_SWN.includes(str(sk, 'name', '')))
    .map((sk) => num(sk, 'level', 0));
  return levels.length ? Math.max(...levels) : -1;
}

/** Auto max Effort: 1 + the better of a trained discipline skill or WIS/CON mod. */
export function effortMaxFor(sheet: SheetData): number {
  const best = bestPsychicSkillLevel(sheet);
  const wisMod = swnMod(num(sheet, 'wis', 10));
  const conMod = swnMod(num(sheet, 'con', 10));
  return 1 + Math.max(best, wisMod, conMod);
}

/** True if the character has any training (even level 0) in the discipline —
 *  gates which powers can actually be activated as a combat action. */
export function hasDiscipline(sheet: SheetData, discipline: string): boolean {
  return rows(sheet, 'skills').some((sk) => str(sk, 'name', '') === discipline);
}

export interface PsychicMishap {
  id: string;
  text: string;
  /** Extra system strain the mishap adds (0 = none). */
  systemStrain: number;
  /** Self-inflicted damage dice from backlash ('' = none). */
  selfDamage: string;
  /** Draws unwanted attention — narrative flag surfaced in chat. */
  torched: boolean;
}

const MISHAP_TABLE: PsychicMishap[] = [
  { id: 'strain', text: 'feedback wracks their nerves — system strain flares', systemStrain: 1, selfDamage: '', torched: false },
  { id: 'backlash', text: 'the power backlashes painfully', systemStrain: 0, selfDamage: '1d6', torched: false },
  { id: 'overload', text: 'their control slips and the committed effort bleeds away uselessly', systemStrain: 1, selfDamage: '', torched: false },
  { id: 'attention', text: 'something about the moment draws unwanted attention', systemStrain: 0, selfDamage: '', torched: true },
];

/** Snake-eyes (both activation-check d6 show 1) triggers a psychic mishap. */
export function isPsychicMishap(d6Values: number[]): boolean {
  return d6Values.length >= 2 && d6Values.every((v) => v === 1);
}

export function rollMishap(rng: RNG = Math.random): PsychicMishap {
  return MISHAP_TABLE[Math.floor(rng() * MISHAP_TABLE.length)];
}

export const SPECIES_SWN = [
  'Human', 'Android', 'VI (True AI)', 'Uplifted Bioform', 'Alien Sophont', 'Transhuman',
];

// ---------- Phase 6/7: foci mechanics, AC, encumbrance ----------

/** A taken focus at-or-above `minLevel` (foci rows carry an `id` + `level`). */
export function hasFocus(sheet: SheetData, id: string, minLevel = 1): boolean {
  return rows(sheet, 'foci').some((f) => str(f, 'id', '') === id && num(f, 'level', 1) >= minLevel);
}

/** Ironhide's natural AC when unarmored (13 at level 1, 15 at level 2); 0 if untaken. */
function ironhideNaturalAc(sheet: SheetData): number {
  if (hasFocus(sheet, 'ironhide', 2)) return 15;
  if (hasFocus(sheet, 'ironhide', 1)) return 13;
  return 0;
}

/** Sum of AC/save bonuses from equipped (checked) gear, e.g. Dermal Plating
 *  ("+1 armor") or an attuned protective trinket. */
function equippedItemBonuses(sheet: SheetData): { ac: number; save: number } {
  return rows(sheet, 'inventory')
    .filter((i) => i.equipped === true)
    .reduce<{ ac: number; save: number }>(
      (acc, i) => ({ ac: acc.ac + num(i, 'acBonus', 0), save: acc.save + num(i, 'saveBonus', 0) }),
      { ac: 0, save: 0 },
    );
}

/**
 * Derived AC: an equipped armor row wins over the manually-typed AC field
 * (Phase 7's armor→AC auto-calc); Ironhide's natural AC is a floor under
 * that (it doesn't stack with worn armor — bounded by taking the max, not
 * adding); Alert adds a flat +1 (its real trigger is "first round of
 * combat only", simplified here to always-on since derive() has no access
 * to initiative-round state); equipped gear (cyberware, trinkets) adds its
 * AC bonus on top of whichever base is in play.
 */
export function swnDerivedAc(sheet: SheetData): number {
  const equipped = rows(sheet, 'armor').find((a) => a.equipped === true);
  const base = equipped ? num(equipped, 'ac', 10) : num(sheet, 'ac', 10);
  const withNatural = Math.max(base, ironhideNaturalAc(sheet));
  return withNatural + (hasFocus(sheet, 'alert', 1) ? 1 : 0) + equippedItemBonuses(sheet).ac;
}

/** Total carried encumbrance (sum of qty × enc across inventory) and a rough
 *  capacity (6 + 3 × STR mod). Exceeding it halves derived speed. */
export function swnEncumbrance(sheet: SheetData): { total: number; max: number } {
  const total = rows(sheet, 'inventory').reduce((sum, it) => sum + num(it, 'qty', 1) * num(it, 'enc', 1), 0);
  const max = 6 + 3 * swnMod(num(sheet, 'str', 10));
  return { total, max };
}

/** Total system strain installed cyberware costs (informational only — the
 *  sheet's own systemStrain field stays the manually-tracked authoritative
 *  value, since strain also comes from psionic mishaps and other sources). */
export function cyberwareStrainTotal(sheet: SheetData): number {
  return rows(sheet, 'cyberware').reduce((sum, c) => sum + num(c, 'strain', 0), 0);
}

/** The skill Specialist's 3d6-keep-2 bonus applies to: the character's
 *  highest-level skill (there's no per-focus "which skill" picker yet, so
 *  this reads as "specializes in what you're already best at"). */
function specialistSkillName(sheet: SheetData): string | null {
  if (!hasFocus(sheet, 'specialist', 1)) return null;
  const skills = rows(sheet, 'skills');
  if (skills.length === 0) return null;
  const best = skills.reduce((a, b) => (num(b, 'level', 0) > num(a, 'level', 0) ? b : a));
  return str(best, 'name', null as unknown as string) || null;
}

/** Unarmed Strike's damage die: 1d4 baseline, 1d6 with Unarmed Combatant or
 *  Armsman at level 1, 1d8 with either at level 2. */
function unarmedDie(sheet: SheetData): string {
  if (hasFocus(sheet, 'unarmed-combatant', 2) || hasFocus(sheet, 'armsman', 2)) return '1d8';
  if (hasFocus(sheet, 'unarmed-combatant', 1) || hasFocus(sheet, 'armsman', 1)) return '1d6';
  return '1d4';
}

/** Shock bonus damage for a weapon: its own `shock` column, plus Shocking
 *  Assault (+character level, melee only) and Armsman (+1, melee/unarmed
 *  only) — Gunslinger's sidearm shock bump is folded in by the caller since
 *  it depends on the weapon being a named "pistol". */
function shockBonus(sheet: SheetData, rowShock: number, melee: boolean): number {
  let bonus = rowShock;
  if (melee && hasFocus(sheet, 'shocking-assault', 1)) bonus += Math.max(1, num(sheet, 'level', 1));
  if (melee && hasFocus(sheet, 'armsman', 1)) bonus += 1;
  return bonus;
}

// ---------- Tab 1: Core ----------

const identityFields: FieldDef[] = [
  { id: 'class', label: 'Class', type: 'select', options: ['Warrior', 'Expert', 'Psychic', 'Adventurer'], width: 'third', default: 'Expert' },
  {
    id: 'secondaryClass', label: 'Adventurer: 2nd class', type: 'select', width: 'third', default: '',
    options: ['', 'Warrior', 'Expert', 'Psychic'],
  },
  { id: 'background', label: 'Background', type: 'text', width: 'third', suggestions: BACKGROUNDS_SWN },
  { id: 'homeworld', label: 'Homeworld', type: 'text', width: 'third' },
  { id: 'level', label: 'Level', type: 'number', width: 'sixth', default: 1 },
  { id: 'xp', label: 'XP', type: 'number', width: 'sixth', default: 0 },
];

const attributeFields: FieldDef[] = ATTRIBUTES.map((a) => ({
  id: a.id, label: a.label, type: 'number' as const, width: 'sixth' as const, default: 10,
}));

const combatFields: FieldDef[] = [
  { id: 'hp', label: 'HP', type: 'number', width: 'sixth', default: 6 },
  { id: 'maxHp', label: 'Max HP', type: 'number', width: 'sixth', default: 6 },
  { id: 'ac', label: 'AC', type: 'number', width: 'sixth', default: 10 },
  { id: 'attackBonus', label: 'Attack bonus', type: 'number', width: 'sixth', default: 0 },
  { id: 'speed', label: 'Speed (m)', type: 'number', width: 'sixth', default: 10 },
  { id: 'systemStrain', label: 'System strain', type: 'number', width: 'sixth', default: 0 },
  { id: 'resist', label: 'Resistances', type: 'text', width: 'third', default: '' },
  { id: 'vulnerable', label: 'Vulnerabilities', type: 'text', width: 'third', default: '' },
  { id: 'immune', label: 'Immunities', type: 'text', width: 'third', default: '' },
];

const sensesFields: FieldDef[] = [
  { id: 'visionRange', label: 'Vision range (hexes)', type: 'number', width: 'half', default: 24 },
  { id: 'darkvision', label: 'Low-light / IR (hexes)', type: 'number', width: 'half', default: 0 },
];

const coreTab: SheetTab = {
  id: 'core',
  title: 'Core',
  sections: [
    { kind: 'fields', id: 'identity', title: 'Character', fields: identityFields },
    { kind: 'fields', id: 'attributes', title: 'Attributes', fields: attributeFields },
    { kind: 'fields', id: 'combat', title: 'Combat', fields: combatFields },
    {
      kind: 'derived', id: 'saves', title: 'Saving Throws (roll d20, meet or beat)',
      items: [
        { key: 'save_physical', label: 'Physical' },
        { key: 'save_evasion', label: 'Evasion' },
        { key: 'save_mental', label: 'Mental' },
      ],
    },
    { kind: 'fields', id: 'senses', title: 'Senses & Vision', fields: sensesFields },
    {
      kind: 'list', id: 'skills', title: 'Skills',
      columns: [
        { id: 'name', label: 'Skill', type: 'text', width: 'third', suggestions: SKILLS_SWN },
        { id: 'level', label: 'Level', type: 'number', width: 'sixth', default: 0 },
        {
          id: 'attr', label: 'Attribute', type: 'select', width: 'sixth',
          options: ['str', 'dex', 'con', 'int', 'wis', 'cha'], default: 'int',
        },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
    {
      kind: 'derived', id: 'skillPointsDerived', title: 'Skill Points (2/level, +1 more for Expert)',
      items: [{ key: 'skillPointsRemaining', label: 'Remaining' }],
    },
    {
      kind: 'list', id: 'foci', title: 'Foci & Class Abilities',
      columns: [
        { id: 'name', label: 'Focus', type: 'text', width: 'third' },
        { id: 'level', label: 'Level', type: 'number', width: 'sixth', default: 1 },
        { id: 'notes', label: 'Effect', type: 'text', width: 'half' },
      ],
    },
  ],
};

// ---------- Tab 2: Gear & Combat ----------

const gearTab: SheetTab = {
  id: 'gear',
  title: 'Gear & Combat',
  sections: [
    {
      kind: 'list', id: 'attacks', title: 'Weapons',
      columns: [
        { id: 'name', label: 'Weapon', type: 'text', width: 'third' },
        { id: 'bonus', label: 'Hit bonus', type: 'number', width: 'sixth', default: 0 },
        { id: 'damage', label: 'Damage', type: 'text', width: 'sixth', default: '1d6' },
        { id: 'dtype', label: 'Dmg type', type: 'select', width: 'sixth', default: '', options: ['', 'kinetic', 'energy'] },
        { id: 'shock', label: 'Shock', type: 'number', width: 'sixth', default: 0 },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 5 },
        { id: 'ammo', label: 'Ammo left', type: 'number', width: 'sixth' },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'list', id: 'armor', title: 'Armor',
      columns: [
        { id: 'name', label: 'Armor', type: 'text', width: 'third' },
        { id: 'ac', label: 'AC', type: 'number', width: 'sixth', default: 10 },
        { id: 'equipped', label: 'Worn', type: 'checkbox', width: 'sixth' },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
    {
      kind: 'derived', id: 'acDerived', title: 'AC (from worn armor + Ironhide/Alert)',
      items: [{ key: 'ac', label: 'Effective AC' }],
    },
    {
      kind: 'fields', id: 'money', title: 'Money',
      fields: [{ id: 'credits', label: 'Credits', type: 'number', width: 'third', default: 0 }],
    },
    {
      kind: 'list', id: 'inventory', title: 'Gear',
      columns: [
        { id: 'name', label: 'Item', type: 'text', width: 'third' },
        { id: 'qty', label: 'Qty', type: 'number', width: 'sixth', default: 1 },
        { id: 'enc', label: 'Enc', type: 'number', width: 'sixth', default: 1 },
        { id: 'effect', label: 'Use', type: 'select', width: 'sixth', options: ['none', 'heal', 'damage'], default: 'none' },
        { id: 'amount', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'equipped', label: 'Equipped', type: 'checkbox', width: 'sixth' },
        { id: 'acBonus', label: 'AC bonus', type: 'number', width: 'sixth', default: 0 },
        { id: 'saveBonus', label: 'Save bonus', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
    {
      kind: 'derived', id: 'encumbranceDerived', title: 'Encumbrance',
      items: [
        { key: 'encumbrance', label: 'Carried' },
        { key: 'encumbranceMax', label: 'Capacity' },
      ],
    },
    {
      kind: 'list', id: 'cyberware', title: 'Cyberware',
      columns: [
        { id: 'name', label: 'Implant', type: 'text', width: 'third' },
        { id: 'strain', label: 'System strain', type: 'number', width: 'sixth', default: 1 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'half' },
      ],
    },
  ],
};

// ---------- Tab 3: Psionics & Bio ----------

const psionicsTab: SheetTab = {
  id: 'psionics',
  title: 'Psionics & Bio',
  sections: [
    {
      kind: 'fields', id: 'portrait', title: 'Portrait & Token',
      fields: [
        { id: 'tokenImage', label: 'Token image', type: 'image', width: 'half' },
        { id: 'detailImage', label: 'Detail / portrait', type: 'image', width: 'half' },
      ],
    },
    {
      kind: 'fields', id: 'effort', title: 'Effort',
      fields: [
        { id: 'effortCommitted', label: 'Committed', type: 'number', width: 'third', default: 0 },
      ],
    },
    {
      kind: 'derived', id: 'effortStats', title: 'Effort Capacity',
      items: [{ key: 'effortMax', label: 'Max Effort (1 + best of discipline skill / WIS / CON)' }],
    },
    {
      kind: 'list', id: 'powers', title: 'Psychic Powers',
      columns: [
        { id: 'name', label: 'Power', type: 'text', width: 'third' },
        { id: 'discipline', label: 'Discipline', type: 'text', width: 'third', suggestions: PSYCHIC_DISCIPLINES_SWN },
        { id: 'level', label: 'Level', type: 'number', width: 'sixth', default: 0 },
        { id: 'effort', label: 'Effort', type: 'number', width: 'sixth', default: 0 },
        { id: 'effect', label: 'Effect', type: 'select', width: 'sixth', default: 'damage', options: ['damage', 'heal'] },
        { id: 'damage', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'save', label: 'Save', type: 'select', width: 'sixth', default: '', options: ['', 'physical', 'evasion', 'mental'] },
        { id: 'dtype', label: 'Type', type: 'select', width: 'sixth', default: '', options: ['', ...DAMAGE_TYPES] },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'fields', id: 'bio', title: 'Bio',
      fields: [
        { id: 'species', label: 'Species', type: 'text', width: 'third', suggestions: SPECIES_SWN },
        { id: 'goal', label: 'Goal', type: 'text', width: 'third' },
        { id: 'appearance', label: 'Appearance', type: 'text', width: 'third' },
      ],
    },
    {
      kind: 'fields', id: 'notes', title: 'Notes',
      fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }],
    },
  ],
};

export const swn: SystemSchema = {
  id: 'swn',
  name: 'Stars Without Number',
  tabs: [coreTab, gearTab, psionicsTab],

  defaultSheet(): SheetData {
    const sheet: SheetData = {};
    for (const tab of swn.tabs) {
      for (const section of tab.sections) {
        if (section.kind === 'fields') {
          for (const f of section.fields) {
            if (f.default !== undefined) sheet[f.id] = f.default;
          }
        } else if (section.kind === 'list') {
          sheet[section.id] = [];
        }
      }
    }
    return sheet;
  },

  derive(sheet: SheetData): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    const level = num(sheet, 'level', 1);
    for (const a of ATTRIBUTES) {
      const mod = swnMod(num(sheet, a.id, 10));
      out[a.id] = fmtMod(mod);
      out[`${a.id}Mod`] = fmtMod(mod);
    }
    const itemBonus = equippedItemBonuses(sheet);
    for (const s of SAVES) {
      const best = Math.max(...s.attrs.map((a) => swnMod(num(sheet, a, 10))));
      out[`save_${s.id}`] = 15 - level - best - itemBonus.save;
    }
    out.effortMax = effortMaxFor(sheet);
    out.ac = swnDerivedAc(sheet);
    const enc = swnEncumbrance(sheet);
    out.encumbrance = enc.total;
    out.encumbranceMax = enc.max;
    const spent = rows(sheet, 'skills').reduce((sum, sk) => sum + Math.max(0, num(sk, 'level', 0)), 0);
    out.skillPointsRemaining = num(sheet, 'skillPointsEarned', 0) - spent;
    return out;
  },

  rollables(sheet: SheetData): Rollable[] {
    const out: Rollable[] = [];
    const level = num(sheet, 'level', 1);
    const itemBonus = equippedItemBonuses(sheet);
    for (const s of SAVES) {
      const best = Math.max(...s.attrs.map((a) => swnMod(num(sheet, a, 10))));
      const target = 15 - level - best - itemBonus.save;
      out.push({ id: `save_${s.id}`, label: `${s.label} save (need ${target}+)`, expr: '1d20', group: 'Saving throws', d20: true });
    }
    const specSkill = specialistSkillName(sheet);
    const shootSkill = rows(sheet, 'skills').find((sk) => str(sk, 'name', '') === 'Shoot');
    const shootLevel = shootSkill ? Math.max(0, num(shootSkill, 'level', 0)) : 0;
    rows(sheet, 'skills').forEach((sk, i) => {
      const name = str(sk, 'name', `Skill ${i + 1}`);
      const lvl = num(sk, 'level', 0);
      const attr = str(sk, 'attr', 'int');
      const mod = swnMod(num(sheet, attr, 10)) + (name === 'Lead' && hasFocus(sheet, 'authority', 1) ? 2 : 0);
      // Specialist: 3d6-keep-2 instead of the usual 2d6 for your best skill.
      const dice = name === specSkill ? '3d6kh2' : '2d6';
      out.push({
        id: `skill_${i}`,
        label: `${name} (${attr.toUpperCase()})`,
        expr: `${dice}${fmtMod(lvl + mod)}`,
        group: 'Skills',
        d20: false,
      });
    });
    const ab = num(sheet, 'attackBonus', 0);
    // Sniper's Aim toggle: +4 to hit a ranged shot, and (at level 2) adds
    // Shoot-skill dice to the damage. A manual toggle (like the 5e power-attack
    // toggle) rather than an auto-clearing one-shot buff, for consistency.
    const aiming = sheet.aimActive === true && hasFocus(sheet, 'sniper', 1);
    rows(sheet, 'attacks').forEach((atk, i) => {
      const name = str(atk, 'name', `Attack ${i + 1}`);
      const melee = num(atk, 'range', 5) <= 5;
      const isPistol = /pistol/i.test(name);
      let atkBonus = ab + num(atk, 'bonus', 0);
      if (!melee && isPistol && hasFocus(sheet, 'gunslinger', 1)) atkBonus += 1;
      if (!melee && aiming) atkBonus += 4;
      out.push({ id: `attack_${i}`, label: `${name} (hit)`, expr: `1d20${fmtMod(atkBonus)}`, group: 'Attacks', d20: true });
      const dmg = str(atk, 'damage', '').trim();
      if (dmg) {
        let rowShock = num(atk, 'shock', 0);
        if (!melee && isPistol && hasFocus(sheet, 'gunslinger', 2)) rowShock += 2;
        const shock = shockBonus(sheet, rowShock, melee);
        let expr = shock > 0 ? `${dmg}+${shock}` : dmg;
        if (!melee && aiming && shootLevel > 0 && hasFocus(sheet, 'sniper', 2)) expr = `${expr}+${shootLevel}d6`;
        out.push({ id: `damage_${i}`, label: `${name} (damage)`, expr, group: 'Attacks', d20: false });
      }
    });
    // Unarmed Strike is always available, same as a 5e monk's — base 1d4,
    // upgraded to 1d6/1d8 by the Unarmed Combatant or Armsman focus.
    let unarmedAtk = ab;
    if (hasFocus(sheet, 'unarmed-combatant', 1) || hasFocus(sheet, 'armsman', 1)) unarmedAtk += 1;
    out.push({ id: 'unarmed_attack', label: 'Unarmed Strike (hit)', expr: `1d20${fmtMod(unarmedAtk)}`, group: 'Attacks', d20: true });
    const unarmedShock = shockBonus(sheet, 0, true);
    const unarmedDmg = unarmedShock > 0 ? `${unarmedDie(sheet)}+${unarmedShock}` : unarmedDie(sheet);
    out.push({ id: 'unarmed_damage', label: 'Unarmed Strike (damage)', expr: unarmedDmg, group: 'Attacks', d20: false });
    return out;
  },

  vision(sheet: SheetData): VisionStats {
    return {
      visionRange: num(sheet, 'visionRange', 24),
      darkvision: num(sheet, 'darkvision', 0),
    };
  },

  initiativeExpr(sheet: SheetData): string {
    const alertBonus = hasFocus(sheet, 'alert', 2) ? 2 : 0;
    return `1d8${fmtMod(swnMod(num(sheet, 'dex', 10)) + alertBonus)}`;
  },

  hp(sheet: SheetData): { hp: number; maxHp: number } {
    return { hp: num(sheet, 'hp', 0), maxHp: num(sheet, 'maxHp', 0) };
  },

  saveIds(): { id: string; label: string }[] {
    return SAVES.map((s) => ({ id: s.id, label: `${s.label} save` }));
  },

  // SWN saves are target-number based: roll d20, meet or beat 15 − level − best
  // attribute mod. The DC argument is ignored (each target uses its own target).
  saveCheck(sheet: SheetData, saveId: string): { expr: string; threshold: number; label: string } {
    const save = SAVES.find((s) => s.id === saveId) ?? SAVES[0];
    const level = num(sheet, 'level', 1);
    const best = Math.max(...save.attrs.map((a) => swnMod(num(sheet, a, 10))));
    return { expr: '1d20', threshold: 15 - level - best, label: `${save.label} save` };
  },
};
