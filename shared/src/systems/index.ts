import type { GameSystem } from '../types.js';
import type { SystemSchema } from './types.js';
import { dnd5e } from './dnd5e.js';
import { swn } from './swn.js';

export * from './types.js';
export { dnd5e, SKILLS_5E } from './dnd5e.js';
export { swn, swnMod } from './swn.js';

export const SYSTEMS: Record<GameSystem, SystemSchema> = { dnd5e, swn };

export function systemFor(system: GameSystem): SystemSchema {
  return SYSTEMS[system];
}
