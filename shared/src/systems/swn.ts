import type { SheetData, VisionStats } from '../types.js';
import {
  fmtMod, num, rows, str,
  type FieldDef, type Rollable, type SheetTab, type SystemSchema,
} from './types.js';

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

export const SPECIES_SWN = [
  'Human', 'Android', 'VI (True AI)', 'Uplifted Bioform', 'Alien Sophont', 'Transhuman',
];

// ---------- Tab 1: Core ----------

const identityFields: FieldDef[] = [
  { id: 'class', label: 'Class', type: 'select', options: ['Warrior', 'Expert', 'Psychic', 'Adventurer'], width: 'third', default: 'Expert' },
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
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 5 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'list', id: 'armor', title: 'Armor',
      columns: [
        { id: 'name', label: 'Armor', type: 'text', width: 'third' },
        { id: 'ac', label: 'AC', type: 'number', width: 'sixth', default: 10 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
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
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
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
      kind: 'fields', id: 'effort', title: 'Effort',
      fields: [
        { id: 'effortMax', label: 'Max effort', type: 'number', width: 'third', default: 0 },
        { id: 'effortCommitted', label: 'Committed', type: 'number', width: 'third', default: 0 },
      ],
    },
    {
      kind: 'list', id: 'powers', title: 'Psychic Powers',
      columns: [
        { id: 'name', label: 'Power', type: 'text', width: 'third' },
        { id: 'discipline', label: 'Discipline', type: 'text', width: 'third', suggestions: PSYCHIC_DISCIPLINES_SWN },
        { id: 'level', label: 'Level', type: 'number', width: 'sixth', default: 0 },
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
    for (const s of SAVES) {
      const best = Math.max(...s.attrs.map((a) => swnMod(num(sheet, a, 10))));
      out[`save_${s.id}`] = 15 - level - best;
    }
    return out;
  },

  rollables(sheet: SheetData): Rollable[] {
    const out: Rollable[] = [];
    const level = num(sheet, 'level', 1);
    for (const s of SAVES) {
      const best = Math.max(...s.attrs.map((a) => swnMod(num(sheet, a, 10))));
      const target = 15 - level - best;
      out.push({ id: `save_${s.id}`, label: `${s.label} save (need ${target}+)`, expr: '1d20', group: 'Saving throws', d20: true });
    }
    rows(sheet, 'skills').forEach((sk, i) => {
      const name = str(sk, 'name', `Skill ${i + 1}`);
      const lvl = num(sk, 'level', 0);
      const attr = str(sk, 'attr', 'int');
      const mod = swnMod(num(sheet, attr, 10));
      out.push({
        id: `skill_${i}`,
        label: `${name} (${attr.toUpperCase()})`,
        expr: `2d6${fmtMod(lvl + mod)}`,
        group: 'Skills',
        d20: false,
      });
    });
    const ab = num(sheet, 'attackBonus', 0);
    rows(sheet, 'attacks').forEach((atk, i) => {
      const name = str(atk, 'name', `Attack ${i + 1}`);
      out.push({ id: `attack_${i}`, label: `${name} (hit)`, expr: `1d20${fmtMod(ab + num(atk, 'bonus', 0))}`, group: 'Attacks', d20: true });
      const dmg = str(atk, 'damage', '').trim();
      if (dmg) out.push({ id: `damage_${i}`, label: `${name} (damage)`, expr: dmg, group: 'Attacks', d20: false });
    });
    return out;
  },

  vision(sheet: SheetData): VisionStats {
    return {
      visionRange: num(sheet, 'visionRange', 24),
      darkvision: num(sheet, 'darkvision', 0),
    };
  },

  initiativeExpr(sheet: SheetData): string {
    return `1d8${fmtMod(swnMod(num(sheet, 'dex', 10)))}`;
  },

  hp(sheet: SheetData): { hp: number; maxHp: number } {
    return { hp: num(sheet, 'hp', 0), maxHp: num(sheet, 'maxHp', 0) };
  },
};
