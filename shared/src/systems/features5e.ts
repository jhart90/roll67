// Per-feature 5e mechanics layered on the class chassis: class resources
// (rage, ki, channel divinity, …) and the martial features that change rolls
// (Rage damage, Sneak Attack, Extra Attack). Resources track spent uses on the
// sheet as `res_<id>`; the sheet UI shows trackers and rest buttons.

import type { SheetData } from '../types.js';
import { num, str } from './types.js';
import { getClass5e } from './classes5e.js';

export interface ClassResource {
  id: string;
  name: string;
  max: number;
  used: number;
  remaining: number;
  /** Recharge on a short or long rest. */
  reset: 'short' | 'long';
  /** True for large point pools (Lay on Hands) — render a number, not pips. */
  pool?: boolean;
  note?: string;
}

// Barbarian rage uses by level (index 1..20; 999 = unlimited at 20).
const RAGE_USES = [0, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 999];

function mod(sheet: SheetData, ability: string): number {
  return Math.floor((num(sheet, ability, 10) - 10) / 2);
}

/** Barbarian rage bonus damage by level. */
export function rageDamage(level: number): number {
  return level >= 16 ? 4 : level >= 9 ? 3 : 2;
}

export function isRaging(sheet: SheetData): boolean {
  return sheet.rageActive === true;
}

export function classId(sheet: SheetData): string {
  return getClass5e(str(sheet, 'class', ''))?.id ?? '';
}

/** Monk Martial Arts damage die by level. */
export function martialArtsDie(level: number): string {
  return level >= 17 ? '1d10' : level >= 11 ? '1d8' : level >= 5 ? '1d6' : '1d4';
}

export const FIGHTING_STYLES = [
  '—', 'Archery', 'Defense', 'Dueling', 'Great Weapon Fighting', 'Protection', 'Two-Weapon Fighting',
];

/** Numeric bonuses a fighting style adds. `ranged` = the attack's reach > 5 ft. */
export function fightingStyleBonus(style: string, ranged: boolean): { attack: number; damage: number } {
  if (style === 'Archery' && ranged) return { attack: 2, damage: 0 };
  if (style === 'Dueling' && !ranged) return { attack: 0, damage: 2 };
  return { attack: 0, damage: 0 };
}

/** Rogue Sneak Attack dice count (0 if not a rogue). */
export function sneakAttackDice(sheet: SheetData): number {
  const cls = getClass5e(str(sheet, 'class', ''));
  if (!cls || cls.id !== 'rogue') return 0;
  return Math.ceil(Math.max(1, num(sheet, 'level', 1)) / 2);
}

/** Attacks per Attack action (Extra Attack). */
export function attacksPerAction(sheet: SheetData): number {
  const cls = getClass5e(str(sheet, 'class', ''));
  if (!cls) return 1;
  const lvl = num(sheet, 'level', 1);
  if (cls.id === 'fighter') return lvl >= 20 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;
  if (['barbarian', 'monk', 'paladin', 'ranger'].includes(cls.id)) return lvl >= 5 ? 2 : 1;
  return 1;
}

/** Limited-use class resources for this character's class + level. */
export function classResources(sheet: SheetData): ClassResource[] {
  const cls = getClass5e(str(sheet, 'class', ''));
  if (!cls) return [];
  const lvl = Math.max(1, num(sheet, 'level', 1));
  const defs: Array<Omit<ClassResource, 'used' | 'remaining'>> = [];

  switch (cls.id) {
    case 'barbarian':
      defs.push({ id: 'rage', name: 'Rage', max: RAGE_USES[Math.min(20, lvl)], reset: 'long', note: `+${rageDamage(lvl)} melee damage while raging` });
      break;
    case 'monk':
      if (lvl >= 2) defs.push({ id: 'ki', name: 'Ki', max: lvl, reset: 'short' });
      break;
    case 'fighter':
      defs.push({ id: 'secondWind', name: 'Second Wind', max: 1, reset: 'short', note: `heal 1d10+${lvl}` });
      if (lvl >= 2) defs.push({ id: 'actionSurge', name: 'Action Surge', max: lvl >= 17 ? 2 : 1, reset: 'short' });
      if (lvl >= 9) defs.push({ id: 'indomitable', name: 'Indomitable', max: lvl >= 17 ? 3 : lvl >= 13 ? 2 : 1, reset: 'long' });
      break;
    case 'paladin':
      defs.push({ id: 'layOnHands', name: 'Lay on Hands', max: 5 * lvl, reset: 'long', pool: true, note: 'healing pool' });
      if (lvl >= 3) defs.push({ id: 'channelDivinity', name: 'Channel Divinity', max: 1, reset: 'short' });
      break;
    case 'cleric':
      if (lvl >= 2) defs.push({ id: 'channelDivinity', name: 'Channel Divinity', max: lvl >= 18 ? 3 : lvl >= 6 ? 2 : 1, reset: 'short' });
      break;
    case 'druid':
      if (lvl >= 2) defs.push({ id: 'wildShape', name: 'Wild Shape', max: 2, reset: 'short' });
      break;
    case 'bard':
      defs.push({ id: 'bardicInspiration', name: 'Bardic Inspiration', max: Math.max(1, mod(sheet, 'cha')), reset: lvl >= 5 ? 'short' : 'long' });
      break;
    case 'sorcerer':
      if (lvl >= 2) defs.push({ id: 'sorceryPoints', name: 'Sorcery Points', max: lvl, reset: 'long', pool: true });
      break;
    case 'artificer':
      if (lvl >= 7) defs.push({ id: 'flashOfGenius', name: 'Flash of Genius', max: Math.max(1, mod(sheet, 'int')), reset: 'long' });
      break;
    case 'wizard':
      defs.push({ id: 'arcaneRecovery', name: 'Arcane Recovery', max: 1, reset: 'long' });
      break;
    default:
      break;
  }

  return defs.map((d) => {
    const used = num(sheet, `res_${d.id}`, 0);
    return { ...d, used, remaining: Math.max(0, d.max - used) };
  });
}
