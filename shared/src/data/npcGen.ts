// Randomized NPC generator: assembles a complete character — name, look,
// personality, background, stats, skills, and starting gear — from
// predefined pools. Pure (injectable RNG) so it stays deterministic in tests.

import type { GameSystem, SheetData } from '../types.js';
import { systemFor } from '../systems/index.js';
import { ALIGNMENTS, BACKGROUNDS_5E, RACES_5E, SKILLS_5E } from '../systems/dnd5e.js';
import { BACKGROUNDS_SWN, SKILLS_SWN, SPECIES_SWN } from '../systems/swn.js';
import { ANCESTRIES_SWADE, SKILLS_SWADE, TRAIT_DICE } from '../systems/swade.js';
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
// SWADE is setting-agnostic — a deliberately genre-mixed pool.
const OCCUPATIONS_SWADE = [
  'Saloon Keeper', 'Bounty Hunter', 'Deputy', 'Prospector', 'Gambler', 'Preacher', 'Rancher',
  'Detective', 'Reporter', 'Professor', 'Mechanic', 'Smuggler', 'Sailor', 'Explorer',
  'Merchant', 'Physician', 'Drifter', 'Trapper', 'Entertainer', 'Occultist',
];
const GEAR_SWADE = ['a trusty knife', 'a coil of rope', 'a battered hat', 'a deck of cards', 'a first aid kit', 'a flask', 'an old map', 'a lucky coin'];
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
const NICKNAMES = [
  'Sparrow', 'Ash', 'Nine-Fingers', 'Lucky', 'Squint', 'Rook', 'Marbles', 'Whistler',
  'Patch', 'Fox', 'Bramble', 'Two-Bits', 'Grit', 'Magpie', 'Cinder', 'Bones',
];
const PERSON_TRAITS = [
  'Quick', 'Elder', 'Younger', 'Wise', 'Bold', 'Grey', 'Red', 'Silent', 'Lucky', 'Tall', 'Kind', 'Stubborn',
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

/** A human-scale age/height/weight/eyes/hair/skin bundle, shared by every
 *  "this is a person" path — the from-scratch generator and, for the library
 *  randomizer, its People & NPCs branch. */
function personBioBits(rng: RNG) {
  const age = between(17, 68, rng);
  const heightFt = between(4, 6, rng);
  const heightIn = between(0, 11, rng);
  return {
    age, height: `${heightFt}'${heightIn}"`, weight: `${between(110, 250, rng)} lb`,
    eyes: pick(EYES, rng), hair: pick(HAIR, rng), skin: pick(SKIN, rng),
  };
}

/** Build a fully-populated random NPC for the given system. */
export function generateNpc(system: GameSystem, rng: RNG = Math.random): GeneratedNpc {
  const name = `${pick(FIRST_NAMES, rng)} ${pick(SURNAMES, rng)}`;
  const personality = pickSome(PERSONALITY, 2, rng);
  const appearance = pick(APPEARANCE, rng);
  const quirk = pick(QUIRKS, rng);
  const hook = pick(HOOKS, rng);
  const { age, height, weight, eyes, hair, skin } = personBioBits(rng);
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

  if (system === 'swade') {
    const occupation = pick(OCCUPATIONS_SWADE, rng);
    // Ordinary folk: mostly d6s, one trait a notch better or worse.
    const die = () => pick(['d4', 'd6', 'd6', 'd6', 'd8'] as const, rng);
    const skillPool = pickSome(SKILLS_SWADE.filter((s) => !['Athletics', 'Common Knowledge', 'Notice', 'Persuasion', 'Stealth'].includes(s)), 2, rng);
    const coreSkills = [
      { name: 'Athletics', die: 'd4', notes: '' },
      { name: 'Common Knowledge', die: 'd6', notes: '' },
      { name: 'Notice', die: pick(['d4', 'd6'] as const, rng), notes: '' },
      { name: 'Persuasion', die: pick(['d4', 'd6'] as const, rng), notes: '' },
      { name: 'Stealth', die: 'd4', notes: '' },
    ];
    const strength = die();
    Object.assign(sheet, {
      concept: occupation, ancestry: pick(ANCESTRIES_SWADE, rng), rank: 'Novice', wildCard: false,
      agility: die(), smarts: die(), spirit: die(), strength, vigor: die(),
      hp: 10, maxHp: 10, bennies: 0, pace: 6,
      age, height, weight, eyes, skin, hair,
      dollars: between(20, 400, rng),
      skills: [...coreSkills, ...skillPool.map((name) => ({ name, die: pick(TRAIT_DICE.slice(0, 3), rng), notes: '' }))],
      attacks: [{ name: 'Knife', skill: 'Fighting', damage: `1${strength}!+1d4!`, dtype: 'piercing', range: 5, notes: '' }],
      inventory: pickSome(GEAR_SWADE, 2, rng).map((g) => ({ name: g, qty: 1, weight: 0, notes: '' })),
      notes: `Occupation: ${occupation}. ${personality[0]}, ${personality[1]}; has ${appearance}; ${quirk}. Hook: ${hook}.`,
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
const PERSON_CATEGORIES_SWADE = new Set(['People', 'Soldiers & Lawmen']);

export type NpcKind = 'person' | 'creature' | 'robot';

/** Classify a library entry so its generated name/flavor fits its type. */
export function npcKindForEntry(entry: Pick<NpcEntry, 'system' | 'category'>): NpcKind {
  if (entry.system === 'dnd5e') {
    return PERSON_CATEGORIES_5E.has(entry.category) ? 'person' : 'creature';
  }
  if (entry.system === 'swade') {
    return PERSON_CATEGORIES_SWADE.has(entry.category) ? 'person' : 'creature';
  }
  if (ROBOT_CATEGORIES_SWN.has(entry.category)) return 'robot';
  return PERSON_CATEGORIES_SWN.has(entry.category) ? 'person' : 'creature';
}

/** One-line description of the naming style an entry will get, for UI hints. */
export function npcFlavorHint(entry: Pick<NpcEntry, 'system' | 'category'>): string {
  if (entry.system === 'dnd5e') {
    if (entry.category === 'People & NPCs') return 'a person — gets a fresh human name & backstory';
    if (entry.category === 'Savage Humanoids') return 'a savage humanoid — gets a tribal name & pack flavor';
    return `a ${entry.category.toLowerCase()} — gets a name & flavor fit for its kind`;
  }
  const kind = npcKindForEntry(entry);
  if (kind === 'robot') return 'a machine — gets a serial designation & flavor';
  if (kind === 'person') return 'a person — gets a fresh human name & backstory';
  return 'a creature — gets a monster-appropriate name & flavor';
}

// Generic SWN 'creature' fallback (aliens/wildlife not covered by a specific
// D&D-style category) — unchanged from the original single-pool generator.
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

/** A human/townsfolk name in one of several structural styles, so a room
 *  full of People & NPCs doesn't all read as "First Last". */
function personName(rng: RNG): string {
  const first = pick(FIRST_NAMES, rng);
  const surname = pick(SURNAMES, rng);
  const styles: Array<() => string> = [
    () => `${first} ${surname}`,
    () => `${first} "${pick(NICKNAMES, rng)}" ${surname}`,
    () => `${first} the ${pick(PERSON_TRAITS, rng)}`,
    () => `${pick(PERSON_TRAITS, rng)} ${first} ${surname}`,
  ];
  return pick(styles, rng)();
}

function personFlavor(entry: NpcEntry, rng: RNG): { name: string; notes: string } {
  const personality = pickSome(PERSONALITY, 2, rng);
  const quirk = pick(QUIRKS, rng);
  const hook = pick(HOOKS, rng);
  const name = personName(rng);
  const notes = `${pick(PERSON_FLAVOR_PREFIX, rng)} ${entry.name.toLowerCase()}, ${personality[0]} and ${personality[1]}; ${quirk}. ${hook[0].toUpperCase()}${hook.slice(1)}.`;
  return { name, notes };
}

/** A pool of thematic name parts for one monster category. buildCreatureName
 *  assembles a name from these using a randomly chosen structure, so entries
 *  in the same category don't all read as "Given the Epithet". */
interface NamePool {
  given: readonly string[];
  epithets: readonly string[]; // e.g. 'the Bonecrusher'
  adjectives?: readonly string[]; // standalone descriptor, no "the" — for "Adj Given"
  domains?: readonly string[]; // full "of ..." suffix — tribe/plane/hoard, etc.
  nameless?: readonly string[]; // standalone moniker used with no given name at all
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildCreatureName(pool: NamePool, rng: RNG): string {
  const styles: Array<() => string> = [
    () => `${pick(pool.given, rng)} ${pick(pool.epithets, rng)}`,
    () => capitalizeFirst(pick(pool.epithets, rng)),
    () => pick(pool.given, rng),
  ];
  if (pool.adjectives?.length) styles.push(() => `${pick(pool.adjectives!, rng)} ${pick(pool.given, rng)}`);
  if (pool.domains?.length) styles.push(() => `${pick(pool.given, rng)} ${pick(pool.domains!, rng)}`);
  if (pool.nameless?.length) styles.push(() => pick(pool.nameless!, rng));
  return pick(styles, rng)();
}

const SAVAGE_HUMANOID_NAMES: NamePool = {
  given: ['Rekk', 'Ssaleth', 'Vrahsk', 'Kelu', 'Dagmir', 'Ythiss', 'Skreel', 'Naghal', 'Ussa', 'Threll', 'Vokka', 'Zeth', 'Mirrix', 'Ghurn', 'Slyth', 'Corram'],
  epithets: ['the Deep-Hunter', 'the Reef-Stalker', 'the Pack-Eater', 'the Silt-Walker', 'the Coldscale', 'the Marsh-Born', 'the Night-Diver', 'the Bone-Collector', 'the Tide-Caller', 'the Hollow-Voice'],
  domains: ['of the Sunken Reef clan', 'of the Bloodmire pack', 'of the Salt-Tooth tribe', 'of the Deepwater brood', 'of the Ashen Fen coven'],
};
const SAVAGE_HUMANOID_FLAVOR = [
  'Runs with a pack that answers to no law but its own.',
  'Worships something old and hungry that sleeps beneath the water.',
  'Marks its territory with the bones of trespassers.',
  'Was driven from its brood for a crime none will name.',
  'Leads raids on anything foolish enough to wander too close.',
  'Speaks a guttural tongue few outsiders have ever learned.',
  'Bears ritual scars marking a rank earned in blood.',
  'Has not seen the sun in longer than it can remember.',
];

const GOBLINOID_NAMES: NamePool = {
  given: ['Snagrat', 'Uzgash', 'Griknuk', 'Mogdul', 'Thratch', 'Kizzik', 'Ruknar', 'Vazgor', 'Nogrim', 'Skrat', 'Bolgash', 'Yarnik', 'Drazgul', 'Guzruk', 'Karnash'],
  epithets: ['the Tusk-Breaker', 'the Cave-King', 'the Sharptooth', 'the Warcaller', 'the Bone-Gnawer', 'the Skull-Splitter', 'the Mudback', 'the Iron-Jaw', 'the Nightraider', 'the Grubfist'],
  adjectives: ['Grim', 'Foul', 'Vicious', 'Ragged', 'Snarling'],
  domains: ['of the Blackfang tribe', 'of the Cinderjaw warband', 'of the Skullpile clan', 'of the Bloodmoon raiders', 'of the Broken Tusk tribe'],
};
const GOBLINOID_FLAVOR = [
  'Climbed to the top of its warband by outliving everyone above it.',
  'Leads raiding parties along the old trade roads.',
  'Carries trophies from a dozen ambushes on its belt.',
  'Rules through fear more than any real cunning.',
  'Was passed over for chief once, and has not forgotten it.',
  'Keeps a pack of beasts loyal only to it.',
  'Is smarter than it looks, which has kept it alive.',
  'Answers to a warlord it secretly means to replace.',
];

const UNDEAD_NAMES: NamePool = {
  given: ['Malachor', 'Sorrowyn', 'Vael', 'Ithren', 'Corvashe', 'Nymira', 'Ashkar', 'Dolmenne', 'Ezraeth', 'Vhalor', 'Cyrwyn', 'Morteth'],
  epithets: ['the Unquiet', 'the Restless', 'the Grave-Bound', 'the Pale Wanderer', 'the Ash-Shrouded', 'the Forgotten', 'the Deathless', 'the Withering', 'the Grieving', 'the Bone-Cold'],
  adjectives: ['Silent', 'Withered', 'Hollow', 'Ashen', 'Sorrowful'],
  nameless: ['The Hollow One', 'The Nameless Grief', 'What Remains', 'The Cold Silence', 'The Last Mourner'],
};
const UNDEAD_FLAVOR = [
  'Does not remember its own name, only what was taken from it.',
  'Still wears what is left of the clothes it died in.',
  'Guards a tomb it can no longer recall the purpose of.',
  'Rises again every time it is put down for good.',
  'Was bound here by a curse someone else has long forgotten.',
  'Reaches for something it lost centuries ago.',
  'Its grave goods are worth more than its unlife.',
  'Was given no funeral rites, and has never forgiven the living for that.',
];

const BEAST_NAMES: NamePool = {
  given: ['Ashclaw', 'Windrunner', 'Nightpaw', 'Brambletooth', 'Stormwing', 'Frostmuzzle', 'Talonstrike', 'Duskhide', 'Emberfang', 'Mossback', 'Thistlefoot', 'Rimehorn'],
  epithets: ['Old Scar', 'the Grey Ghost', 'the Lone Hunter', 'Broken Horn', 'the White Shadow', 'One-Eye', 'the Trail-Breaker', 'the Silent Stalker', 'King of the Thicket', 'Last of the Litter'],
};
const BEAST_FLAVOR = [
  'Larger than any of its kind seen in these parts for years.',
  'Has evaded every hunting party sent after it.',
  'Bears old wounds from a fight it clearly won.',
  'Has been spotted near the same territory for seasons.',
  "Was once someone's companion, now gone feral.",
  'Locals leave out offerings to keep it from their livestock.',
  'Moves in ways that seem almost too deliberate for a mere animal.',
  'Leads the rest of its kind through the area.',
];

const MONSTROSITY_NAMES: NamePool = {
  given: ['Grethka', 'Aulmir', 'Skavox', 'Rhennik', 'Tholgrim', 'Vexara', 'Chalmuth', 'Draveth', 'Ossyra', 'Nemrick'],
  epithets: ['the Feral', 'the Twisted', 'the Maze-Walker', 'the Nightmare-Born', 'the Chimeric', 'the Sky-Render', 'the Venom-Fanged', 'the Unnatural', 'the Stitched-Together', 'the Trap-Sprung'],
  adjectives: ['Feral', 'Twisted', 'Ravenous', 'Warped'],
};
const MONSTROSITY_FLAVOR = [
  'Is a mismatched horror even others of its kind avoid.',
  "Was likely the result of some wizard's failed experiment.",
  'Lairs somewhere no sane creature would choose to live.',
  'Has developed a taste for something very specific.',
  'Was summoned or bred for a purpose long since abandoned.',
  'Leaves the remains of prey arranged in unsettling patterns.',
  'Has outlived every attempt to hunt it down.',
  'Reacts to magic in ways that unnerve even seasoned casters.',
];

const GIANT_NAMES: NamePool = {
  given: ['Thromm', 'Borgakh', 'Gundrun', 'Kraggmar', 'Ovrenn', 'Dunmarr', 'Skalgrim', 'Hrolf', 'Bramgar', 'Voldrek'],
  epithets: ['the Boulder-Fist', 'the Sky-Reacher', 'the Earth-Shaker', 'the Frost-Bearded', 'the Storm-Caller', 'the Hollow-Toothed', 'the Herd-Breaker', 'the Mountain-Breaker', 'the Cloud-Strider'],
  domains: ['of the Ashpeak clan', 'of the Frosthold kin', 'of the Stormwatch brood', 'of the Cloudspire lineage'],
};
const GIANT_FLAVOR = [
  'Can crush a wagon underfoot without slowing its stride.',
  'Keeps a hoard buried somewhere only it remembers.',
  'Was cast out from its kin for a slight no one else recalls.',
  'Rules its stretch of land by simply being the biggest thing in it.',
  'Collects oddities from the smaller folk it has bested.',
  'Is smarter than most give it credit for.',
  'Has a temper that levels forests when provoked.',
  'Answers to an even larger chief somewhere further off.',
];

const DRAGON_NAMES: NamePool = {
  given: ['Vaelithrax', 'Zarnorion', 'Ixphyrra', 'Thalzurath', 'Morvantheus', 'Kethrandor', 'Nyssathra', 'Ombrezail', 'Cyraxis', 'Draumethis'],
  epithets: ['the World-Ender', 'the Ashen Sovereign', 'the Storm-Wyrm', 'the Gold-Hoarder', 'the Sky-Tyrant', 'the Ancient Terror', 'the Flame-Eternal', 'the Frost-Bound', 'the Venom-Scaled', 'the Undying'],
  domains: ['of the Charred Peaks', 'of the Sunken Hoard', 'of the Ashfall Wastes', 'of the Shattered Spire', 'of the Forgotten Reach'],
};
const DRAGON_FLAVOR = [
  'Has slept atop its hoard for longer than most kingdoms have existed.',
  'Is spoken of in local legend, usually in a hushed voice.',
  'Demands tribute from every settlement within sight of its lair.',
  'Bears scars from a rival dragon it never quite finished off.',
  'Collects one very specific kind of treasure above all else.',
  'Was once bound by an ancient pact it no longer honors.',
  'Its lair is said to be trapped as thoroughly as it is guarded.',
  'Has outlived every hero once sent to slay it.',
];

const FIEND_NAMES: NamePool = {
  given: ['Malphestor', 'Grazroth', 'Vhaelex', 'Ixodral', 'Baalcyre', 'Ozrathum', 'Sindrach', 'Krevoss'],
  epithets: ['the Pit-Spawned', 'the Soul-Broker', 'the Ash-Tongued', 'the Nine-Chained', 'the Wrath-Bound', 'the Hell-Marked', 'the Deceiver', 'the Torment-Weaver'],
  domains: ['of the Ninth Circle', 'of the Blood War legions', 'of the Abyssal Rift', 'of the Brimstone Court'],
};
const FIEND_FLAVOR = [
  'Was sent to collect on a bargain someone foolishly made.',
  'Answers to a master it would happily betray given the chance.',
  'Bears a mark that binds it to this plane, for now.',
  'Delights in twisting the letter of any deal it makes.',
  'Has corrupted more souls than it can be bothered to count.',
  'Was summoned by a cult that no longer controls it.',
  'Leaves a lingering smell of sulfur and old smoke.',
  'Is patient in a way only something immortal can afford to be.',
];

const ELEMENTAL_NAMES: NamePool = {
  given: ['Ashwhirl', 'Tidecaller', 'Stonemaw', 'Cinderveil', 'Galewrath', 'Mudheart', 'Emberdrift', 'Frostvein'],
  epithets: ['the Unbound', 'the Raging', 'the Ancient Current', 'the Wildfire', 'the Earthquake-Born', 'the Howling'],
};
const ELEMENTAL_FLAVOR = [
  'Was torn loose from its home plane and has raged ever since.',
  'Was bound here by a ritual its summoner barely survived.',
  'Grows stronger the closer it gets to its native element.',
  'Answers to nothing but the raw force that spawned it.',
  'Has been slowly reshaping the land around it.',
  'Was summoned to guard something and has forgotten what.',
];

const CONSTRUCT_DESIGNATIONS = ['Warden', 'Sentinel', 'Bastion', 'Custodian', 'Vigil', 'Ironward', 'Aegis', 'Keeper'];
const CONSTRUCT_FLAVOR = [
  'Was built to guard a place its makers abandoned long ago.',
  'Follows its last given order with unsettling precision.',
  "Bears the maker's mark of a guild that no longer exists.",
  'Has not needed maintenance in longer than anyone alive remembers.',
  'Reacts to intruders with mechanical, tireless patience.',
  "Was animated by a ritual its creator never wrote down.",
];
function constructName(rng: RNG): string {
  const base = pick(CONSTRUCT_DESIGNATIONS, rng);
  const styles: Array<() => string> = [
    () => `${base}-${between(1, 99, rng)}`,
    () => `${base} Mk. ${between(2, 9, rng)}`,
    () => `${base} Prime`,
    () => base,
  ];
  return pick(styles, rng)();
}

const OOZE_NAMES = new Set(['Gray Ooze', 'Gibbering Mouther', 'Gelatinous Cube', 'Ochre Jelly', 'Black Pudding', 'Otyugh']);
const OOZE_LABELS = ['The Crawling Stain', 'The Devouring Mass', 'The Silent Hunger', 'The Formless Terror', 'The Creeping Blight', 'The Nameless Spill'];
const OOZE_FLAVOR = [
  'Has slowly dissolved everything left in its path for years.',
  'Was likely something else, once, before whatever changed it.',
  'Leaves a trail that dissolves stone as easily as flesh.',
  'Cannot be reasoned with, only avoided.',
  'Has absorbed enough treasure to be worth the risk of killing it.',
  'Fills a space no one has cleared out in a very long time.',
];
const ABERRATION_NAMES: NamePool = {
  given: ['Xhalgreth', 'Vyrnoth', 'Qoreth', 'Sszaakth', 'Uvraleth', 'Nyxthul', 'Zhorkaan', 'Ithrivex'],
  epithets: ['the Mind-Render', 'the Depth-Watcher', 'the Unseen', 'the Whispering Dark', 'the Old One Below', 'the Star-Touched', 'the Reality-Warped'],
};
const ABERRATION_FLAVOR = [
  'Came from somewhere no map can point to.',
  'Speaks directly into the minds of those unlucky enough to find it.',
  'Has watched this stretch of dark for longer than history records.',
  'Its presence alone is enough to unravel a lesser mind.',
  'Was here long before whatever now lives above it.',
  'Answers to something even stranger than itself.',
];

const CELESTIAL_NAMES = new Set(['Couatl', 'Deva', 'Planetar', 'Solar']);
const CELESTIAL_NAME_POOL: NamePool = {
  given: ['Seraphiel', 'Auravel', 'Threnody', 'Ithariel', 'Zophriel', 'Malakiel'],
  epithets: ['the Radiant', 'the Unyielding Light', 'the Herald', 'the Dawnbringer', 'the Sworn Protector', 'the Voice Eternal'],
};
const CELESTIAL_FLAVOR = [
  "Was sent to answer a prayer someone has almost given up on.",
  'Serves a cause it will not abandon, whatever the cost.',
  'Bears a message it is waiting for the right moment to deliver.',
  'Watches over this place at the behest of a power far above it.',
  'Will not raise arms unless what it protects is truly threatened.',
  'Carries itself with a stillness that unnerves mortals nearby.',
];

const PLANT_NAMES = new Set(['Awakened Tree', 'Shambling Mound', 'Treant']);
const PLANT_NAME_POOL: NamePool = {
  given: ['Mossheart', 'Rootbind', 'Thornwood', 'Bramblecrown', 'Old Growth', 'Elder Bough'],
  epithets: ['the Grove-Keeper', 'the Slow Wrath', 'the Root-Bound', 'the Verdant Guardian', 'the Withering', 'the Deep-Rooted'],
};
const PLANT_FLAVOR = [
  'Has stood watch over this ground since long before living memory.',
  'Moves only when something threatens what it protects.',
  'Was once ordinary, before whatever woke it stirred.',
  'Grows stranger and larger with every passing season.',
  "Answers to the will of the forest more than any single voice.",
  'Its roots reach further than anyone has dared to trace.',
];

const FEY_NAME_POOL: NamePool = {
  given: ['Thistlewhisper', 'Moonbramble', 'Wrenfeather', 'Larkspur', 'Hollowbell', 'Fernwhistle', 'Briarsong', 'Duskwing'],
  epithets: ['the Trickster', 'the Moonlit', 'the Wildwood-Born', 'the Bargain-Maker', 'the Ever-Laughing', 'the Thornbound', 'the Riddle-Speaker'],
};
const FEY_FLAVOR = [
  'Trades in favors that always cost more than they seem to.',
  'Cannot lie outright, but rarely tells the whole truth either.',
  'Has lived in these woods since before they had a name.',
  'Finds mortal bargains endlessly, cruelly amusing.',
  'Marks its territory with rings no sensible traveler crosses.',
  'Remembers every slight and every kindness, forever.',
];

/**
 * Bio & Info / Character-tab flavor for a non-person monster bucket — the
 * same buckets used for naming above, so a dragon's age/height/alignment
 * reads as dragon-appropriate rather than the blank fields the library ships
 * with. Numbers are illustrative (the DM can always edit); non-humanoid
 * fields (hair on an ooze, eyes on a construct) get an honest substitute
 * ("none") rather than a fabricated human trait.
 */
interface MonsterBio {
  race: string;
  background: string;
  alignments: readonly string[];
  ages: readonly string[];
  heights: readonly string[];
  weights: readonly string[];
  eyes: readonly string[];
  hair: readonly string[];
  skin: readonly string[];
  ideals: readonly string[];
  bonds: readonly string[];
  flaws: readonly string[];
  languages: string;
}

const MONSTER_BIO: Record<string, MonsterBio> = {
  goblinoid: {
    race: 'Humanoid (goblinoid)', background: 'Clan warrior',
    alignments: ['Neutral Evil', 'Lawful Evil'],
    ages: ['Young adult', 'Battle-worn veteran', 'Grizzled elder'],
    heights: ['4\'0"', '4\'8"', '5\'6"', '6\'4"'], weights: ['35 lb', '95 lb', '180 lb', '280 lb'],
    eyes: ['beady yellow', 'bloodshot red', 'sickly green'],
    hair: ['patchy black', 'greasy and unkempt', 'none — scarred scalp'],
    skin: ['mottled green', 'sallow grey-green', 'scarred and leathery'],
    ideals: ['Strength decides everything worth deciding.', 'The tribe survives; nothing else matters.'],
    bonds: ['Answers to a chief it would not dare betray.', 'Owes its life to the warband that took it in.'],
    flaws: ['Picks fights it cannot win to prove a point.', 'Cannot resist looting even when it should flee.'],
    languages: 'Goblin, Common',
  },
  savageHumanoid: {
    race: 'Humanoid', background: 'Tribal hunter',
    alignments: ['Chaotic Evil', 'Neutral Evil'],
    ages: ['Young', 'Seasoned', 'Elder of the tribe'],
    heights: ['5\'0"', '5\'8"', '6\'2"'], weights: ['120 lb', '170 lb', '220 lb'],
    eyes: ['reptilian yellow', 'flat black', 'hungry amber'],
    hair: ['coarse and matted', 'ritually shaved', 'none'],
    skin: ['scaled green-grey', 'rough, hide-like', 'mottled brown'],
    ideals: ['Only the strong eat first.', 'The old ways are the only true ways.'],
    bonds: ['Would die defending its brood.', 'Serves a totem spirit it fears more than any foe.'],
    flaws: ['Frenzies at the smell of blood, allies or not.', 'Distrusts anything it cannot eat or fight.'],
    languages: 'A guttural tongue of its own kind',
  },
  undead: {
    race: 'Undead', background: 'Bound to unlife',
    alignments: ['Lawful Evil', 'Neutral Evil', 'Chaotic Evil'],
    ages: ['Centuries dead', 'Recently risen', 'Unknown — long since forgotten'],
    heights: ['5\'4"', '5\'10"', '6\'0"'], weights: ['Withered, lighter than in life', '130 lb', '160 lb'],
    eyes: ['hollow sockets', 'a faint cold light', 'milky white'],
    hair: ['brittle and grey', 'long since fallen out', 'matted with grave-dirt'],
    skin: ['grey, taut over bone', 'rotted and peeling', 'pale as bleached bone'],
    ideals: ['What was taken from me, I will reclaim.', 'The living owe the dead a debt they refuse to pay.'],
    bonds: ['Guards a grave it can no longer remember the meaning of.', 'Is bound by a curse someone else has long forgotten.'],
    flaws: ['Cannot leave the place it died.', 'Mistakes the living for people long gone.'],
    languages: 'None, or whatever it knew in life, if anything remains',
  },
  beast: {
    race: 'Beast', background: 'Wild predator',
    alignments: ['Unaligned'],
    ages: ['Young', 'Prime of its life', 'Old and scarred'],
    heights: ['Small for its kind', 'Typical size', 'Larger than most of its kind'],
    weights: ['Light', 'Average for its species', 'Heavier than typical'],
    eyes: ['alert amber', 'dark and watchful', 'sharp yellow'],
    hair: ['thick natural coat', 'short bristly fur', 'coarse and shaggy'],
    skin: ['fur-covered', 'hide-covered', 'scaled hide'],
    ideals: ['Survival, plain and simple.', 'Protect the pack/den above all.'],
    bonds: ['Fiercely protective of its young or pack.', 'Has claimed this territory and will not yield it.'],
    flaws: ['Attacks when cornered, no matter the odds.', 'Driven by hunger more than sense.'],
    languages: "None — beasts don't speak",
  },
  monstrosity: {
    race: 'Monstrosity', background: 'Twisted creation',
    alignments: ['Unaligned', 'Chaotic Evil'],
    ages: ['Unknown origin', 'Fully grown', 'Ancient specimen'],
    heights: ['Larger than a person', 'Hulking', 'Unnaturally proportioned'],
    weights: ['Several hundred pounds', 'Immense', 'Surprisingly light for its size'],
    eyes: ['multiple, unblinking', 'a single baleful eye', 'clouded and strange'],
    hair: ['coarse quills', 'matted fur in patches', 'none — chitinous plating'],
    skin: ['chitinous plating', 'scarred hide', 'mottled and warty'],
    ideals: ['Hunt, or be forgotten.', 'It was made for a purpose it no longer remembers.'],
    bonds: ['Lairs somewhere it will defend to the death.', 'Was bred or summoned for a task now abandoned.'],
    flaws: ['Reacts to threats with mindless violence.', 'Cannot resist a very specific kind of prey.'],
    languages: 'None, or an unintelligible tongue of its own',
  },
  giant: {
    race: 'Giant', background: 'Clan-raised',
    alignments: ['Chaotic Evil', 'Neutral Evil', 'Lawful Evil'],
    ages: ['Young by giant standards', 'Middle-aged', 'Ancient'],
    heights: ['9\'2"', '10\'6"', '11\'8"'], weights: ['1,800 lb', '2,200 lb', '2,600 lb'],
    eyes: ['deep-set and glowering', 'small for its size, dark', 'pale and cold'],
    hair: ['braided and filthy', 'wild and unkempt', 'none — bald scalp'],
    skin: ['weathered and ruddy', 'thick, callused hide', 'grey and stone-like'],
    ideals: ['Might makes right, always has.', 'The biggest thing in the room rules it.'],
    bonds: ['Answers to a chief it secretly means to challenge.', 'Guards a hoard buried somewhere only it remembers.'],
    flaws: ['A temper that levels whatever is nearby.', 'Underestimates anything smaller than itself.'],
    languages: 'Giant, Common',
  },
  dragon: {
    race: 'Dragon', background: 'Ancient hoarder',
    alignments: ['Chaotic Evil', 'Lawful Evil', 'Neutral Evil'],
    ages: ['Wyrmling', 'Young', 'Adult', 'Ancient'],
    heights: ['20 ft long', "40 ft long, wingtip to tail", '60 ft, a true terror of the skies'],
    weights: ['Several tons', 'Massive beyond reckoning', 'Heavier than a loaded warship'],
    eyes: ['slitted and gleaming', 'burning like embers', 'ancient and calculating'],
    hair: ['none — crowned in horns', 'none — a ridge of spines', 'none'],
    skin: ['gleaming scales', 'scarred, battle-worn scales', 'ancient, dulled scales'],
    ideals: ['Everything within sight belongs to me.', 'Only power and treasure are worth pursuing.'],
    bonds: ['Will burn a kingdom to reclaim a single stolen coin.', 'Was bound by an ancient pact it no longer honors.'],
    flaws: ['Vanity: cannot resist a challenge to its supremacy.', 'Obsessed with one very specific kind of treasure.'],
    languages: 'Draconic, Common',
  },
  fiend: {
    race: 'Fiend', background: 'Infernal servant',
    alignments: ['Lawful Evil', 'Chaotic Evil', 'Neutral Evil'],
    ages: ['Countless centuries old', 'Newly summoned', 'Ageless'],
    heights: ['6\'0", cloaked in dread', 'Towering and horned', 'Man-sized but clearly inhuman'],
    weights: ['Unnervingly light', 'Solid muscle and horn', 'About 200 lb'],
    eyes: ['burning red', 'pits of black', 'glowing coals'],
    hair: ['none — curling horns instead', 'singed and smoking', 'none'],
    skin: ['charred and cracked', 'deep crimson hide', 'ashen grey'],
    ideals: ['Every soul has a price; find it.', 'Suffering is simply how the universe works.'],
    bonds: ['Serves a master it would betray without hesitation.', 'Is bound here by a bargain someone foolish signed.'],
    flaws: ['Cannot resist twisting the letter of any deal.', 'Pride: will not admit when outmatched.'],
    languages: 'Infernal, Abyssal',
  },
  elemental: {
    race: 'Elemental', background: 'Elemental spirit',
    alignments: ['Unaligned'],
    ages: ['Ageless', 'Newly formed', 'Bound for centuries'],
    heights: ['Formless — shifts with its element', 'No fixed form'],
    weights: ['Formless — shifts with its element', 'No fixed form'],
    eyes: ['none — a churning core of its element', 'flickers where eyes might be'],
    hair: ['none', 'wisps of its element instead'],
    skin: ['living flame', 'churning water', 'shifting stone', 'swirling air'],
    ideals: ['Its native element must be free to rage.', 'Answers to nothing but the force that spawned it.'],
    bonds: ['Was torn from its home plane and rages to return.', 'Was summoned to guard something it has forgotten.'],
    flaws: ['Cannot be reasoned with, only outlasted.', 'Grows more violent the longer it is contained.'],
    languages: 'Primordial',
  },
  construct: {
    race: 'Construct', background: 'Constructed guardian',
    alignments: ['Unaligned'],
    ages: ['Unknown — does not age', 'Decades old', 'Freshly animated'],
    heights: ['6\'0", plated head to foot', 'Squat and reinforced', 'Towering, built for war'],
    weights: ['Several hundred pounds of metal and stone', 'Heavier than it looks', 'Surprisingly light despite its bulk'],
    eyes: ['none — glowing sensor slits', 'dark, dead lenses', 'a single rotating lens'],
    hair: ['none'], skin: ['pitted metal plating', 'stone, chipped with age', 'rune-etched plating'],
    ideals: ['Fulfill the last order given, forever if need be.', 'Purpose is the only thing that matters.'],
    bonds: ['Was built to guard a place its makers abandoned.', "Bears its maker's mark, though the maker is long gone."],
    flaws: ['Follows orders literally, even to disastrous ends.', 'Cannot recognize a situation its orders never covered.'],
    languages: "Understands its creator's language but cannot speak",
  },
  ooze: {
    race: 'Ooze', background: 'Mindless devourer',
    alignments: ['Unaligned'],
    ages: ['Ageless', 'Unknown'],
    heights: ['No fixed shape', 'Roughly man-height when reared up'],
    weights: ['Dense, wet mass', 'Heavier than its size suggests'],
    eyes: ['none'], hair: ['none'], skin: ['translucent, quivering mass', 'slick and corrosive', 'a churning acidic surface'],
    ideals: ['Consume.'],
    bonds: ['Fills a space nothing has cleared out in ages.'],
    flaws: ['Cannot be reasoned with, bargained with, or deterred.'],
    languages: "None — oozes don't speak",
  },
  aberration: {
    race: 'Aberration', background: 'Alien intruder',
    alignments: ['Chaotic Evil', 'Chaotic Neutral', 'Lawful Evil'],
    ages: ['Unfathomably old', 'Unknown', 'Recently arrived from elsewhere'],
    heights: ['Disturbingly asymmetrical', 'Larger than expected', 'Unsettlingly compact'],
    weights: ['Unknown — its mass seems to shift', 'Heavier than it should be'],
    eyes: ['too many to count', 'one vast, unblinking eye', 'clustered and alien'],
    hair: ['none — writhing tendrils instead', 'slick, hairless hide'],
    skin: ['rubbery and alien', 'pulsating and moist', 'covered in fine cilia'],
    ideals: ['Mortal concepts of morality do not apply to it.', 'Its unknowable purpose comes before anything else.'],
    bonds: ['Was here long before whatever now lives above it.', 'Answers to something even stranger than itself.'],
    flaws: ['Its presence alone unravels lesser minds — including allies.', 'Cannot comprehend why mortals fear it.'],
    languages: 'An alien tongue, if any at all',
  },
  celestial: {
    race: 'Celestial', background: 'Divine servant',
    alignments: ['Lawful Good', 'Neutral Good'],
    ages: ['Ageless', 'As old as its purpose'],
    heights: ['Tall and radiant', 'Towers with an unearthly presence'],
    weights: ['Seems to weigh nothing at all', 'Solid despite its glow'],
    eyes: ['glowing with soft light', 'ancient and kind', 'radiant gold'],
    hair: ['luminous and flowing', 'none — a halo of light instead'],
    skin: ['radiant, faintly glowing', 'unblemished and pale'],
    ideals: ['Serve the cause, whatever the cost.', 'Every soul deserves a chance at redemption.'],
    bonds: ['Carries a message it awaits the right moment to deliver.', 'Was sent to answer a prayer someone has nearly given up on.'],
    flaws: ['Will not act until its conditions for intervention are met.', 'Struggles to understand mortal weakness.'],
    languages: 'Celestial, Common',
  },
  plant: {
    race: 'Plant', background: 'Ancient growth',
    alignments: ['Unaligned', 'True Neutral'],
    ages: ['Older than the surrounding forest', 'Recently awakened', 'Ancient'],
    heights: ['Rooted and towering', 'Gnarled and ancient-looking'],
    weights: ['Heavy as old timber', 'Immense'],
    eyes: ['none — bark where eyes might be', 'deep knotholes that seem to watch'],
    hair: ['trailing moss and vines', 'none — bare branches instead'],
    skin: ['rough bark', 'mossy and damp', 'gnarled wood'],
    ideals: ['Protect the grove; nothing else matters.', 'Grow, endure, and outlast every intruder.'],
    bonds: ['Has stood watch over this ground since before living memory.', "Answers to the forest's will more than any single voice."],
    flaws: ['Moves and reacts far too slowly to negotiate with.', 'Cannot leave the ground it is rooted to.'],
    languages: 'None, or Sylvan if it once dwelt among the fey',
  },
  fey: {
    race: 'Fey', background: 'Fey trickster',
    alignments: ['Chaotic Neutral', 'Chaotic Good', 'True Neutral'],
    ages: ['Ageless', 'Older than it appears', 'Young by fey reckoning'],
    heights: ['Slight and quick', 'Taller than they first appear', 'Small enough to vanish in undergrowth'],
    weights: ['Lighter than they look', 'Impossible to guess'],
    eyes: ['unnervingly bright', 'shifting colors', 'catlike and gleaming'],
    hair: ['woven with leaves and blossoms', 'wild and colorful', 'braided with vines'],
    skin: ['dappled like sunlight through leaves', 'faintly luminous', 'smooth and unnervingly perfect'],
    ideals: ['A bargain is a bargain, however it was struck.', 'Mortal rules were never meant for fey folk.'],
    bonds: ['Has lived in these woods since before they had a name.', 'Owes (or is owed) a debt it will collect eventually.'],
    flaws: ['Cannot resist a clever wager.', 'Finds mortal suffering endlessly, cruelly amusing.'],
    languages: 'Sylvan, Common',
  },
};

interface CreatureProfile {
  nameFn: (rng: RNG) => string;
  flavor: readonly string[];
  bio: MonsterBio;
}
function poolProfile(pool: NamePool, flavor: readonly string[], bio: MonsterBio): CreatureProfile {
  return { nameFn: (rng) => buildCreatureName(pool, rng), flavor, bio };
}

/** Resolve the name pool + flavor lines + Bio&Info fields for a non-person 5e
 *  library entry, branching by sub-type for the categories that mix several
 *  creature flavors together (elementals vs constructs, oozes vs
 *  aberrations, fey vs celestials vs plants). */
function resolveCreatureProfile(entry: NpcEntry): CreatureProfile {
  switch (entry.category) {
    case 'Goblinoids & Orcs': return poolProfile(GOBLINOID_NAMES, GOBLINOID_FLAVOR, MONSTER_BIO.goblinoid);
    case 'Savage Humanoids': return poolProfile(SAVAGE_HUMANOID_NAMES, SAVAGE_HUMANOID_FLAVOR, MONSTER_BIO.savageHumanoid);
    case 'Undead': return poolProfile(UNDEAD_NAMES, UNDEAD_FLAVOR, MONSTER_BIO.undead);
    case 'Beasts': return poolProfile(BEAST_NAMES, BEAST_FLAVOR, MONSTER_BIO.beast);
    case 'Monstrosities': return poolProfile(MONSTROSITY_NAMES, MONSTROSITY_FLAVOR, MONSTER_BIO.monstrosity);
    case 'Giants & Ogres': return poolProfile(GIANT_NAMES, GIANT_FLAVOR, MONSTER_BIO.giant);
    case 'Dragons': return poolProfile(DRAGON_NAMES, DRAGON_FLAVOR, MONSTER_BIO.dragon);
    case 'Fiends': return poolProfile(FIEND_NAMES, FIEND_FLAVOR, MONSTER_BIO.fiend);
    case 'Elementals & Constructs':
      return entry.name.includes('Elemental')
        ? poolProfile(ELEMENTAL_NAMES, ELEMENTAL_FLAVOR, MONSTER_BIO.elemental)
        : { nameFn: constructName, flavor: CONSTRUCT_FLAVOR, bio: MONSTER_BIO.construct };
    case 'Aberrations & Oozes':
      return OOZE_NAMES.has(entry.name)
        ? { nameFn: (rng) => pick(OOZE_LABELS, rng), flavor: OOZE_FLAVOR, bio: MONSTER_BIO.ooze }
        : poolProfile(ABERRATION_NAMES, ABERRATION_FLAVOR, MONSTER_BIO.aberration);
    case 'Fey, Celestials & Plants':
      if (CELESTIAL_NAMES.has(entry.name)) return poolProfile(CELESTIAL_NAME_POOL, CELESTIAL_FLAVOR, MONSTER_BIO.celestial);
      if (PLANT_NAMES.has(entry.name)) return poolProfile(PLANT_NAME_POOL, PLANT_FLAVOR, MONSTER_BIO.plant);
      return poolProfile(FEY_NAME_POOL, FEY_FLAVOR, MONSTER_BIO.fey);
    default:
      return poolProfile(MONSTROSITY_NAMES, MONSTROSITY_FLAVOR, MONSTER_BIO.monstrosity);
  }
}

/**
 * Build a randomized NPC modeled after an existing compendium entry: stats
 * are jittered a little (HP, AC, ability scores/attack bonus), while a fresh
 * name and flavor text are generated appropriate to what the model actually
 * is — a townsfolk NPC reads like a person, a dragon reads like a monster,
 * a security bot reads like a machine — with each 5e monster category
 * (goblinoids, undead, dragons, fiends, ...) drawing on its own name/flavor
 * pool and mixing several structural name styles, not just "Given the Epithet".
 */
export function generateNpcFromModel(entry: NpcEntry, rng: RNG = Math.random): GeneratedNpc {
  const kind = npcKindForEntry(entry);
  const sheet: SheetData = structuredClone(entry.sheet);
  const priorNotes = typeof sheet.notes === 'string' ? sheet.notes : '';

  // HP/AC always exist on library sheets; ability scores only on 5e ones.
  const hp = jitter(Number(sheet.maxHp ?? sheet.hp ?? entry.hp), 0.15, rng, 1);
  sheet.hp = hp;
  sheet.maxHp = hp;
  // SWADE sheets have no manual AC (Parry is derived) or attack bonus, and
  // trait dice don't jitter — only the HP pool above varies for them.
  if (entry.system !== 'swade') {
    sheet.ac = jitter(Number(sheet.ac ?? entry.ac), 0.08, rng, 5);
  }
  if (entry.system === 'dnd5e') {
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      sheet[ab] = jitter(Number(sheet[ab] ?? 10), 0.1, rng, 1);
    }
  } else if (entry.system === 'swn') {
    sheet.attackBonus = jitter(Number(sheet.attackBonus ?? 0), 0.2, rng, 0);
  }

  let name: string;
  let notes: string;
  if (entry.system === 'dnd5e' && entry.category === 'People & NPCs') {
    ({ name, notes } = personFlavor(entry, rng));
    Object.assign(sheet, {
      race: pick(RACES_5E, rng), background: pick(BACKGROUNDS_5E, rng), alignment: pick(ALIGNMENTS, rng),
      ...personBioBits(rng),
      personalityTraits: notes,
      ideals: pick(IDEALS, rng), bonds: pick(BONDS, rng), flaws: pick(FLAWS, rng),
      proficienciesLanguages: `Common, ${pick(LANGUAGES, rng)}`,
    });
  } else if (entry.system === 'dnd5e') {
    const profile = resolveCreatureProfile(entry);
    name = profile.nameFn(rng);
    const flavorLine = pick(profile.flavor, rng);
    notes = `A ${entry.name.toLowerCase()} known as ${name}. ${flavorLine}`;
    const bio = profile.bio;
    Object.assign(sheet, {
      race: bio.race, background: bio.background, alignment: pick(bio.alignments, rng),
      age: pick(bio.ages, rng), height: pick(bio.heights, rng), weight: pick(bio.weights, rng),
      eyes: pick(bio.eyes, rng), hair: pick(bio.hair, rng), skin: pick(bio.skin, rng),
      personalityTraits: flavorLine,
      ideals: pick(bio.ideals, rng), bonds: pick(bio.bonds, rng), flaws: pick(bio.flaws, rng),
      proficienciesLanguages: bio.languages,
    });
  } else if (kind === 'robot') {
    const designation = `${pick(ROBOT_PREFIXES, rng)}-${between(100, 999, rng)}`;
    name = `Unit ${designation}`;
    notes = `A ${entry.name} chassis. ${pick(ROBOT_FLAVOR, rng)}`;
  } else if (kind === 'person') {
    ({ name, notes } = personFlavor(entry, rng));
  } else {
    name = `${pick(CREATURE_GIVEN, rng)} ${pick(CREATURE_EPITHET, rng)}`;
    notes = `A ${entry.name.toLowerCase()} known as ${name}. ${pick(CREATURE_FLAVOR, rng)}`;
  }
  sheet.notes = priorNotes ? `${notes} ${priorNotes}` : notes;
  if (entry.system === 'dnd5e') sheet.backstory = notes;
  else if (entry.system === 'swn') sheet.goal = notes;

  return { name, occupation: entry.category, tags: [kind, entry.category], sheet };
}
