import type { GameSystem } from '../types.js';
import type { NpcEntry } from './npcTypes.js';
import { NPCS_5E } from './npcs5e.js';
import { NPCS_SWN } from './npcsSwn.js';

export type { NpcEntry } from './npcTypes.js';

export const ALL_NPCS: NpcEntry[] = [...NPCS_5E, ...NPCS_SWN];

const byId = new Map(ALL_NPCS.map((n) => [n.id, n]));

export function npcById(id: string): NpcEntry | undefined {
  return byId.get(id);
}

export function npcsForSystem(system: GameSystem): NpcEntry[] {
  return ALL_NPCS.filter((n) => n.system === system);
}

export function npcCategories(system: GameSystem): string[] {
  const seen: string[] = [];
  for (const n of npcsForSystem(system)) {
    if (!seen.includes(n.category)) seen.push(n.category);
  }
  return seen;
}
