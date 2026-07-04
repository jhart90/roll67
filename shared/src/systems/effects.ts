// Shared "effect engine" primitives used by both 5e and SWN: damage types +
// resistance, critical-hit dice doubling, and status conditions with their
// combat implications. Pure functions so the server and client agree and the
// logic is unit-testable.

import type { SheetData } from '../types.js';
import { num, str } from './types.js';
import { hasSavageAttacker } from './feats5e.js';

// ---------- damage types & resistance ----------

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  // SWN-flavored physical/energy tags also accepted:
  'kinetic', 'energy',
] as const;

function parseTypeList(raw: string): Set<string> {
  return new Set(raw.toLowerCase().split(/[,;/]/).map((s) => s.trim()).filter(Boolean));
}

/**
 * Damage multiplier from the target sheet's resist / vulnerable / immune
 * fields (each a comma-separated list of damage types): immune → 0,
 * resistant → 0.5, vulnerable → 2, otherwise 1. Immunity beats resistance
 * beats vulnerability.
 */
export function damageMultiplier(sheet: SheetData, damageType: string): number {
  const t = (damageType || '').toLowerCase().trim();
  if (!t) return 1;
  if (parseTypeList(str(sheet, 'immune', '')).has(t)) return 0;
  if (parseTypeList(str(sheet, 'resist', '')).has(t)) return 0.5;
  if (parseTypeList(str(sheet, 'vulnerable', '')).has(t)) return 2;
  return 1;
}

/** Apply a resist/vuln multiplier to a damage number (floor, never below 0). */
export function applyDamageMultiplier(amount: number, mult: number): number {
  return Math.max(0, Math.floor(amount * mult));
}

/** One-word label for a non-1 multiplier, for chat ("resisted", etc.). */
export function multiplierLabel(mult: number): string {
  if (mult === 0) return 'immune';
  if (mult < 1) return 'resisted';
  if (mult > 1) return 'vulnerable';
  return '';
}

/**
 * Double every dice term in a damage expression for a critical hit, leaving
 * flat modifiers alone: "1d8+3" → "2d8+3", "2d6" → "4d6", "1d12+1d6+2" →
 * "2d12+2d6+2".
 */
export function critDamageExpr(expr: string): string {
  return expr.replace(/(\d*)d(\d+)/gi, (_m, count: string, sides: string) => {
    const n = count === '' ? 1 : parseInt(count, 10);
    return `${n * 2}d${sides}`;
  });
}

// ---------- conditions ----------

export interface ConditionDef {
  id: string;
  label: string;
  icon: string;
  /** Which systems offer this condition in their picker. */
  systems: Array<'dnd5e' | 'swn'>;
  /** Attackers targeting this creature roll with advantage. */
  grantsAttackAdv?: boolean;
  /** Attackers targeting this creature roll with disadvantage. */
  grantsAttackDis?: boolean;
  /** This creature makes its own attack rolls with disadvantage. */
  selfAttackDis?: boolean;
  /** This creature can take no actions/reactions. */
  incapacitated?: boolean;
  desc: string;
}

export const CONDITIONS: ConditionDef[] = [
  { id: 'blinded', label: 'Blinded', icon: '🕶️', systems: ['dnd5e', 'swn'], grantsAttackAdv: true, selfAttackDis: true, desc: "Can't see; attacks against have advantage, its attacks have disadvantage." },
  { id: 'charmed', label: 'Charmed', icon: '💗', systems: ['dnd5e'], desc: "Can't attack the charmer; the charmer has advantage on social checks." },
  { id: 'deafened', label: 'Deafened', icon: '🔇', systems: ['dnd5e', 'swn'], desc: "Can't hear; fails hearing-based checks." },
  { id: 'frightened', label: 'Frightened', icon: '😱', systems: ['dnd5e', 'swn'], selfAttackDis: true, desc: 'Disadvantage on attacks/checks while the source is in sight; can’t move closer.' },
  { id: 'grappled', label: 'Grappled', icon: '✊', systems: ['dnd5e', 'swn'], desc: 'Speed 0; ends if the grappler is incapacitated.' },
  { id: 'incapacitated', label: 'Incapacitated', icon: '💫', systems: ['dnd5e', 'swn'], incapacitated: true, desc: "Can't take actions or reactions." },
  { id: 'invisible', label: 'Invisible', icon: '👻', systems: ['dnd5e'], grantsAttackDis: true, desc: 'Attacks against have disadvantage; its attacks have advantage.' },
  { id: 'paralyzed', label: 'Paralyzed', icon: '🧊', systems: ['dnd5e'], grantsAttackAdv: true, incapacitated: true, desc: "Incapacitated, can't move/speak; melee hits crit; auto-fails STR/DEX saves." },
  { id: 'petrified', label: 'Petrified', icon: '🗿', systems: ['dnd5e'], grantsAttackAdv: true, incapacitated: true, desc: 'Turned to stone; resistant to all damage; incapacitated.' },
  { id: 'poisoned', label: 'Poisoned', icon: '🤢', systems: ['dnd5e', 'swn'], selfAttackDis: true, desc: 'Disadvantage on attack rolls and ability checks.' },
  { id: 'prone', label: 'Prone', icon: '⬇️', systems: ['dnd5e', 'swn'], grantsAttackAdv: true, grantsAttackDis: true, selfAttackDis: true, desc: 'Melee attackers have advantage, ranged have disadvantage; its attacks have disadvantage.' },
  { id: 'restrained', label: 'Restrained', icon: '🕸️', systems: ['dnd5e', 'swn'], grantsAttackAdv: true, selfAttackDis: true, desc: 'Speed 0; attacks against have advantage; its attacks have disadvantage; disadvantage on DEX saves.' },
  { id: 'stunned', label: 'Stunned', icon: '⭐', systems: ['dnd5e', 'swn'], grantsAttackAdv: true, incapacitated: true, desc: 'Incapacitated; attacks against have advantage; auto-fails STR/DEX saves.' },
  { id: 'unconscious', label: 'Unconscious', icon: '💤', systems: ['dnd5e', 'swn'], grantsAttackAdv: true, incapacitated: true, desc: 'Incapacitated and prone; melee hits crit; auto-fails STR/DEX saves.' },
  { id: 'dead', label: 'Dead', icon: '💀', systems: ['dnd5e', 'swn'], incapacitated: true, desc: 'Out of the fight.' },
];

const CONDITION_MAP = new Map(CONDITIONS.map((c) => [c.id, c]));

export function getCondition(id: string): ConditionDef | undefined {
  return CONDITION_MAP.get(id);
}

export function conditionsFor(system: 'dnd5e' | 'swn'): ConditionDef[] {
  return CONDITIONS.filter((c) => c.systems.includes(system));
}

/** Read a creature's active condition ids off its sheet. */
export function conditionsOf(sheet: SheetData): string[] {
  const v = sheet.conditions;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export interface ConditionCombat {
  selfAttackDis: boolean;
  grantsAttackAdv: boolean;
  grantsAttackDis: boolean;
  incapacitated: boolean;
}

/** Fold a set of condition ids into their combined combat implications. */
export function conditionCombat(conditionIds: string[]): ConditionCombat {
  const out: ConditionCombat = { selfAttackDis: false, grantsAttackAdv: false, grantsAttackDis: false, incapacitated: false };
  for (const id of conditionIds) {
    const c = CONDITION_MAP.get(id);
    if (!c) continue;
    if (c.selfAttackDis) out.selfAttackDis = true;
    if (c.grantsAttackAdv) out.grantsAttackAdv = true;
    if (c.grantsAttackDis) out.grantsAttackDis = true;
    if (c.incapacitated) out.incapacitated = true;
  }
  return out;
}

/**
 * Net advantage state for an attack, combining the roller's chosen adv/dis with
 * the attacker's and target's conditions. Advantage and disadvantage cancel
 * (5e rules): any of each → normal. `ranged` selects prone's split effect.
 */
export function attackAdvantage(
  chosen: 'adv' | 'dis' | null,
  attacker: ConditionCombat,
  target: ConditionCombat,
  ranged: boolean,
): 'adv' | 'dis' | null {
  let adv = chosen === 'adv';
  let dis = chosen === 'dis' || attacker.selfAttackDis;
  // Prone grants advantage to melee attackers, disadvantage to ranged.
  if (target.grantsAttackAdv && !(ranged && target.grantsAttackDis)) adv = true;
  if (target.grantsAttackDis && (ranged || !target.grantsAttackAdv)) dis = true;
  if (adv && dis) return null;
  return adv ? 'adv' : dis ? 'dis' : null;
}

// ---------- reactions & reroll pools ----------

export interface CombatResource {
  id: string;
  name: string;
  max: number;
  used: number;
  remaining: number;
  /** When the pool refreshes: each round, each scene/encounter, or on a rest. */
  reset: 'round' | 'scene' | 'short' | 'long';
  note?: string;
}

/**
 * Universal combat-economy trackers, spent on the sheet as `res_<id>` like class
 * resources: a per-round Reaction for everyone, plus once-per-scene reroll pools
 * (5e Lucky feat; SWN Warrior Knack / Expert Expertise).
 */
export function combatResources(system: 'dnd5e' | 'swn', sheet: SheetData): CombatResource[] {
  const defs: Array<Omit<CombatResource, 'used' | 'remaining'>> = [
    { id: 'reaction', name: 'Reaction', max: 1, reset: 'round', note: 'opportunity attack, Shield, Deflect…' },
  ];
  if (system === 'dnd5e') {
    const feats = Array.isArray(sheet.feats) ? (sheet.feats as unknown[]) : [];
    if (feats.includes('lucky')) {
      defs.push({ id: 'luck', name: 'Luck', max: 3, reset: 'long', note: 'reroll a d20 (yours or an attacker’s)' });
    }
    if (hasSavageAttacker(sheet)) {
      defs.push({ id: 'savageAttacker', name: 'Savage Attacker', max: 1, reset: 'round', note: 'auto-rerolls melee weapon damage, keeps the higher' });
    }
  } else {
    const cls = str(sheet, 'class', '').toLowerCase();
    if (cls === 'warrior') defs.push({ id: 'knack', name: 'Knack', max: 1, reset: 'scene', note: 'reroll a failed attack/save, or make a hit a crit' });
    if (cls === 'expert') defs.push({ id: 'expertReroll', name: 'Expertise', max: 1, reset: 'scene', note: 'reroll a failed trained-skill check' });
  }
  return defs.map((d) => {
    const used = num(sheet, `res_${d.id}`, 0);
    return { ...d, used, remaining: Math.max(0, d.max - used) };
  });
}

/** Reset scopes cleared by a given reset action (broader clears narrower). */
export function resetsCleared(action: 'round' | 'scene' | 'short' | 'long'): Array<CombatResource['reset']> {
  switch (action) {
    case 'round': return ['round'];
    case 'scene': return ['round', 'scene'];
    case 'short': return ['round', 'scene', 'short'];
    case 'long': return ['round', 'scene', 'short', 'long'];
  }
}
