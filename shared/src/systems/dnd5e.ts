import type { SheetData, VisionStats } from '../types.js';
import {
  bool, fmtMod, num, rows, str,
  type FieldDef, type Rollable, type SheetTab, type SystemSchema,
} from './types.js';
import {
  classId, divineFury, divineSmite, fightingStyleBonus, isRaging, martialArtsDie, rageDamage,
  remarkableAthleteBonus, sneakAttackDice, superiorityDice,
} from './features5e.js';
import { dualWielderAcBonus, featBonuses, powerAttackBonus } from './feats5e.js';

const ABILITIES = [
  { id: 'str', label: 'STR' },
  { id: 'dex', label: 'DEX' },
  { id: 'con', label: 'CON' },
  { id: 'int', label: 'INT' },
  { id: 'wis', label: 'WIS' },
  { id: 'cha', label: 'CHA' },
] as const;

const DAMAGE_TYPES_5E = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];

const AOE_SHAPES_5E = ['sphere', 'cone', 'line', 'cube', 'cylinder'];

export const SKILLS_5E = [
  { id: 'acrobatics', label: 'Acrobatics', ability: 'dex' },
  { id: 'animalHandling', label: 'Animal Handling', ability: 'wis' },
  { id: 'arcana', label: 'Arcana', ability: 'int' },
  { id: 'athletics', label: 'Athletics', ability: 'str' },
  { id: 'deception', label: 'Deception', ability: 'cha' },
  { id: 'history', label: 'History', ability: 'int' },
  { id: 'insight', label: 'Insight', ability: 'wis' },
  { id: 'intimidation', label: 'Intimidation', ability: 'cha' },
  { id: 'investigation', label: 'Investigation', ability: 'int' },
  { id: 'medicine', label: 'Medicine', ability: 'wis' },
  { id: 'nature', label: 'Nature', ability: 'int' },
  { id: 'perception', label: 'Perception', ability: 'wis' },
  { id: 'performance', label: 'Performance', ability: 'cha' },
  { id: 'persuasion', label: 'Persuasion', ability: 'cha' },
  { id: 'religion', label: 'Religion', ability: 'int' },
  { id: 'sleightOfHand', label: 'Sleight of Hand', ability: 'dex' },
  { id: 'stealth', label: 'Stealth', ability: 'dex' },
  { id: 'survival', label: 'Survival', ability: 'wis' },
] as const;

/** Sum of AC/save bonuses from equipped (checked) inventory items, e.g. a
 *  worn Cloak of Protection ("+1 AC and saving throws"). */
function equippedItemBonuses(sheet: SheetData): { ac: number; save: number } {
  return rows(sheet, 'inventory')
    .filter((i) => i.equipped === true)
    .reduce<{ ac: number; save: number }>(
      (acc, i) => ({ ac: acc.ac + num(i, 'acBonus', 0), save: acc.save + num(i, 'saveBonus', 0) }),
      { ac: 0, save: 0 },
    );
}

/**
 * AC from worn armor: an equipped non-shield armor row replaces the
 * manually-typed base AC (base + Dex, capped per its maxDex); a manually-typed
 * base AC is used as a fallback when nothing is equipped (preserves existing
 * NPCs/monsters that never use the armor list). Equipped shields always add
 * their AC on top, whichever base is in play.
 */
function armorAc(sheet: SheetData): number {
  const armor = rows(sheet, 'armor').filter((a) => a.equipped === true);
  const body = armor.find((a) => a.shield !== true);
  const shields = armor.filter((a) => a.shield === true);
  let base: number;
  if (body) {
    const dexMod = abilityMod(num(sheet, 'dex', 10));
    const maxDex = num(body, 'maxDex', -1);
    const dexBonus = body.addDex ? (maxDex < 0 ? dexMod : Math.min(dexMod, maxDex)) : 0;
    base = num(body, 'baseAc', 10) + dexBonus;
  } else {
    base = num(sheet, 'ac', 10);
  }
  return base + shields.reduce((sum, s) => sum + num(s, 'baseAc', 0), 0);
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function profBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// ---------- Known values for combo fields (typing custom values still works) ----------

export const CLASSES_5E = [
  'Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
  'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
];

export const SUBCLASSES_5E = [
  // Artificer
  'Alchemist', 'Armorer', 'Artillerist', 'Battle Smith',
  // Barbarian
  'Path of the Berserker', 'Path of the Totem Warrior', 'Path of the Ancestral Guardian',
  'Path of the Storm Herald', 'Path of the Zealot', 'Path of Wild Magic', 'Path of the Beast',
  // Bard
  'College of Lore', 'College of Valor', 'College of Glamour', 'College of Swords',
  'College of Whispers', 'College of Creation', 'College of Eloquence',
  // Cleric
  'Knowledge Domain', 'Life Domain', 'Light Domain', 'Nature Domain', 'Tempest Domain',
  'Trickery Domain', 'War Domain', 'Death Domain', 'Forge Domain', 'Grave Domain',
  'Order Domain', 'Peace Domain', 'Twilight Domain',
  // Druid
  'Circle of the Land', 'Circle of the Moon', 'Circle of Dreams', 'Circle of the Shepherd',
  'Circle of Spores', 'Circle of Stars', 'Circle of Wildfire',
  // Fighter
  'Champion', 'Battle Master', 'Eldritch Knight', 'Arcane Archer', 'Cavalier',
  'Samurai', 'Psi Warrior', 'Rune Knight', 'Echo Knight',
  // Monk
  'Way of the Open Hand', 'Way of Shadow', 'Way of the Four Elements', 'Way of the Drunken Master',
  'Way of the Kensei', 'Way of the Sun Soul', 'Way of Mercy', 'Way of the Astral Self',
  // Paladin
  'Oath of Devotion', 'Oath of the Ancients', 'Oath of Vengeance', 'Oath of Conquest',
  'Oath of Redemption', 'Oath of Glory', 'Oath of the Watchers', 'Oathbreaker',
  // Ranger
  'Hunter', 'Beast Master', 'Gloom Stalker', 'Horizon Walker', 'Monster Slayer',
  'Fey Wanderer', 'Swarmkeeper', 'Drakewarden',
  // Rogue
  'Thief', 'Assassin', 'Arcane Trickster', 'Inquisitive', 'Mastermind', 'Scout',
  'Swashbuckler', 'Phantom', 'Soulknife',
  // Sorcerer
  'Draconic Bloodline', 'Wild Magic', 'Divine Soul', 'Shadow Magic', 'Storm Sorcery',
  'Aberrant Mind', 'Clockwork Soul',
  // Warlock
  'The Archfey', 'The Fiend', 'The Great Old One', 'The Celestial', 'The Hexblade',
  'The Fathomless', 'The Genie', 'The Undying',
  // Wizard
  'School of Abjuration', 'School of Conjuration', 'School of Divination', 'School of Enchantment',
  'School of Evocation', 'School of Illusion', 'School of Necromancy', 'School of Transmutation',
  'Bladesinging', 'War Magic', 'Order of Scribes',
];

export const RACES_5E = [
  'Human', 'Variant Human', 'Hill Dwarf', 'Mountain Dwarf', 'High Elf', 'Wood Elf',
  'Drow', 'Eladrin', 'Lightfoot Halfling', 'Stout Halfling', 'Forest Gnome', 'Rock Gnome',
  'Deep Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling', 'Dragonborn', 'Aasimar', 'Goliath',
  'Tabaxi', 'Firbolg', 'Kenku', 'Tortle', 'Triton', 'Genasi (Air)', 'Genasi (Earth)',
  'Genasi (Fire)', 'Genasi (Water)', 'Goblin', 'Hobgoblin', 'Bugbear', 'Kobold',
  'Lizardfolk', 'Orc', 'Yuan-ti Pureblood', 'Changeling', 'Warforged', 'Shifter', 'Harengon',
];

export const BACKGROUNDS_5E = [
  'Acolyte', 'Charlatan', 'Criminal', 'Entertainer', 'Folk Hero', 'Gladiator',
  'Guild Artisan', 'Hermit', 'Knight', 'Noble', 'Outlander', 'Pirate', 'Sage',
  'Sailor', 'Soldier', 'Spy', 'Urchin', 'Haunted One', 'City Watch', 'Far Traveler',
];

export const ALIGNMENTS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Unaligned',
];

// ---------- Tab 1: Core ----------

const identityFields: FieldDef[] = [
  { id: 'class', label: 'Class', type: 'text', width: 'third', suggestions: CLASSES_5E },
  { id: 'subclass', label: 'Subclass', type: 'text', width: 'third', suggestions: SUBCLASSES_5E },
  { id: 'race', label: 'Race', type: 'text', width: 'third', suggestions: RACES_5E },
  { id: 'background', label: 'Background', type: 'text', width: 'third', suggestions: BACKGROUNDS_5E },
  { id: 'alignment', label: 'Alignment', type: 'text', width: 'third', suggestions: ALIGNMENTS },
  { id: 'level', label: 'Level', type: 'number', width: 'sixth', default: 1 },
  { id: 'xp', label: 'XP', type: 'number', width: 'sixth', default: 0 },
  { id: 'inspiration', label: 'Inspiration', type: 'checkbox', width: 'sixth' },
];

const abilityFields: FieldDef[] = ABILITIES.map((a) => ({
  id: a.id, label: a.label, type: 'number' as const, width: 'sixth' as const, default: 10,
}));

const combatFields: FieldDef[] = [
  { id: 'ac', label: 'AC', type: 'number', width: 'sixth', default: 10 },
  { id: 'speed', label: 'Speed (ft)', type: 'number', width: 'sixth', default: 30 },
  { id: 'hp', label: 'HP', type: 'number', width: 'sixth', default: 10 },
  { id: 'maxHp', label: 'Max HP', type: 'number', width: 'sixth', default: 10 },
  { id: 'tempHp', label: 'Temp HP', type: 'number', width: 'sixth', default: 0 },
  { id: 'hitDice', label: 'Hit Dice', type: 'text', width: 'sixth', default: '1d8' },
  { id: 'deathSuccesses', label: 'Death Saves ✓', type: 'number', width: 'sixth', default: 0 },
  { id: 'deathFailures', label: 'Death Saves ✗', type: 'number', width: 'sixth', default: 0 },
  {
    id: 'fightingStyle', label: 'Fighting Style', type: 'select', width: 'third', default: '—',
    options: ['—', 'Archery', 'Defense', 'Dueling', 'Great Weapon Fighting', 'Protection', 'Two-Weapon Fighting'],
  },
  { id: 'resist', label: 'Resistances', type: 'text', width: 'third', default: '' },
  { id: 'vulnerable', label: 'Vulnerabilities', type: 'text', width: 'third', default: '' },
  { id: 'immune', label: 'Immunities', type: 'text', width: 'third', default: '' },
];

const saveFields: FieldDef[] = ABILITIES.map((a) => ({
  id: `save_${a.id}`, label: a.label, type: 'checkbox' as const, width: 'sixth' as const,
}));

const skillFields: FieldDef[] = SKILLS_5E.map((s) => ({
  id: `skill_${s.id}`, label: s.label, type: 'checkbox' as const, width: 'third' as const,
}));

const sensesFields: FieldDef[] = [
  { id: 'visionRange', label: 'Vision range (hexes)', type: 'number', width: 'half', default: 24 },
  { id: 'darkvision', label: 'Darkvision (hexes)', type: 'number', width: 'half', default: 0 },
];

const currencyFields: FieldDef[] = ['cp', 'sp', 'ep', 'gp', 'pp'].map((c) => ({
  id: c, label: c.toUpperCase(), type: 'number' as const, width: 'sixth' as const, default: 0,
}));

const coreTab: SheetTab = {
  id: 'core',
  title: 'Core',
  sections: [
    { kind: 'fields', id: 'identity', title: 'Character', fields: identityFields },
    { kind: 'fields', id: 'abilities', title: 'Ability Scores', fields: abilityFields },
    {
      kind: 'derived', id: 'coreStats', title: 'Derived',
      items: [
        { key: 'profBonus', label: 'Proficiency' },
        { key: 'initiative', label: 'Initiative' },
        { key: 'passivePerception', label: 'Passive Perc.' },
      ],
    },
    { kind: 'fields', id: 'combat', title: 'Combat', fields: combatFields },
    { kind: 'fields', id: 'saves', title: 'Saving Throw Proficiencies', fields: saveFields },
    { kind: 'fields', id: 'skills', title: 'Skill Proficiencies', fields: skillFields },
    { kind: 'fields', id: 'senses', title: 'Senses & Vision', fields: sensesFields },
    {
      kind: 'list', id: 'attacks', title: 'Attacks',
      columns: [
        { id: 'name', label: 'Name', type: 'text', width: 'third' },
        { id: 'bonus', label: 'Atk bonus', type: 'number', width: 'sixth', default: 0 },
        { id: 'damage', label: 'Damage', type: 'text', width: 'sixth', default: '1d6' },
        { id: 'dtype', label: 'Dmg type', type: 'select', width: 'sixth', default: '', options: ['', ...DAMAGE_TYPES_5E] },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 5 },
        // A save-based special attack (breath weapons, etc.) leaves "bonus" as
        // the flat +0 SRD monsters use and forces this save instead of a to-hit
        // roll; "Save DC" is a fixed stat-block number, not derived like a PC's.
        { id: 'save', label: 'Forces save', type: 'select', width: 'sixth', default: '', options: ['', 'str', 'dex', 'con', 'int', 'wis', 'cha'] },
        { id: 'onSave', label: 'On save', type: 'select', width: 'sixth', default: 'half', options: ['half', 'negate'] },
        { id: 'saveDc', label: 'Save DC', type: 'number', width: 'sixth', default: 0 },
        { id: 'aoeShape', label: 'Area', type: 'select', width: 'sixth', default: '', options: ['', ...AOE_SHAPES_5E] },
        { id: 'aoeSize', label: 'Area ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'aoeWidth', label: 'Area width ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'list', id: 'armor', title: 'Armor',
      columns: [
        { id: 'name', label: 'Armor', type: 'text', width: 'third' },
        { id: 'baseAc', label: 'Base AC', type: 'number', width: 'sixth', default: 10 },
        { id: 'addDex', label: 'Add Dex', type: 'checkbox', width: 'sixth' },
        { id: 'maxDex', label: 'Max Dex (-1=none)', type: 'number', width: 'sixth', default: -1 },
        { id: 'shield', label: 'Shield', type: 'checkbox', width: 'sixth' },
        { id: 'equipped', label: 'Worn', type: 'checkbox', width: 'sixth' },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
    {
      kind: 'derived', id: 'acDerived', title: 'Effective AC (worn armor + magic bonuses)',
      items: [{ key: 'ac', label: 'Effective AC' }],
    },
    { kind: 'fields', id: 'currency', title: 'Currency', fields: currencyFields },
    {
      kind: 'list', id: 'inventory', title: 'Equipment',
      columns: [
        { id: 'name', label: 'Item', type: 'text', width: 'third' },
        { id: 'qty', label: 'Qty', type: 'number', width: 'sixth', default: 1 },
        { id: 'weight', label: 'Weight', type: 'number', width: 'sixth', default: 0 },
        { id: 'effect', label: 'Use', type: 'select', width: 'sixth', options: ['none', 'heal', 'damage'], default: 'none' },
        { id: 'amount', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'equipped', label: 'Equipped', type: 'checkbox', width: 'sixth' },
        { id: 'acBonus', label: 'AC bonus', type: 'number', width: 'sixth', default: 0 },
        { id: 'saveBonus', label: 'Save bonus', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'third' },
      ],
    },
  ],
};

// ---------- Tab 2: Bio & Info ----------

const bioTab: SheetTab = {
  id: 'bio',
  title: 'Bio & Info',
  sections: [
    {
      kind: 'fields', id: 'portrait', title: 'Portrait & Token',
      fields: [
        { id: 'tokenImage', label: 'Token image', type: 'image', width: 'half' },
        { id: 'detailImage', label: 'Detail / portrait', type: 'image', width: 'half' },
      ],
    },
    {
      kind: 'fields', id: 'appearance', title: 'Appearance',
      fields: [
        { id: 'age', label: 'Age', type: 'text', width: 'sixth' },
        { id: 'height', label: 'Height', type: 'text', width: 'sixth' },
        { id: 'weight', label: 'Weight', type: 'text', width: 'sixth' },
        { id: 'eyes', label: 'Eyes', type: 'text', width: 'sixth' },
        { id: 'skin', label: 'Skin', type: 'text', width: 'sixth' },
        { id: 'hair', label: 'Hair', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'fields', id: 'personality', title: 'Personality',
      fields: [
        { id: 'personalityTraits', label: 'Personality Traits', type: 'textarea' },
        { id: 'ideals', label: 'Ideals', type: 'textarea' },
        { id: 'bonds', label: 'Bonds', type: 'textarea' },
        { id: 'flaws', label: 'Flaws', type: 'textarea' },
      ],
    },
    {
      kind: 'list', id: 'features', title: 'Features & Traits',
      columns: [
        { id: 'name', label: 'Name', type: 'text', width: 'third' },
        { id: 'source', label: 'Source', type: 'text', width: 'third' },
        { id: 'description', label: 'Description', type: 'text', width: 'third' },
      ],
    },
    {
      kind: 'fields', id: 'proficiencies', title: 'Other Proficiencies & Languages',
      fields: [{ id: 'proficienciesLanguages', label: 'Proficiencies & Languages', type: 'textarea' }],
    },
    {
      kind: 'fields', id: 'backstory', title: 'Backstory',
      fields: [{ id: 'backstory', label: 'Backstory', type: 'textarea' }],
    },
  ],
};

// ---------- Tab 3: Spells ----------

const spellSlotFields: FieldDef[] = Array.from({ length: 9 }, (_, i): FieldDef => ({
  id: `slots${i + 1}`, label: `L${i + 1}`, type: 'number', width: 'sixth', default: 0,
}));

const spellsTab: SheetTab = {
  id: 'spells',
  title: 'Spells',
  sections: [
    {
      kind: 'fields', id: 'spellcasting', title: 'Spellcasting',
      fields: [
        { id: 'spellClass', label: 'Spellcasting Class', type: 'text', width: 'third', suggestions: CLASSES_5E },
        { id: 'spellAbility', label: 'Ability', type: 'select', options: ['int', 'wis', 'cha'], width: 'third', default: 'int' },
      ],
    },
    {
      kind: 'derived', id: 'spellStats', title: 'Spellcasting Stats',
      items: [
        { key: 'spellDc', label: 'Save DC' },
        { key: 'spellAttack', label: 'Spell Attack' },
      ],
    },
    { kind: 'fields', id: 'spellSlots', title: 'Spell Slots (total)', fields: spellSlotFields },
    {
      kind: 'list', id: 'cantrips', title: 'Cantrips',
      columns: [
        { id: 'name', label: 'Name', type: 'text', width: 'third' },
        { id: 'effect', label: 'Effect', type: 'select', width: 'sixth', default: 'damage', options: ['damage', 'heal'] },
        { id: 'damage', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'save', label: 'Save', type: 'select', width: 'sixth', default: '', options: ['', 'attack', 'str', 'dex', 'con', 'int', 'wis', 'cha'] },
        { id: 'onSave', label: 'On save', type: 'select', width: 'sixth', default: 'half', options: ['half', 'negate'] },
        { id: 'dtype', label: 'Type', type: 'select', width: 'sixth', default: '', options: ['', ...DAMAGE_TYPES_5E] },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'aoeShape', label: 'Area', type: 'select', width: 'sixth', default: '', options: ['', ...AOE_SHAPES_5E] },
        { id: 'aoeSize', label: 'Area ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'aoeWidth', label: 'Area width ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
    {
      kind: 'list', id: 'spells', title: 'Spells',
      columns: [
        { id: 'name', label: 'Name', type: 'text', width: 'third' },
        { id: 'level', label: 'Lvl', type: 'number', width: 'sixth', default: 1 },
        { id: 'prepared', label: 'Prep', type: 'checkbox', width: 'sixth' },
        { id: 'effect', label: 'Effect', type: 'select', width: 'sixth', default: 'damage', options: ['damage', 'heal'] },
        { id: 'damage', label: 'Amount', type: 'text', width: 'sixth' },
        { id: 'save', label: 'Save', type: 'select', width: 'sixth', default: '', options: ['', 'attack', 'str', 'dex', 'con', 'int', 'wis', 'cha'] },
        { id: 'onSave', label: 'On save', type: 'select', width: 'sixth', default: 'half', options: ['half', 'negate'] },
        { id: 'dtype', label: 'Type', type: 'select', width: 'sixth', default: '', options: ['', ...DAMAGE_TYPES_5E] },
        { id: 'range', label: 'Range ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'aoeShape', label: 'Area', type: 'select', width: 'sixth', default: '', options: ['', ...AOE_SHAPES_5E] },
        { id: 'aoeSize', label: 'Area ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'aoeWidth', label: 'Area width ft', type: 'number', width: 'sixth', default: 0 },
        { id: 'conc', label: 'Conc.', type: 'checkbox', width: 'sixth' },
        { id: 'notes', label: 'Notes', type: 'text', width: 'sixth' },
      ],
    },
  ],
};

export const dnd5e: SystemSchema = {
  id: 'dnd5e',
  name: 'D&D 5e',
  tabs: [coreTab, bioTab, spellsTab],

  defaultSheet(): SheetData {
    const sheet: SheetData = {};
    for (const tab of dnd5e.tabs) {
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
    const pb = profBonus(level);
    out.profBonus = fmtMod(pb);
    const itemBonus = equippedItemBonuses(sheet);
    for (const a of ABILITIES) {
      const mod = abilityMod(num(sheet, a.id, 10));
      // Keyed by field id (badge next to the score) and by <id>Mod (used elsewhere).
      out[a.id] = fmtMod(mod);
      out[`${a.id}Mod`] = fmtMod(mod);
      out[`save_${a.id}`] = fmtMod(mod + (bool(sheet, `save_${a.id}`) ? pb : 0) + itemBonus.save);
    }
    for (const s of SKILLS_5E) {
      const mod = abilityMod(num(sheet, s.ability, 10));
      out[`skill_${s.id}`] = fmtMod(mod + (bool(sheet, `skill_${s.id}`) ? pb : 0));
    }
    const dexMod = abilityMod(num(sheet, 'dex', 10));
    const wisMod = abilityMod(num(sheet, 'wis', 10));
    const fb = featBonuses(sheet);
    out.initiative = fmtMod(dexMod + fb.initiative);
    out.passivePerception = 10 + wisMod + (bool(sheet, 'skill_perception') ? pb : 0) + fb.passivePerception;
    const spellAbility = str(sheet, 'spellAbility', 'int');
    const spellMod = abilityMod(num(sheet, spellAbility, 10));
    out.spellDc = 8 + pb + spellMod;
    out.spellAttack = fmtMod(pb + spellMod);
    // Equipped armor (and shields) replace/augment the manually-typed base AC;
    // Dual Wielder and equipped-item AC bonuses (e.g. a worn Cloak of
    // Protection) always add on top. This is what combat resolution reads.
    out.ac = armorAc(sheet) + dualWielderAcBonus(sheet) + itemBonus.ac;
    return out;
  },

  rollables(sheet: SheetData): Rollable[] {
    const level = num(sheet, 'level', 1);
    const pb = profBonus(level);
    const out: Rollable[] = [];
    // Champion Remarkable Athlete: half proficiency to STR/DEX/CON checks.
    const ra = remarkableAthleteBonus(sheet);
    const itemBonus = equippedItemBonuses(sheet);
    for (const a of ABILITIES) {
      const mod = abilityMod(num(sheet, a.id, 10));
      const check = mod + (ra && (a.id === 'str' || a.id === 'dex' || a.id === 'con') ? ra : 0);
      out.push({ id: `check_${a.id}`, label: `${a.label} check`, expr: `1d20${fmtMod(check)}`, group: 'Ability checks', d20: true });
      const save = mod + (bool(sheet, `save_${a.id}`) ? pb : 0) + itemBonus.save;
      out.push({ id: `save_${a.id}`, label: `${a.label} save`, expr: `1d20${fmtMod(save)}`, group: 'Saving throws', d20: true });
    }
    for (const s of SKILLS_5E) {
      const mod = abilityMod(num(sheet, s.ability, 10)) + (bool(sheet, `skill_${s.id}`) ? pb : 0);
      out.push({ id: `skill_${s.id}`, label: s.label, expr: `1d20${fmtMod(mod)}`, group: 'Skills', d20: true });
    }
    out.push({ id: 'initiative', label: 'Initiative', expr: `1d20${fmtMod(abilityMod(num(sheet, 'dex', 10)) + ra + featBonuses(sheet).initiative)}`, group: 'Combat', d20: true });
    const rageBonus = isRaging(sheet) ? rageDamage(level) : 0;
    const style = str(sheet, 'fightingStyle', '');
    rows(sheet, 'attacks').forEach((atk, i) => {
      const name = str(atk, 'name', `Attack ${i + 1}`);
      const ranged = num(atk, 'range', 5) > 5;
      const fs = fightingStyleBonus(style, ranged);
      // GWM/Sharpshooter −5/+10 power-attack toggle (melee vs ranged gated).
      const pa = powerAttackBonus(sheet, ranged);
      out.push({ id: `attack_${i}`, label: `${name} (attack)`, expr: `1d20${fmtMod(num(atk, 'bonus', 0) + fs.attack + pa.toHit)}`, group: 'Attacks', d20: true });
      let dmg = str(atk, 'damage', '').trim();
      if (dmg) {
        // Melee-only bonuses stack: Rage damage + Dueling fighting style.
        const bonus = (!ranged ? rageBonus : 0) + fs.damage + pa.damage;
        if (bonus > 0) dmg = `${dmg}+${bonus}`;
        out.push({ id: `damage_${i}`, label: `${name} (damage)`, expr: dmg, group: 'Attacks', d20: false });
      }
    });
    // Rogue Sneak Attack: extra dice you add to a qualifying attack.
    const sneak = sneakAttackDice(sheet);
    if (sneak > 0) out.push({ id: 'sneak', label: `Sneak Attack (${sneak}d6)`, expr: `${sneak}d6`, group: 'Attacks', d20: false });
    // Monk Martial Arts: DEX-based unarmed strike using the martial-arts die.
    if (classId(sheet) === 'monk') {
      const dexMod = abilityMod(num(sheet, 'dex', 10));
      const ma = martialArtsDie(level);
      out.push({ id: 'unarmed_attack', label: 'Unarmed Strike (attack)', expr: `1d20${fmtMod(dexMod + pb)}`, group: 'Attacks', d20: true });
      out.push({ id: 'unarmed_damage', label: `Unarmed Strike (${ma})`, expr: `${ma}${fmtMod(dexMod)}`, group: 'Attacks', d20: false });
    }
    // Battle Master: roll a superiority die (for maneuvers).
    const sup = superiorityDice(sheet);
    if (sup) out.push({ id: 'superiority', label: `Superiority Die (${sup.die})`, expr: `1${sup.die}`, group: 'Attacks', d20: false });
    // Paladin Divine Smite (spend a slot); Zealot Barbarian Divine Fury.
    const smite = divineSmite(sheet);
    if (smite) out.push({ id: 'divineSmite', label: 'Divine Smite (2d8)', expr: smite.base, group: 'Attacks', d20: false });
    const fury = divineFury(sheet);
    if (fury) out.push({ id: 'divineFury', label: `Divine Fury (${fury})`, expr: fury, group: 'Attacks', d20: false });
    const spellAbility = str(sheet, 'spellAbility', 'int');
    const spellMod = abilityMod(num(sheet, spellAbility, 10));
    out.push({ id: 'spellAttack', label: 'Spell attack', expr: `1d20${fmtMod(pb + spellMod)}`, group: 'Combat', d20: true });
    // Spells and cantrips with a damage/heal expression become click-to-roll.
    // Leveled spells (not cantrips) carry a slotLevel so casting spends a slot.
    const spellDamage = (rowsList: SheetData[], prefix: string, leveled: boolean) => {
      rowsList.forEach((sp, i) => {
        const dmg = str(sp, 'damage', '').trim();
        if (!dmg || !/\d*d\d/i.test(dmg)) return;
        const name = str(sp, 'name', `${prefix} ${i + 1}`);
        const lvl = Math.max(1, num(sp, 'level', 1));
        out.push({
          id: `${prefix}_${i}`, label: `${name}`, expr: dmg, group: 'Spells',
          d20: /^1d20/i.test(dmg), ...(leveled ? { slotLevel: lvl } : {}),
        });
      });
    };
    spellDamage(rows(sheet, 'cantrips'), 'cantrip', false);
    spellDamage(rows(sheet, 'spells'), 'spell', true);
    return out;
  },

  vision(sheet: SheetData): VisionStats {
    return {
      visionRange: num(sheet, 'visionRange', 24),
      darkvision: num(sheet, 'darkvision', 0),
    };
  },

  initiativeExpr(sheet: SheetData): string {
    // Must match the sheet's own Initiative rollable (see rollables()): DEX
    // mod plus Remarkable Athlete and feat bonuses (Alert's +5) -- the
    // tracker's group-roll and the sheet button must agree.
    const bonus = abilityMod(num(sheet, 'dex', 10)) + remarkableAthleteBonus(sheet) + featBonuses(sheet).initiative;
    return `1d20${fmtMod(bonus)}`;
  },

  hp(sheet: SheetData): { hp: number; maxHp: number } {
    return { hp: num(sheet, 'hp', 0), maxHp: num(sheet, 'maxHp', 0) };
  },

  saveIds(): { id: string; label: string }[] {
    return ABILITIES.map((a) => ({ id: a.id, label: `${a.label} save` }));
  },

  saveCheck(sheet: SheetData, saveId: string, dc: number): { expr: string; threshold: number; label: string } {
    const ability = ABILITIES.find((a) => a.id === saveId) ?? ABILITIES[0];
    const pb = profBonus(num(sheet, 'level', 1));
    const mod = abilityMod(num(sheet, ability.id, 10)) + (bool(sheet, `save_${ability.id}`) ? pb : 0) + equippedItemBonuses(sheet).save;
    return { expr: `1d20${fmtMod(mod)}`, threshold: dc, label: `${ability.label} save` };
  },
};
