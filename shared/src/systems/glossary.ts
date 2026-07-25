// Rules-term glossary: hover-tooltip descriptions for every term a player
// meets in the character creators (attributes, skills, ancestries/species,
// core concepts). Hindrances, Edges, custom-race traits, classes,
// backgrounds, foci, and packages carry their own `desc` fields in their
// data modules — this file covers everything that was previously just a
// bare name. Text is a concise paraphrase of each game's rules, not a
// verbatim transcription.

import { SKILLS_SWADE, ANCESTRIES_SWADE } from './swade.js';
import { SKILLS_SWN, SPECIES_SWN } from './swn.js';

// ---------- SWADE ----------

const SWADE_ATTRIBUTES: Record<string, string> = {
  Agility: 'Nimbleness, dexterity, and overall physical coordination. Governs Athletics, Fighting, Shooting, Stealth, and most vehicle skills.',
  Smarts: 'Raw intellect, perception, and mental agility. Governs knowledge skills, Notice, Healing, and arcane skills like Spellcasting.',
  Spirit: 'Inner willpower and confidence. Governs social skills like Persuasion and Intimidation, resisting Tests, and recovering from being Shaken.',
  Strength: 'Physical power. Sets melee damage (your Strength die is rolled with the weapon die) and how much you can carry.',
  Vigor: 'Endurance and toughness. Half your Vigor die sets your Toughness, and Vigor rolls resist poison, disease, and fatigue.',
};

const SWADE_SKILLS: Record<string, string> = {
  Academics: 'Knowledge of the liberal arts, social sciences, history, and law.',
  Athletics: 'Climbing, jumping, swimming, throwing, wrestling, and general physical coordination. A core skill everyone starts with at d4.',
  Battle: 'Military strategy and tactics — the commander’s skill in Mass Battles and coordinated actions.',
  Boating: 'Piloting watercraft, from rowboats to sailing ships.',
  'Common Knowledge': 'General knowledge of your world: customs, notable people, geography. A core skill everyone starts with at d4.',
  Driving: 'Operating ground vehicles — cars, trucks, hovercraft.',
  Faith: 'The arcane skill for Miracles — casting powers granted by a higher power.',
  Fighting: 'All melee and unarmed combat. Half your Fighting die (+2) sets your Parry — the number enemies must hit in melee.',
  Focus: 'The arcane skill for Gifted characters — activating innate supernatural talents.',
  Gambling: 'Games of chance and reading the table — win money, spot cheats.',
  Hacking: 'Breaking into and manipulating computer systems.',
  Healing: 'Treating Wounds within the Golden Hour, stabilizing the dying, and long-term care.',
  Intimidation: 'Threats and fearsome presence — a Test opposed by the target’s Spirit.',
  Language: 'Fluency in an additional language.',
  Notice: 'Awareness: spotting hidden foes, hearing footsteps, sensing lies. A core skill everyone starts with at d4.',
  Occult: 'Knowledge of supernatural lore, rituals, and creatures of the dark.',
  Performance: 'Singing, acting, dancing, or playing to an audience.',
  Persuasion: 'Convincing others to see things your way; shifts an NPC’s attitude. A core skill everyone starts with at d4.',
  Piloting: 'Flying aircraft and spacecraft.',
  Psionics: 'The arcane skill for psionicists — activating powers of the mind.',
  Repair: 'Fixing gadgets, vehicles, and machines.',
  Research: 'Digging facts out of libraries, archives, and the net.',
  Riding: 'Riding and controlling mounts, in and out of combat.',
  Science: 'Knowledge of the hard sciences: biology, chemistry, physics, engineering theory.',
  Shooting: 'All ranged weapons: bows, pistols, rifles, vehicle-mounted guns.',
  Spellcasting: 'The arcane skill for Magic — casting spells with arcane formulae.',
  Stealth: 'Moving unseen and unheard; palming objects. A core skill everyone starts with at d4.',
  Survival: 'Tracking, foraging, and staying alive in the wilds.',
  Taunt: 'Insults and mockery that rattle a foe — a Test opposed by the target’s Smarts.',
  Thievery: 'Picking locks and pockets, sleight of hand, and disabling traps.',
  'Weird Science': 'The arcane skill for mad inventors — powers built into strange devices.',
};

const SWADE_ANCESTRIES: Record<string, string> = {
  Human: 'Versatile and ambitious. Humans begin with a free Edge of their choice (this wizard grants Adaptable: once per session, re-roll a Trait roll).',
  Android: 'Constructed beings: tireless, logical, and unliving — they don’t breathe, eat, or suffer disease, but healing them takes Repair, not medicine.',
  Aquarian: 'Amphibious folk of the deep: at home underwater, tough in the crush of the depths, but dependent on regular immersion.',
  Avion: 'Winged humanoids: they fly, and hollow bones keep them light — and fragile.',
  Dwarf: 'Stout mountain folk: slow of Pace but tough as stone, with low-light vision from a life underground.',
  Elf: 'Graceful and long-lived, agile beyond human measure, with keen low-light vision — but slighter of build.',
  'Half-Elf': 'Caught between two worlds: inherits a measure of elven grace and human adaptability.',
  'Half-Folk': 'Small, lucky, and unassuming — hard to hit and harder to demoralize, but weaker of limb.',
  Rakashan: 'Feline humanoids: quick, with natural claws and low-light hunter’s eyes; their bloodlust is infamous.',
  Saurian: 'Reptilian warriors: scaled hide for natural armor and a keen predator’s senses, but cold-blooded in the chill.',
};

const SWADE_CONCEPTS: Record<string, string> = {
  'Wild Card': 'A hero or major character: rolls a d6 Wild Die alongside every Trait roll (keep the better), takes three Wounds before going down, and holds Bennies.',
  'Wild Die': 'The extra d6 Wild Cards roll with every Trait roll — keep the higher of the two dice. Both dice can ace (explode).',
  Benny: 'A fate chip. Spend one to re-roll a Trait roll, Soak damage, recover from Shaken, or draw a new Action Card. You start each session with three.',
  Bennies: 'Fate chips. Spend one to re-roll a Trait roll, Soak damage, recover from Shaken, or draw a new Action Card. You start each session with three.',
  Hindrance: 'A character flaw you choose for points: up to 2 Minor (1 point each) and 1 Major (2 points), spent on funds, attribute or skill points, or Edges.',
  Edge: 'A special talent or knack that bends the rules in your favor — bought at creation with Hindrance points, or earned through Advances.',
  Trait: 'Any attribute or skill. A Trait roll is that die (plus your Wild Die if you’re a Wild Card) against Target Number 4; every 4 over is a raise.',
  Pace: 'How many inches (tabletop) you move on your turn — 6 for most characters. Roll your Running die as a free action to move farther.',
  Parry: '2 plus half your Fighting die, plus shield and weapon modifiers — the Target Number enemies must hit you in melee.',
  Toughness: '2 plus half your Vigor die, plus Armor — the number damage rolls must beat to Shake or Wound you.',
  'Running Die': 'The die you roll and add to Pace when you run (d6 for most). Running is a free action.',
  'Power Points': 'The energy pool that fuels powers. Each power costs its listed Points to activate; they recover with rest.',
  Rank: 'Experience tier — Novice, Seasoned, Veteran, Heroic, Legendary. Advances raise it, and higher-Rank Edges and powers unlock as you climb.',
  Ancestry: 'Your species or folk. Each grants racial abilities — pick a preset or build one from racial trait points.',
  'Starting funds': 'Cash for gear: $500 by default. Spend it after creation from your sheet’s + Compendium button.',
};

const TERMS_SWADE: Record<string, string> = {
  ...SWADE_ATTRIBUTES, ...SWADE_SKILLS, ...SWADE_ANCESTRIES, ...SWADE_CONCEPTS,
};

// ---------- SWN ----------

const SWN_ATTRIBUTES: Record<string, string> = {
  Strength: 'Raw muscle: melee and thrown-weapon punch, carrying capacity, and feats of might.',
  Dexterity: 'Speed and coordination: ranged accuracy, Armor Class, and initiative.',
  Constitution: 'Health and stamina: bonus hit points every level and resistance to physical trauma.',
  Intelligence: 'Learning and reason: technical skills, memory, and analysis.',
  Wisdom: 'Perception and judgment: noticing danger, willpower, and Mental saving throws.',
  Charisma: 'Presence and leadership: winning people over, commanding loyalty, striking deals.',
};

const SWN_SKILLS: Record<string, string> = {
  Administer: 'Run organizations: bureaucracy, logistics, law, and management.',
  Connect: 'Find people who can help — contacts, favors, and knowing who to ask.',
  Exert: 'Athletics: climbing, swimming, running, throwing, and feats of endurance.',
  Fix: 'Repair and build devices, vehicles, and structures; jury-rig solutions.',
  Heal: 'Treat wounds, cure diseases, and stabilize the dying with medicine or psionics-adjacent tech.',
  Know: 'Academic and scientific knowledge: history, the sciences, and planetary lore.',
  Lead: 'Inspire and command others — keeping NPCs loyal and coordinated under fire.',
  Notice: 'Spot hidden things, read people, and stay alert to ambushes.',
  Perform: 'Artistic expression: music, acting, oratory, and dance.',
  Pilot: 'Fly or drive anything — from gravcars to starships.',
  Program: 'Code, hack, and operate computerized systems.',
  Punch: 'Unarmed combat: fists, kicks, and martial arts.',
  Shoot: 'Ranged combat: pistols, rifles, energy weapons, and heavy guns.',
  Sneak: 'Stealth, disguise, lockpicking, and sleight of hand.',
  Stab: 'Melee combat with weapons: knives, blades, clubs, and spears.',
  Survive: 'Endure the wilds: tracking, foraging, shelter, and hazard sense.',
  Talk: 'Persuade, deceive, and negotiate face to face.',
  Trade: 'Buy low, sell high: commerce, smuggling, and appraising goods.',
  Work: 'A profession’s craft — farming, mining, manufacturing, or any honest trade.',
  Biopsionics: 'Psychic discipline: mend flesh, purge toxins, and reshape living bodies.',
  Metapsionics: 'Psychic discipline: shape psychic energy itself — boost, suppress, or disrupt other powers.',
  Precognition: 'Psychic discipline: glimpse the future — sense danger and divine outcomes.',
  Telekinesis: 'Psychic discipline: move and strike objects with pure mental force.',
  Telepathy: 'Psychic discipline: read thoughts, link minds, and dominate the unwilling.',
  Teleportation: 'Psychic discipline: cross space in a blink, alone or with company.',
};

const SWN_SPECIES: Record<string, string> = {
  Human: 'Baseline humanity — the vast majority of the settled galaxy after the Scream.',
  Android: 'Human-shaped robots with human-level minds; some pass unnoticed among true humans.',
  'VI (True AI)': 'A Virtual Intelligence: a self-aware artificial mind riding a chassis or mainframe core.',
  'Uplifted Bioform': 'An animal lineage engineered up to sapience — moddable, loyal, and often underestimated.',
  'Alien Sophont': 'A member of a nonhuman starfaring species, with a physiology and psychology all their own.',
  Transhuman: 'Humanity upgraded: gene-lines and augments pushed past the baseline into something new.',
};

const SWN_CONCEPTS: Record<string, string> = {
  Class: 'Your calling: Warriors fight, Experts master skills, Psychics wield mental powers, and Adventurers blend two of those callings.',
  Background: 'Where you came from before the stars — grants a free level-0 skill that reflects that life.',
  Focus: 'A specialty talent (like a feat): grants a skill and a unique ability, growing stronger at level 2.',
  'Skill points': 'Spent to raise skills. Level-0 is competent, level-1 professional; higher levels come with experience.',
  Attributes: 'Rolled 3d6 each, straight down. 14+ gives a +1 modifier, 18 a +2; 7 or less takes penalties.',
  HP: 'Hit points: your capacity to keep fighting. At zero you’re down and dying without swift aid.',
  AC: 'Armor Class: the roll an attacker must meet or beat to hit you — set by armor worn plus Dexterity.',
  Effort: 'A psychic’s power reserve: committed to fuel disciplines, returned when powers end or after rest.',
  'Equipment package': 'A ready-made loadout of weapons, armor, and gear so you can skip line-item shopping.',
  Credits: 'The interstellar currency. Spend them after creation from your sheet’s + Compendium button.',
  Homeworld: 'The world that raised you — pure flavor here, but a hook your GM can build on.',
  Species: 'Your origin stock. Mechanically neutral in this wizard — the flavor drives roleplay and GM rulings.',
};

const TERMS_SWN: Record<string, string> = {
  ...SWN_ATTRIBUTES, ...SWN_SKILLS, ...SWN_SPECIES, ...SWN_CONCEPTS,
};

// ---------- lookup ----------

const LOWER_SWADE = new Map(Object.entries(TERMS_SWADE).map(([k, v]) => [k.toLowerCase(), v]));
const LOWER_SWN = new Map(Object.entries(TERMS_SWN).map(([k, v]) => [k.toLowerCase(), v]));

/** Case-insensitive glossary lookup. Returns undefined for unknown terms so
 *  callers can render plain text instead of an empty tooltip. */
export function termDesc(system: 'swade' | 'swn', term: string): string | undefined {
  return (system === 'swade' ? LOWER_SWADE : LOWER_SWN).get(term.trim().toLowerCase());
}

/** Every SWADE skill/ancestry/attribute name must have a glossary entry —
 *  exported for the completeness test. */
export function glossaryCoverage(): { missingSwade: string[]; missingSwn: string[] } {
  const missingSwade = [
    ...SKILLS_SWADE.filter((s) => !termDesc('swade', s)),
    ...ANCESTRIES_SWADE.filter((a) => !termDesc('swade', a)),
  ];
  const missingSwn = [
    ...SKILLS_SWN.filter((s) => !termDesc('swn', s)),
    ...SPECIES_SWN.filter((s) => !termDesc('swn', s)),
  ];
  return { missingSwade, missingSwn };
}
