/**
 * Which clip a blast template makes when it lands.
 *
 * Every file here is one we already ship for the dice Ace animations, so this
 * adds no assets — it just stops the map's AoE bursts being silent while the
 * dice get all the noise. Two rules decide the clip:
 *
 *   damage type  picks the family (fire crackles, cold hits water, a plain
 *                kinetic bang gets the explosions)
 *   template     picks the weight — a Large Blast Template is the one thing
 *                big enough for huge_explosion, which nothing else uses
 *
 * Several files in a family are picked at random, the same way the Ace sounds
 * do it, so a volley of grenades doesn't play the same bang four times.
 */

/** Blast templates, by the hex radius the compendium gives them. */
export type BlastTemplate = 'small' | 'medium' | 'large' | 'other';

/** SBT/MBT/LBT are 1/3/5 hexes across; anything else is a spell's own shape. */
export function blastTemplate(sizeHexes: number | undefined): BlastTemplate {
  if (sizeHexes === 1) return 'small';
  if (sizeHexes === 3) return 'medium';
  if (sizeHexes === 5) return 'large';
  return 'other';
}

const FAMILIES: Record<string, string[]> = {
  explosion: ['explosion_1', 'explosion_2', 'explosion_3', 'explosion_4'],
  fire: ['fire_1'],
  water: ['water_1', 'water_2'],
  shine: ['shine_1'],
  smoke: ['smoke_1'],
};

/** Damage type → sound family. Anything unlisted falls through to explosion. */
const FAMILY_FOR_TYPE: Record<string, keyof typeof FAMILIES> = {
  fire: 'fire',
  cold: 'water',
  acid: 'water',
  poison: 'smoke',
  necrotic: 'smoke',
  psychic: 'smoke',
  radiant: 'shine',
  energy: 'shine',
  lightning: 'shine',
  force: 'explosion',
  thunder: 'explosion',
  kinetic: 'explosion',
  bludgeoning: 'explosion',
  piercing: 'explosion',
  slashing: 'explosion',
};

/**
 * The pool a burst draws from. A template with no damage type at all is a
 * smoke screen — the Smoke Grenade is the only template weapon in the
 * compendium that deals nothing and names no type — so it gets the smoke
 * clip rather than an explosion it never makes.
 */
export function blastSoundPool(sizeHexes: number | undefined, damageType: string | undefined): string[] {
  const key = damageType?.toLowerCase().trim() ?? '';
  if (key === '') return FAMILIES.smoke!;
  const family = FAMILY_FOR_TYPE[key] ?? 'explosion';
  // The Large Blast Template is the only thing that earns the big one.
  if (family === 'explosion' && blastTemplate(sizeHexes) === 'large') return ['huge_explosion'];
  return FAMILIES[family]!;
}

/** One clip from the pool, chosen with the caller's own randomness. */
export function blastSoundClip(
  sizeHexes: number | undefined, damageType: string | undefined, rnd: number,
): string {
  const pool = blastSoundPool(sizeHexes, damageType);
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rnd * pool.length)));
  return pool[i]!;
}

/**
 * The dice's own Ace animation to play over a blast template.
 *
 * A grenade going off on the map and an aced die going off in the tray are
 * the same event to look at, so they use the same drawing — scaled to the
 * template instead of to a die. Deliberately keyed off the SAME family as the
 * sound: a burst that hisses should not also look like a fireball.
 *
 * null for families with no matching Ace style, which keeps the plain
 * shockwave those already had.
 */
export function blastAceStyle(sizeHexes: number | undefined, damageType: string | undefined): string | null {
  const pool = blastSoundPool(sizeHexes, damageType);
  const first = pool[0] ?? '';
  if (first.startsWith('explosion') || first === 'huge_explosion') return 'explosion';
  if (first.startsWith('fire')) return 'flames';
  if (first.startsWith('smoke')) return 'smoke';
  if (first.startsWith('water')) return 'water';
  if (first.startsWith('shine')) return 'flash';
  return null;
}

/** Louder for the bigger templates — a Large Blast should feel like one. */
export function blastSoundVolume(sizeHexes: number | undefined): number {
  switch (blastTemplate(sizeHexes)) {
    case 'large': return 0.7;
    case 'medium': return 0.55;
    case 'small': return 0.45;
    default: return 0.5;
  }
}
