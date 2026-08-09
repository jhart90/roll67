// Shared "effect engine" primitives used by both 5e and SWN: damage types +
// resistance, critical-hit dice doubling, and status conditions with their
// combat implications. Pure functions so the server and client agree and the
// logic is unit-testable.

import type { GameSystem, SheetData } from '../types.js';
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
  systems: GameSystem[];
  /** Bearer cannot voluntarily move (Entangled, Bound, Stunned, restraints). */
  blocksMove?: boolean;
  /** Attackers targeting this creature roll with advantage ('melee' = only melee attackers, e.g. prone). */
  grantsAttackAdv?: boolean | 'melee';
  /** Attackers targeting this creature roll with disadvantage ('ranged' = only ranged attackers, e.g. prone). */
  grantsAttackDis?: boolean | 'ranged';
  /** This creature makes its own attack rolls with advantage (e.g. invisible). */
  selfAttackAdv?: boolean;
  /** This creature makes its own attack rolls with disadvantage. */
  selfAttackDis?: boolean;
  /** This creature can take no actions/reactions. */
  incapacitated?: boolean;
  desc: string;
  /** SWADE-specific wording, shown instead of `desc` in SWADE campaigns —
   *  the shared conditions carry 5e-flavoured rules text otherwise. */
  swadeDesc?: string;
}

/** The tooltip text for a condition, in the given system's own rules language. */
export function conditionDesc(c: ConditionDef, system: GameSystem): string {
  return system === 'swade' && c.swadeDesc ? c.swadeDesc : c.desc;
}

export const CONDITIONS: ConditionDef[] = [
  { id: 'blinded', label: 'Blinded', icon: '🕶️', systems: ['dnd5e', 'swn', 'swade'], grantsAttackAdv: true, selfAttackDis: true, desc: "Can't see; attacks against have advantage, its attacks have disadvantage.", swadeDesc: 'Can’t see: −2 on sight-dependent Trait rolls (−6 if fully blind) and Vulnerable until vision clears.' },
  { id: 'charmed', label: 'Charmed', icon: '💗', systems: ['dnd5e'], desc: "Can't attack the charmer; the charmer has advantage on social checks." },
  { id: 'deafened', label: 'Deafened', icon: '🔇', systems: ['dnd5e', 'swn'], desc: "Can't hear; fails hearing-based checks." },
  { id: 'frightened', label: 'Frightened', icon: '😱', systems: ['dnd5e', 'swn', 'swade'], selfAttackDis: true, desc: 'Disadvantage on attacks/checks while the source is in sight; can’t move closer.', swadeDesc: 'Panicked by Fear: −2 on Trait rolls while the source is in sight, and won’t willingly move closer to it.' },
  { id: 'grappled', label: 'Grappled', icon: '✊', systems: ['dnd5e', 'swn'], desc: 'Speed 0; ends if the grappler is incapacitated.' },
  { id: 'incapacitated', label: 'Incapacitated', icon: '💫', systems: ['dnd5e', 'swn', 'swade'], incapacitated: true, desc: "Can't take actions or reactions.", swadeDesc: 'Down and out of the fight: took more Wounds than they can carry. Helpless — no actions or movement. A Wild Card rolls Vigor against the Injury Table and may be Bleeding Out; healing a Wound clears this.' },
  { id: 'invisible', label: 'Invisible', icon: '👻', systems: ['dnd5e', 'swade'], grantsAttackDis: true, selfAttackAdv: true, desc: 'Attacks against have disadvantage; its attacks have advantage.', swadeDesc: 'Unseen: attacks against it suffer −2 (−6 if totally unseen); its own actions against others gain +2.' },
  { id: 'paralyzed', label: 'Paralyzed', icon: '🧊', systems: ['dnd5e'], grantsAttackAdv: true, incapacitated: true, desc: "Incapacitated, can't move/speak; melee hits crit; auto-fails STR/DEX saves." },
  { id: 'petrified', label: 'Petrified', icon: '🗿', systems: ['dnd5e'], grantsAttackAdv: true, incapacitated: true, desc: 'Turned to stone; resistant to all damage; incapacitated.' },
  { id: 'poisoned', label: 'Poisoned', icon: '🤢', systems: ['dnd5e', 'swn'], selfAttackDis: true, desc: 'Disadvantage on attack rolls and ability checks.' },
  { id: 'defending', label: 'Defending', icon: '🛡️', systems: ['swade'], desc: 'Devoting the whole turn to defense: +4 Parry until the start of their next turn; may not run.' },
  { id: 'prone', label: 'Prone', icon: '⬇️', systems: ['dnd5e', 'swn', 'swade'], grantsAttackAdv: 'melee', grantsAttackDis: 'ranged', selfAttackDis: true, desc: 'Melee attackers have advantage, ranged have disadvantage; its attacks have disadvantage.', swadeDesc: 'On the ground: −2 Parry and −2 to its own Fighting rolls; ranged attacks against it suffer −2. Standing back up costs 2 hexes of Pace.' },
  { id: 'restrained', label: 'Restrained', icon: '🕸️', systems: ['dnd5e', 'swn'], grantsAttackAdv: true, selfAttackDis: true, desc: 'Speed 0; attacks against have advantage; its attacks have disadvantage; disadvantage on DEX saves.' },
  { id: 'stunned', label: 'Stunned', icon: '⭐', systems: ['dnd5e', 'swn', 'swade'], grantsAttackAdv: true, incapacitated: true, blocksMove: true, desc: 'Incapacitated; attacks against have advantage; auto-fails STR/DEX saves.', swadeDesc: 'Falls Prone, Distracted, can’t move or act, and attackers may have The Drop. Free Vigor roll at the start of each turn to recover — leaving them Vulnerable and Distracted (a raise clears everything).' },
  { id: 'unconscious', label: 'Unconscious', icon: '💤', systems: ['dnd5e', 'swn', 'swade'], grantsAttackAdv: true, incapacitated: true, desc: 'Incapacitated and prone; melee hits crit; auto-fails STR/DEX saves.', swadeDesc: 'Out cold and helpless: attackers have The Drop (+4 to attack and damage), and a Fighting attack on a helpless foe hits with a raise on a success.' },
  { id: 'dead', label: 'Dead', icon: '💀', systems: ['dnd5e', 'swn', 'swade'], incapacitated: true, desc: 'Out of the fight.' },
  // SWADE-only states.
  { id: 'aiming', label: 'Aiming', icon: '🎯', systems: ['swade'], desc: 'Spent the whole turn drawing a bead. The FIRST action next turn — if it’s a ranged attack — ignores up to 4 points of range and cover penalties (+2 if there are none). Moving or doing anything else first loses it.' },
  { id: 'shaken', label: 'Shaken', icon: '😵', systems: ['swade'], incapacitated: true, desc: 'May only take free actions. At the start of the character’s turn, a free Spirit roll removes Shaken.' },
  { id: 'distracted', label: 'Distracted', icon: '😖', systems: ['swade'], selfAttackDis: true, desc: '−2 to all Trait rolls. Goes away at the end of the character’s next turn if not caused by another condition.' },
  { id: 'vulnerable', label: 'Vulnerable', icon: '🎯', systems: ['swade'], grantsAttackAdv: true, desc: 'Actions against the character are made at +2 (does not stack with The Drop). Goes away at the end of the character’s next turn if not caused by another condition.' },
  { id: 'entangled', label: 'Entangled', icon: '🕸️', systems: ['swade'], selfAttackDis: true, blocksMove: true, desc: 'Distracted and can’t move until free.' },
  { id: 'bound', label: 'Bound', icon: '⛓️', systems: ['swade'], grantsAttackAdv: true, selfAttackDis: true, incapacitated: true, blocksMove: true, desc: 'Vulnerable, Distracted, and cannot move or take physical actions other than trying to break free.' },
  { id: 'encumbered', label: 'Encumbered', icon: '🎒', systems: ['swade'], desc: 'Carrying more than your Strength allows: −2 to Pace (minimum 1), running, Agility and all linked skills, and to Vigor rolls made to resist Fatigue. Set automatically from the weight on your sheet.' },
  { id: 'bleeding', label: 'Bleeding Out', icon: '🩸', systems: ['swade'], incapacitated: true, blocksMove: true, desc: 'Dying: at the start of the character’s turn make a Vigor roll — die on a failure, hang on with a success, stop Bleeding Out on a raise.' },
];

const CONDITION_MAP = new Map(CONDITIONS.map((c) => [c.id, c]));

export function getCondition(id: string): ConditionDef | undefined {
  return CONDITION_MAP.get(id);
}

export function conditionsFor(system: GameSystem): ConditionDef[] {
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
/** Whether any held condition pins the bearer in place. */
export function blocksMovement(conditionIds: string[]): boolean {
  return conditionIds.some((id) => CONDITION_MAP.get(id)?.blocksMove === true);
}

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
 * (5e rules): any of each → normal.
 *
 * Takes the raw condition-id lists (not pre-folded ConditionCombat flags):
 * each condition's contribution has to be judged individually against the
 * attack's range — folding first conflated e.g. restrained (always grants
 * advantage) + prone (grants ranged attackers disadvantage) into one
 * ambiguous adv+dis pair that got misread as prone's own melee/ranged split.
 */
export function attackAdvantage(
  chosen: 'adv' | 'dis' | null,
  attackerConditions: string[],
  targetConditions: string[],
  ranged: boolean,
): 'adv' | 'dis' | null {
  let adv = chosen === 'adv';
  let dis = chosen === 'dis';
  for (const id of attackerConditions) {
    const c = CONDITION_MAP.get(id);
    if (!c) continue;
    if (c.selfAttackAdv) adv = true;
    if (c.selfAttackDis) dis = true;
  }
  for (const id of targetConditions) {
    const c = CONDITION_MAP.get(id);
    if (!c) continue;
    if (c.grantsAttackAdv === true || (c.grantsAttackAdv === 'melee' && !ranged)) adv = true;
    if (c.grantsAttackDis === true || (c.grantsAttackDis === 'ranged' && ranged)) dis = true;
  }
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

// A tiny local copy of swn.ts's hasFocus check — can't import it directly,
// since swn.ts itself imports DAMAGE_TYPES from this file (circular import).
function focusAtLevel(sheet: SheetData, id: string, minLevel: number): boolean {
  const foci = Array.isArray(sheet.foci) ? (sheet.foci as SheetData[]) : [];
  return foci.some((f) => str(f, 'id', '') === id && num(f, 'level', 1) >= minLevel);
}

/**
 * Universal combat-economy trackers, spent on the sheet as `res_<id>` like class
 * resources: a per-round Reaction for everyone, plus once-per-scene reroll pools
 * (5e Lucky feat; SWN Warrior Knack / Expert Expertise).
 */
export function combatResources(system: GameSystem, sheet: SheetData): CombatResource[] {
  // SWADE has no reaction economy — its universal pool is the Bennies stash
  // (refreshed each session, tracked on the sheet's own bennies field).
  if (system === 'swade') {
    // The `bennies` field IS the live count (the Benny menu and Soak spend it
    // directly), so the pip row reads it as-is: pips lit = bennies in hand,
    // out of at least the standard starting three.
    const count = Math.max(0, num(sheet, 'bennies', 3));
    const max = Math.max(3, count);
    return [{
      id: 'bennies', name: 'Bennies', max, used: max - count, remaining: count,
      reset: 'long', note: 'reroll a trait roll, soak wounds, unshake…',
    }];
  }
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
    // Adventurer folds in whichever of Warrior/Expert it picked as its second class.
    const secondary = str(sheet, 'secondaryClass', '').toLowerCase();
    if (cls === 'warrior' || secondary === 'warrior') defs.push({ id: 'knack', name: 'Knack', max: 1, reset: 'scene', note: 'reroll a failed attack/save, or make a hit a crit' });
    if (cls === 'expert' || secondary === 'expert') defs.push({ id: 'expertReroll', name: 'Expertise', max: 1, reset: 'scene', note: 'reroll a failed trained-skill check' });
    if (focusAtLevel(sheet, 'authority', 2)) defs.push({ id: 'authorityMorale', name: 'Authority (Command)', max: 1, reset: 'scene', note: 'force an NPC morale check as if badly beaten' });
    if (focusAtLevel(sheet, 'star-captain', 2)) defs.push({ id: 'starCaptainReroll', name: 'Star Captain (Ally Reroll)', max: 1, reset: 'scene', note: 'let an ally reroll a failed check' });
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
