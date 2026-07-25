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
  | { kind: 'pace'; amount: number; runningDieSteps?: number }
  | { kind: 'armor'; amount: number }
  | { kind: 'vision'; darkvision: number }
  | { kind: 'resist' }
  | { kind: 'vulnerable' }
  | { kind: 'skillBonus'; skill: string; amount: number }
  | { kind: 'none' };

export interface CustomRaceTrait {
  id: string;
  name: string;
  /** Build points: positive = costs points, negative = refunds points (a Drawback). */
  cost: number;
  desc: string;
  effect: CustomRaceTraitEffect;
  /** This trait needs the player to pick an attribute (Attribute Increase/Reduced Attribute). */
  needsAttrChoice?: boolean;
  /** This trait needs the player to pick a damage type (Resistant/Vulnerable). */
  needsDamageTypeChoice?: boolean;
}

export const CUSTOM_RACE_TRAITS: CustomRaceTrait[] = [
  { id: 'attribute-increase', name: 'Attribute Increase', cost: 2, needsAttrChoice: true, effect: { kind: 'attributeStep', amount: 1 }, desc: 'Raise one attribute one die type.' },
  { id: 'armor-plus2', name: 'Natural Armor +2', cost: 2, effect: { kind: 'armor', amount: 2 }, desc: 'Tough hide, scales, or plating grant +2 Armor.' },
  { id: 'low-light-vision', name: 'Low Light Vision', cost: 1, effect: { kind: 'vision', darkvision: 12 }, desc: 'Ignores penalties for Dim and Dark lighting.' },
  { id: 'infravision', name: 'Infravision', cost: 2, effect: { kind: 'vision', darkvision: 24 }, desc: 'Sees clearly in near-total darkness.' },
  { id: 'fast', name: 'Fast', cost: 2, effect: { kind: 'pace', amount: 2, runningDieSteps: 1 }, desc: '+2 Pace and a die type to Running.' },
  { id: 'resistant', name: 'Resistant (choose a damage type)', cost: 1, needsDamageTypeChoice: true, effect: { kind: 'resist' }, desc: 'Takes half damage from a chosen damage type.' },
  { id: 'rugged', name: 'Rugged Constitution', cost: 1, effect: { kind: 'armor', amount: 1 }, desc: '+1 Toughness from a dense or sturdy build.' },
  { id: 'keen-senses', name: 'Keen Senses', cost: 1, effect: { kind: 'skillBonus', skill: 'Notice', amount: 2 }, desc: '+2 to Notice rolls.' },
  { id: 'reduced-attribute', name: 'Reduced Attribute', cost: -2, needsAttrChoice: true, effect: { kind: 'attributeStep', amount: -1 }, desc: 'Lower one attribute one die type.' },
  { id: 'reduced-pace', name: 'Reduced Pace', cost: -1, effect: { kind: 'pace', amount: -1, runningDieSteps: -1 }, desc: '−1 Pace and a die type to Running.' },
  { id: 'frail', name: 'Frail', cost: -1, effect: { kind: 'armor', amount: -1 }, desc: '−1 Toughness.' },
  { id: 'vulnerable-damage', name: 'Vulnerable (choose a damage type)', cost: -1, needsDamageTypeChoice: true, effect: { kind: 'vulnerable' }, desc: 'Takes double damage from a chosen damage type.' },
  { id: 'outsider', name: 'Outsider', cost: -1, effect: { kind: 'none' }, desc: 'Suffers social penalties among those unfamiliar with your kind.' },
  { id: 'clumsy', name: 'Clumsy', cost: -1, effect: { kind: 'skillBonus', skill: 'Athletics', amount: -1 }, desc: '−1 to Athletics rolls needing fine coordination.' },
];

export const CUSTOM_RACE_TRAITS_BY_ID = new Map(CUSTOM_RACE_TRAITS.map((t) => [t.id, t]));

/** The recommended build budget: spend up to this many net points on
 *  benefits; every point past it must come from an equal-or-greater
 *  drawback (a negative-cost trait) elsewhere in the build. */
export const CUSTOM_RACE_POINT_CAP = 2;
/** Soft floor — stacking drawbacks past this is unusual even for a heavily
 *  flawed race and probably wants a GM's sign-off. */
export const CUSTOM_RACE_POINT_FLOOR = -4;

export function raceTraitPointTotal(traitIds: string[]): number {
  return traitIds.reduce((sum, id) => sum + (CUSTOM_RACE_TRAITS_BY_ID.get(id)?.cost ?? 0), 0);
}

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
  customTraitIds: string[];
  customTraitChoices: Record<string, string>;
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

/** Apply every selected custom-race trait's attributeStep effect (Attribute
 *  Increase / Reduced Attribute) on top of a base attribute set. */
export function applyCustomRaceAttributeSteps(
  attrs: Record<SwadeAttrId, string>, traitIds: string[], choices: Record<string, string>,
): Record<SwadeAttrId, string> {
  const out = { ...attrs };
  for (const id of traitIds) {
    const trait = CUSTOM_RACE_TRAITS_BY_ID.get(id);
    if (trait?.effect.kind === 'attributeStep') {
      const attrId = (choices[id] as SwadeAttrId) ?? 'agility';
      out[attrId] = stepDie(out[attrId], trait.effect.amount);
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
  steps: Record<SwadeAttrId, number>, ancestryIsCustom: boolean, customTraitIds: string[], customTraitChoices: Record<string, string>,
): Record<SwadeAttrId, string> {
  const base = baseAttributeDice(steps);
  return ancestryIsCustom ? applyCustomRaceAttributeSteps(base, customTraitIds, customTraitChoices) : base;
}

/** Build a complete SWADE sheet patch from a finished wizard run. Pure and
 *  deterministic — the wizard validates budgets client-side; this function
 *  just assembles whatever it's handed. */
export function buildSwadeCharacterSheet(input: SwadeCreationInput): SheetData {
  const sheet = swade.defaultSheet();
  sheet.concept = input.concept.trim();
  sheet.wildCard = true;
  sheet.rank = 'Novice';

  const attrs = finalAttributeDice(input.attributeSteps, input.ancestryIsCustom, input.customTraitIds, input.customTraitChoices);

  let pace = 6;
  let runningDieSteps = 0;
  const armorRows: SheetData[] = [];
  const inventoryRows: SheetData[] = [];
  let darkvisionBonus = 0;
  const resistTypes: string[] = [];
  const vulnerableTypes: string[] = [];
  const ancestryTraitNotes: string[] = [];

  if (input.ancestryIsCustom) {
    for (const id of input.customTraitIds) {
      const trait = CUSTOM_RACE_TRAITS_BY_ID.get(id);
      if (!trait) continue;
      const choice = input.customTraitChoices[id];
      ancestryTraitNotes.push(`${trait.name}${choice ? ` (${choice})` : ''}`);
      switch (trait.effect.kind) {
        case 'attributeStep':
          break; // already folded into `attrs` via finalAttributeDice above
        case 'pace':
          pace += trait.effect.amount;
          runningDieSteps += trait.effect.runningDieSteps ?? 0;
          break;
        case 'armor':
          armorRows.push({ name: trait.name, armor: trait.effect.amount, parryBonus: 0, rangedArmor: 0, equipped: true, notes: 'Racial trait' });
          break;
        case 'vision':
          darkvisionBonus = Math.max(darkvisionBonus, trait.effect.darkvision);
          break;
        case 'resist':
          if (choice) resistTypes.push(choice);
          break;
        case 'vulnerable':
          if (choice) vulnerableTypes.push(choice);
          break;
        case 'skillBonus':
          inventoryRows.push({
            name: `${trait.name} (racial)`, qty: 1, weight: 0, equipped: true,
            bonusSkill: trait.effect.skill, bonusAmt: trait.effect.amount, notes: 'Racial trait',
          });
          break;
        case 'none':
        default:
          break;
      }
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

  // Skills: free baseline first, then every skill the player actually bought.
  const skillRows: SheetData[] = FREE_SKILLS_SWADE.map((name) => ({ name, die: input.skillDice[name] ?? 'd4', notes: '' }));
  for (const [name, die] of Object.entries(input.skillDice)) {
    if (FREE_SKILLS_SWADE.includes(name)) continue;
    if (!SKILLS_SWADE.includes(name)) continue;
    skillRows.push({ name, die, notes: '' });
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

  const bioParts = [
    input.concept.trim() ? `Concept: ${input.concept.trim()}.` : '',
    ancestryTraitNotes.length ? `Ancestry traits: ${ancestryTraitNotes.join(', ')}.` : '',
  ].filter(Boolean);
  if (bioParts.length) sheet.notes = bioParts.join(' ');

  return sheet;
}
