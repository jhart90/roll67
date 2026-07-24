import type { GameSystem } from '../types.js';
import type { SystemSchema } from './types.js';
import { dnd5e } from './dnd5e.js';
import { swn } from './swn.js';
import { swade } from './swade.js';

export * from './types.js';
export * from './cards.js';
export * from './combat.js';
export * from './currency.js';
export * from './spells.js';
export * from './classes5e.js';
export * from './levelup5e.js';
export * from './npcBoost5e.js';
export * from './features5e.js';
export * from './feats5e.js';
export * from './subclassFeatures5e.js';
export * from './effects.js';
export * from './namedPicks5e.js';
export * from './swnData.js';
export { dnd5e, SKILLS_5E } from './dnd5e.js';
export {
  swn, swnMod, PSYCHIC_DISCIPLINES_SWN, SKILLS_SWN, SPECIES_SWN, BACKGROUNDS_SWN,
  bestPsychicSkillLevel, effortMaxFor, hasDiscipline, isPsychicMishap, rollMishap, type PsychicMishap,
  hasFocus, swnDerivedAc, swnEncumbrance, cyberwareStrainTotal, cyberInitBonus,
  swnReloadCheck, type SwnReloadCheck,
} from './swn.js';
export {
  swade, ATTRIBUTES_SWADE, SKILLS_SWADE, RANKS_SWADE, ARCANE_BACKGROUNDS_SWADE, ANCESTRIES_SWADE,
  TRAIT_DICE, dieSides, traitExpr, woundPenalty, swadeParry, swadeToughness,
  swadeRangedArmor, swadeArcaneExpr, gearTraitBonus,
  FREE_SKILLS_SWADE, SKILL_ATTR_SWADE, dieStepIndex, stepDie,
} from './swade.js';
export * from './swadeCreation.js';
export * from './swnCreation.js';

export const SYSTEMS: Record<GameSystem, SystemSchema> = { dnd5e, swn, swade };

export function systemFor(system: GameSystem): SystemSchema {
  return SYSTEMS[system];
}
