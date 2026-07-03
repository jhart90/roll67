// Data-driven D&D 5e class definitions used by the level-up engine. This is the
// "chassis": hit dice, saves, proficiencies, ASI levels, subclass timing, spell
// progression, and the named features gained at each level. Deep per-feature
// math (e.g. auto-scaling Sneak Attack) is layered on later; here features are
// recorded as described entries and everything numeric is automated.

export type CasterType = 'full' | 'half' | 'pact' | 'none';

export interface ClassFeature {
  level: number;
  name: string;
  desc: string;
}

export interface ClassDef {
  id: string;
  name: string;
  hitDie: number;
  /** Proficient saving throw ability ids. */
  saves: [string, string];
  caster: CasterType;
  spellAbility?: 'int' | 'wis' | 'cha';
  /** Level at which the subclass is chosen. */
  subclassLevel: number;
  subclassLabel: string;
  subclasses: string[];
  /** Levels at which the subclass grants a feature (recorded as an entry). */
  subclassFeatureLevels: number[];
  /** Number of skill proficiencies chosen when this is the character's first class. */
  skillCount: number;
  skillList: string[];
  armor: string;
  weapons: string;
  /** Levels that grant an Ability Score Improvement / feat. */
  asiLevels: number[];
  features: ClassFeature[];
}

const f = (level: number, name: string, desc: string): ClassFeature => ({ level, name, desc });

// ---------- spell-slot tables ----------

// Full-caster slots by class level (index 1..20) → [L1..L9].
const FULL: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0], // 0 (unused)
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// Warlock pact magic: [slotCount, slotLevel] by class level.
const PACT: Array<[number, number]> = [
  [0, 0], [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5],
  [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

/** Spell slots [L1..L9] for a single-class caster at the given class level. */
export function spellSlotsForClass(caster: CasterType, level: number, roundUp = false): number[] {
  const empty = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const lvl = Math.max(0, Math.min(20, Math.floor(level)));
  if (caster === 'full') return [...(FULL[lvl] ?? empty)];
  if (caster === 'half') {
    // Paladin/Ranger gain no slots at level 1; Artificer (roundUp) does.
    if (lvl < 1 || (!roundUp && lvl < 2)) return [...empty];
    return [...(FULL[Math.max(1, Math.ceil(lvl / 2))] ?? empty)];
  }
  if (caster === 'pact') {
    const [count, slvl] = PACT[lvl] ?? [0, 0];
    const out = [...empty];
    if (count > 0 && slvl > 0) out[slvl - 1] = count;
    return out;
  }
  return [...empty];
}

// ---------- proficiency bonus ----------

export function profBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// ---------- class definitions ----------

const STANDARD_ASI = [4, 8, 12, 16, 19];

export const CLASSES_5E_DEF: Record<string, ClassDef> = {
  barbarian: {
    id: 'barbarian', name: 'Barbarian', hitDie: 12, saves: ['str', 'con'], caster: 'none',
    subclassLevel: 3, subclassLabel: 'Primal Path',
    subclasses: ['Path of the Berserker', 'Path of the Totem Warrior', 'Path of the Ancestral Guardian', 'Path of the Storm Herald', 'Path of the Zealot', 'Path of Wild Magic', 'Path of the Beast'],
    subclassFeatureLevels: [3, 6, 10, 14],
    skillCount: 2, skillList: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
    armor: 'Light & medium armor, shields', weapons: 'Simple & martial weapons', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Rage', 'Bonus-action rage: bonus melee damage, resistance to physical damage, advantage on STR checks/saves.'),
      f(1, 'Unarmored Defense', 'AC = 10 + DEX mod + CON mod when unarmored.'),
      f(2, 'Reckless Attack', 'Advantage on STR melee attacks this turn; attacks against you get advantage.'),
      f(2, 'Danger Sense', 'Advantage on DEX saves against effects you can see.'),
      f(5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f(5, 'Fast Movement', '+10 ft speed when not wearing heavy armor.'),
      f(7, 'Feral Instinct', 'Advantage on initiative; can act while surprised if you rage.'),
      f(9, 'Brutal Critical', 'Roll one extra weapon damage die on a crit (more at 13/17).'),
      f(11, 'Relentless Rage', 'DC 10 CON save to drop to 1 HP instead of 0 while raging.'),
      f(15, 'Persistent Rage', 'Rage ends early only if you choose or fall unconscious.'),
      f(18, 'Indomitable Might', 'Minimum STR check total equals your STR score.'),
      f(20, 'Primal Champion', 'STR and CON increase by 4 (max 24).'),
    ],
  },
  bard: {
    id: 'bard', name: 'Bard', hitDie: 8, saves: ['dex', 'cha'], caster: 'full', spellAbility: 'cha',
    subclassLevel: 3, subclassLabel: 'Bard College',
    subclasses: ['College of Lore', 'College of Valor', 'College of Glamour', 'College of Swords', 'College of Whispers', 'College of Creation', 'College of Eloquence'],
    subclassFeatureLevels: [3, 6, 14],
    skillCount: 3, skillList: ['acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival'],
    armor: 'Light armor', weapons: 'Simple weapons, hand crossbows, longswords, rapiers, shortswords', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Bardic Inspiration (d6)', 'Bonus action: give an ally a d6 to add to a check/attack/save (die grows at 5/10/15).'),
      f(1, 'Spellcasting', 'Cast bard spells using Charisma; known spells + cantrips.'),
      f(2, 'Jack of All Trades', 'Add half proficiency to non-proficient ability checks.'),
      f(2, 'Song of Rest', 'Allies regain extra HP on a short rest (die grows).'),
      f(3, 'Expertise', 'Double proficiency on two skills (two more at level 10).'),
      f(5, 'Font of Inspiration', 'Regain Bardic Inspiration on a short or long rest.'),
      f(6, 'Countercharm', 'Performance grants advantage vs frightened/charmed.'),
      f(10, 'Magical Secrets', 'Learn spells from any class (more at 14/18).'),
      f(20, 'Superior Inspiration', 'Regain one Bardic Inspiration when you roll initiative with none.'),
    ],
  },
  cleric: {
    id: 'cleric', name: 'Cleric', hitDie: 8, saves: ['wis', 'cha'], caster: 'full', spellAbility: 'wis',
    subclassLevel: 1, subclassLabel: 'Divine Domain',
    subclasses: ['Knowledge Domain', 'Life Domain', 'Light Domain', 'Nature Domain', 'Tempest Domain', 'Trickery Domain', 'War Domain', 'Death Domain', 'Forge Domain', 'Grave Domain', 'Order Domain', 'Peace Domain', 'Twilight Domain'],
    subclassFeatureLevels: [1, 2, 6, 8, 17],
    skillCount: 2, skillList: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    armor: 'Light & medium armor, shields', weapons: 'Simple weapons', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Spellcasting', 'Cast cleric spells using Wisdom; prepare from the full cleric list.'),
      f(2, 'Channel Divinity', 'Turn Undead and a domain effect (1/rest, more later).'),
      f(5, 'Destroy Undead', 'Turn Undead destroys weak undead (threshold grows).'),
      f(10, 'Divine Intervention', 'Call on your deity for aid (improves at 20).'),
      f(20, 'Divine Intervention Improvement', 'Divine Intervention automatically succeeds.'),
    ],
  },
  druid: {
    id: 'druid', name: 'Druid', hitDie: 8, saves: ['int', 'wis'], caster: 'full', spellAbility: 'wis',
    subclassLevel: 2, subclassLabel: 'Druid Circle',
    subclasses: ['Circle of the Land', 'Circle of the Moon', 'Circle of Dreams', 'Circle of the Shepherd', 'Circle of Spores', 'Circle of Stars', 'Circle of Wildfire'],
    subclassFeatureLevels: [2, 6, 10, 14],
    skillCount: 2, skillList: ['arcana', 'animalHandling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'],
    armor: 'Light & medium armor, shields (nonmetal)', weapons: 'Clubs, daggers, darts, javelins, maces, quarterstaffs, scimitars, sickles, slings, spears', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Druidic', 'Know the secret druid language.'),
      f(1, 'Spellcasting', 'Cast druid spells using Wisdom; prepare from the full druid list.'),
      f(2, 'Wild Shape', 'Transform into beasts you have seen (uses grow with level).'),
      f(18, 'Timeless Body & Beast Spells', 'Age slowly; cast many spells while wild-shaped.'),
      f(20, 'Archdruid', 'Unlimited Wild Shape; ignore some spell components.'),
    ],
  },
  fighter: {
    id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['str', 'con'], caster: 'none',
    subclassLevel: 3, subclassLabel: 'Martial Archetype',
    subclasses: ['Champion', 'Battle Master', 'Eldritch Knight', 'Arcane Archer', 'Cavalier', 'Samurai', 'Psi Warrior', 'Rune Knight', 'Echo Knight'],
    subclassFeatureLevels: [3, 7, 10, 15, 18],
    skillCount: 2, skillList: ['acrobatics', 'animalHandling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'],
    armor: 'All armor, shields', weapons: 'Simple & martial weapons', asiLevels: [4, 6, 8, 12, 14, 16, 19],
    features: [
      f(1, 'Fighting Style', 'Adopt a combat style (e.g. Defense, Dueling, Archery).'),
      f(1, 'Second Wind', 'Bonus action: regain 1d10 + level HP (1/rest).'),
      f(2, 'Action Surge', 'Take one extra action (1/rest, twice at 17).'),
      f(5, 'Extra Attack', 'Attack twice (three times at 11, four at 20).'),
      f(9, 'Indomitable', 'Reroll a failed saving throw (more uses later).'),
      f(11, 'Extra Attack (2)', 'Attack three times when you take the Attack action.'),
      f(20, 'Extra Attack (3)', 'Attack four times when you take the Attack action.'),
    ],
  },
  monk: {
    id: 'monk', name: 'Monk', hitDie: 8, saves: ['str', 'dex'], caster: 'none',
    subclassLevel: 3, subclassLabel: 'Monastic Tradition',
    subclasses: ['Way of the Open Hand', 'Way of Shadow', 'Way of the Four Elements', 'Way of the Drunken Master', 'Way of the Kensei', 'Way of the Sun Soul', 'Way of Mercy', 'Way of the Astral Self'],
    subclassFeatureLevels: [3, 6, 11, 17],
    skillCount: 2, skillList: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
    armor: 'None', weapons: 'Simple weapons, shortswords', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Unarmored Defense', 'AC = 10 + DEX mod + WIS mod when unarmored.'),
      f(1, 'Martial Arts', 'Use DEX for monk weapons; bonus-action unarmed strike; damage die grows.'),
      f(2, 'Ki', 'Spend ki for Flurry of Blows, Patient Defense, Step of the Wind.'),
      f(2, 'Unarmored Movement', '+10 ft speed unarmored (grows with level).'),
      f(3, 'Deflect Missiles', 'Reduce ranged weapon damage as a reaction.'),
      f(4, 'Slow Fall', 'Reduce falling damage as a reaction.'),
      f(5, 'Extra Attack', 'Attack twice; Stunning Strike with ki.'),
      f(6, 'Ki-Empowered Strikes', 'Unarmed strikes count as magical.'),
      f(7, 'Evasion & Stillness of Mind', 'Take no damage on some DEX saves; end charm/fear.'),
      f(10, 'Purity of Body', 'Immune to disease and poison.'),
      f(14, 'Diamond Soul', 'Proficiency in all saves; reroll failed saves with ki.'),
      f(18, 'Empty Body', 'Spend ki to become invisible; cast Astral Projection.'),
      f(20, 'Perfect Self', 'Regain 4 ki when you roll initiative with none.'),
    ],
  },
  paladin: {
    id: 'paladin', name: 'Paladin', hitDie: 10, saves: ['wis', 'cha'], caster: 'half', spellAbility: 'cha',
    subclassLevel: 3, subclassLabel: 'Sacred Oath',
    subclasses: ['Oath of Devotion', 'Oath of the Ancients', 'Oath of Vengeance', 'Oath of Conquest', 'Oath of Redemption', 'Oath of Glory', 'Oath of the Watchers', 'Oathbreaker'],
    subclassFeatureLevels: [3, 7, 15, 20],
    skillCount: 2, skillList: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
    armor: 'All armor, shields', weapons: 'Simple & martial weapons', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Divine Sense', 'Detect celestials, fiends, and undead nearby.'),
      f(1, 'Lay on Hands', 'Pool of healing = 5 × level; cure disease/poison.'),
      f(2, 'Fighting Style', 'Adopt a combat style.'),
      f(2, 'Spellcasting', 'Cast paladin spells using Charisma (from level 2).'),
      f(2, 'Divine Smite', 'Expend a spell slot to deal extra radiant damage on a hit.'),
      f(3, 'Divine Health', 'Immune to disease.'),
      f(3, 'Channel Divinity', 'Oath-specific effects (1/rest).'),
      f(5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f(6, 'Aura of Protection', 'You and nearby allies add your CHA mod to saves.'),
      f(10, 'Aura of Courage', 'You and nearby allies can’t be frightened.'),
      f(11, 'Improved Divine Smite', 'All melee weapon hits deal +1d8 radiant.'),
      f(14, 'Cleansing Touch', 'End a spell on yourself or another as an action.'),
    ],
  },
  ranger: {
    id: 'ranger', name: 'Ranger', hitDie: 10, saves: ['str', 'dex'], caster: 'half', spellAbility: 'wis',
    subclassLevel: 3, subclassLabel: 'Ranger Conclave',
    subclasses: ['Hunter', 'Beast Master', 'Gloom Stalker', 'Horizon Walker', 'Monster Slayer', 'Fey Wanderer', 'Swarmkeeper', 'Drakewarden'],
    subclassFeatureLevels: [3, 7, 11, 15],
    skillCount: 3, skillList: ['animalHandling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
    armor: 'Light & medium armor, shields', weapons: 'Simple & martial weapons', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Favored Enemy', 'Advantage to track and recall lore about chosen foes.'),
      f(1, 'Natural Explorer', 'Expertise navigating favored terrain.'),
      f(2, 'Fighting Style', 'Adopt a combat style.'),
      f(2, 'Spellcasting', 'Cast ranger spells using Wisdom (from level 2).'),
      f(3, 'Primeval Awareness', 'Sense certain creature types nearby.'),
      f(5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f(8, 'Land’s Stride', 'Move through nonmagical difficult terrain freely.'),
      f(10, 'Hide in Plain Sight', 'Camouflage yourself for a big Stealth bonus.'),
      f(14, 'Vanish', 'Hide as a bonus action; can’t be tracked nonmagically.'),
      f(18, 'Feral Senses', 'Fight unseen attackers without disadvantage.'),
      f(20, 'Foe Slayer', 'Add WIS mod to an attack or damage roll each turn.'),
    ],
  },
  rogue: {
    id: 'rogue', name: 'Rogue', hitDie: 8, saves: ['dex', 'int'], caster: 'none',
    subclassLevel: 3, subclassLabel: 'Roguish Archetype',
    subclasses: ['Thief', 'Assassin', 'Arcane Trickster', 'Inquisitive', 'Mastermind', 'Scout', 'Swashbuckler', 'Phantom', 'Soulknife'],
    subclassFeatureLevels: [3, 9, 13, 17],
    skillCount: 4, skillList: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleightOfHand', 'stealth'],
    armor: 'Light armor', weapons: 'Simple weapons, hand crossbows, longswords, rapiers, shortswords', asiLevels: [4, 8, 10, 12, 16, 19],
    features: [
      f(1, 'Expertise', 'Double proficiency on two skills (two more at level 6).'),
      f(1, 'Sneak Attack', 'Extra damage (1d6, +1d6 every 2 levels) with advantage or a nearby ally.'),
      f(1, 'Thieves’ Cant', 'Secret rogue code and slang.'),
      f(2, 'Cunning Action', 'Dash, Disengage, or Hide as a bonus action.'),
      f(5, 'Uncanny Dodge', 'Halve damage from one attacker as a reaction.'),
      f(7, 'Evasion', 'Take no damage on successful DEX saves for half.'),
      f(11, 'Reliable Talent', 'Treat d20 rolls of 9 or lower as 10 on proficient checks.'),
      f(14, 'Blindsense', 'Sense hidden creatures within 10 ft.'),
      f(15, 'Slippery Mind', 'Gain proficiency in Wisdom saves.'),
      f(18, 'Elusive', 'No attack roll has advantage against you while you can move.'),
      f(20, 'Stroke of Luck', 'Turn a miss into a hit or a failed check into a 20 (1/rest).'),
    ],
  },
  sorcerer: {
    id: 'sorcerer', name: 'Sorcerer', hitDie: 6, saves: ['con', 'cha'], caster: 'full', spellAbility: 'cha',
    subclassLevel: 1, subclassLabel: 'Sorcerous Origin',
    subclasses: ['Draconic Bloodline', 'Wild Magic', 'Divine Soul', 'Shadow Magic', 'Storm Sorcery', 'Aberrant Mind', 'Clockwork Soul'],
    subclassFeatureLevels: [1, 6, 14, 18],
    skillCount: 2, skillList: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
    armor: 'None', weapons: 'Daggers, darts, slings, quarterstaffs, light crossbows', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Spellcasting', 'Cast sorcerer spells using Charisma; known spells.'),
      f(2, 'Font of Magic', 'Sorcery points to create or convert spell slots.'),
      f(3, 'Metamagic', 'Bend spells with options like Twinned or Quickened (more later).'),
      f(20, 'Sorcerous Restoration', 'Regain 4 sorcery points on a short rest.'),
    ],
  },
  warlock: {
    id: 'warlock', name: 'Warlock', hitDie: 8, saves: ['wis', 'cha'], caster: 'pact', spellAbility: 'cha',
    subclassLevel: 1, subclassLabel: 'Otherworldly Patron',
    subclasses: ['The Archfey', 'The Fiend', 'The Great Old One', 'The Celestial', 'The Hexblade', 'The Fathomless', 'The Genie', 'The Undying'],
    subclassFeatureLevels: [1, 6, 10, 14],
    skillCount: 2, skillList: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
    armor: 'Light armor', weapons: 'Simple weapons', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Pact Magic', 'Few spell slots that recharge on a short rest, all at the highest level.'),
      f(2, 'Eldritch Invocations', 'Learn magical options (e.g. Agonizing Blast); grows with level.'),
      f(3, 'Pact Boon', 'Choose Pact of the Blade, Chain, or Tome.'),
      f(11, 'Mystic Arcanum (6th)', 'Cast a 6th-level spell 1/long rest (7th/8th/9th at 13/15/17).'),
      f(20, 'Eldritch Master', 'Regain all Pact Magic slots 1/long rest by pleading with your patron.'),
    ],
  },
  wizard: {
    id: 'wizard', name: 'Wizard', hitDie: 6, saves: ['int', 'wis'], caster: 'full', spellAbility: 'int',
    subclassLevel: 2, subclassLabel: 'Arcane Tradition',
    subclasses: ['School of Abjuration', 'School of Conjuration', 'School of Divination', 'School of Enchantment', 'School of Evocation', 'School of Illusion', 'School of Necromancy', 'School of Transmutation', 'Bladesinging', 'War Magic', 'Order of Scribes'],
    subclassFeatureLevels: [2, 6, 10, 14],
    skillCount: 2, skillList: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'],
    armor: 'None', weapons: 'Daggers, darts, slings, quarterstaffs, light crossbows', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Spellcasting', 'Cast wizard spells using Intelligence; prepare from your spellbook.'),
      f(1, 'Arcane Recovery', 'Recover some spell slots on a short rest (1/day).'),
      f(18, 'Spell Mastery', 'Cast a chosen 1st- and 2nd-level spell at will.'),
      f(20, 'Signature Spells', 'Always have two 3rd-level spells prepared, free 1/rest each.'),
    ],
  },
  artificer: {
    id: 'artificer', name: 'Artificer', hitDie: 8, saves: ['con', 'int'], caster: 'half', spellAbility: 'int',
    subclassLevel: 3, subclassLabel: 'Artificer Specialist',
    subclasses: ['Alchemist', 'Armorer', 'Artillerist', 'Battle Smith'],
    subclassFeatureLevels: [3, 5, 9, 15],
    skillCount: 2, skillList: ['arcana', 'history', 'investigation', 'medicine', 'nature', 'perception', 'sleightOfHand'],
    armor: 'Light & medium armor, shields', weapons: 'Simple weapons', asiLevels: STANDARD_ASI,
    features: [
      f(1, 'Magical Tinkering', 'Imbue tiny objects with minor magical properties.'),
      f(1, 'Spellcasting', 'Cast artificer spells using Intelligence, through tools (slots from level 1).'),
      f(2, 'Infuse Item', 'Grant magical infusions to gear (known infusions grow).'),
      f(3, 'The Right Tool for the Job', 'Magically create artisan’s tools.'),
      f(6, 'Tool Expertise', 'Double proficiency with tools you’re proficient in.'),
      f(7, 'Flash of Genius', 'Add INT mod to an ally’s check or save as a reaction.'),
      f(10, 'Magic Item Adept', 'Craft magic items faster; attune to more.'),
      f(11, 'Spell-Storing Item', 'Store a spell in an item for others to use.'),
      f(14, 'Magic Item Savant', 'Attune to even more items; ignore some requirements.'),
      f(18, 'Magic Item Master', 'Attune to up to six magic items.'),
      f(20, 'Soul of Artifice', 'Bonus to saves per attuned item; cheat death 1/rest.'),
    ],
  },
};

export const CLASS_LIST_5E: ClassDef[] = Object.values(CLASSES_5E_DEF);

export function getClass5e(id: string): ClassDef | undefined {
  // Accept either the id ('fighter') or the display name ('Fighter').
  const key = id.toLowerCase();
  return CLASSES_5E_DEF[key] ?? CLASS_LIST_5E.find((c) => c.name.toLowerCase() === key);
}
