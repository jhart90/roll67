// SWADE guided character creation: pure data + pure assembly logic for the
// client's step-by-step wizard. Kept separate from swade.ts (the live sheet
// schema/derive logic) since this is a one-time build tool, not something
// derive() ever re-evaluates.
//
// Costs/effects below are a deliberately approximate, GM-adjustable model of
// the Adventure Edition's "Creating Races" point-buy and the Hindrance/Edge
// economy — not a verbatim transcription of the rulebook. Point values are
// reasonable analogues of the official building blocks; a table that wants
// exact-by-the-book pricing should treat this as a starting point and adjust
// by hand afterward (every value it produces lands on ordinary, editable
// sheet fields).

import type { SheetData } from '../types.js';
import { num } from './types.js';
import {
  ATTRIBUTES_SWADE, FREE_SKILLS_SWADE, SKILL_ATTR_SWADE, SKILLS_SWADE,
  TRAIT_DICE, dieStepIndex, stepDie, swade,
} from './swade.js';
import { DAMAGE_TYPES } from './effects.js';
import { CONTENT_SWADE } from '../data/contentSwade.js';

export type SwadeAttrId = 'agility' | 'smarts' | 'spirit' | 'strength' | 'vigor';

// ---------- Custom race (ancestry) point-buy ----------

export type CustomRaceTraitEffect =
  | { kind: 'attributeStep'; amount: number }
  | { kind: 'pace'; amount: number; runningDieSteps?: number; skill?: string; skillAmount?: number }
  | { kind: 'armor'; amount: number }
  | { kind: 'toughness'; amount: number }
  | { kind: 'parry'; amount: number }
  | { kind: 'size'; amount: number }
  | { kind: 'vision'; darkvision: number }
  | { kind: 'flight'; pace: number }
  | { kind: 'naturalWeapon'; damage: string; ap?: number }
  | { kind: 'skillStart'; die: string }
  | { kind: 'coreSkillLost' }
  | { kind: 'grantEdge' }
  | { kind: 'grantPower' }
  | { kind: 'construct' }
  | { kind: 'immunity' }
  | { kind: 'envResist' }
  | { kind: 'envWeak' }
  | { kind: 'resist' }
  | { kind: 'vulnerable' }
  | { kind: 'skillBonus'; skill: string; amount: number }
  | { kind: 'none' };

export interface CustomRaceTrait {
  id: string;
  name: string;
  /** Build points for the default (first) tier: positive costs, negative refunds. */
  cost: number;
  /** Which table this came from, for grouping in the builder. */
  category?: 'positive' | 'negative';
  /** How many times it may be taken; omitted means once. */
  maxTakes?: number | 'unlimited';
  /** Priced tiers, when the rulebook offers a choice of strength. */
  tiers?: RaceTraitTier[];
  /** This trait needs the player to name a skill. */
  needsSkillChoice?: boolean;
  /** …an environmental effect (heat, cold, radiation…). */
  needsEnvironmentChoice?: boolean;
  /** …an Edge. */
  needsEdgeChoice?: boolean;
  /** …a Hindrance. */
  needsHindranceChoice?: boolean;
  desc: string;
  effect: CustomRaceTraitEffect;
  /** This trait needs the player to pick an attribute (Attribute Increase/Reduced Attribute). */
  needsAttrChoice?: boolean;
  /** This trait needs the player to pick a damage type (Resistant/Vulnerable). */
  needsDamageTypeChoice?: boolean;
}

/** One purchasable step of a racial ability. Abilities the rulebook prices
 *  in tiers ("1 or 2 points", "2/3/4") expose one entry per tier. */
export interface RaceTraitTier {
  /** Build-point cost: positive for benefits, negative for drawbacks. */
  cost: number;
  /** Short label for the tier picker ("Pace 6", "Pace 12", "Pace 24"). */
  label: string;
  desc: string;
  effect: CustomRaceTraitEffect;
}

export const CUSTOM_RACE_TRAITS: CustomRaceTrait[] = [
  // ---------- positive ----------
  { id: 'adaptable', name: 'Adaptable', cost: 2, category: 'positive', effect: { kind: 'none' }, desc: 'Start with a free Novice Edge of your choice (you must still meet its Requirements).' },
  { id: 'additional-action', name: 'Additional Action', cost: 3, category: 'positive', effect: { kind: 'none' }, desc: 'Extra limbs or reflexes: ignore 2 points of Multi-Action penalties each turn.' },
  {
    id: 'aquatic', name: 'Aquatic / Semi-Aquatic', category: 'positive', cost: 1, effect: { kind: 'none' },
    desc: 'At home in the water.',
    tiers: [
      { cost: 1, label: 'Semi-Aquatic', desc: 'Holds its breath 15 minutes before checking for drowning.', effect: { kind: 'none' } },
      { cost: 2, label: 'Aquatic', desc: 'Native to water: cannot drown in oxygenated liquid and swims at full Pace.', effect: { kind: 'none' } },
    ],
  },
  { id: 'armor', name: 'Armor', cost: 1, category: 'positive', maxTakes: 3, effect: { kind: 'armor', amount: 2 }, desc: 'Thick hide, scales, or plating grant +2 Armor each time taken.' },
  { id: 'attribute-increase', name: 'Attribute Increase', cost: 2, category: 'positive', maxTakes: 'unlimited', needsAttrChoice: true, effect: { kind: 'attributeStep', amount: 1 }, desc: 'Raise one attribute a die type, raising its maximum too.' },
  { id: 'bite', name: 'Bite', cost: 1, category: 'positive', effect: { kind: 'naturalWeapon', damage: 'Str+d4' }, desc: 'Fangs that cause Strength+d4 damage.' },
  { id: 'burrowing', name: 'Burrowing', cost: 1, category: 'positive', effect: { kind: 'none' }, desc: 'Burrow through loose earth at half Pace; may surprise foes by surfacing beneath them.' },
  {
    id: 'claws', name: 'Claws', category: 'positive', cost: 2, effect: { kind: 'naturalWeapon', damage: 'Str+d4' },
    desc: 'Natural claws.',
    tiers: [
      { cost: 2, label: 'Claws', desc: 'Claws that cause Strength+d4 damage.', effect: { kind: 'naturalWeapon', damage: 'Str+d4' } },
      { cost: 3, label: 'Claws (d6)', desc: 'Claws that cause Strength+d6 damage.', effect: { kind: 'naturalWeapon', damage: 'Str+d6' } },
      { cost: 4, label: 'Claws (d6, AP 2)', desc: 'Strength+d6 damage with AP 2.', effect: { kind: 'naturalWeapon', damage: 'Str+d6', ap: 2 } },
    ],
  },
  { id: 'construct', name: 'Construct', cost: 8, category: 'positive', effect: { kind: 'construct' }, desc: '+2 to recover from Shaken, ignores one level of Wound modifiers, does not breathe, immune to disease and poison. Must be repaired rather than healed.' },
  { id: 'doesnt-breathe', name: 'Doesn’t Breathe', cost: 2, category: 'positive', effect: { kind: 'none' }, desc: 'Unaffected by inhaled toxins, cannot drown, and can survive vacuum.' },
  { id: 'edge', name: 'Edge', cost: 2, category: 'positive', maxTakes: 'unlimited', needsEdgeChoice: true, effect: { kind: 'grantEdge' }, desc: 'An innate Edge, ignoring its Requirements except other Edges. Higher-Rank Edges cost more.' },
  { id: 'environmental-resistance', name: 'Environmental Resistance', cost: 1, category: 'positive', maxTakes: 'unlimited', needsEnvironmentChoice: true, effect: { kind: 'envResist' }, desc: '+4 to resist one environmental effect, and 4 less damage from it.' },
  {
    id: 'flight', name: 'Flight', category: 'positive', cost: 2, effect: { kind: 'flight', pace: 6 },
    desc: 'The species can fly.',
    tiers: [
      { cost: 2, label: 'Fly Pace 6', desc: 'Flies at Pace 6 and may “run” for extra movement.', effect: { kind: 'flight', pace: 6 } },
      { cost: 4, label: 'Fly Pace 12', desc: 'Flies at Pace 12 and may “run” for extra movement.', effect: { kind: 'flight', pace: 12 } },
      { cost: 6, label: 'Fly Pace 24', desc: 'Flies at Pace 24 and may “run” for 2d6 additional movement.', effect: { kind: 'flight', pace: 24 } },
    ],
  },
  { id: 'hardy', name: 'Hardy', cost: 2, category: 'positive', effect: { kind: 'none' }, desc: 'A second Shaken result in combat does not cause a Wound.' },
  {
    id: 'horns', name: 'Horns', category: 'positive', cost: 1, effect: { kind: 'naturalWeapon', damage: 'Str+d4' },
    desc: 'A horn or horns.',
    tiers: [
      { cost: 1, label: 'Horns (d4)', desc: 'Horns that cause Strength+d4 damage.', effect: { kind: 'naturalWeapon', damage: 'Str+d4' } },
      { cost: 2, label: 'Horns (d6)', desc: 'Horns that cause Strength+d6 damage.', effect: { kind: 'naturalWeapon', damage: 'Str+d6' } },
    ],
  },
  { id: 'immune-poison-disease', name: 'Immune to Poison or Disease', cost: 1, category: 'positive', maxTakes: 2, effect: { kind: 'immunity' }, desc: 'Immune to poison or to disease (your choice). Take it twice for both.' },
  { id: 'infravision', name: 'Infravision', cost: 1, category: 'positive', effect: { kind: 'vision', darkvision: 24 }, desc: 'Sees heat, halving Illumination penalties against warm targets (even invisible ones).' },
  { id: 'leaper', name: 'Leaper', cost: 2, category: 'positive', effect: { kind: 'none' }, desc: 'Jumps twice as far, and adds +4 damage when leaping as part of a Wild Attack instead of +2.' },
  { id: 'low-light-vision', name: 'Low Light Vision', cost: 1, category: 'positive', effect: { kind: 'vision', darkvision: 12 }, desc: 'Ignores penalties for Dim and Dark illumination (but not Pitch Darkness).' },
  { id: 'no-vital-organs', name: 'No Vital Organs', cost: 1, category: 'positive', effect: { kind: 'none' }, desc: 'Hidden or redundant vital organs: Called Shots do no extra damage.' },
  { id: 'pace', name: 'Pace', cost: 2, category: 'positive', effect: { kind: 'pace', amount: 2, runningDieSteps: 1 }, desc: '+2 Pace and a die type to the running die.' },
  { id: 'parry', name: 'Parry', cost: 1, category: 'positive', maxTakes: 3, effect: { kind: 'parry', amount: 1 }, desc: '+1 natural Parry each time taken — a prehensile tail, extra limbs, or latent psi-sense.' },
  {
    id: 'poisonous-touch', name: 'Poisonous Touch', category: 'positive', cost: 1, effect: { kind: 'none' },
    desc: 'A venomous touch, bite, or claw.',
    tiers: [
      { cost: 1, label: 'Mild Poison', desc: 'On a successful Touch Attack the victim rolls Vigor or suffers Mild Poison.', effect: { kind: 'none' } },
      { cost: 3, label: 'Lethal Poison', desc: 'As above, but the poison may Knockout, Paralyze, or kill. Costs the user Fatigue.', effect: { kind: 'none' } },
    ],
  },
  {
    id: 'power', name: 'Power', category: 'positive', cost: 2, maxTakes: 'unlimited', effect: { kind: 'grantPower' },
    desc: 'An innate ability that works like a power.',
    tiers: [
      { cost: 2, label: 'First power', desc: 'Grants Arcane Background (Gifted) and one power. Does not add Power Points.', effect: { kind: 'grantPower' } },
      { cost: 1, label: 'Additional power', desc: 'Each power after the first costs 1 point.', effect: { kind: 'grantPower' } },
    ],
  },
  { id: 'reach', name: 'Reach', cost: 1, category: 'positive', maxTakes: 3, effect: { kind: 'none' }, desc: 'Long limbs or tentacles grant Reach +1 (and +1 more each further time).' },
  {
    id: 'regeneration', name: 'Regeneration', category: 'positive', cost: 2, effect: { kind: 'none' },
    desc: 'The being heals unnaturally fast.',
    tiers: [
      { cost: 2, label: 'Fast healing', desc: 'Makes a natural healing roll once per day rather than every five.', effect: { kind: 'none' } },
      { cost: 3, label: 'Regrows injuries', desc: 'As above, and permanent injuries can be recovered once all other Wounds are healed.', effect: { kind: 'none' } },
    ],
  },
  { id: 'size-plus', name: 'Size +1', cost: 1, category: 'positive', maxTakes: 3, effect: { kind: 'size', amount: 1 }, desc: 'Larger than normal: each point adds +1 Toughness and raises maximum Strength a step.' },
  {
    id: 'skill', name: 'Skill', category: 'positive', cost: 1, maxTakes: 'unlimited', needsSkillChoice: true, effect: { kind: 'skillStart', die: 'd4' },
    desc: 'A skill inherent to the race.',
    tiers: [
      { cost: 1, label: 'Starts at d4', desc: 'The character begins with a d4 in a skill inherent to her race.', effect: { kind: 'skillStart', die: 'd4' } },
      { cost: 2, label: 'Starts at d6, max d12+1', desc: 'The skill starts at d6 and its maximum increases to d12+1.', effect: { kind: 'skillStart', die: 'd6' } },
    ],
  },
  { id: 'skill-bonus', name: 'Skill Bonus', cost: 2, category: 'positive', maxTakes: 'unlimited', needsSkillChoice: true, effect: { kind: 'skillBonus', skill: '', amount: 2 }, desc: '+2 when using a particular skill (once per skill).' },
  { id: 'sleep-reduction', name: 'Sleep Reduction', cost: 1, category: 'positive', maxTakes: 2, effect: { kind: 'none' }, desc: 'Needs half the sleep a human does. Taken twice, the being never sleeps.' },
  { id: 'toughness', name: 'Toughness', cost: 1, category: 'positive', maxTakes: 3, effect: { kind: 'toughness', amount: 1 }, desc: 'Hardened skin or dense tissue: +1 Toughness each time taken.' },
  { id: 'wall-walker', name: 'Wall Walker', cost: 1, category: 'positive', effect: { kind: 'none' }, desc: 'Walks vertical surfaces normally, and inverted surfaces at half Pace.' },

  // ---------- negative ----------
  {
    id: 'attribute-penalty', name: 'Attribute Penalty', category: 'negative', cost: -2, maxTakes: 'unlimited', needsAttrChoice: true,
    effect: { kind: 'attributeStep', amount: -1 },
    desc: 'One attribute (but not its linked skills) is reduced.',
    tiers: [
      { cost: -2, label: '−1 die type', desc: 'One attribute drops a die type.', effect: { kind: 'attributeStep', amount: -1 } },
      { cost: -3, label: '−2 die types', desc: 'One attribute drops two die types.', effect: { kind: 'attributeStep', amount: -2 } },
    ],
  },
  { id: 'big', name: 'Big', cost: -2, category: 'negative', effect: { kind: 'none' }, desc: 'Too large for common equipment: −2 with gear not made for the race, and clothing, food, and armor cost double.' },
  { id: 'cannot-speak', name: 'Cannot Speak', cost: -1, category: 'negative', effect: { kind: 'none' }, desc: 'No vocal cords: communicates naturally only with its own kind.' },
  { id: 'dependency', name: 'Dependency', cost: -2, category: 'negative', needsEnvironmentChoice: true, effect: { kind: 'none' }, desc: 'Must spend an hour a day in contact with a substance or grow Fatigued daily until Incapacitated.' },
  { id: 'environmental-weakness', name: 'Environmental Weakness', cost: -1, category: 'negative', maxTakes: 'unlimited', needsEnvironmentChoice: true, effect: { kind: 'envWeak' }, desc: '−4 to resist one environmental effect, and +4 damage from it.' },
  { id: 'frail', name: 'Frail', cost: -1, category: 'negative', maxTakes: 2, effect: { kind: 'toughness', amount: -1 }, desc: '−1 Toughness.' },
  {
    id: 'hindrance', name: 'Hindrance', category: 'negative', cost: -1, maxTakes: 'unlimited', needsHindranceChoice: true, effect: { kind: 'none' },
    desc: 'The race carries an inherent Hindrance.',
    tiers: [
      { cost: -1, label: 'Minor', desc: 'An inherent Minor Hindrance.', effect: { kind: 'none' } },
      { cost: -2, label: 'Major', desc: 'An inherent Major Hindrance.', effect: { kind: 'none' } },
    ],
  },
  { id: 'poor-parry', name: 'Poor Parry', cost: -1, category: 'negative', maxTakes: 3, effect: { kind: 'parry', amount: -1 }, desc: 'A poor melee defender: −1 Parry each time taken.' },
  { id: 'racial-enemy', name: 'Racial Enemy', cost: -1, category: 'negative', maxTakes: 'unlimited', effect: { kind: 'none' }, desc: '−2 Persuasion when dealing with a rival species, who may turn hostile easily.' },
  { id: 'reduced-core-skills', name: 'Reduced Core Skills', cost: -1, category: 'negative', maxTakes: 5, needsSkillChoice: true, effect: { kind: 'coreSkillLost' }, desc: 'One core skill does not start at d4 (it can still be bought normally).' },
  {
    id: 'reduced-pace', name: 'Reduced Pace', category: 'negative', cost: -1, effect: { kind: 'pace', amount: -1, runningDieSteps: -1 },
    desc: 'Slower than most.',
    tiers: [
      { cost: -1, label: '−1 Pace', desc: '−1 Pace and the running die drops a type.', effect: { kind: 'pace', amount: -1, runningDieSteps: -1 } },
      { cost: -2, label: '−3 Pace, −2 Athletics', desc: 'Pace drops another 2 points, and −2 to Athletics where mobility matters.', effect: { kind: 'pace', amount: -3, runningDieSteps: -1, skill: 'Athletics', skillAmount: -2 } },
    ],
  },
  { id: 'size-minus', name: 'Size −1', cost: -1, category: 'negative', effect: { kind: 'size', amount: -1 }, desc: 'Smaller than average: Size and Toughness drop by 1.' },
  {
    id: 'skill-penalty', name: 'Skill Penalty', category: 'negative', cost: -1, maxTakes: 'unlimited', needsSkillChoice: true,
    effect: { kind: 'skillBonus', skill: '', amount: -1 },
    desc: 'The race is poor at a particular skill.',
    tiers: [
      { cost: -1, label: '−1 (common skill)', desc: '−1 to a commonly used skill.', effect: { kind: 'skillBonus', skill: '', amount: -1 } },
      { cost: -2, label: '−2 (common skill)', desc: '−2 to a commonly used skill.', effect: { kind: 'skillBonus', skill: '', amount: -2 } },
    ],
  },
];

export const CUSTOM_RACE_TRAITS_BY_ID = new Map(CUSTOM_RACE_TRAITS.map((t) => [t.id, t]));

/** The recommended build budget: spend up to this many net points on
 *  benefits; every point past it must come from an equal-or-greater
 *  drawback (a negative-cost trait) elsewhere in the build. */
export const CUSTOM_RACE_POINT_CAP = 2;
/** Soft floor — stacking drawbacks past this is unusual even for a heavily
 *  flawed race and probably wants a GM's sign-off. */
export const CUSTOM_RACE_POINT_FLOOR = -4;

/** One racial ability the player has actually taken, at a chosen tier and
 *  with whatever the ability asks them to name. */
export interface RaceTraitPick {
  traitId: string;
  /** Index into the trait's `tiers`, or 0 when it has none. */
  tier?: number;
  /** Attribute id / skill name / damage type / environment / Edge / Hindrance. */
  choice?: string;
}

/** The tier a pick resolves to (falls back to the trait's own cost/effect). */
export function pickTier(trait: CustomRaceTrait, tier = 0): RaceTraitTier {
  if (trait.tiers && trait.tiers[tier]) return trait.tiers[tier];
  return { cost: trait.cost, label: trait.name, desc: trait.desc, effect: trait.effect };
}

export function raceTraitPickCost(pick: RaceTraitPick): number {
  const trait = CUSTOM_RACE_TRAITS_BY_ID.get(pick.traitId);
  return trait ? pickTier(trait, pick.tier ?? 0).cost : 0;
}

/** How many times a trait may be taken (1 unless stated otherwise). */
export function maxTakesOf(trait: CustomRaceTrait): number {
  if (trait.maxTakes === 'unlimited') return Number.POSITIVE_INFINITY;
  return trait.maxTakes ?? 1;
}

export function raceTraitPointTotal(picks: RaceTraitPick[]): number {
  return picks.reduce((sum, p) => sum + raceTraitPickCost(p), 0);
}

/** Environmental effects the Resistance/Weakness/Dependency abilities name. */
export const RACE_ENVIRONMENTS = [
  'Heat', 'Cold', 'Lack of air', 'Radiation', 'Pressure', 'Sunlight', 'Water', 'Toxins', 'Disease', 'Magic',
];

export const RESISTIBLE_DAMAGE_TYPES = DAMAGE_TYPES;

// ---------- Attribute point-buy (5 points, d4 baseline) ----------

export const ATTRIBUTE_POINTS = 5;

export function attributePointsSpent(steps: Record<string, number>): number {
  return ATTRIBUTES_SWADE.reduce((sum, a) => sum + Math.max(0, steps[a.id] ?? 0), 0);
}

// ---------- Skill point-buy (12 points) ----------

export const SKILL_POINTS = 12;

/** Points needed to raise one skill from its free/untrained baseline up to
 *  (and including) `targetIdx` (a TRAIT_DICE index, 0=d4..4=d12) — steps at
 *  or below the linked attribute's die cost 1 each, steps above cost 2. */
export function skillPointCost(skillName: string, targetIdx: number, linkedAttrDie: string): number {
  const startIdx = FREE_SKILLS_SWADE.includes(skillName) ? 0 : -1;
  if (targetIdx <= startIdx) return 0;
  const linkedIdx = Math.max(0, dieStepIndex(linkedAttrDie));
  let cost = 0;
  for (let i = startIdx + 1; i <= targetIdx; i++) cost += i <= linkedIdx ? 1 : 2;
  return cost;
}

/** Total skill points spent across every chosen skill die, given the
 *  character's final (post-race-trait) attribute dice. */
export function totalSkillPointsSpent(skillDice: Record<string, string>, attrs: Record<string, string>): number {
  return Object.entries(skillDice).reduce((sum, [name, die]) => {
    const idx = dieStepIndex(die);
    if (idx < 0) return sum;
    const linked = SKILL_ATTR_SWADE[name] ?? 'smarts';
    return sum + skillPointCost(name, idx, attrs[linked] ?? 'd4');
  }, 0);
}

// ---------- Hindrances ----------

export interface HindranceOption {
  id: string;
  name: string;
  severity: 'Minor' | 'Major';
  desc: string;
}

export const CURATED_HINDRANCES_SWADE: HindranceOption[] = [
  { id: 'bad-eyes', name: 'Bad Eyes', severity: 'Minor', desc: '−2 Notice involving sight without corrective lenses.' },
  { id: 'clueless', name: 'Clueless', severity: 'Minor', desc: '−2 to untrained Common Knowledge rolls.' },
  { id: 'curious', name: 'Curious', severity: 'Minor', desc: 'Compelled to investigate the unknown.' },
  { id: 'loyal', name: 'Loyal', severity: 'Minor', desc: 'Will not abandon friends or allies.' },
  { id: 'cautious', name: 'Cautious', severity: 'Minor', desc: 'Reluctant to act without a plan.' },
  { id: 'ugly', name: 'Ugly', severity: 'Minor', desc: '−2 Persuasion; +2 Intimidation.' },
  { id: 'illiterate', name: 'Illiterate', severity: 'Minor', desc: 'Cannot read or write.' },
  { id: 'quirk', name: 'Quirk', severity: 'Minor', desc: 'A distinctive personality trait or mannerism.' },
  { id: 'bad-luck', name: 'Bad Luck', severity: 'Major', desc: 'One less Benny at the start of every session.' },
  { id: 'greedy', name: 'Greedy', severity: 'Major', desc: 'Never satisfied with a fair share.' },
  { id: 'vengeful', name: 'Vengeful', severity: 'Major', desc: 'Never forgets a wrong; seeks payback.' },
  { id: 'wanted', name: 'Wanted', severity: 'Major', desc: 'Sought by the law or a powerful enemy.' },
  { id: 'death-wish', name: 'Death Wish', severity: 'Major', desc: 'Driven by a single overriding goal.' },
  { id: 'heroic', name: 'Heroic', severity: 'Major', desc: 'Compelled to help those in need, regardless of risk.' },
];

/** Standard build cap: up to two Minor Hindrances and one Major. Each Minor
 *  is worth 1 point, each Major 2 — max 4 points earned to spend below. */
export const MAX_MINOR_HINDRANCES = 2;
export const MAX_MAJOR_HINDRANCES = 1;

export function hindrancePoints(chosen: Array<{ severity: 'Minor' | 'Major' }>): number {
  return chosen.reduce((sum, h) => sum + (h.severity === 'Major' ? 2 : 1), 0);
}

// ---------- Edges ----------

export interface EdgeOption {
  id: string;
  name: string;
  desc: string;
  /** Hindrance points this Edge costs when bought at creation (0 = free/racial). */
  cost: number;
}

export const CURATED_EDGES_SWADE: EdgeOption[] = [
  { id: 'alertness', name: 'Alertness', desc: '+2 to Notice rolls.', cost: 2 },
  { id: 'brawny', name: 'Brawny', desc: '+1 Toughness; can carry more before being encumbered.', cost: 2 },
  { id: 'fleet-footed', name: 'Fleet-Footed', desc: '+2 Pace; d10 running die.', cost: 2 },
  { id: 'luck', name: 'Luck', desc: 'Draw an extra Benny each session.', cost: 2 },
  { id: 'rich', name: 'Rich', desc: '+$1,000 starting funds.', cost: 2 },
  { id: 'linguist', name: 'Linguist', desc: 'Fluent in an extra language per point of Smarts.', cost: 2 },
  { id: 'strong-willed', name: 'Strong Willed', desc: '+2 to resist Intimidation and Taunt.', cost: 2 },
  { id: 'woodsman', name: 'Woodsman', desc: '+2 Survival and Stealth in the wilderness.', cost: 2 },
];
export const CURATED_EDGES_BY_ID = new Map(CURATED_EDGES_SWADE.map((e) => [e.id, e]));

/** Humans get this signature Edge for free — never counted against earned
 *  hindrance points. */
export const HUMAN_FREE_EDGE: EdgeOption = {
  id: 'adaptable', name: 'Adaptable', desc: 'Once per session, may re-roll a single Trait roll.', cost: 0,
};

// ---------- Final assembly ----------

export interface SwadeCreationInput {
  concept: string;
  ancestryName: string;
  ancestryIsCustom: boolean;
  /** Only when ancestryIsCustom — the chosen trait ids and, for traits that
   *  need one, the picked attribute id or damage type. */
  customTraitPicks: RaceTraitPick[];
  /**
   * FINAL point-buy steps (0-4) for each attribute, before any racial
   * attribute-step traits — this already includes any extra steps bought
   * with earned Hindrance points; the wizard tracks the combined budget
   * (5 base + Hindrance-bought), the assembler only needs the total.
   */
  attributeSteps: Record<SwadeAttrId, number>;
  /**
   * FINAL chosen die for every skill the player invested points in (again
   * already including any Hindrance-bought bonus skill points) — skills
   * left out stay at their free d4 (if in FREE_SKILLS_SWADE) or untrained.
   */
  skillDice: Record<string, string>;
  hindranceIds: string[];
  /** Hindrance points spent on starting funds (each unit = +$500). Funds are
   *  the only Hindrance-point sink the assembler needs to know about — the
   *  others (skill points, attribute steps, Edges) already flow through
   *  skillDice/attributeSteps/edgeIds above. */
  hindranceFundsSpent: number;
  edgeIds: string[];
}

function attrLabelToId(label: string): SwadeAttrId {
  return label.toLowerCase() as SwadeAttrId;
}

/**
 * The live modifier columns for an Edge or Hindrance, looked up by name in
 * the compendium — the single source of truth for what a trait actually
 * does. Traits with no mechanical hook return all zeroes, which is still
 * the right shape for the sheet's list columns.
 */
function traitModsFor(name: string): SheetData {
  const entry = CONTENT_SWADE.find(
    (e) => (e.kind === 'edge' || e.kind === 'hindrance') && e.name.toLowerCase() === name.toLowerCase(),
  );
  const t = entry?.trait;
  return {
    bonusSkill: t?.bonusSkill ?? '',
    bonusAmt: t?.bonusAmt ?? 0,
    parryBonus: t?.parryBonus ?? 0,
    toughnessBonus: t?.toughnessBonus ?? 0,
    paceBonus: t?.paceBonus ?? 0,
  };
}

/** Point-buy attribute dice before any racial trait adjustments: d4 baseline
 *  plus `steps[attr]` die-steps each (0-4). */
export function baseAttributeDice(steps: Record<SwadeAttrId, number>): Record<SwadeAttrId, string> {
  const attrs: Record<SwadeAttrId, string> = { agility: 'd4', smarts: 'd4', spirit: 'd4', strength: 'd4', vigor: 'd4' };
  for (const a of ATTRIBUTES_SWADE) {
    const id = attrLabelToId(a.id);
    attrs[id] = stepDie('d4', Math.max(0, steps[id] ?? 0));
  }
  return attrs;
}

/** "Str+d4" with the character's real Strength die folded in, so a natural
 *  weapon arrives as a rollable attack rather than a formula to interpret. */
function naturalWeaponDamage(formula: string, strengthDie: string): string {
  const bonus = /d(\d+)/.exec(formula)?.[0] ?? 'd4';
  return `1${strengthDie}!+1${bonus}!`;
}

/** Apply every selected custom-race trait's attributeStep effect (Attribute
 *  Increase / Reduced Attribute) on top of a base attribute set. */
export function applyCustomRaceAttributeSteps(
  attrs: Record<SwadeAttrId, string>, picks: RaceTraitPick[],
): Record<SwadeAttrId, string> {
  const out = { ...attrs };
  for (const pick of picks) {
    const trait = CUSTOM_RACE_TRAITS_BY_ID.get(pick.traitId);
    if (!trait) continue;
    const effect = pickTier(trait, pick.tier ?? 0).effect;
    if (effect.kind === 'attributeStep') {
      const attrId = (pick.choice as SwadeAttrId) ?? 'agility';
      out[attrId] = stepDie(out[attrId], effect.amount);
    }
  }
  return out;
}

/**
 * The final attribute dice a build will actually end up with: point-buy
 * steps, then (for a custom ancestry) its attribute-step traits — the same
 * function the wizard uses to preview costs live and buildSwadeCharacterSheet
 * uses to assemble the real sheet, so the two can never disagree.
 */
export function finalAttributeDice(
  steps: Record<SwadeAttrId, number>, ancestryIsCustom: boolean, picks: RaceTraitPick[],
): Record<SwadeAttrId, string> {
  const base = baseAttributeDice(steps);
  return ancestryIsCustom ? applyCustomRaceAttributeSteps(base, picks) : base;
}

/** Build a complete SWADE sheet patch from a finished wizard run. Pure and
 *  deterministic — the wizard validates budgets client-side; this function
 *  just assembles whatever it's handed. */
export function buildSwadeCharacterSheet(input: SwadeCreationInput): SheetData {
  const sheet = swade.defaultSheet();
  sheet.concept = input.concept.trim();
  sheet.wildCard = true;
  sheet.rank = 'Novice';

  const attrs = finalAttributeDice(input.attributeSteps, input.ancestryIsCustom, input.customTraitPicks);

  let pace = 6;
  let runningDieSteps = 0;
  const armorRows: SheetData[] = [];
  const inventoryRows: SheetData[] = [];
  let darkvisionBonus = 0;
  const resistTypes: string[] = [];
  const vulnerableTypes: string[] = [];
  const ancestryTraitNotes: string[] = [];
  // Racial abilities are first-class traits on the sheet, carrying the same
  // live modifier columns as Edges — never disguised as gear or armor rows.
  const racialTraitRows: SheetData[] = [];
  const extraAttackRows: SheetData[] = [];
  const extraSkillRows: SheetData[] = [];
  const lostCoreSkills = new Set<string>();

  if (input.ancestryIsCustom) {
    for (const pick of input.customTraitPicks) {
      const trait = CUSTOM_RACE_TRAITS_BY_ID.get(pick.traitId);
      if (!trait) continue;
      const tier = pickTier(trait, pick.tier ?? 0);
      const effect = tier.effect;
      const choice = pick.choice;
      const label = `${trait.name}${trait.tiers ? ` — ${tier.label}` : ''}${choice ? ` (${choice})` : ''}`;
      ancestryTraitNotes.push(label);

      const row: SheetData = {
        name: label, bonusSkill: '', bonusAmt: 0,
        parryBonus: 0, toughnessBonus: 0, paceBonus: 0, notes: tier.desc,
      };

      switch (effect.kind) {
        case 'attributeStep':
          break; // already folded into `attrs` via finalAttributeDice above
        case 'pace':
          pace += effect.amount;
          runningDieSteps += effect.runningDieSteps ?? 0;
          if (effect.skill) { row.bonusSkill = effect.skill; row.bonusAmt = effect.skillAmount ?? 0; }
          break;
        case 'armor':
        case 'toughness':
        case 'size':
          // Natural armor, hardened tissue, and Size all land on Toughness.
          row.toughnessBonus = effect.amount;
          break;
        case 'parry':
          row.parryBonus = effect.amount;
          break;
        case 'vision':
          darkvisionBonus = Math.max(darkvisionBonus, effect.darkvision);
          break;
        case 'flight':
          row.notes = `${tier.desc} Flying Pace ${effect.pace}.`;
          break;
        case 'naturalWeapon':
          extraAttackRows.push({
            name: trait.name, skill: 'Fighting', damage: naturalWeaponDamage(effect.damage, attrs.strength),
            dtype: '', range: 5, ap: effect.ap ?? 0, parryBonus: 0, wielded: false, notes: 'Natural weapon',
          });
          break;
        case 'skillStart':
          if (choice) extraSkillRows.push({ name: choice, die: effect.die, notes: 'Racial' });
          break;
        case 'coreSkillLost':
          if (choice) lostCoreSkills.add(choice);
          break;
        case 'skillBonus':
          if (choice) { row.bonusSkill = choice; row.bonusAmt = effect.amount; }
          break;
        case 'envResist':
          if (choice) row.notes = `+4 to resist ${choice}, and 4 less damage from it.`;
          break;
        case 'envWeak':
          if (choice) row.notes = `−4 to resist ${choice}, and +4 damage from it.`;
          break;
        case 'immunity':
        case 'construct':
          if (choice) resistTypes.push(choice);
          break;
        case 'resist':
          if (choice) resistTypes.push(choice);
          break;
        case 'vulnerable':
          if (choice) vulnerableTypes.push(choice);
          break;
        case 'grantEdge':
        case 'grantPower':
        case 'none':
        default:
          break;
      }
      racialTraitRows.push(row);
    }
  }

  sheet.ancestry = input.ancestryIsCustom ? (input.ancestryName.trim() || 'Custom Ancestry') : input.ancestryName;
  Object.assign(sheet, attrs);
  sheet.pace = Math.max(1, pace);
  sheet.runningDie = stepDie('d6', runningDieSteps);
  sheet.visionRange = 24;
  sheet.darkvision = darkvisionBonus;
  if (resistTypes.length) sheet.resist = resistTypes.join(', ');
  if (vulnerableTypes.length) sheet.vulnerable = vulnerableTypes.join(', ');

  sheet.racialTraits = racialTraitRows;

  // Skills: free baseline first (minus any core skill the race gave up),
  // then every skill the player bought, then racial starting skills.
  const skillRows: SheetData[] = FREE_SKILLS_SWADE
    .filter((name) => !lostCoreSkills.has(name))
    .map((name) => ({ name, die: input.skillDice[name] ?? 'd4', notes: '' }));
  for (const [name, die] of Object.entries(input.skillDice)) {
    if (FREE_SKILLS_SWADE.includes(name) && !lostCoreSkills.has(name)) continue;
    if (!SKILLS_SWADE.includes(name)) continue;
    skillRows.push({ name, die, notes: '' });
  }
  for (const racial of extraSkillRows) {
    const existing = skillRows.find((s) => String(s.name).toLowerCase() === String(racial.name).toLowerCase());
    // A racial skill only helps if it beats what the character already has.
    if (!existing) skillRows.push(racial);
    else if (dieStepIndex(String(racial.die)) > dieStepIndex(String(existing.die))) existing.die = racial.die;
  }
  sheet.skills = skillRows;

  const chosenHindrances = input.hindranceIds
    .map((id) => CURATED_HINDRANCES_SWADE.find((h) => h.id === id))
    .filter((h): h is HindranceOption => !!h);
  sheet.hindrances = chosenHindrances.map((h) => ({
    name: h.name, severity: h.severity, notes: h.desc, ...traitModsFor(h.name),
  }));
  if (chosenHindrances.some((h) => h.id === 'bad-luck')) sheet.bennies = Math.max(0, num(sheet, 'bennies', 3) - 1);

  // Edges land as real Edge rows carrying their mechanical columns (pulled
  // from the compendium so there's one source of truth), which is what makes
  // them live: swadeParry/swadeToughness/swadePace and gearTraitBonus read
  // those columns directly. Only the effects with no column to live in
  // (Bennies, starting funds, the running die) are applied to fields here.
  const edges: SheetData[] = [];
  if (input.ancestryName === 'Human' && !input.ancestryIsCustom) {
    edges.push({ name: HUMAN_FREE_EDGE.name, notes: HUMAN_FREE_EDGE.desc, ...traitModsFor(HUMAN_FREE_EDGE.name) });
  }
  let bonusFunds = input.hindranceFundsSpent * 500;
  for (const id of input.edgeIds) {
    const edge = CURATED_EDGES_BY_ID.get(id);
    if (!edge) continue;
    edges.push({ name: edge.name, notes: edge.desc, ...traitModsFor(edge.name) });
    if (id === 'fleet-footed') sheet.runningDie = 'd10';
    if (id === 'luck') sheet.bennies = num(sheet, 'bennies', 3) + 1;
    if (id === 'rich') bonusFunds += 1000;
  }
  sheet.edges = edges;
  sheet.dollars = 500 + bonusFunds;
  sheet.armor = armorRows;
  sheet.inventory = inventoryRows;
  // Bites, claws, and horns arrive as real attacks you can click.
  if (extraAttackRows.length) sheet.attacks = extraAttackRows;

  const bioParts = [
    input.concept.trim() ? `Concept: ${input.concept.trim()}.` : '',
    ancestryTraitNotes.length ? `Ancestry traits: ${ancestryTraitNotes.join(', ')}.` : '',
  ].filter(Boolean);
  if (bioParts.length) sheet.notes = bioParts.join(' ');

  return sheet;
}
