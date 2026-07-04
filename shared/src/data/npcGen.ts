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

interface CreatureProfile {
  nameFn: (rng: RNG) => string;
  flavor: readonly string[];
}
function poolProfile(pool: NamePool, flavor: readonly string[]): CreatureProfile {
  return { nameFn: (rng) => buildCreatureName(pool, rng), flavor };
}

/** Resolve the name pool + flavor lines for a non-person 5e library entry,
 *  branching by sub-type for the categories that mix several creature
 *  flavors together (elementals vs constructs, oozes vs aberrations,
 *  fey vs celestials vs plants). */
function resolveCreatureProfile(entry: NpcEntry): CreatureProfile {
  switch (entry.category) {
    case 'Goblinoids & Orcs': return poolProfile(GOBLINOID_NAMES, GOBLINOID_FLAVOR);
    case 'Savage Humanoids': return poolProfile(SAVAGE_HUMANOID_NAMES, SAVAGE_HUMANOID_FLAVOR);
    case 'Undead': return poolProfile(UNDEAD_NAMES, UNDEAD_FLAVOR);
    case 'Beasts': return poolProfile(BEAST_NAMES, BEAST_FLAVOR);
    case 'Monstrosities': return poolProfile(MONSTROSITY_NAMES, MONSTROSITY_FLAVOR);
    case 'Giants & Ogres': return poolProfile(GIANT_NAMES, GIANT_FLAVOR);
    case 'Dragons': return poolProfile(DRAGON_NAMES, DRAGON_FLAVOR);
    case 'Fiends': return poolProfile(FIEND_NAMES, FIEND_FLAVOR);
    case 'Elementals & Constructs':
      return entry.name.includes('Elemental')
        ? poolProfile(ELEMENTAL_NAMES, ELEMENTAL_FLAVOR)
        : { nameFn: constructName, flavor: CONSTRUCT_FLAVOR };
    case 'Aberrations & Oozes':
      return OOZE_NAMES.has(entry.name)
        ? { nameFn: (rng) => pick(OOZE_LABELS, rng), flavor: OOZE_FLAVOR }
        : poolProfile(ABERRATION_NAMES, ABERRATION_FLAVOR);
    case 'Fey, Celestials & Plants':
      if (CELESTIAL_NAMES.has(entry.name)) return poolProfile(CELESTIAL_NAME_POOL, CELESTIAL_FLAVOR);
      if (PLANT_NAMES.has(entry.name)) return poolProfile(PLANT_NAME_POOL, PLANT_FLAVOR);
      return poolProfile(FEY_NAME_POOL, FEY_FLAVOR);
    default:
      return poolProfile(MONSTROSITY_NAMES, MONSTROSITY_FLAVOR);
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
  if (entry.system === 'dnd5e' && entry.category === 'People & NPCs') {
    ({ name, notes } = personFlavor(entry, rng));
  } else if (entry.system === 'dnd5e') {
    const profile = resolveCreatureProfile(entry);
    name = profile.nameFn(rng);
    notes = `A ${entry.name.toLowerCase()} known as ${name}. ${pick(profile.flavor, rng)}`;
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
  else sheet.goal = notes;

  return { name, occupation: entry.category, tags: [kind, entry.category], sheet };
}
