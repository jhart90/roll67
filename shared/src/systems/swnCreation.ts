// Stars Without Number guided character creation: thin orchestration over
// the existing, already-tested chargen primitives (applyLevelUpSwn /
// applyBackground / applyFocus / applyPackage) — this module's only new
// logic is attribute rolling and stitching those pure appliers together
// into one finished sheet for the client's step-by-step wizard.

import type { SheetData } from '../types.js';
import type { RNG } from '../dice/roller.js';
import { rows } from './types.js';
import { swn } from './swn.js';
import { applyBackground, applyFocus, applyLevelUpSwn, applyPackage, planLevelUpSwn } from './swnData.js';

export const SWN_ATTR_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type SwnAttrId = typeof SWN_ATTR_IDS[number];

/** Classic SWN attribute generation: 3d6, straight down. */
export function roll3d6(rng: RNG = Math.random): number {
  return 3 + Math.floor(rng() * 6) + Math.floor(rng() * 6) + Math.floor(rng() * 6);
}

export function rollAttributeSet(rng: RNG = Math.random): Record<SwnAttrId, number> {
  const out = {} as Record<SwnAttrId, number>;
  for (const id of SWN_ATTR_IDS) out[id] = roll3d6(rng);
  return out;
}

export interface SwnCreationInput {
  name: string;
  homeworld: string;
  goal: string;
  attributes: Record<SwnAttrId, number>;
  classId: string;
  secondaryClassId?: string;
  backgroundId?: string;
  focusId?: string;
  packageId?: string;
  /** Extra skills bought with starting skill points (background's free
   *  skill is applied separately by applyBackground) — each entry is one
   *  point spent raising that skill by one level. */
  skillLevels: Array<{ name: string; attr: SwnAttrId; level: number }>;
}

/** Build a complete SWN sheet patch from a finished wizard run. */
export function buildSwnCharacterSheet(input: SwnCreationInput): SheetData {
  let sheet: SheetData = { ...swn.defaultSheet(), ...input.attributes };
  if (input.secondaryClassId) sheet.secondaryClass = input.secondaryClassId;
  sheet.homeworld = input.homeworld.trim();
  sheet.goal = input.goal.trim();

  const plan = planLevelUpSwn(sheet, input.classId, 1);
  if (plan) {
    const levelPatch = applyLevelUpSwn(sheet, input.classId, 1, { hpGained: plan.firstHp, background: input.backgroundId });
    sheet = { ...sheet, ...levelPatch };
  } else if (input.backgroundId) {
    sheet = { ...sheet, ...applyBackground(sheet, input.backgroundId) };
  }

  if (input.focusId) sheet = { ...sheet, ...applyFocus(sheet, input.focusId) };

  if (input.packageId) {
    sheet = { ...sheet, ...applyPackage(sheet, input.packageId) };
    // Wear whatever armor the package provided — a fresh character starts
    // in their kit, not carrying it unworn (equipping stays a normal,
    // editable sheet action after this).
    const armor = rows(sheet, 'armor').map((r) => ({ ...r }));
    if (armor.length > 0) armor[armor.length - 1] = { ...armor[armor.length - 1], equipped: true };
    sheet.armor = armor;
  }

  // Skill points spent: raise each chosen skill to its target level,
  // stacking with anything a background/focus already granted.
  const skills = rows(sheet, 'skills').map((r) => ({ ...r }));
  for (const s of input.skillLevels) {
    const existing = skills.find((sk) => String(sk.name ?? '').toLowerCase() === s.name.toLowerCase());
    if (existing) existing.level = Math.max(Number(existing.level ?? 0), s.level);
    else skills.push({ name: s.name, level: s.level, attr: s.attr, notes: '' });
  }
  sheet.skills = skills;

  return sheet;
}
