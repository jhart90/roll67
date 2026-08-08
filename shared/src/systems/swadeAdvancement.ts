// SWADE advancement: pure rank/Advance math, the five ways to spend an
// Advance, and eligibility gating — kept out of the UI so the wizard is
// presentation only and the rules stay unit-testable.
//
// An Advance lets a character do exactly one of:
//   1. gain a new Edge they qualify for,
//   2. raise one skill that is already at or above its linked attribute,
//   3. raise two skills that are below their linked attributes,
//   4. learn a brand-new skill at d4,
//   5. raise one attribute a die type — only once per Rank.
// Every four Advances raises the character's Rank.

import type { SheetData } from '../types.js';
import { num, rows, str } from './types.js';
import {
  RANKS_SWADE, SKILLS_SWADE, SKILL_ATTR_SWADE, TRAIT_DICE,
  ATTRIBUTES_SWADE, dieStepIndex, stepDie,
} from './swade.js';
import { CONTENT_SWADE } from '../data/contentSwade.js';
import type { ContentEntry } from '../data/compendiumTypes.js';

export const ADVANCES_PER_RANK = 4;
export const MAX_TRAIT_DIE = 'd12';

/** Rank index (0=Novice … 4=Legendary) for a number of completed Advances. */
export function rankIndexForAdvances(advances: number): number {
  return Math.min(RANKS_SWADE.length - 1, Math.floor(Math.max(0, advances) / ADVANCES_PER_RANK));
}

export function rankForAdvances(advances: number): string {
  return RANKS_SWADE[rankIndexForAdvances(advances)];
}

/** How many more Advances until the next Rank (0 when already Legendary). */
export function advancesToNextRank(advances: number): number {
  const idx = rankIndexForAdvances(advances);
  if (idx >= RANKS_SWADE.length - 1) return 0;
  return (idx + 1) * ADVANCES_PER_RANK - Math.max(0, advances);
}

/** True when taking one more Advance pushes the character into a new Rank. */
export function advanceRanksUp(advances: number): boolean {
  return rankIndexForAdvances(advances + 1) > rankIndexForAdvances(advances);
}

// ---------- current trait dice ----------

export function attributeDie(sheet: SheetData, attrId: string): string {
  const die = str(sheet, attrId, 'd4');
  return /^d\d+$/.test(die) ? die : 'd4';
}

/** The die a named skill sits at, or null when the character lacks it. */
export function skillDieOf(sheet: SheetData, skillName: string): string | null {
  const row = rows(sheet, 'skills').find((s) => str(s, 'name', '').toLowerCase() === skillName.toLowerCase());
  if (!row) return null;
  const die = str(row, 'die', 'd4');
  return /^d\d+$/.test(die) ? die : 'd4';
}

/** The attribute a skill is linked to (defaults to Smarts for unknowns). */
export function linkedAttrOf(skillName: string): string {
  return SKILL_ATTR_SWADE[skillName] ?? 'smarts';
}

export interface SkillStanding {
  name: string;
  die: string;
  linkedAttr: string;
  linkedDie: string;
  /** At or above the linked attribute — costs a whole Advance to raise. */
  atOrAbove: boolean;
  /** Already at the d12 cap. */
  maxed: boolean;
}

/** Every skill the character has, tagged with how it stands against its
 *  linked attribute (which decides whether raising it costs a full Advance
 *  or shares one with a second skill). */
export function skillStandings(sheet: SheetData): SkillStanding[] {
  return rows(sheet, 'skills')
    .map((row) => {
      const name = str(row, 'name', '').trim();
      if (!name) return null;
      const die = /^d\d+$/.test(str(row, 'die', 'd4')) ? str(row, 'die', 'd4') : 'd4';
      const linkedAttr = linkedAttrOf(name);
      const linkedDie = attributeDie(sheet, linkedAttr);
      return {
        name, die, linkedAttr, linkedDie,
        atOrAbove: dieStepIndex(die) >= dieStepIndex(linkedDie),
        maxed: dieStepIndex(die) >= dieStepIndex(MAX_TRAIT_DIE),
      };
    })
    .filter((s): s is SkillStanding => s !== null);
}

/** Core skills and anything else in the catalog the character hasn't taken. */
export function untakenSkills(sheet: SheetData): string[] {
  const have = new Set(rows(sheet, 'skills').map((s) => str(s, 'name', '').toLowerCase()));
  return SKILLS_SWADE.filter((s) => !have.has(s.toLowerCase()));
}

// ---------- attribute raises (once per Rank) ----------

/** The Rank index at which this character last spent an Advance on an
 *  attribute. −1 when they never have. */
export function lastAttrRaiseRank(sheet: SheetData): number {
  const v = num(sheet, 'attrRaisedAtRank', -1);
  return Number.isFinite(v) ? v : -1;
}

/** Attributes may be raised only once per Rank. */
export function canRaiseAttribute(sheet: SheetData): boolean {
  return lastAttrRaiseRank(sheet) !== rankIndexForAdvances(num(sheet, 'advances', 0));
}

export function raisableAttributes(sheet: SheetData): Array<{ id: string; label: string; die: string; maxed: boolean }> {
  return ATTRIBUTES_SWADE.map((a) => {
    const die = attributeDie(sheet, a.id);
    return { id: a.id, label: a.label, die, maxed: dieStepIndex(die) >= dieStepIndex(MAX_TRAIT_DIE) };
  });
}

// ---------- Edges ----------

export const EDGE_ENTRIES_SWADE: ContentEntry[] = CONTENT_SWADE.filter((e) => e.kind === 'edge');

export function takenEdgeNames(sheet: SheetData): string[] {
  return rows(sheet, 'edges').map((e) => str(e, 'name', '').trim()).filter(Boolean);
}

export interface EdgeEligibility {
  entry: ContentEntry;
  eligible: boolean;
  /** Why not, when ineligible. */
  reason?: string;
}

/**
 * Whether a character meets an Edge's requirements. Requirement strings look
 * like "Seasoned, Fighting d8+" or "Novice, Strength d6+, Vigor d6+" — the
 * leading word is a Rank and the rest are trait minimums. Anything that
 * doesn't parse (e.g. "Arcane Background") is shown but never blocks, since
 * the table adjudicates those.
 */
export function edgeEligibility(sheet: SheetData, entry: ContentEntry): EdgeEligibility {
  if (takenEdgeNames(sheet).some((n) => n.toLowerCase() === entry.name.toLowerCase())) {
    return { entry, eligible: false, reason: 'Already taken.' };
  }
  const requires = entry.trait?.requires ?? '';
  const parts = requires.split(',').map((p) => p.trim()).filter(Boolean);
  const charRank = rankIndexForAdvances(num(sheet, 'advances', 0));

  for (const part of parts) {
    const rankIdx = RANKS_SWADE.findIndex((r) => r.toLowerCase() === part.toLowerCase());
    if (rankIdx >= 0) {
      if (charRank < rankIdx) return { entry, eligible: false, reason: `Requires ${RANKS_SWADE[rankIdx]} Rank.` };
      continue;
    }
    // "Fighting d8+", "Agility d8+", "Spirit d6+", "Athletics or Shooting d8+"
    const m = /^(.+?)\s+(d\d+)\+?$/i.exec(part);
    if (!m) continue; // unparseable prose — never blocks
    const needIdx = dieStepIndex(m[2]);
    // "Athletics or Shooting d8+": any one alternative meeting the bar passes.
    const alternatives = m[1].trim().split(/\s+or\s+/i);
    const dieFor = (traitName: string) => {
      const attr = ATTRIBUTES_SWADE.find((a) => a.label.toLowerCase() === traitName.toLowerCase());
      return attr ? attributeDie(sheet, attr.id) : skillDieOf(sheet, traitName);
    };
    // Vague wording ("chosen skill", "any Trait", "arcane skill") never blocks.
    if (alternatives.some((t) => /chosen|any|arcane skill|in trait/i.test(t))) continue;
    const dice = alternatives.map(dieFor);
    if (dice.some((d) => d && dieStepIndex(d) >= needIdx)) continue;
    const label = `${alternatives.join(' or ')} ${m[2]}+`;
    const have = dice.find(Boolean);
    return {
      entry, eligible: false,
      reason: have ? `Requires ${label} (you have ${have}).` : `Requires ${label}.`,
    };
  }
  return { entry, eligible: true };
}

export function edgeOptions(sheet: SheetData): EdgeEligibility[] {
  return EDGE_ENTRIES_SWADE.map((e) => edgeEligibility(sheet, e));
}

// ---------- the choice ----------

export type AdvanceChoice =
  | { kind: 'edge'; edgeName: string }
  | { kind: 'skillHigh'; skill: string }
  | { kind: 'skillsLow'; skills: string[] }
  | { kind: 'newSkill'; skill: string }
  | { kind: 'attribute'; attrId: string };

export interface AdvanceOptionInfo {
  kind: AdvanceChoice['kind'];
  label: string;
  detail: string;
  available: boolean;
  reason?: string;
}

/** The five ways to spend this Advance, each tagged with whether the
 *  character can actually use it right now. */
export function advanceOptions(sheet: SheetData): AdvanceOptionInfo[] {
  const standings = skillStandings(sheet);
  const high = standings.filter((s) => s.atOrAbove && !s.maxed);
  const low = standings.filter((s) => !s.atOrAbove && !s.maxed);
  const untaken = untakenSkills(sheet);
  const attrs = raisableAttributes(sheet).filter((a) => !a.maxed);
  const attrOk = canRaiseAttribute(sheet);
  return [
    {
      kind: 'edge', label: 'Gain a new Edge',
      detail: 'Pick any Edge whose Rank and trait requirements you meet.',
      available: edgeOptions(sheet).some((e) => e.eligible),
      reason: 'No Edges are currently available to you.',
    },
    {
      kind: 'skillHigh', label: 'Raise one skill at or above its attribute',
      detail: 'A single skill already equal to or better than its linked attribute goes up a die type.',
      available: high.length > 0,
      reason: 'No eligible skill is at or above its linked attribute.',
    },
    {
      kind: 'skillsLow', label: 'Raise two skills below their attributes',
      detail: 'Two skills still under their linked attributes each go up a die type.',
      available: low.length >= 2,
      reason: 'You need at least two skills below their linked attributes.',
    },
    {
      kind: 'newSkill', label: 'Learn a new skill at d4',
      detail: 'Pick up a skill you have never trained.',
      available: untaken.length > 0,
      reason: 'You already have every skill in the list.',
    },
    {
      kind: 'attribute', label: 'Raise an attribute',
      detail: 'One attribute goes up a die type — allowed only once per Rank.',
      available: attrOk && attrs.length > 0,
      reason: attrOk ? 'Every attribute is already at d12.' : 'You have already raised an attribute this Rank.',
    },
  ];
}

export interface AdvanceResult {
  patch: SheetData;
  /** Human-readable summary for the chat log. */
  summary: string;
  /** Trait die worth showing off with a roll afterwards, when one changed.
   *  `kind` lets the caller name it naturally: a skill reads "Battle Skill
   *  roll", an attribute just "Agility roll". */
  showcase?: { label: string; die: string; kind: 'skill' | 'attribute' };
}

/** Raise one skill row a die type, adding it at d4 if absent. */
function withSkillRaised(skills: SheetData[], name: string, addAtD4: boolean): SheetData[] {
  const idx = skills.findIndex((s) => str(s, 'name', '').toLowerCase() === name.toLowerCase());
  if (idx < 0) {
    return addAtD4 ? [...skills, { name, die: 'd4', notes: '' }] : skills;
  }
  const cur = str(skills[idx], 'die', 'd4');
  const next = stepDie(cur, 1);
  return skills.map((s, i) => (i === idx ? { ...s, die: next } : s));
}

/**
 * Apply an Advance to a sheet, returning the patch to send. Bumps the
 * Advance count and Rank, records attribute raises for the once-per-Rank
 * rule, and never pushes a trait past d12.
 */
export function applyAdvance(sheet: SheetData, choice: AdvanceChoice): AdvanceResult {
  const advances = num(sheet, 'advances', 0) + 1;
  const patch: SheetData = { advances, rank: rankForAdvances(advances) };
  const skills = rows(sheet, 'skills').map((s) => ({ ...s }));
  let summary = '';
  let showcase: AdvanceResult['showcase'];

  if (choice.kind === 'edge') {
    const entry = EDGE_ENTRIES_SWADE.find((e) => e.name === choice.edgeName);
    const t = entry?.trait;
    patch.edges = [
      ...rows(sheet, 'edges').map((e) => ({ ...e })),
      {
        name: choice.edgeName,
        bonusSkill: t?.bonusSkill ?? '', bonusAmt: t?.bonusAmt ?? 0,
        parryBonus: t?.parryBonus ?? 0, toughnessBonus: t?.toughnessBonus ?? 0,
        paceBonus: t?.paceBonus ?? 0,
        notes: entry?.subtitle ?? '',
      },
    ];
    summary = `takes the ${choice.edgeName} Edge`;
  } else if (choice.kind === 'skillHigh') {
    const before = skillDieOf(sheet, choice.skill) ?? 'd4';
    patch.skills = withSkillRaised(skills, choice.skill, false);
    const after = stepDie(before, 1);
    summary = `raises ${choice.skill} from ${before} to ${after}`;
    showcase = { label: choice.skill, die: after, kind: 'skill' };
  } else if (choice.kind === 'skillsLow') {
    let next = skills;
    const parts: string[] = [];
    for (const name of choice.skills.slice(0, 2)) {
      const before = skillDieOf(sheet, name) ?? 'd4';
      next = withSkillRaised(next, name, false);
      parts.push(`${name} ${before}→${stepDie(before, 1)}`);
    }
    patch.skills = next;
    summary = `raises ${parts.join(' and ')}`;
  } else if (choice.kind === 'newSkill') {
    patch.skills = withSkillRaised(skills, choice.skill, true);
    summary = `learns ${choice.skill} at d4`;
    showcase = { label: choice.skill, die: 'd4', kind: 'skill' };
  } else {
    const attr = ATTRIBUTES_SWADE.find((a) => a.id === choice.attrId);
    const before = attributeDie(sheet, choice.attrId);
    const after = stepDie(before, 1);
    patch[choice.attrId] = after;
    patch.attrRaisedAtRank = rankIndexForAdvances(advances);
    summary = `raises ${attr?.label ?? choice.attrId} from ${before} to ${after}`;
    showcase = { label: attr?.label ?? choice.attrId, die: after, kind: 'attribute' };
  }

  if (advanceRanksUp(advances - 1)) {
    summary += ` — and reaches ${rankForAdvances(advances)} Rank!`;
  }
  return { patch, summary, showcase };
}

/** Cap check used by the UI to grey out maxed traits. */
export function isMaxDie(die: string): boolean {
  return dieStepIndex(die) >= dieStepIndex(MAX_TRAIT_DIE);
}

export { TRAIT_DICE };
