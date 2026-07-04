// Randomized NPC generator: assembles a complete character — name, look,
// personality, background, stats, skills, and starting gear — from
// predefined pools. Pure (injectable RNG) so it stays deterministic in tests.

import type { GameSystem, SheetData } from '../types.js';
import { systemFor } from '../systems/index.js';
import { ALIGNMENTS, BACKGROUNDS_5E, RACES_5E, SKILLS_5E } from '../systems/dnd5e.js';
import { BACKGROUNDS_SWN, SKILLS_SWN, SPECIES_SWN } from '../systems/swn.js';
import type { RNG } from '../dice/roller.js';
import type { NpcEntry } from './npcTypes.js';

const FIRST_NAMES = [
  'Aldous', 'Bram', 'Cassia', 'Doran', 'Elowen', 'Fenwick', 'Greta', 'Harlan', 'Isolde', 'Joss',
  'Kaelen', 'Lira', 'Marek', 'Nessa', 'Orin', 'Petra', 'Quill', 'Rowan', 'Sable', 'Tamsin',
  'Ulric', 'Vesna', 'Wend', 'Xandra', 'Yorick', 'Zephyr', 'Bela', 'Corvin', 'Dahlia', 'Emrys',
  'Fable', 'Gwyn', 'Hollis', 'Ines', 'Jarek', 'Kira', 'Lucan', 'Mira', 'Nolan', 'Odette',
  'Piper', 'Ravi', 'Suri', 'Tobin', 'Una', 'Varen', 'Wynn', 'Yara', 'Zane', 'Bex',
];
const SURNAMES = [
  'Ashdown', 'Blackwater', 'Coldiron', 'Duskmere', 'Emberly', 'Fairwind', 'Greaves', 'Hallow',
  'Ironwood', 'Jessup', 'Karr', 'Lockhart', 'Marsh', 'Nightingale', 'Oakhart', 'Pryce', 'Quarrow',
  'Ravenscar', 'Stonebrook', 'Thorne', 'Umbermoor', 'Vance', 'Whitlock', 'Yarrow', 'Ashford',
  'Vex', 'Dune', 'Solari', 'Kade', 'Orbital', 'Voss', 'Renner', 'Calloway', 'Sky', 'Reyes',
];
const OCCUPATIONS_5E = [
  'Blacksmith', 'Innkeeper', 'Farmer', 'Merchant', 'Guard', 'Priest', 'Scholar', 'Hunter',
  'Fisher', 'Baker', 'Cobbler', 'Sailor', 'Miner', 'Herbalist', 'Bard', 'Beggar', 'Noble',
  'Scribe', 'Stablehand', 'Tanner', 'Mercenary', 'Fortune-teller', 'Alchemist', 'Ferryman',
];
const OCCUPATIONS_SWN = [
  'Dock Worker', 'Ship Mechanic', 'Data Broker', 'Bartender', 'Bounty Poster', 'Cargo Hauler',
  'Corp Rep', 'Street Doc', 'Fixer', 'Pilot', 'Miner', 'Cultist', 'Smuggler', 'Bureaucrat',
  'Journalist', 'Gunrunner', 'Prospector', 'Hydroponics Tech', 'Salvager', 'Bodyguard',
];
const PERSONALITY = [
  'gruff', 'cheerful', 'suspicious', 'greedy', 'kind-hearted', 'nervous', 'arrogant', 'loyal',
  'sarcastic', 'devout', 'cowardly', 'brave', 'melancholy', 'gossipy', 'meticulous', 'reckless',
  'soft-spoken', 'boisterous', 'cunning', 'naive', 'world-weary', 'optimistic', 'vengeful', 'curious',
];
const APPEARANCE = [
  'a jagged scar', 'piercing eyes', 'a booming laugh', 'a limp', 'ink-stained fingers', 'a gold tooth',
  'weathered hands', 'an ornate ring', 'a nervous tic', 'a shaved head', 'a long braid', 'a fine cloak',
  'a missing ear', 'freckles', 'a raspy voice', 'a false smile', 'tattoos of birds', 'tired eyes',
];
const QUIRKS = [
  'hums old tunes', 'never makes eye contact', 'collects odd trinkets', 'quotes proverbs',
  'always haggling', 'terrified of the dark', 'owes money to dangerous people', 'secretly literate',
  'talks to their pet', 'writes everything down', 'fidgets constantly', 'name-drops constantly',
];
const EYES = ['brown', 'blue', 'green', 'hazel', 'grey', 'amber', 'dark', 'pale blue', 'one milky white'];
const HAIR = ['short black', 'long auburn', 'greying brown', 'curly red', 'straight blond', 'bald', 'silver braided', 'wild grey', 'close-cropped', 'raven-dark'];
const SKIN = ['fair', 'olive', 'tan', 'dark', 'ruddy', 'pale', 'weathered', 'freckled', 'bronzed'];
const IDEALS = [
  'Freedom. Everyone should be able to chart their own course.',
  'Community. We must look out for one another.',
  'Greed. There is nothing money cannot buy.',
  'Faith. My god guides my every step.',
  'Honor. My word is my bond.',
  'Knowledge. Understanding is the truest power.',
  'Redemption. There is good in everyone, even me.',
  'Power. I will rise no matter the cost.',
];
const BONDS = [
  'I would die to protect my family.',
  'I owe everything to the person who took me in.',
  'A sacred relic was stolen and I mean to reclaim it.',
  'My hometown is all that matters to me.',
  'I seek the one who ruined my life.',
  'An old debt still hangs over my head.',
  'I am sworn to a mentor I have never met in person.',
  'My work is the only thing that gives me meaning.',
];
const FLAWS = [
  'I cannot resist a pretty face or a full purse.',
  'I speak before I think, always.',
  'I trust too easily and pay for it.',
  'I will do anything to avoid a fight.',
  'Secretly, I believe I deserve better than everyone around me.',
  'I drink to forget things I would rather not remember.',
  'I hold grudges longer than I should.',
  'I am hopeless with money.',
];
const LANGUAGES = ['Dwarvish', 'Elvish', 'Halfling', 'Orc', 'Draconic', 'Gnomish', 'Goblin', 'Celestial', 'Infernal', 'Sylvan'];
const FEATURES_5E: Array<[string, string, string]> = [
  ['Local Knowledge', 'Background', 'Knows the streets, rumours, and safe houses of their home.'],
  ['Trade Skill', 'Occupation', 'Expert at their craft; can appraise related goods.'],
  ['Contacts', 'Background', 'Knows someone useful in most settlements.'],
  ['Hard to Rattle', 'Trait', 'Advantage on saves against fear.'],
  ['Quick Fingers', 'Trait', 'Deft with tools and locks.'],
  ['Silver Tongue', 'Trait', 'Persuasive in a pinch.'],
];
const GEAR_5E = ['a worn dagger', 'a set of common clothes', 'a belt pouch', 'a tinderbox', 'a length of rope', 'a lucky charm', 'a half-eaten meal', 'a folded letter'];
const GEAR_SWN = ['a compad', 'a multitool', 'a ration pack', 'a data cube', 'a stim injector', 'a worn jacket', 'an ID chit', 'a keepsake photo'];
const HOOKS = [
  'is looking for honest work', 'has a secret to keep', 'knows something they should not',
  'is in over their head', 'wants revenge on a rival', 'is fleeing an old life',
  'guards a hidden treasure', 'is not what they seem',
];

function pick<T>(arr: readonly T[], rng: RNG): T {
  return arr[Math.floor(rng() * arr.length)];
}
function pickSome<T>(arr: readonly T[], n: number, rng: RNG): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
function between(lo: number, hi: number, rng: RNG): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
function roll3d6(rng: RNG): number {
  return 3 + Math.floor(rng() * 6) + Math.floor(rng() * 6) + Math.floor(rng() * 6);
}

export interface GeneratedNpc {
  name: string;
  occupation: string;
  tags: string[];
  sheet: SheetData;
}

/** Build a fully-populated random NPC for the given system. */
export function generateNpc(system: GameSystem, rng: RNG = Math.random): GeneratedNpc {
  const name = `${pick(FIRST_NAMES, rng)} ${pick(SURNAMES, rng)}`;
  const personality = pickSome(PERSONALITY, 2, rng);
  const appearance = pick(APPEARANCE, rng);
  const quirk = pick(QUIRKS, rng);
  const hook = pick(HOOKS, rng);
  const age = between(17, 68, rng);
  const heightFt = between(4, 6, rng);
  const heightIn = between(0, 11, rng);
  const height = `${heightFt}'${heightIn}"`;
  const weight = `${between(110, 250, rng)} lb`;
  const eyes = pick(EYES, rng);
  const hair = pick(HAIR, rng);
  const skin = pick(SKIN, rng);
  const sheet = systemFor(system).defaultSheet();
  const tags = [...personality, appearance, quirk];

  if (system === 'dnd5e') {
    const occupation = pick(OCCUPATIONS_5E, rng);
    const scores = Array.from({ length: 6 }, () => 8 + Math.floor(rng() * 7)); // 8..14
    const conMod = Math.floor((scores[2] - 10) / 2);
    const hp = Math.max(3, 6 + conMod + between(0, 4, rng));
    // A couple of skill + save proficiencies, thematically flavored.
    for (const s of pickSome(SKILLS_5E, 3, rng)) sheet[`skill_${s.id}`] = true;
    for (const ab of pickSome(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const, 1, rng)) sheet[`save_${ab}`] = true;
    const [feat1, feat2] = pickSome(FEATURES_5E, 2, rng);

    Object.assign(sheet, {
      class: occupation, subclass: '', race: pick(RACES_5E, rng),
      background: pick(BACKGROUNDS_5E, rng), alignment: pick(ALIGNMENTS, rng),
      level: 1, xp: 0,
      str: scores[0], dex: scores[1], con: scores[2], int: scores[3], wis: scores[4], cha: scores[5],
      ac: 10 + Math.floor((scores[1] - 10) / 2), speed: 30, hp, maxHp: hp, hitDice: '1d8',
      age, height, weight, eyes, skin, hair,
      personalityTraits: `${personality[0]} and ${personality[1]}; has ${appearance}.`,
      ideals: pick(IDEALS, rng),
      bonds: pick(BONDS, rng),
      flaws: pick(FLAWS, rng),
      proficienciesLanguages: `Common, ${pickSome(LANGUAGES, 1, rng)[0]}`,
      backstory: `A ${occupation.toLowerCase()} who ${quirk} and ${hook}.`,
      features: [
        { name: feat1[0], source: feat1[1], description: feat1[2] },
        { name: feat2[0], source: feat2[1], description: feat2[2] },
      ],
      cp: between(0, 60, rng), sp: between(0, 20, rng), gp: between(0, 15, rng),
      inventory: pickSome(GEAR_5E, 2, rng).map((g) => ({ name: g, qty: 1, weight: 0, notes: '' })),
      attacks: [{ name: 'Dagger', bonus: 2 + Math.floor((scores[1] - 10) / 2), damage: `1d4+${Math.floor((scores[1] - 10) / 2)}`, notes: 'piercing; finesse' }],
      notes: `Random NPC — occupation: ${occupation}. Hook: ${hook}. Tags: ${tags.join(', ')}.`,
    });
    return { name, occupation, tags, sheet };
  }

  // SWN
  const occupation = pick(OCCUPATIONS_SWN, rng);
  const attrs = { str: roll3d6(rng), dex: roll3d6(rng), con: roll3d6(rng), int: roll3d6(rng), wis: roll3d6(rng), cha: roll3d6(rng) };
  const hp = between(4, 10, rng);
  const skillPool = pickSome(SKILLS_SWN, 3, rng);
  Object.assign(sheet, {
    class: pick(['Warrior', 'Expert', 'Adventurer'] as const, rng),
    background: pick(BACKGROUNDS_SWN, rng), homeworld: pick(['Kua', 'Halcyon', 'Redmark', 'Ixion Deep', 'Farhaven', 'The Drift'], rng),
    level: 1, xp: 0,
    ...attrs,
    hp, maxHp: hp, ac: 12, attackBonus: 0, speed: 10, systemStrain: 0,
    age, height, weight, eyes, skin, hair,
    species: pick(SPECIES_SWN, rng),
    goal: `${hook[0].toUpperCase()}${hook.slice(1)}.`,
    credits: between(0, 200, rng),
    skills: skillPool.map((s) => ({ name: s, level: between(0, 1, rng), attr: pick(['str', 'dex', 'int', 'wis', 'cha'], rng), notes: '' })),
    attacks: [{ name: 'Knife', bonus: 0, damage: '1d4', notes: 'kinetic' }],
    inventory: pickSome(GEAR_SWN, 2, rng).map((g) => ({ name: g, qty: 1, enc: 1, notes: '' })),
    notes: `Occupation: ${occupation}. ${personality[0]}, ${personality[1]}; has ${appearance}; ${quirk}.`,
  });
  return { name, occupation, tags, sheet };
}

// ---------- randomize-from-model (compendium NPC as a template) ----------

// Which library categories read as "a person" (get a human name + townsfolk
// flavor) rather than a monster/robot (so a dragon never gets a name like a
// blacksmith's). Anything not listed here falls back to the 'creature' kind.
const PERSON_CATEGORIES_5E = new Set(['People & NPCs', 'Savage Humanoids']);
const PERSON_CATEGORIES_SWN = new Set(['Civilians', 'Criminals', 'Military', 'Psychics', 'Spacers & Adventurers']);
const ROBOT_CATEGORIES_SWN = new Set(['Robots & VIs']);

export type NpcKind = 'person' | 'creature' | 'robot';

/** Classify a library entry so its generated name/flavor fits its type. */
export function npcKindForEntry(entry: Pick<NpcEntry, 'system' | 'category'>): NpcKind {
  if (entry.system === 'dnd5e') {
    return PERSON_CATEGORIES_5E.has(entry.category) ? 'person' : 'creature';
  }
  if (ROBOT_CATEGORIES_SWN.has(entry.category)) return 'robot';
  return PERSON_CATEGORIES_SWN.has(entry.category) ? 'person' : 'creature';
}

const CREATURE_GIVEN = [
  'Grakthar', 'Vraknos', 'Skarn', 'Mordath', 'Uldrak', 'Threx', 'Vyrga', 'Naxil', 'Orrik', 'Zephyra',
  'Karrgoth', 'Ssythra', 'Drommel', 'Ixthar', 'Baelnok', 'Charn', 'Rhaskor', 'Nyxara', 'Grumveth', 'Aszra',
];
const CREATURE_EPITHET = [
  'the Bonecrusher', 'the Emberclaw', 'the Doomwing', 'the Nightfang', 'the Ironhide', 'the Frostmaw',
  'the Bloodtusk', 'the Shadowmere', 'the Grimtooth', 'the Stormrend', 'the Hollow-Eyed', 'the Ashen',
  'the Void-Touched', 'the Many-Scarred', 'the Ravenous', 'the Unyielding', 'the Cinder-Wing', 'the Gravewalker',
];
const CREATURE_FLAVOR = [
  'Rumored to lair nearby and guard a hoard of stolen valuables.',
  'Has terrorized travelers on this road for years.',
  'Bears countless scars from battles it always wins.',
  'Its territory is marked with the remains of past challengers.',
  'Said to be smarter and crueler than others of its kind.',
  'Answers to no one and fears even less.',
  'Recently driven from its old haunt, and hungrier for it.',
  'Known to hoard trophies taken from its kills.',
];
const PERSON_FLAVOR_PREFIX = [
  'Once known simply as a', 'Formerly a', 'Still remembered as a', 'Rose from being a',
];
const ROBOT_PREFIXES = ['KX', 'VN', 'RZ', 'TN', 'QB', 'MX', 'DL', 'HX', 'WR', 'PL'];
const ROBOT_FLAVOR = [
  "Runs on an outdated firmware build prone to odd glitches.",
  'Recently reactivated after years in storage.',
  'Its chassis bears scorch marks from a past skirmish.',
  'Follows its last-given orders with unsettling precision.',
  "Occasionally repeats fragments of a long-dead operator's voice.",
  'Missing several non-essential panels; sparks when it walks.',
];

function jitter(n: number, pct: number, rng: RNG, min: number): number {
  const delta = Math.max(1, Math.round(Math.abs(n) * pct));
  return Math.max(min, n + between(-delta, delta, rng));
}

/**
 * Build a randomized NPC modeled after an existing compendium entry: stats
 * are jittered a little (HP, AC, ability scores/attack bonus), while a fresh
 * name and flavor text are generated appropriate to what the model actually
 * is — a townsfolk NPC reads like a person, a dragon reads like a monster,
 * a security bot reads like a machine.
 */
export function generateNpcFromModel(entry: NpcEntry, rng: RNG = Math.random): GeneratedNpc {
  const kind = npcKindForEntry(entry);
  const sheet: SheetData = structuredClone(entry.sheet);
  const priorNotes = typeof sheet.notes === 'string' ? sheet.notes : '';

  // HP/AC always exist on library sheets; ability scores only on 5e ones.
  const hp = jitter(Number(sheet.maxHp ?? sheet.hp ?? entry.hp), 0.15, rng, 1);
  sheet.hp = hp;
  sheet.maxHp = hp;
  sheet.ac = jitter(Number(sheet.ac ?? entry.ac), 0.08, rng, 5);
  if (entry.system === 'dnd5e') {
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      sheet[ab] = jitter(Number(sheet[ab] ?? 10), 0.1, rng, 1);
    }
  } else {
    sheet.attackBonus = jitter(Number(sheet.attackBonus ?? 0), 0.2, rng, 0);
  }

  let name: string;
  let notes: string;
  if (kind === 'person') {
    const personality = pickSome(PERSONALITY, 2, rng);
    const quirk = pick(QUIRKS, rng);
    const hook = pick(HOOKS, rng);
    name = `${pick(FIRST_NAMES, rng)} ${pick(SURNAMES, rng)}`;
    notes = `${pick(PERSON_FLAVOR_PREFIX, rng)} ${entry.name.toLowerCase()}, ${personality[0]} and ${personality[1]}; ${quirk}. ${hook[0].toUpperCase()}${hook.slice(1)}.`;
  } else if (kind === 'robot') {
    const designation = `${pick(ROBOT_PREFIXES, rng)}-${between(100, 999, rng)}`;
    name = `Unit ${designation}`;
    notes = `A ${entry.name} chassis. ${pick(ROBOT_FLAVOR, rng)}`;
  } else {
    name = `${pick(CREATURE_GIVEN, rng)} ${pick(CREATURE_EPITHET, rng)}`;
    notes = `A ${entry.name.toLowerCase()} known as ${name}. ${pick(CREATURE_FLAVOR, rng)}`;
  }
  sheet.notes = priorNotes ? `${notes} ${priorNotes}` : notes;
  if (entry.system === 'dnd5e') sheet.backstory = notes;
  else sheet.goal = notes;

  return { name, occupation: entry.category, tags: [kind, entry.category], sheet };
}
