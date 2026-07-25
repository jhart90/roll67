// Savage Worlds Adventure Edition (SWADE). Traits are die types (d4–d12)
// rather than scores: a trait roll is that die, acing (exploding) on its max,
// vs target number 4 — Wild Cards also roll a d6 wild die and keep the best
// (the roller's `best(1d8!, 1d6!)` form). The VTT engine's AC slot carries
// derived Parry (melee/ranged attacks target it) and its HP pool stands in
// for the wound track — Wounds/Fatigue are tracked on the sheet and feed the
// standard −1/level penalty into every trait roll.

import type { SheetData, VisionStats } from '../types.js';
import {
  fmtMod, num, rows, str,
  type FieldDef, type Rollable, type SheetTab, type SystemSchema,
} from './types.js';
import { DAMAGE_TYPES } from './effects.js';

export const ATTRIBUTES_SWADE = [
  { id: 'agility', label: 'Agility' },
  { id: 'smarts', label: 'Smarts' },
  { id: 'spirit', label: 'Spirit' },
  { id: 'strength', label: 'Strength' },
  { id: 'vigor', label: 'Vigor' },
] as const;

export const TRAIT_DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];

/** "d8" → 8; unknown/blank → 0 (no die). */
export function dieSides(die: string): number {
  const m = /^d(\d+)$/.exec(die.trim().toLowerCase());
  return m ? Number(m[1]) : 0;
}

export const SKILLS_SWADE = [
  'Academics', 'Athletics', 'Battle', 'Boating', 'Common Knowledge', 'Driving',
  'Faith', 'Fighting', 'Focus', 'Gambling', 'Hacking', 'Healing', 'Intimidation',
  'Language', 'Notice', 'Occult', 'Performance', 'Persuasion', 'Piloting',
  'Psionics', 'Repair', 'Research', 'Riding', 'Science', 'Shooting',
  'Spellcasting', 'Stealth', 'Survival', 'Taunt', 'Thievery', 'Weird Science',
];

export const RANKS_SWADE = ['Novice', 'Seasoned', 'Veteran', 'Heroic', 'Legendary'];

export const ARCANE_BACKGROUNDS_SWADE = ['Gifted', 'Magic', 'Miracles', 'Psionics', 'Weird Science'];
const ARCANE_SKILLS = ['', 'Focus', 'Spellcasting', 'Faith', 'Psionics', 'Weird Science'];

export const ANCESTRIES_SWADE = [
  'Human', 'Android', 'Aquarian', 'Avion', 'Dwarf', 'Elf', 'Half-Elf', 'Half-Folk', 'Rakashan', 'Saurian',
];

/** Every SWADE character starts with a free d4 in these five skills — no
 *  points spent (Adventure Edition core rules). Character creation math
 *  (see swadeCreation.ts) treats these as an already-paid baseline. */
export const FREE_SKILLS_SWADE = ['Athletics', 'Common Knowledge', 'Notice', 'Persuasion', 'Stealth'];

/** Each core skill's linked attribute — buying a skill die up to and
 *  including this attribute's die costs 1 build point/step; beyond it,
 *  2 points/step (Adventure Edition character creation rules). */
export const SKILL_ATTR_SWADE: Record<string, string> = {
  Academics: 'smarts', Athletics: 'agility', Battle: 'smarts', Boating: 'agility',
  'Common Knowledge': 'smarts', Driving: 'agility', Faith: 'spirit', Fighting: 'agility',
  Focus: 'spirit', Gambling: 'smarts', Hacking: 'smarts', Healing: 'smarts',
  Intimidation: 'spirit', Language: 'smarts', Notice: 'smarts', Occult: 'smarts',
  Performance: 'spirit', Persuasion: 'spirit', Piloting: 'agility', Psionics: 'smarts',
  Repair: 'smarts', Research: 'smarts', Riding: 'agility', Science: 'smarts',
  Shooting: 'agility', Spellcasting: 'smarts', Stealth: 'agility', Survival: 'smarts',
  Taunt: 'smarts', Thievery: 'agility', 'Weird Science': 'smarts',
};

/** Trait-die step index (0 = d4 … 4 = d12); -1 for an empty/unrecognized die. */
export function dieStepIndex(die: string): number {
  return TRAIT_DICE.indexOf(die);
}

/** Step a die up or down by a signed number of steps, clamped to d4..d12. */
export function stepDie(die: string, steps: number): string {
  const idx = dieStepIndex(die);
  const base = idx === -1 ? 0 : idx;
  return TRAIT_DICE[Math.max(0, Math.min(TRAIT_DICE.length - 1, base + steps))];
}

/** The die a skill/attribute row holds, or 0 sides when untrained/absent. */
function skillDie(sheet: SheetData, name: string): number {
  const row = rows(sheet, 'skills').find((sk) => str(sk, 'name', '').toLowerCase() === name.toLowerCase());
  return row ? dieSides(str(row, 'die', 'd4')) : 0;
}

/** Standard SWADE trait-roll penalty: −1 per Wound (max −3) and per Fatigue level. */
export function woundPenalty(sheet: SheetData): number {
  const wounds = Math.min(3, Math.max(0, num(sheet, 'wounds', 0)));
  const fatigue = Math.min(2, Math.max(0, num(sheet, 'fatigue', 0)));
  return -(wounds + fatigue);
}

/** Trait roll expression: acing trait die, plus a d6 wild die for Wild Cards. */
export function traitExpr(sheet: SheetData, sides: number, mod = 0): string {
  const penalty = woundPenalty(sheet) + mod;
  const tail = penalty !== 0 ? fmtMod(penalty) : '';
  if (sides <= 0) return `1d4!-2${tail}`; // unskilled
  const wild = sheet.wildCard !== false;
  return wild ? `best(1d${sides}!, 1d6!)${tail}` : `1d${sides}!${tail}`;
}

/** Equipped shield Parry bonus + equipped armor Toughness bonus + armor that
 *  only counts against ranged attacks (a Medium/Large Shield's +2). */
function equippedGearBonuses(sheet: SheetData): { parry: number; armor: number; rangedArmor: number } {
  return rows(sheet, 'armor')
    .filter((a) => a.equipped === true)
    .reduce<{ parry: number; armor: number; rangedArmor: number }>(
      (acc, a) => ({
        parry: acc.parry + num(a, 'parryBonus', 0),
        armor: acc.armor + num(a, 'armor', 0),
        rangedArmor: acc.rangedArmor + num(a, 'rangedArmor', 0),
      }),
      { parry: 0, armor: 0, rangedArmor: 0 },
    );
}

/** Extra armor that applies only against ranged attacks (equipped shields).
 *  The combat engine subtracts it from incoming ranged weapon damage. */
export function swadeRangedArmor(sheet: SheetData): number {
  return equippedGearBonuses(sheet).rangedArmor;
}

/** Trait-roll expression for the sheet's arcane skill, or null if none is
 *  set/trained — powers activate with this roll (vs TN 4). */
export function swadeArcaneExpr(sheet: SheetData): string | null {
  const skill = str(sheet, 'arcaneSkill', '');
  if (!skill) return null;
  const sides = dieSides(str(
    rows(sheet, 'skills').find((sk) => str(sk, 'name', '').toLowerCase() === skill.toLowerCase()) ?? {},
    'die', '',
  ));
  return traitExpr(sheet, sides);
}

/** Parry modifier from wielded weapons (a Rapier's +1, a Great Sword's −1). */
function wieldedWeaponParry(sheet: SheetData): number {
  return rows(sheet, 'attacks')
    .filter((a) => a.wielded === true)
    .reduce((sum, a) => sum + num(a, 'parryBonus', 0), 0);
}

/** Parry: 2 + half Fighting die (2 flat when untrained) + equipped shields
 *  + wielded weapon modifiers + a maintained Deflection power (−2 to be hit,
 *  carried here as +2 Parry). */
export function swadeParry(sheet: SheetData): number {
  const fighting = skillDie(sheet, 'Fighting');
  return 2 + Math.floor(fighting / 2) + equippedGearBonuses(sheet).parry
    + wieldedWeaponParry(sheet) + (sheet.deflectionActive === true ? 2 : 0)
    + traitLineBonuses(sheet).parry;
}

/** Toughness: 2 + half Vigor die + equipped armor + maintained Armor /
 *  Protection powers (+2 each while toggled on). */
export function swadeToughness(sheet: SheetData): number {
  const vigor = dieSides(str(sheet, 'vigor', 'd6'));
  return 2 + Math.floor(vigor / 2) + equippedGearBonuses(sheet).armor
    + (sheet.armorActive === true ? 2 : 0) + (sheet.protectionActive === true ? 2 : 0)
    + traitLineBonuses(sheet).toughness;
}

/**
 * Bonus to a named trait (skill or attribute) from everything that can grant
 * one: equipped gear (a Lockpick's +1 Thievery), Edges (Alertness's +2
 * Notice), and Hindrances (Clueless's −2 Common Knowledge). Gear only counts
 * while equipped; Edges and Hindrances are always on.
 */
export function gearTraitBonus(sheet: SheetData, traitName: string): number {
  const want = traitName.trim().toLowerCase();
  if (!want) return 0;
  const matches = (r: SheetData) => str(r, 'bonusSkill', '').trim().toLowerCase() === want;
  const sum = (list: SheetData[]) => list.reduce((n, r) => (matches(r) ? n + num(r, 'bonusAmt', 0) : n), 0);
  return sum(rows(sheet, 'inventory').filter((i) => i.equipped === true))
    + sum(rows(sheet, 'racialTraits'))
    + sum(rows(sheet, 'edges'))
    + sum(rows(sheet, 'hindrances'));
}

/** Flat Parry / Toughness / Pace modifiers granted by Edges and Hindrances. */
function traitLineBonuses(sheet: SheetData): { parry: number; toughness: number; pace: number } {
  return [...rows(sheet, 'racialTraits'), ...rows(sheet, 'edges'), ...rows(sheet, 'hindrances')].reduce<{ parry: number; toughness: number; pace: number }>(
    (acc, r) => ({
      parry: acc.parry + num(r, 'parryBonus', 0),
      toughness: acc.toughness + num(r, 'toughnessBonus', 0),
      pace: acc.pace + num(r, 'paceBonus', 0),
    }),
    { parry: 0, toughness: 0, pace: 0 },
  );
}

/** Pace after Edge/Hindrance modifiers (Fleet-Footed +2, Slow −2). */
export function swadePace(sheet: SheetData): number {
  return Math.max(1, num(sheet, 'pace', 6) + traitLineBonuses(sheet).pace);
}

// ---------- Tab 1: Core ----------

const identityFields: FieldDef[] = [
  { id: 'concept', label: 'Concept', type: 'text', width: 'third' },
  { id: 'ancestry', label: 'Ancestry', type: 'text', width: 'third', suggestions: ANCESTRIES_SWADE },
  { id: 'rank', label: 'Rank', type: 'select', width: 'third', options: RANKS_SWADE, default: 'Novice' },
  { id: 'advances', label: 'Advances', type: 'number', width: 'sixth', default: 0 },
  { id: 'wildCard', label: 'Wild Card', type: 'checkbox', width: 'sixth', default: true },
];

const attributeFields: FieldDef[] = ATTRIBUTES_SWADE.map((a) => ({
  id: a.id, label: a.label, type: 'select' as const, width: 'sixth' as const,
  options: TRAIT_DICE, default: 'd6',
}));

const combatFields: FieldDef[] = [
  { id: 'bennies', label: 'Bennies', type: 'number', width: 'sixth', default: 3 },
  { id: 'wounds', label: 'Wounds (0–3)', type: 'number', width: 'sixth', default: 0 },
  { id: 'fatigue', label: 'Fatigue (0–2)', type: 'number', width: 'sixth', default: 0 },
  { id: 'pace', label: 'Pace', type: 'number', width: 'sixth', default: 6 },
  { id: 'runningDie', label: 'Running die', type: 'select', width: 'sixth', options: TRAIT_DICE, default: 'd6' },
  { id: 'hp', label: 'HP (pool)', type: 'number', width: 'sixth', default: 15 },
  { id: 'maxHp', label: 'Max HP', type: 'number', width: 'sixth', default: 15 },
  { id: 'resist', label: 'Resistances', type: 'text', width: 'third', default: '' },
  { id: 'vulnerable', label: 'Vulnerabilities', type: 'text', width: 'third', default: '' },
  { id: 'immune', label: 'Immunities', type: 'text', width: 'third', default: '' },
];

const sensesFields: FieldDef[] = [
  { id: 'visionRange', label: 'Vision range (hexes)', type: 'number', width: 'half', default: 24 },
  { id: 'darkvision', label: 'Low-light / infravision (hexes)', type: 'number', width: 'half', default: 0 },
];

const coreTab: SheetTab = {
  id: 'core',
  title: 'Core',
  sections: [
    { kind: 'fields', id: 'identity', title: 'Character', fields: identityFields },
    { kind: 'fields', id: 'attributes', title: 'Attributes (trait dice)', fields: attributeFields },
    { kind: 'fields', id: 'combat', title: 'Combat', fields: combatFields },
    {
      kind: 'derived', id: 'derivedStats', title: 'Derived (TN 4; attacks target Parry)',
      items: [
        { key: 'parry', label: 'Parry' },
        { key: 'toughness', label: 'Toughness (incl. armor)' },
        { key: 'toughnessRanged', label: 'Toughness vs ranged' },
        { key: 'pace', label: 'Pace' },
        { key: 'traitPenalty', label: 'Wound/Fatigue penalty' },
      ],
    },
    { kind: 'fields', id: 'senses', title: 'Senses & Vision', fields: sensesFields },
    {
      kind: 'list', id: 'skills', title: 'Skills',
      columns: [
        { id: 'name', label: 'Skill', type: 'text', width: 'third', suggestions: SKILLS_SWADE },
        { id: 'die', label: 'Die', type: 'select', width: 'sixth', options: TRAIT_DICE, default: 'd4' },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
    {
      // Racial abilities from an ancestry live here as first-class traits
      // with the same live modifier columns as Edges — never disguised as
      // gear or armor rows.
      kind: 'list', id: 'racialTraits', title: 'Ancestry Traits',
      columns: [
        { id: 'name', label: 'Trait', type: 'text', width: 'third' },
        { id: 'bonusSkill', label: 'Boosts trait', type: 'text', width: 'sixth', suggestions: [...SKILLS_SWADE, 'Strength', 'Agility', 'Smarts', 'Spirit', 'Vigor'] },
        { id: 'bonusAmt', label: '+', type: 'number', width: 'sixth', default: 0 },
        { id: 'parryBonus', label: 'Parry', type: 'number', width: 'sixth', default: 0 },
        { id: 'toughnessBonus', label: 'Toughness', type: 'number', width: 'sixth', default: 0 },
        { id: 'paceBonus', label: 'Pace', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Effect', type: 'text', width: 'half' },
      ],
    },
    {
      // Edges carry live modifier columns so a taken Edge actually moves the
      // sheet: Alertness raises Notice rolls, Brawny raises Toughness,
      // Fleet-Footed raises Pace, and so on — no manual bookkeeping.
      kind: 'list', id: 'edges', title: 'Edges',
      columns: [
        { id: 'name', label: 'Edge', type: 'text', width: 'third' },
        { id: 'bonusSkill', label: 'Boosts trait', type: 'text', width: 'sixth', suggestions: [...SKILLS_SWADE, 'Strength', 'Agility', 'Smarts', 'Spirit', 'Vigor'] },
        { id: 'bonusAmt', label: '+', type: 'number', width: 'sixth', default: 0 },
        { id: 'parryBonus', label: 'Parry', type: 'number', width: 'sixth', default: 0 },
        { id: 'toughnessBonus', label: 'Toughness', type: 'number', width: 'sixth', default: 0 },
        { id: 'paceBonus', label: 'Pace', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Effect', type: 'text', width: 'half' },
      ],
    },
    {
      kind: 'list', id: 'hindrances', title: 'Hindrances',
      columns: [
        { id: 'name', label: 'Hindrance', type: 'text', width: 'third' },
        { id: 'severity', label: 'Severity', type: 'select', width: 'sixth', options: ['Minor', 'Major'], default: 'Minor' },
        { id: 'bonusSkill', label: 'Affects trait', type: 'text', width: 'sixth', suggestions: [...SKILLS_SWADE, 'Strength', 'Agility', 'Smarts', 'Spirit', 'Vigor'] },
        { id: 'bonusAmt', label: '±', type: 'number', width: 'sixth', default: 0 },
        { id: 'parryBonus', label: 'Parry', type: 'number', width: 'sixth', default: 0 },
        { id: 'toughnessBonus', label: 'Toughness', type: 'number', width: 'sixth', default: 0 },
        { id: 'paceBonus', label: 'Pace', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Effect', type: 'text', width: 'third' },
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
      kind: 'list', id: 'attacks', title: 'Weapons (damage dice ace with "!")',
      columns: [
        { id: 'name', label: 'Weapon', type: 'text', width: 'third' },
        { id: 'skill', label: 'Skill', type: 'select', width: 'sixth', options: ['Fighting', 'Shooting', 'Athletics'], default: 'Fighting' },
        { id: 'damage', label: 'Damage', type: 'text', width: 'sixth', default: '1d6!' },
        { id: 'dtype', label: 'Dmg type', type: 'select', width: 'sixth', default: '', options: ['', ...DAMAGE_TYPES] },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 5 },
        { id: 'ap', label: 'AP', type: 'number', width: 'sixth', default: 0 },
        { id: 'parryBonus', label: 'Parry mod', type: 'number', width: 'sixth', default: 0 },
        { id: 'wielded', label: 'Wielded', type: 'checkbox', width: 'sixth' },
        { id: 'ammo', label: 'Ammo left', type: 'number', width: 'sixth' },
        { id: 'notes', label: 'Notes (RoF…)', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'list', id: 'armor', title: 'Armor & Shields',
      columns: [
        { id: 'name', label: 'Item', type: 'text', width: 'third' },
        { id: 'armor', label: 'Armor (+Toughness)', type: 'number', width: 'sixth', default: 0 },
        { id: 'parryBonus', label: 'Parry (+shield)', type: 'number', width: 'sixth', default: 0 },
        { id: 'rangedArmor', label: 'Armor vs ranged', type: 'number', width: 'sixth', default: 0 },
        { id: 'equipped', label: 'Worn', type: 'checkbox', width: 'sixth' },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'fields', id: 'money', title: 'Money',
      fields: [{ id: 'dollars', label: 'Currency ($)', type: 'number', width: 'third', default: 500 }],
    },
    {
      kind: 'list', id: 'inventory', title: 'Gear',
      columns: [
        { id: 'name', label: 'Item', type: 'text', width: 'third' },
        { id: 'qty', label: 'Qty', type: 'number', width: 'sixth', default: 1 },
        { id: 'weight', label: 'Weight', type: 'number', width: 'sixth', default: 0 },
        { id: 'effect', label: 'Use', type: 'select', width: 'sixth', options: ['none', 'heal', 'damage'], default: 'none' },
        { id: 'amount', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'equipped', label: 'Equipped', type: 'checkbox', width: 'sixth' },
        { id: 'bonusSkill', label: 'Boosts trait', type: 'text', width: 'sixth', suggestions: [...SKILLS_SWADE, 'Strength', 'Agility', 'Smarts', 'Spirit', 'Vigor'] },
        { id: 'bonusAmt', label: '+', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
  ],
};

// ---------- Tab 3: Powers & Bio ----------

const powersTab: SheetTab = {
  id: 'powers',
  title: 'Powers & Bio',
  sections: [
    {
      kind: 'fields', id: 'portrait', title: 'Portrait & Token',
      fields: [
        { id: 'tokenImage', label: 'Token image', type: 'image', width: 'half' },
        { id: 'detailImage', label: 'Detail / portrait', type: 'image', width: 'half' },
      ],
    },
    {
      kind: 'fields', id: 'arcane', title: 'Arcane Background',
      fields: [
        { id: 'arcaneBackground', label: 'Arcane Background', type: 'text', width: 'third', suggestions: ARCANE_BACKGROUNDS_SWADE },
        { id: 'arcaneSkill', label: 'Arcane skill', type: 'select', width: 'third', options: ARCANE_SKILLS, default: '' },
        { id: 'pp', label: 'Power Points', type: 'number', width: 'sixth', default: 10 },
        { id: 'maxPp', label: 'Max PP', type: 'number', width: 'sixth', default: 10 },
      ],
    },
    {
      // Self-buff powers with an ongoing stat effect: toggle while maintained
      // (spend/track the PP by hand — durations aren't clocked). The effects
      // are live: Armor/Protection raise Toughness, Deflection raises Parry,
      // Smite adds +2 to wielded weapon damage.
      kind: 'fields', id: 'maintainedPowers', title: 'Maintained Powers (toggle while active; PP by hand)',
      fields: [
        { id: 'armorActive', label: 'Armor (+2 Toughness)', type: 'checkbox', width: 'sixth', default: false },
        { id: 'protectionActive', label: 'Protection (+2 Toughness)', type: 'checkbox', width: 'sixth', default: false },
        { id: 'deflectionActive', label: 'Deflection (+2 Parry)', type: 'checkbox', width: 'sixth', default: false },
        { id: 'smiteActive', label: 'Smite (+2 wielded dmg)', type: 'checkbox', width: 'sixth', default: false },
      ],
    },
    {
      kind: 'list', id: 'powers', title: 'Powers',
      columns: [
        { id: 'name', label: 'Power', type: 'text', width: 'third' },
        { id: 'cost', label: 'PP', type: 'number', width: 'sixth', default: 1 },
        { id: 'effect', label: 'Effect', type: 'select', width: 'sixth', default: 'damage', options: ['damage', 'heal'] },
        { id: 'damage', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'dtype', label: 'Type', type: 'select', width: 'sixth', default: '', options: ['', ...DAMAGE_TYPES] },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'save', label: 'Resisted by', type: 'select', width: 'sixth', default: '', options: ['', 'agility', 'smarts', 'spirit', 'strength', 'vigor'] },
        { id: 'onSave', label: 'On success', type: 'select', width: 'sixth', default: 'negate', options: ['negate', 'half'] },
        { id: 'aoeShape', label: 'Area', type: 'select', width: 'sixth', default: '', options: ['', 'sphere', 'cone', 'line', 'cube'] },
        { id: 'aoeSize', label: 'Area ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'condition', label: 'Inflicts', type: 'select', width: 'sixth', default: '', options: ['', 'shaken', 'distracted', 'vulnerable', 'entangled', 'bound', 'stunned', 'frightened', 'blinded', 'invisible', 'prone', 'unconscious'] },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'fields', id: 'notes', title: 'Notes',
      fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }],
    },
  ],
};

export const swade: SystemSchema = {
  id: 'swade',
  name: 'Savage Worlds (SWADE)',
  tabs: [coreTab, gearTab, powersTab],

  defaultSheet(): SheetData {
    const sheet: SheetData = {};
    for (const tab of swade.tabs) {
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
    // Every SWADE character starts with the core skills at d4.
    sheet.skills = FREE_SKILLS_SWADE.map((name) => ({ name, die: 'd4', notes: '' }));
    return sheet;
  },

  derive(sheet: SheetData): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    for (const a of ATTRIBUTES_SWADE) {
      out[a.id] = str(sheet, a.id, 'd6');
    }
    out.parry = swadeParry(sheet);
    out.toughness = swadeToughness(sheet);
    out.toughnessRanged = swadeToughness(sheet) + swadeRangedArmor(sheet);
    out.pace = swadePace(sheet);
    // The combat engine resolves attack rolls against derived `ac`: in SWADE
    // that target number is Parry (ranged attacks vs a stationary TN 4 are
    // left to the DM's judgment — Parry is the safe common case).
    out.ac = swadeParry(sheet);
    const penalty = woundPenalty(sheet);
    out.traitPenalty = penalty !== 0 ? fmtMod(penalty) : '—';
    return out;
  },

  rollables(sheet: SheetData): Rollable[] {
    const out: Rollable[] = [];
    for (const a of ATTRIBUTES_SWADE) {
      const sides = dieSides(str(sheet, a.id, 'd6'));
      const gear = gearTraitBonus(sheet, a.label);
      out.push({
        id: `trait_${a.id}`,
        label: `${a.label} (d${sides || 4})${gear ? ` [gear ${fmtMod(gear)}]` : ''}`,
        expr: traitExpr(sheet, sides, gear),
        group: 'Attributes',
        d20: false,
      });
    }
    rows(sheet, 'skills').forEach((sk, i) => {
      const name = str(sk, 'name', `Skill ${i + 1}`);
      const sides = dieSides(str(sk, 'die', 'd4'));
      const gear = gearTraitBonus(sheet, name);
      out.push({
        id: `skill_${i}`,
        label: `${name} (d${sides || 4})${gear ? ` [gear ${fmtMod(gear)}]` : ''}`,
        expr: traitExpr(sheet, sides, gear),
        group: 'Skills',
        d20: false,
      });
    });
    out.push({ id: 'unskilled', label: 'Unskilled (d4−2)', expr: traitExpr(sheet, 0), group: 'Skills', d20: false });
    rows(sheet, 'attacks').forEach((atk, i) => {
      const name = str(atk, 'name', `Attack ${i + 1}`);
      const skill = str(atk, 'skill', 'Fighting');
      out.push({
        id: `attack_${i}`,
        label: `${name} (${skill})`,
        expr: traitExpr(sheet, skillDie(sheet, skill)),
        group: 'Attacks',
        d20: false,
      });
      let dmg = str(atk, 'damage', '').trim();
      // A maintained Smite adds +2 damage to the wielded weapon.
      if (dmg && sheet.smiteActive === true && atk.wielded === true) dmg = `${dmg}+2`;
      if (dmg) {
        out.push({ id: `damage_${i}`, label: `${name} (damage)`, expr: dmg, group: 'Attacks', d20: false });
      }
    });
    // Powers: the activation roll is the arcane skill's trait roll; the
    // effect roll is whatever the power's Amount column holds.
    const arcaneSkill = str(sheet, 'arcaneSkill', '');
    rows(sheet, 'powers').forEach((pw, i) => {
      const name = str(pw, 'name', `Power ${i + 1}`);
      if (arcaneSkill) {
        out.push({
          id: `power_${i}`,
          label: `${name} (${arcaneSkill}, ${num(pw, 'cost', 1)} PP)`,
          expr: traitExpr(sheet, skillDie(sheet, arcaneSkill)),
          group: 'Powers',
          d20: false,
        });
      }
      const dmg = str(pw, 'damage', '').trim();
      if (dmg) {
        out.push({ id: `powerDamage_${i}`, label: `${name} (effect)`, expr: dmg, group: 'Powers', d20: false });
      }
    });
    const running = dieSides(str(sheet, 'runningDie', 'd6')) || 6;
    out.push({ id: 'running', label: 'Running die', expr: `1d${running}`, group: 'Other', d20: false });
    return out;
  },

  vision(sheet: SheetData): VisionStats {
    return {
      visionRange: num(sheet, 'visionRange', 24),
      darkvision: num(sheet, 'darkvision', 0),
    };
  },

  // Action-deck stand-in: 1d54 over the 54-card deck, high card acts first
  // (53–54 read as the Jokers — take a Benny and act when you like).
  initiativeExpr(): string {
    return '1d54';
  },

  hp(sheet: SheetData): { hp: number; maxHp: number } {
    return { hp: num(sheet, 'hp', 0), maxHp: num(sheet, 'maxHp', 0) };
  },

  saveIds(): { id: string; label: string }[] {
    return ATTRIBUTES_SWADE.map((a) => ({ id: a.id, label: `${a.label} roll` }));
  },

  // SWADE has no saving throws per se — a "save" is a trait roll against the
  // fixed target number 4 (the DC argument is ignored).
  saveCheck(sheet: SheetData, saveId: string): { expr: string; threshold: number; label: string } {
    const attr = ATTRIBUTES_SWADE.find((a) => a.id === saveId) ?? ATTRIBUTES_SWADE[0];
    const sides = dieSides(str(sheet, attr.id, 'd6'));
    return { expr: traitExpr(sheet, sides), threshold: 4, label: `${attr.label} roll` };
  },
};
