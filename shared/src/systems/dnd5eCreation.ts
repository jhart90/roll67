// D&D 5e guided character creation: pure data + pure assembly logic for the
// client's step-by-step wizard. Mirrors swadeCreation.ts / swnCreation.ts —
// this is a one-time build tool, not something derive() re-evaluates.
//
// Race/background/kit data below is a practical, GM-adjustable subset of the
// published options: ability bonuses, speed, darkvision, and granted skills
// are mechanically applied; the flavor traits land as Features & Traits rows
// the table can edit freely. Everything it produces lands on ordinary,
// editable sheet fields.

import type { SheetData } from '../types.js';
import { SKILLS_5E, RACES_5E, BACKGROUNDS_5E } from './dnd5e.js';
import { CLASS_LIST_5E, getClass5e, profBonusForLevel, spellSlotsForClass } from './classes5e.js';

export type AbilityId = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITY_IDS: AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_LABELS: Record<AbilityId, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

export function abilityMod5e(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ---------- Ability score generation ----------

/** The PHB's standard array — assign each value to one ability. */
export const STANDARD_ARRAY_5E = [15, 14, 13, 12, 10, 8];

/** Point-buy budget and the cost of each score from 8 to 15. */
export const POINT_BUY_BUDGET = 27;
const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

export function pointBuyCost(score: number): number {
  return POINT_BUY_COST[score] ?? 0;
}

export function pointBuySpent(scores: Record<AbilityId, number>): number {
  return ABILITY_IDS.reduce((sum, id) => sum + pointBuyCost(scores[id] ?? POINT_BUY_MIN), 0);
}

/** 4d6-drop-lowest, the classic roll. Injectable RNG keeps it testable. */
export function roll4d6DropLowest(rng: () => number = Math.random): number {
  const dice = [0, 0, 0, 0].map(() => 1 + Math.floor(rng() * 6));
  dice.sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

// ---------- Races ----------

export interface RaceTraits {
  name: string;
  /** Fixed ability score increases. */
  abilities: Partial<Record<AbilityId, number>>;
  /** How many +1s the player assigns freely (Half-Elf, Variant Human…). */
  freeChoices: number;
  speed: number;
  darkvision: number;
  traits: string;
}

// [name, 'con+2,wis+1', speed, darkvision, freeChoices, traits]
type RaceRow = [string, string, number, number, number, string];

const RACE_ROWS: RaceRow[] = [
  ['Human', 'str+1,dex+1,con+1,int+1,wis+1,cha+1', 30, 0, 0, 'Versatile and ambitious; an extra language.'],
  ['Variant Human', '', 30, 0, 2, 'Two ability increases of your choice, a skill proficiency, and a feat at 1st level.'],
  ['Hill Dwarf', 'con+2,wis+1', 25, 60, 0, 'Dwarven Toughness (+1 HP per level), poison resistance, stonecunning, darkvision.'],
  ['Mountain Dwarf', 'con+2,str+2', 25, 60, 0, 'Dwarven armor training (light and medium), poison resistance, stonecunning, darkvision.'],
  ['High Elf', 'dex+2,int+1', 30, 60, 0, 'A wizard cantrip, keen senses, fey ancestry, trance, darkvision.'],
  ['Wood Elf', 'dex+2,wis+1', 35, 60, 0, 'Mask of the Wild, fleet of foot, keen senses, fey ancestry, trance, darkvision.'],
  ['Drow', 'dex+2,cha+1', 30, 120, 0, 'Superior darkvision, Dancing Lights, sunlight sensitivity, fey ancestry.'],
  ['Eladrin', 'dex+2,cha+1', 30, 60, 0, 'Fey Step teleport, fey ancestry, trance, darkvision.'],
  ['Lightfoot Halfling', 'dex+2,cha+1', 25, 0, 0, 'Naturally Stealthy, lucky, brave, halfling nimbleness.'],
  ['Stout Halfling', 'dex+2,con+1', 25, 0, 0, 'Stout Resilience (poison), lucky, brave, halfling nimbleness.'],
  ['Forest Gnome', 'int+2,dex+1', 25, 60, 0, 'Minor Illusion, speak with small beasts, gnome cunning, darkvision.'],
  ['Rock Gnome', 'int+2,con+1', 25, 60, 0, 'Artificer’s Lore, tinker, gnome cunning, darkvision.'],
  ['Deep Gnome', 'int+2,dex+1', 25, 120, 0, 'Superior darkvision, stone camouflage, gnome cunning.'],
  ['Half-Elf', 'cha+2', 30, 60, 2, 'Two ability increases of your choice, two skill proficiencies, fey ancestry, darkvision.'],
  ['Half-Orc', 'str+2,con+1', 30, 60, 0, 'Relentless Endurance, Savage Attacks, menacing, darkvision.'],
  ['Tiefling', 'cha+2,int+1', 30, 60, 0, 'Hellish Resistance (fire), Thaumaturgy cantrip, darkvision.'],
  ['Dragonborn', 'str+2,cha+1', 30, 0, 0, 'Breath weapon and damage resistance matching your draconic ancestry.'],
  ['Aasimar', 'cha+2,wis+1', 30, 60, 0, 'Celestial Resistance, Light cantrip, healing hands, darkvision.'],
  ['Goliath', 'str+2,con+1', 30, 0, 0, 'Stone’s Endurance, powerful build, mountain born, natural athlete.'],
  ['Tabaxi', 'dex+2,cha+1', 30, 60, 0, 'Feline Agility, cat’s claws, cat’s talent, darkvision.'],
  ['Firbolg', 'wis+2,str+1', 30, 0, 0, 'Firbolg Magic, hidden step, powerful build, speech of beast and leaf.'],
  ['Kenku', 'dex+2,wis+1', 30, 0, 0, 'Expert Forgery, mimicry, kenku training.'],
  ['Tortle', 'str+2,wis+1', 30, 0, 0, 'Natural Armor (AC 17), shell defense, hold breath, claws.'],
  ['Triton', 'str+1,con+1,cha+1', 30, 120, 0, 'Amphibious, control air and water, emissary of the sea, cold resistance.'],
  ['Genasi (Air)', 'con+2,dex+1', 30, 0, 0, 'Unending Breath, Lightning Lure cantrip.'],
  ['Genasi (Earth)', 'con+2,str+1', 30, 0, 0, 'Earth Walk, Blade Ward cantrip.'],
  ['Genasi (Fire)', 'con+2,int+1', 30, 60, 0, 'Fire Resistance, Produce Flame cantrip, darkvision.'],
  ['Genasi (Water)', 'con+2,wis+1', 30, 0, 0, 'Acid Resistance, amphibious, Shape Water cantrip.'],
  ['Goblin', 'dex+2,con+1', 30, 60, 0, 'Fury of the Small, nimble escape, darkvision.'],
  ['Hobgoblin', 'con+2,int+1', 30, 60, 0, 'Saving Face, martial training, darkvision.'],
  ['Bugbear', 'str+2,dex+1', 30, 60, 0, 'Surprise Attack, long-limbed, powerful build, sneaky, darkvision.'],
  ['Kobold', 'dex+2', 30, 60, 0, 'Pack Tactics, sunlight sensitivity, darkvision.'],
  ['Lizardfolk', 'con+2,wis+1', 30, 0, 0, 'Natural Armor, bite, hungry jaws, hold breath, cunning artisan.'],
  ['Orc', 'str+2,con+1', 30, 60, 0, 'Aggressive, powerful build, primal intuition, darkvision.'],
  ['Yuan-ti Pureblood', 'cha+2,int+1', 30, 60, 0, 'Magic Resistance, poison immunity, innate spellcasting, darkvision.'],
  ['Changeling', 'cha+2', 30, 0, 1, 'Shapechanger, changeling instincts, one ability increase of your choice.'],
  ['Warforged', 'con+2', 30, 0, 1, 'Constructed Resilience, sentry’s rest, integrated protection (+1 AC).'],
  ['Shifter', 'dex+1', 30, 60, 1, 'Shifting, keen senses, darkvision, one ability increase of your choice.'],
  ['Harengon', 'dex+2,wis+1', 30, 0, 0, 'Rabbit Hop, lucky footwork, hare-trigger initiative.'],
];

function parseAbilityString(s: string): Partial<Record<AbilityId, number>> {
  const out: Partial<Record<AbilityId, number>> = {};
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z]{3})\s*([+-]\d+)$/i.exec(part);
    if (m) out[m[1].toLowerCase() as AbilityId] = Number(m[2]);
  }
  return out;
}

export const RACE_TRAITS_5E: RaceTraits[] = RACE_ROWS.map(([name, abilities, speed, darkvision, freeChoices, traits]) => ({
  name, abilities: parseAbilityString(abilities), speed, darkvision, freeChoices, traits,
}));

export const RACE_TRAITS_BY_NAME = new Map(RACE_TRAITS_5E.map((r) => [r.name, r]));

export function getRace5e(name: string): RaceTraits | undefined {
  return RACE_TRAITS_BY_NAME.get(name);
}

// ---------- Backgrounds ----------

export interface BackgroundDef5e {
  name: string;
  /** SKILLS_5E ids granted automatically. */
  skills: string[];
  feature: string;
}

// [name, 'skillId skillId', feature]
const BACKGROUND_ROWS: Array<[string, string, string]> = [
  ['Acolyte', 'insight religion', 'Shelter of the Faithful — your temple supports you and those you vouch for.'],
  ['Charlatan', 'deception sleightOfHand', 'False Identity — a second persona with papers to back it up.'],
  ['Criminal', 'deception stealth', 'Criminal Contact — a reliable fence who moves messages for you.'],
  ['Entertainer', 'acrobatics performance', 'By Popular Demand — free lodging and food where you perform.'],
  ['Folk Hero', 'animalHandling survival', 'Rustic Hospitality — common folk will shelter and hide you.'],
  ['Gladiator', 'acrobatics performance', 'By Popular Demand — a crowd will always pay to see you fight.'],
  ['Guild Artisan', 'insight persuasion', 'Guild Membership — your guild vouches for you and offers aid.'],
  ['Hermit', 'medicine religion', 'Discovery — a unique secret uncovered in your seclusion.'],
  ['Knight', 'history persuasion', 'Retainers — loyal commoners serve your household.'],
  ['Noble', 'history persuasion', 'Position of Privilege — the highborn treat you as a peer.'],
  ['Outlander', 'athletics survival', 'Wanderer — you always recall terrain and can find food for six.'],
  ['Pirate', 'athletics perception', 'Bad Reputation — people fear you enough to look the other way.'],
  ['Sage', 'arcana history', 'Researcher — you know where to find any lore you don’t already have.'],
  ['Sailor', 'athletics perception', 'Ship’s Passage — free passage for you and your companions.'],
  ['Soldier', 'athletics intimidation', 'Military Rank — soldiers recognize your authority.'],
  ['Spy', 'deception stealth', 'Criminal Contact — a trusted go-between in the underworld.'],
  ['Urchin', 'sleightOfHand stealth', 'City Secrets — travel twice as fast through any city you know.'],
  ['Haunted One', 'arcana investigation', 'Heart of Darkness — those who see your torment offer help.'],
  ['City Watch', 'athletics insight', 'Watcher’s Eye — you can quickly find the local watch and criminal dens.'],
  ['Far Traveler', 'insight perception', 'All Eyes on You — your foreignness draws attention and curiosity.'],
];

export const BACKGROUNDS_DEF_5E: BackgroundDef5e[] = BACKGROUND_ROWS.map(([name, skills, feature]) => ({
  name, skills: skills.split(' ').filter(Boolean), feature,
}));

export const BACKGROUNDS_BY_NAME_5E = new Map(BACKGROUNDS_DEF_5E.map((b) => [b.name, b]));

// ---------- Starting equipment kits ----------

export interface StartingKit {
  classId: string;
  label: string;
  weapons: Array<{ name: string; damage: string; dtype: string; range: number; finesse?: boolean; ranged?: boolean }>;
  armor: Array<{ name: string; baseAc: number; addDex: boolean; maxDex: number; shield?: boolean }>;
  items: string[];
  gp: number;
}

const KITS: StartingKit[] = [
  { classId: 'barbarian', label: 'Greataxe & handaxes', gp: 10, weapons: [{ name: 'Greataxe', damage: '1d12', dtype: 'slashing', range: 5 }, { name: 'Handaxe', damage: '1d6', dtype: 'slashing', range: 20, ranged: true }], armor: [], items: ["Explorer's pack", 'Javelin ×4'] },
  { classId: 'bard', label: 'Rapier & leather', gp: 15, weapons: [{ name: 'Rapier', damage: '1d8', dtype: 'piercing', range: 5, finesse: true }, { name: 'Dagger', damage: '1d4', dtype: 'piercing', range: 20, finesse: true }], armor: [{ name: 'Leather Armor', baseAc: 11, addDex: true, maxDex: -1 }], items: ["Entertainer's pack", 'Lute'] },
  { classId: 'cleric', label: 'Mace, scale mail & shield', gp: 10, weapons: [{ name: 'Mace', damage: '1d6', dtype: 'bludgeoning', range: 5 }], armor: [{ name: 'Scale Mail', baseAc: 14, addDex: true, maxDex: 2 }, { name: 'Shield', baseAc: 2, addDex: false, maxDex: -1, shield: true }], items: ["Priest's pack", 'Holy symbol'] },
  { classId: 'druid', label: 'Scimitar & leather', gp: 10, weapons: [{ name: 'Scimitar', damage: '1d6', dtype: 'slashing', range: 5, finesse: true }], armor: [{ name: 'Leather Armor', baseAc: 11, addDex: true, maxDex: -1 }, { name: 'Wooden Shield', baseAc: 2, addDex: false, maxDex: -1, shield: true }], items: ["Explorer's pack", 'Druidic focus'] },
  { classId: 'fighter', label: 'Longsword, chain mail & shield', gp: 10, weapons: [{ name: 'Longsword', damage: '1d8', dtype: 'slashing', range: 5 }, { name: 'Light Crossbow', damage: '1d8', dtype: 'piercing', range: 80, ranged: true }], armor: [{ name: 'Chain Mail', baseAc: 16, addDex: false, maxDex: -1 }, { name: 'Shield', baseAc: 2, addDex: false, maxDex: -1, shield: true }], items: ["Dungeoneer's pack", 'Bolts ×20'] },
  { classId: 'monk', label: 'Shortsword & darts', gp: 5, weapons: [{ name: 'Shortsword', damage: '1d6', dtype: 'piercing', range: 5, finesse: true }, { name: 'Dart', damage: '1d4', dtype: 'piercing', range: 20, finesse: true, ranged: true }], armor: [], items: ["Explorer's pack"] },
  { classId: 'paladin', label: 'Longsword, chain mail & shield', gp: 10, weapons: [{ name: 'Longsword', damage: '1d8', dtype: 'slashing', range: 5 }, { name: 'Javelin', damage: '1d6', dtype: 'piercing', range: 30, ranged: true }], armor: [{ name: 'Chain Mail', baseAc: 16, addDex: false, maxDex: -1 }, { name: 'Shield', baseAc: 2, addDex: false, maxDex: -1, shield: true }], items: ["Priest's pack", 'Holy symbol'] },
  { classId: 'ranger', label: 'Longbow, shortswords & leather', gp: 10, weapons: [{ name: 'Longbow', damage: '1d8', dtype: 'piercing', range: 150, ranged: true }, { name: 'Shortsword', damage: '1d6', dtype: 'piercing', range: 5, finesse: true }], armor: [{ name: 'Leather Armor', baseAc: 11, addDex: true, maxDex: -1 }], items: ["Explorer's pack", 'Arrows ×20'] },
  { classId: 'rogue', label: 'Rapier, shortbow & leather', gp: 15, weapons: [{ name: 'Rapier', damage: '1d8', dtype: 'piercing', range: 5, finesse: true }, { name: 'Shortbow', damage: '1d6', dtype: 'piercing', range: 80, ranged: true }, { name: 'Dagger', damage: '1d4', dtype: 'piercing', range: 20, finesse: true }], armor: [{ name: 'Leather Armor', baseAc: 11, addDex: true, maxDex: -1 }], items: ["Burglar's pack", "Thieves' tools", 'Arrows ×20'] },
  { classId: 'sorcerer', label: 'Dagger & arcane focus', gp: 20, weapons: [{ name: 'Dagger', damage: '1d4', dtype: 'piercing', range: 20, finesse: true }, { name: 'Light Crossbow', damage: '1d8', dtype: 'piercing', range: 80, ranged: true }], armor: [], items: ["Dungeoneer's pack", 'Arcane focus', 'Bolts ×20'] },
  { classId: 'warlock', label: 'Light crossbow & leather', gp: 15, weapons: [{ name: 'Light Crossbow', damage: '1d8', dtype: 'piercing', range: 80, ranged: true }, { name: 'Dagger', damage: '1d4', dtype: 'piercing', range: 20, finesse: true }], armor: [{ name: 'Leather Armor', baseAc: 11, addDex: true, maxDex: -1 }], items: ["Scholar's pack", 'Arcane focus', 'Bolts ×20'] },
  { classId: 'wizard', label: 'Quarterstaff & spellbook', gp: 10, weapons: [{ name: 'Quarterstaff', damage: '1d6', dtype: 'bludgeoning', range: 5 }, { name: 'Dagger', damage: '1d4', dtype: 'piercing', range: 20, finesse: true }], armor: [], items: ["Scholar's pack", 'Spellbook', 'Arcane focus'] },
  { classId: 'artificer', label: 'Light crossbow, studded leather & tools', gp: 10, weapons: [{ name: 'Light Crossbow', damage: '1d8', dtype: 'piercing', range: 80, ranged: true }, { name: 'Dagger', damage: '1d4', dtype: 'piercing', range: 20, finesse: true }], armor: [{ name: 'Studded Leather', baseAc: 12, addDex: true, maxDex: -1 }], items: ["Dungeoneer's pack", "Thieves' tools", 'Bolts ×20'] },
];

export const STARTING_KITS_5E = KITS;
export const KIT_BY_CLASS_5E = new Map(KITS.map((k) => [k.classId, k]));

// ---------- Final assembly ----------

export interface Dnd5eCreationInput {
  name: string;
  raceName: string;
  classId: string;
  backgroundName: string;
  alignment: string;
  /** Scores BEFORE racial increases — whatever the wizard's chosen method produced. */
  baseAbilities: Record<AbilityId, number>;
  /** Abilities picked for a race's free +1s (Half-Elf, Variant Human…). */
  raceFreeAbilities: AbilityId[];
  /** SKILLS_5E ids chosen from the class's skill list. */
  skillIds: string[];
  /** Include the class's starting equipment kit. */
  takeKit: boolean;
  personality?: string;
  backstory?: string;
}

/** Final ability scores after racial increases (fixed + freely assigned). */
export function finalAbilities5e(
  base: Record<AbilityId, number>,
  raceName: string,
  freePicks: AbilityId[],
): Record<AbilityId, number> {
  const race = getRace5e(raceName);
  const out = { ...base };
  if (race) {
    for (const [id, amount] of Object.entries(race.abilities)) {
      out[id as AbilityId] = (out[id as AbilityId] ?? 10) + (amount ?? 0);
    }
    for (const id of freePicks.slice(0, race.freeChoices)) {
      out[id] = (out[id] ?? 10) + 1;
    }
  }
  return out;
}

/** Skills the character ends up proficient in: class picks + background grants. */
export function grantedSkills5e(skillIds: string[], backgroundName: string): string[] {
  const bg = BACKGROUNDS_BY_NAME_5E.get(backgroundName);
  return [...new Set([...skillIds, ...(bg?.skills ?? [])])];
}

/**
 * Assemble a complete level-1 sheet patch. Every value lands on a normal,
 * editable sheet field — nothing here is re-derived later, so the table can
 * adjust anything afterward.
 */
export function buildDnd5eCharacterSheet(input: Dnd5eCreationInput): SheetData {
  const cls = getClass5e(input.classId);
  const race = getRace5e(input.raceName);
  const bg = BACKGROUNDS_BY_NAME_5E.get(input.backgroundName);
  const abilities = finalAbilities5e(input.baseAbilities, input.raceName, input.raceFreeAbilities);
  const conMod = abilityMod5e(abilities.con);
  const dexMod = abilityMod5e(abilities.dex);
  const hitDie = cls?.hitDie ?? 8;
  const maxHp = hitDie + conMod;
  const pb = profBonusForLevel(1);

  const sheet: SheetData = {
    level: 1,
    class: cls?.name ?? '',
    race: input.raceName,
    background: input.backgroundName,
    alignment: input.alignment,
    speed: race?.speed ?? 30,
    darkvision: race?.darkvision ?? 0,
    visionRange: 24,
    hitDice: `1d${hitDie}`,
    hp: Math.max(1, maxHp),
    maxHp: Math.max(1, maxHp),
    xp: 0,
  };
  for (const id of ABILITY_IDS) sheet[id] = abilities[id];

  // Saving-throw proficiencies come from the class.
  for (const save of cls?.saves ?? []) sheet[`save_${save}`] = true;

  // Skill proficiencies: class picks + background grants.
  for (const skillId of grantedSkills5e(input.skillIds, input.backgroundName)) {
    if (SKILLS_5E.some((s) => s.id === skillId)) sheet[`skill_${skillId}`] = true;
  }

  // Spellcasting: slots and the casting ability, when the class has any.
  if (cls && cls.caster !== 'none' && cls.spellAbility) {
    const slots = spellSlotsForClass(cls.caster, 1);
    sheet.spellAbility = cls.spellAbility;
    sheet.spellClass = cls.name;
    for (let lvl = 1; lvl <= 9; lvl++) {
      const n = slots[lvl - 1] ?? 0;
      if (n > 0) sheet[`slots${lvl}`] = n;
    }
  }

  // Starting kit: weapons become real attacks with their to-hit baked in,
  // armor rows arrive equipped so derived AC is right immediately.
  const kit = input.takeKit ? KIT_BY_CLASS_5E.get(input.classId) : undefined;
  const strMod = abilityMod5e(abilities.str);
  sheet.attacks = (kit?.weapons ?? []).map((w) => {
    // Ranged uses Dex, finesse takes the better of Str/Dex, everything else Str.
    const atkMod = w.ranged ? dexMod : w.finesse ? Math.max(strMod, dexMod) : strMod;
    return {
      name: w.name,
      bonus: atkMod + pb,
      damage: `${w.damage}${atkMod >= 0 ? '+' : ''}${atkMod}`,
      dtype: w.dtype,
      range: w.range,
    };
  });
  sheet.armor = (kit?.armor ?? []).map((a) => ({
    name: a.name, baseAc: a.baseAc, addDex: a.addDex, maxDex: a.maxDex,
    shield: a.shield === true, equipped: true, notes: '',
  }));
  sheet.inventory = (kit?.items ?? []).map((name) => ({ name, qty: 1, weight: 0, notes: 'starting equipment' }));
  sheet.gp = kit?.gp ?? 0;

  // Race and background flavor land as editable Features & Traits rows.
  const features: SheetData[] = [];
  if (race?.traits) features.push({ name: `${race.name} Traits`, source: 'Race', description: race.traits });
  if (bg?.feature) features.push({ name: bg.feature.split('—')[0].trim(), source: `Background: ${bg.name}`, description: bg.feature });
  for (const feat of (cls?.features ?? []).filter((f) => f.level === 1)) {
    features.push({ name: feat.name, source: `${cls?.name} 1`, description: feat.desc });
  }
  sheet.features = features;

  if (cls) sheet.proficienciesLanguages = `Armor: ${cls.armor}. Weapons: ${cls.weapons}.`;
  if (input.personality) sheet.personalityTraits = input.personality;
  if (input.backstory) sheet.backstory = input.backstory;

  return sheet;
}

/** Convenience for the wizard's class dropdown. */
export const CLASS_CHOICES_5E = CLASS_LIST_5E.map((c) => ({
  id: c.id, name: c.name, hitDie: c.hitDie, skillCount: c.skillCount, skillList: c.skillList,
  saves: c.saves, caster: c.caster,
}));

export const RACE_NAMES_5E = RACES_5E;
export const BACKGROUND_NAMES_5E = BACKGROUNDS_5E;
