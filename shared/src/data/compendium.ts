import type { GameSystem } from '../types.js';
import type { ContentEntry, ContentKind } from './compendiumTypes.js';
import { ITEMS_5E } from './items5e.js';
import { SPELLS_5E } from './spells5e.js';
import { CONTENT_SWN } from './contentSwn.js';

export * from './compendiumTypes.js';

export const ALL_CONTENT: ContentEntry[] = [...ITEMS_5E, ...SPELLS_5E, ...CONTENT_SWN];

const byId = new Map(ALL_CONTENT.map((c) => [c.id, c]));

export function contentById(id: string): ContentEntry | undefined {
  return byId.get(id);
}

export function contentForSystem(system: GameSystem): ContentEntry[] {
  return ALL_CONTENT.filter((c) => c.system === system);
}

/** Distinct kinds present for a system, in a sensible display order. */
const KIND_ORDER: ContentKind[] = ['weapon', 'armor', 'spell', 'power', 'gear', 'magicitem'];
export const KIND_LABEL: Record<ContentKind, string> = {
  weapon: 'Weapons',
  armor: 'Armor',
  spell: 'Spells',
  power: 'Psychic Powers',
  gear: 'Gear',
  magicitem: 'Magic Items',
};

export function contentKinds(system: GameSystem): ContentKind[] {
  const present = new Set(contentForSystem(system).map((c) => c.kind));
  return KIND_ORDER.filter((k) => present.has(k));
}
