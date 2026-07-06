import type { AoeShape, GameSystem, SheetData } from '../types.js';

export interface NpcEntry {
  id: string;
  system: GameSystem;
  name: string;
  category: string;
  /** Numeric challenge for sorting (5e CR, SWN hit dice/level). */
  challenge: number;
  /** Display label, e.g. "CR 1/4" or "HD 3". */
  challengeLabel: string;
  ac: number;
  hp: number;
  sheet: SheetData;
}

export function slug(system: string, name: string): string {
  return `${system}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function crToNumber(cr: string): number {
  if (cr.includes('/')) {
    const [a, b] = cr.split('/');
    return Number(a) / Number(b);
  }
  return Number(cr);
}

/**
 * Extra data for a special attack that forces a saving throw instead of a
 * to-hit roll, and/or hits an area — a monster breath weapon, not a plain
 * weapon strike. `dc` is a fixed stat-block number (unlike a PC spell's DC,
 * which derives from ability/proficiency).
 */
export interface SpecialAttackMeta {
  range?: number;
  dtype?: string;
  save?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  dc?: number;
  onSave?: 'half' | 'negate';
  aoeShape?: AoeShape;
  aoeSize?: number;
  aoeWidth?: number;
}

/** [name, toHitBonus, damageExpr, notes?, special?] */
export type AttackRow = [string, number, string, string?, SpecialAttackMeta?];

/** Resolves a plain weapon strike's name to its real range/damage type from
 *  a system's compendium. Passed in by each NPC data file (5e/SWN both call
 *  attackRows with their own compendium's weapons) rather than imported here,
 *  so this file stays free of any compendium dependency. */
export type WeaponLookup = (name: string) => { range: number; dtype: string } | null;

export function attackRows(attacks: AttackRow[], lookupWeapon?: WeaponLookup): Array<Record<string, unknown>> {
  return attacks.map(([name, bonus, damage, notes, special]) => {
    // Cone/line/cube areas always originate on the attacker (a breath weapon
    // has no separate "how far can I aim this" distance — only its own
    // length matters), same convention as self-origin AoE spells. Leaving
    // range unset here would fall through to the attacks schema's default of
    // 5 ft, which made the server's AoE range check reject any aim point
    // more than one hex from the attacker — "area out of range" on every
    // click. Sphere/cylinder areas are point-targeted and keep a real range.
    const selfOrigin = special?.aoeShape === 'cone' || special?.aoeShape === 'line' || special?.aoeShape === 'cube';
    // A plain weapon strike (no `special` override — that's reserved for
    // monster abilities like breath weapons, never named after a real
    // compendium weapon) gets its real range/damage type by looking its name
    // up there — e.g. a Longbow is a 150-ft ranged attack, not the schema's
    // melee default every prebuilt NPC's ranged weapon was silently getting.
    const weapon = !special ? lookupWeapon?.(name) ?? null : null;
    return {
      name, bonus, damage, notes: notes ?? '',
      ...(special?.range !== undefined ? { range: special.range }
        : selfOrigin ? { range: 0 }
          : weapon ? { range: weapon.range } : {}),
      ...(special?.dtype ? { dtype: special.dtype } : weapon ? { dtype: weapon.dtype } : {}),
      ...(special?.save ? { save: special.save, onSave: special.onSave ?? 'half', saveDc: special.dc ?? 13 } : {}),
      ...(special?.aoeShape ? { aoeShape: special.aoeShape, aoeSize: special.aoeSize ?? 0, aoeWidth: special.aoeWidth ?? 0 } : {}),
    };
  });
}
