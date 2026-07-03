// Randomized NPC generator: assembles a name, occupation, personality tags,
// and variable stats from predefined pools. Pure (injectable RNG).

import type { GameSystem, SheetData } from '../types.js';
import { systemFor } from '../systems/index.js';
import { RACES_5E } from '../systems/dnd5e.js';
import { BACKGROUNDS_SWN, SPECIES_SWN } from '../systems/swn.js';
import type { RNG } from '../dice/roller.js';

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
const SECRETS = [
  'is an informant', 'hides a magical heirloom', 'is not who they claim', 'knows a hidden passage',
  'is deep in debt', 'witnessed a crime', 'is searching for a lost sibling', 'fled a former life',
];

function pick<T>(arr: readonly T[], rng: RNG): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickSome<T>(arr: readonly T[], n: number, rng: RNG): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

/** 3d6-style score for variety (SWN attributes / 5e abilities). */
function roll3d6(rng: RNG): number {
  return 1 + Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6);
}

export interface GeneratedNpc {
  name: string;
  occupation: string;
  tags: string[];
  sheet: SheetData;
}

/** Build a fully-random NPC for the given system. */
export function generateNpc(system: GameSystem, rng: RNG = Math.random): GeneratedNpc {
  const name = `${pick(FIRST_NAMES, rng)} ${pick(SURNAMES, rng)}`;
  const personality = pickSome(PERSONALITY, 2, rng);
  const appearance = pick(APPEARANCE, rng);
  const quirk = pick(QUIRKS, rng);
  const secret = pick(SECRETS, rng);
  const sheet = systemFor(system).defaultSheet();

  if (system === 'dnd5e') {
    const occupation = pick(OCCUPATIONS_5E, rng);
    const scores = Array.from({ length: 6 }, () => 8 + Math.floor(rng() * 7)); // 8..14
    Object.assign(sheet, {
      class: occupation, race: pick(RACES_5E, rng), level: 1,
      str: scores[0], dex: scores[1], con: scores[2], int: scores[3], wis: scores[4], cha: scores[5],
      hp: 4 + Math.floor((scores[2] - 10) / 2), maxHp: 4 + Math.floor((scores[2] - 10) / 2),
      ac: 10, speed: 30,
      personalityTraits: `${personality.join(', ')}; has ${appearance}`,
      flaws: `Quirk: ${quirk}`,
      backstory: `Occupation: ${occupation}. Secret: ${secret}.`,
      notes: `Random NPC. Tags: ${personality.join(', ')}, ${quirk}.`,
    });
    const tags = [...personality, appearance, quirk];
    return { name, occupation, tags, sheet };
  }

  // SWN
  const occupation = pick(OCCUPATIONS_SWN, rng);
  Object.assign(sheet, {
    class: 'Expert', background: pick(BACKGROUNDS_SWN, rng), homeworld: 'Local',
    str: roll3d6(rng), dex: roll3d6(rng), con: roll3d6(rng), int: roll3d6(rng), wis: roll3d6(rng), cha: roll3d6(rng),
    level: 1, hp: 4, maxHp: 4, ac: 10, attackBonus: 0,
    species: pick(SPECIES_SWN, rng),
    goal: secret,
    notes: `Occupation: ${occupation}. ${personality.join(', ')}; has ${appearance}; ${quirk}.`,
  });
  const tags = [...personality, appearance, quirk];
  return { name, occupation, tags, sheet };
}
