// D&D 5e feats. Each carries a short description and, where the effect is
// numeric, hooks the engine applies: a fixed or chosen +1 ability (half-feats),
// a save proficiency (Resilient), HP per level (Tough), speed, and ongoing
// derived bonuses (Alert initiative, Observant passive perception). Everything
// else is recorded as a described feature entry on the sheet.

import type { SheetData } from '../types.js';
import { num, rows } from './types.js';

export interface Feat {
  id: string;
  name: string;
  prereq?: string;
  desc: string;
  /** Half-feat: +1 to this fixed ability. */
  abilityFixed?: string;
  /** Half-feat: +1 to one of these abilities (chosen when taken). */
  abilityChoice?: string[];
  /** Resilient: gain proficiency in the chosen ability's saving throw. */
  saveProficiency?: boolean;
  /** Tough: extra max HP per character level. */
  hpPerLevel?: number;
  /** Mobile: bonus walking speed (ft). */
  speedBonus?: number;
  /** Alert: bonus to initiative (ongoing). */
  initiativeBonus?: number;
  /** Observant: bonus to passive Perception/Investigation (ongoing). */
  passivePerceptionBonus?: number;
  /** GWM/Sharpshooter: eligible for the −5 attack / +10 damage toggle. */
  powerAttack?: 'melee' | 'ranged';
  /** Dual Wielder: +1 AC while the dual-wielding toggle is on. */
  dualWielderAc?: number;
  /** War Caster: advantage on concentration saves. */
  concentrationAdvantage?: boolean;
  /** Savage Attacker: once per round, reroll a melee weapon's damage and keep the higher total. */
  savageAttacker?: boolean;
  /** Martial Adept: grants one Battle-Master-style superiority die even without the subclass. */
  martialAdeptDie?: boolean;
}

const ALL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const FEATS_5E: Feat[] = [
  { id: 'actor', name: 'Actor', desc: 'Advantage on Deception/Performance to pass as another; mimic speech/sounds.', abilityFixed: 'cha' },
  { id: 'alert', name: 'Alert', desc: "+5 initiative; can't be surprised while conscious; no advantage to unseen attackers.", initiativeBonus: 5 },
  { id: 'athlete', name: 'Athlete', desc: 'Stand from prone with 5 ft; climb at full speed; running long/high jump after 5 ft.', abilityChoice: ['str', 'dex'] },
  { id: 'charger', name: 'Charger', desc: 'Dash + attack or shove as a bonus action for +5 damage or 10-ft push.' },
  { id: 'crossbow-expert', name: 'Crossbow Expert', desc: 'Ignore loading; no disadvantage in melee; bonus-action hand crossbow shot.' },
  { id: 'defensive-duelist', name: 'Defensive Duelist', prereq: 'Dex 13+', desc: 'Reaction: add proficiency to AC against one melee attack with a finesse weapon.' },
  { id: 'dual-wielder', name: 'Dual Wielder', desc: '+1 AC while dual-wielding; two-weapon fight with non-light weapons; draw two at once.', dualWielderAc: 1 },
  { id: 'dungeon-delver', name: 'Dungeon Delver', desc: 'Advantage vs traps; search at normal pace; resistance to trap damage.' },
  { id: 'durable', name: 'Durable', desc: 'Minimum HP regained on a Hit Die = 2× CON mod.', abilityFixed: 'con' },
  { id: 'elemental-adept', name: 'Elemental Adept', prereq: 'spellcasting', desc: 'Spells of a chosen damage type ignore resistance; treat 1s as 2s.' },
  { id: 'grappler', name: 'Grappler', prereq: 'Str 13+', desc: 'Advantage vs creatures you grapple; can pin a grappled creature.' },
  { id: 'great-weapon-master', name: 'Great Weapon Master', desc: 'Bonus attack on a crit/kill; optional −5 attack for +10 damage with heavy weapons.', powerAttack: 'melee' },
  { id: 'healer', name: 'Healer', desc: 'Use a healer’s kit to restore 1d6+4+HD HP; stabilize with 1 HP.' },
  { id: 'heavily-armored', name: 'Heavily Armored', prereq: 'medium armor prof', desc: 'Proficiency with heavy armor.', abilityFixed: 'str' },
  { id: 'heavy-armor-master', name: 'Heavy Armor Master', prereq: 'heavy armor prof', desc: 'Reduce nonmagical bludgeoning/piercing/slashing damage by 3.', abilityFixed: 'str' },
  { id: 'inspiring-leader', name: 'Inspiring Leader', prereq: 'Cha 13+', desc: '10-min speech grants up to six allies temp HP = your level + CHA mod.' },
  { id: 'keen-mind', name: 'Keen Mind', desc: 'Always know which way is north and hours to sunrise/sunset; perfect recall of the last month.', abilityFixed: 'int' },
  { id: 'lightly-armored', name: 'Lightly Armored', desc: 'Proficiency with light armor.', abilityChoice: ['str', 'dex'] },
  { id: 'linguist', name: 'Linguist', desc: 'Learn three languages; create ciphers.', abilityFixed: 'int' },
  { id: 'lucky', name: 'Lucky', desc: '3 luck points/long rest: reroll an attack, check, save, or an attacker’s roll.' },
  { id: 'mage-slayer', name: 'Mage Slayer', desc: 'Reaction attack vs adjacent casters; advantage on saves vs their spells.' },
  { id: 'magic-initiate', name: 'Magic Initiate', desc: 'Learn two cantrips and one 1st-level spell from a chosen class.' },
  { id: 'martial-adept', name: 'Martial Adept', desc: 'Learn two Battle Master maneuvers and gain one d6 superiority die.', martialAdeptDie: true },
  { id: 'medium-armor-master', name: 'Medium Armor Master', prereq: 'medium armor prof', desc: 'No Stealth disadvantage; add up to +3 Dex to medium-armor AC.', abilityFixed: 'dex' },
  { id: 'mobile', name: 'Mobile', desc: '+10 ft speed; Dash ignores difficult terrain; no opportunity attacks from targets you melee.', speedBonus: 10 },
  { id: 'moderately-armored', name: 'Moderately Armored', prereq: 'light armor prof', desc: 'Proficiency with medium armor and shields.', abilityChoice: ['str', 'dex'] },
  { id: 'mounted-combatant', name: 'Mounted Combatant', desc: 'Advantage vs unmounted foes; redirect attacks to yourself; mount takes no damage on some saves.' },
  { id: 'observant', name: 'Observant', desc: 'Read lips; +5 passive Perception and Investigation.', abilityChoice: ['int', 'wis'], passivePerceptionBonus: 5 },
  { id: 'polearm-master', name: 'Polearm Master', desc: 'Bonus-action butt-end attack (1d4); opportunity attacks when foes enter your reach.' },
  { id: 'resilient', name: 'Resilient', desc: '+1 to a chosen ability and proficiency in its saving throw.', abilityChoice: [...ALL], saveProficiency: true },
  { id: 'ritual-caster', name: 'Ritual Caster', prereq: 'Int or Wis 13+', desc: 'Learn and cast ritual spells from a chosen class’s ritual book.' },
  { id: 'savage-attacker', name: 'Savage Attacker', desc: 'Once per turn, reroll melee weapon damage and use either total.', savageAttacker: true },
  { id: 'sentinel', name: 'Sentinel', desc: 'Opportunity attacks stop movement; hit foes who attack others near you; ignore Disengage.' },
  { id: 'sharpshooter', name: 'Sharpshooter', desc: 'No long-range disadvantage; ignore cover; optional −5 attack for +10 damage with ranged weapons.', powerAttack: 'ranged' },
  { id: 'shield-master', name: 'Shield Master', desc: 'Bonus-action shove; add shield AC to Dex saves; reaction to negate damage.' },
  { id: 'skilled', name: 'Skilled', desc: 'Gain proficiency in any three skills or tools.' },
  { id: 'skulker', name: 'Skulker', prereq: 'Dex 13+', desc: 'Hide when lightly obscured; missing with ranged doesn’t reveal you; no dim-light disadvantage.' },
  { id: 'spell-sniper', name: 'Spell Sniper', prereq: 'spellcasting', desc: 'Double spell attack range; ignore cover; learn an attack cantrip.' },
  { id: 'tavern-brawler', name: 'Tavern Brawler', desc: 'Proficient with improvised weapons; unarmed strike d4; bonus-action grapple after a hit.', abilityChoice: ['str', 'con'] },
  { id: 'tough', name: 'Tough', desc: 'Max HP increases by 2 per level.', hpPerLevel: 2 },
  { id: 'war-caster', name: 'War Caster', prereq: 'spellcasting', desc: 'Advantage on concentration saves; cast with hands full; cast as an opportunity attack.', concentrationAdvantage: true },
  { id: 'weapon-master', name: 'Weapon Master', desc: 'Proficiency with four weapons of your choice.', abilityChoice: ['str', 'dex'] },
];

const BY_ID = new Map(FEATS_5E.map((f) => [f.id, f]));

export function getFeat(id: string): Feat | undefined {
  return BY_ID.get(id);
}

export function takenFeatIds(sheet: SheetData): string[] {
  const v = sheet.feats;
  return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
}

export function takenFeats(sheet: SheetData): Feat[] {
  return takenFeatIds(sheet).map((id) => getFeat(id)).filter((f): f is Feat => !!f);
}

/** Ongoing derived bonuses from all taken feats. */
export function featBonuses(sheet: SheetData): { initiative: number; passivePerception: number } {
  let initiative = 0;
  let passivePerception = 0;
  for (const f of takenFeats(sheet)) {
    initiative += f.initiativeBonus ?? 0;
    passivePerception += f.passivePerceptionBonus ?? 0;
  }
  return { initiative, passivePerception };
}

/**
 * One-time stat effects of taking a feat, plus the feature entry to record.
 * `ability` is the chosen ability for feats with a choice. Returns null for an
 * unknown feat. Does not itself append to the sheet's feats/features lists —
 * callers merge `stats` and push `feature`.
 */
export function featEffects(sheet: SheetData, featId: string, ability?: string):
  { stats: SheetData; feature: SheetData } | null {
  const feat = getFeat(featId);
  if (!feat) return null;
  const stats: SheetData = {};

  const bumpAbility = feat.abilityFixed ?? (feat.abilityChoice && ability && feat.abilityChoice.includes(ability) ? ability : undefined);
  if (bumpAbility) {
    stats[bumpAbility] = Math.min(20, num(sheet, bumpAbility, 10) + 1);
    if (feat.saveProficiency) stats[`save_${bumpAbility}`] = true;
  }
  if (feat.hpPerLevel) {
    const add = feat.hpPerLevel * Math.max(1, num(sheet, 'level', 1));
    stats.maxHp = num(sheet, 'maxHp', 0) + add;
    stats.hp = num(sheet, 'hp', 0) + add;
  }
  if (feat.speedBonus) stats.speed = num(sheet, 'speed', 30) + feat.speedBonus;

  return { stats, feature: { name: feat.name, source: 'Feat', description: feat.desc } };
}

/** Full sheet patch for adding a feat outside the level-up flow. */
export function applyFeat(sheet: SheetData, featId: string, ability?: string): SheetData {
  const eff = featEffects(sheet, featId, ability);
  if (!eff) return {};
  const feats = takenFeatIds(sheet);
  const features = rows(sheet, 'features').slice();
  features.push(eff.feature);
  return { ...eff.stats, feats: [...feats, featId], features };
}

export function featLabel(id: string): string {
  return getFeat(id)?.name ?? id;
}

/**
 * Checkable prerequisites only: "Str 13+", "Dex 13+", "Int or Wis 13+", etc.
 * Prereqs the engine can't verify (spellcasting, armor proficiency) always
 * pass — the picker still shows the text, it just doesn't block on it.
 */
export function meetsPrereq(sheet: SheetData, feat: Feat): boolean {
  if (!feat.prereq) return true;
  const m = feat.prereq.match(/^(str|dex|con|int|wis|cha)(?:\s+or\s+(str|dex|con|int|wis|cha))?\s+(\d+)\+$/i);
  if (!m) return true;
  const [, a1, a2, minStr] = m;
  const min = Number(minStr);
  return [a1, a2].filter((x): x is string => !!x).some((ab) => num(sheet, ab.toLowerCase(), 10) >= min);
}

/** GWM/Sharpshooter −5 attack / +10 damage toggle, gated on the matching
 *  feat and melee-vs-ranged (SS applies to ranged weapons, GWM to melee). */
export function powerAttackBonus(sheet: SheetData, ranged: boolean): { toHit: number; damage: number } {
  if (sheet.powerAttackActive !== true) return { toHit: 0, damage: 0 };
  const want = ranged ? 'ranged' : 'melee';
  const has = takenFeats(sheet).some((f) => f.powerAttack === want);
  return has ? { toHit: -5, damage: 10 } : { toHit: 0, damage: 0 };
}

/** Whether the character could use the power-attack toggle on some weapon
 *  they own (used to decide whether to show the toggle at all). */
export function hasPowerAttackFeat(sheet: SheetData): boolean {
  return takenFeats(sheet).some((f) => f.powerAttack);
}

/** Dual Wielder: +1 AC while the player marks themself as dual-wielding. */
export function dualWielderAcBonus(sheet: SheetData): number {
  if (sheet.dualWieldingActive !== true) return 0;
  const feat = takenFeats(sheet).find((f) => f.dualWielderAc);
  return feat?.dualWielderAc ?? 0;
}

/** War Caster: advantage on concentration (CON) saves. */
export function hasConcentrationAdvantage(sheet: SheetData): boolean {
  return takenFeats(sheet).some((f) => f.concentrationAdvantage);
}

/** Martial Adept: grants a single d6 superiority die outside Battle Master. */
export function hasMartialAdeptDie(sheet: SheetData): boolean {
  return takenFeats(sheet).some((f) => f.martialAdeptDie);
}

/** Savage Attacker: once per round, reroll a melee weapon's damage dice and
 *  keep the higher total. Tracked as a `res_savageAttacker` pool (max 1,
 *  resets each round) so the existing resource-tracker UI/reset buttons work. */
export function hasSavageAttacker(sheet: SheetData): boolean {
  return takenFeats(sheet).some((f) => f.savageAttacker);
}
