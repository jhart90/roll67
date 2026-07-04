import type { GameSystem } from '../types.js';
import type { SystemSchema } from './types.js';
import { dnd5e } from './dnd5e.js';
import { swn } from './swn.js';

export * from './types.js';
export * from './combat.js';
export * from './currency.js';
export * from './spells.js';
export * from './classes5e.js';
export * from './levelup5e.js';
export * from './features5e.js';
export * from './feats5e.js';
export * from './subclassFeatures5e.js';
export * from './effects.js';
export * from './namedPicks5e.js';
export * from './swnData.js';
export { dnd5e, SKILLS_5E } from './dnd5e.js';
export {
  swn, swnMod, PSYCHIC_DISCIPLINES_SWN,
  bestPsychicSkillLevel, effortMaxFor, hasDiscipline, isPsychicMishap, rollMishap, type PsychicMishap,
} from './swn.js';

export const SYSTEMS: Record<GameSystem, SystemSchema> = { dnd5e, swn };

export function systemFor(system: GameSystem): SystemSchema {
  return SYSTEMS[system];
}
