// Stars Without Number (Revised) data + a level-up engine, foci, backgrounds
// and equipment packages that auto-apply their effects. Mirrors the 5e engine:
// everything numeric is applied, and features are recorded as sheet entries.
// SWN caps at level 10. Attack-bonus tables follow the class progression and
// stay editable on the sheet.

import type { SheetData } from '../types.js';
import { num, rows, str } from './types.js';

// ---------- attributes ----------

export const SWN_ATTRIBUTES = [
  { id: 'str', label: 'Strength' }, { id: 'dex', label: 'Dexterity' }, { id: 'con', label: 'Constitution' },
  { id: 'int', label: 'Intelligence' }, { id: 'wis', label: 'Wisdom' }, { id: 'cha', label: 'Charisma' },
];

function swnMod(score: number): number {
  if (score <= 3) return -2;
  if (score <= 7) return -1;
  if (score <= 13) return 0;
  if (score <= 17) return 1;
  return 2;
}

// ---------- classes ----------

export interface SwnClassDef {
  id: string;
  name: string;
  hpBonusPerLevel: number;
  /** Attack bonus by class level (index 1..10). */
  attack: number[];
  ability: string;
}

const WARRIOR_ATK = [0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8];
const PARTIAL_ATK = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5];

export const SWN_CLASSES: Record<string, SwnClassDef> = {
  warrior: {
    id: 'warrior', name: 'Warrior', hpBonusPerLevel: 2, attack: WARRIOR_ATK,
    ability: 'Veteran: +2 max HP per level, better attack bonus. Once per scene, reroll a failed attack or saving throw, or turn a hit into a critical.',
  },
  expert: {
    id: 'expert', name: 'Expert', hpBonusPerLevel: 0, attack: PARTIAL_ATK,
    ability: 'Specialist: gain an extra skill point at each level. Once per scene, reroll a failed skill check you are trained in and take the better result.',
  },
  psychic: {
    id: 'psychic', name: 'Psychic', hpBonusPerLevel: 0, attack: PARTIAL_ATK,
    ability: 'Psionic: gain psychic disciplines and Effort to power techniques. Commit Effort to fuel psychic powers; it returns when the power ends.',
  },
  adventurer: {
    id: 'adventurer', name: 'Adventurer', hpBonusPerLevel: 0, attack: PARTIAL_ATK,
    ability: 'Dual-class: combine the partial abilities of two classes (Warrior/Expert/Psychic). Attack bonus uses the partial progression.',
  },
};

export const SWN_CLASS_LIST = Object.values(SWN_CLASSES);

export function getSwnClass(id: string): SwnClassDef | undefined {
  const key = id.toLowerCase();
  return SWN_CLASSES[key] ?? SWN_CLASS_LIST.find((c) => c.name.toLowerCase() === key);
}

export function swnAttackBonus(classId: string, level: number): number {
  const cls = getSwnClass(classId);
  if (!cls) return 0;
  return cls.attack[Math.max(1, Math.min(10, Math.floor(level)))] ?? 0;
}

// ---------- skills ----------

export const SWN_SKILL_LIST = [
  'Administer', 'Connect', 'Exert', 'Fix', 'Heal', 'Know', 'Lead', 'Notice', 'Perform', 'Pilot',
  'Program', 'Punch', 'Shoot', 'Sneak', 'Stab', 'Survive', 'Talk', 'Trade', 'Work',
];

const DEFAULT_SKILL_ATTR: Record<string, string> = {
  Administer: 'int', Connect: 'cha', Exert: 'con', Fix: 'int', Heal: 'int', Know: 'int', Lead: 'cha',
  Notice: 'wis', Perform: 'cha', Pilot: 'dex', Program: 'int', Punch: 'str', Shoot: 'dex', Sneak: 'dex',
  Stab: 'dex', Survive: 'wis', Talk: 'cha', Trade: 'int', Work: 'int',
};

/** Ensure a skill row exists at ≥ `level`; returns the updated skills array. */
export function grantSkill(sheet: SheetData, skill: string, level = 0): SheetData[] {
  const skills = rows(sheet, 'skills').map((r) => ({ ...r }));
  const existing = skills.find((r) => str(r, 'name', '').toLowerCase() === skill.toLowerCase());
  if (existing) {
    if (num(existing, 'level', 0) < level) existing.level = level;
    return skills;
  }
  skills.push({ name: skill, level, attr: DEFAULT_SKILL_ATTR[skill] ?? 'int', notes: '' });
  return skills;
}

// ---------- backgrounds ----------

export interface SwnBackground {
  id: string;
  name: string;
  freeSkill: string;
  desc: string;
}

export const SWN_BACKGROUNDS: SwnBackground[] = [
  { id: 'barbarian', name: 'Barbarian', freeSkill: 'Survive', desc: 'Raised beyond civilization; hardy and self-reliant.' },
  { id: 'clergy', name: 'Clergy', freeSkill: 'Talk', desc: 'A servant of a faith or philosophy.' },
  { id: 'courtesan', name: 'Courtesan', freeSkill: 'Perform', desc: 'A companion skilled in charm and intrigue.' },
  { id: 'criminal', name: 'Criminal', freeSkill: 'Sneak', desc: 'A thief, smuggler, or worse.' },
  { id: 'dilettante', name: 'Dilettante', freeSkill: 'Connect', desc: 'A well-connected idler of many minor talents.' },
  { id: 'entertainer', name: 'Entertainer', freeSkill: 'Perform', desc: 'A performer who plies the stars for an audience.' },
  { id: 'merchant', name: 'Merchant', freeSkill: 'Trade', desc: 'A trader who knows the value of things.' },
  { id: 'noble', name: 'Noble', freeSkill: 'Lead', desc: 'Born or elevated to rule.' },
  { id: 'official', name: 'Official', freeSkill: 'Administer', desc: 'A bureaucrat versed in institutions.' },
  { id: 'peasant', name: 'Peasant', freeSkill: 'Exert', desc: 'A laborer from a low-tech or agrarian world.' },
  { id: 'physician', name: 'Physician', freeSkill: 'Heal', desc: 'A trained healer.' },
  { id: 'pilot', name: 'Pilot', freeSkill: 'Pilot', desc: 'A flyer of atmosphere or void craft.' },
  { id: 'politician', name: 'Politician', freeSkill: 'Talk', desc: 'A worker of crowds and power.' },
  { id: 'scholar', name: 'Scholar', freeSkill: 'Know', desc: 'A student of history, science, or lore.' },
  { id: 'soldier', name: 'Soldier', freeSkill: 'Shoot', desc: 'A trained fighter from an organized force.' },
  { id: 'spacer', name: 'Spacer', freeSkill: 'Fix', desc: 'Born or bred to shipboard life.' },
  { id: 'technician', name: 'Technician', freeSkill: 'Fix', desc: 'A mender of machines and systems.' },
  { id: 'thug', name: 'Thug', freeSkill: 'Punch', desc: 'A brawler and enforcer.' },
  { id: 'vagabond', name: 'Vagabond', freeSkill: 'Survive', desc: 'A drifter who lives by their wits.' },
  { id: 'worker', name: 'Worker', freeSkill: 'Work', desc: 'A laborer of factory, farm, or dock.' },
];

export function getSwnBackground(id: string): SwnBackground | undefined {
  const key = id.toLowerCase();
  return SWN_BACKGROUNDS.find((b) => b.id === key || b.name.toLowerCase() === key);
}

/** Set the background and grant its free skill. */
export function applyBackground(sheet: SheetData, id: string): SheetData {
  const bg = getSwnBackground(id);
  if (!bg) return {};
  return { background: bg.name, skills: grantSkill(sheet, bg.freeSkill, 0) };
}

// ---------- foci ----------

export interface SwnFocus {
  id: string;
  name: string;
  combat: boolean;
  /** Skill this focus grants a level in. */
  grantsSkill?: string;
  /** Half-focus that also boosts max HP per level (Die Hard). */
  hpPerLevel?: number;
  level1: string;
  level2?: string;
}

export const SWN_FOCI: SwnFocus[] = [
  { id: 'alert', name: 'Alert', combat: false, grantsSkill: 'Notice', level1: 'Roll surprise twice, keep the better; +1 AC in the first round of combat.', level2: 'You can never be surprised; +2 initiative.' },
  { id: 'armsman', name: 'Armsman', combat: true, grantsSkill: 'Punch', level1: 'Unarmed/melee shock rating counts as one higher; +1 to hit unarmed or melee.', level2: 'Unarmed strikes hit as if armed; ignore shock resistance.' },
  { id: 'assassin', name: 'Assassin', combat: true, grantsSkill: 'Stab', level1: 'Deal max weapon damage to an unaware target; +2 to hit them.', level2: 'Add 1d6 damage per Stab skill level against surprised foes.' },
  { id: 'authority', name: 'Authority', combat: false, grantsSkill: 'Lead', level1: 'People assume you have the right to command; +2 to overawe or direct.', level2: 'Once per scene, force a NPC morale check as if badly beaten.' },
  { id: 'close-combat', name: 'Close Combat', combat: true, level1: 'Draw a weapon as an on-turn free action; no penalty firing into melee; +2 AC vs adjacent foes.', level2: 'Ranged attacks in melee that miss can retarget an adjacent foe.' },
  { id: 'connected', name: 'Connected', combat: false, grantsSkill: 'Connect', level1: 'On any world you can find a useful contact after a day of searching.', level2: 'Once per session, a contact provides a modest favor or resource.' },
  { id: 'diplomat', name: 'Diplomat', combat: false, grantsSkill: 'Talk', level1: 'Take 10 minutes to defuse hostility short of active violence.', level2: 'Force a parley; foes who break it take a morale penalty.' },
  { id: 'die-hard', name: 'Die Hard', combat: false, hpPerLevel: 2, level1: '+2 maximum HP per level; +2 to saves vs death and toxins.', level2: 'Stabilize automatically; act for one round at 0 HP before falling.' },
  { id: 'gunslinger', name: 'Gunslinger', combat: true, grantsSkill: 'Shoot', level1: 'Ready and fire a sidearm as one action; +1 to hit with pistols.', level2: 'Sidearm shock rating increases by 2.' },
  { id: 'hacker', name: 'Hacker', combat: false, grantsSkill: 'Program', level1: 'Improvise tools for cyberspace intrusion; +2 vs security.', level2: 'Once per scene, retry a failed Program check with advantage.' },
  { id: 'healer', name: 'Healer', combat: false, grantsSkill: 'Heal', level1: 'Restore 1d6 + Heal HP to a patient once per day with a medkit.', level2: 'Patients heal at double the natural rate under your care.' },
  { id: 'henchkeeper', name: 'Henchkeeper', combat: false, grantsSkill: 'Connect', level1: 'You have a devoted henchman NPC who advances with you.', level2: 'Your henchman gains a focus and improved loyalty.' },
  { id: 'ironhide', name: 'Ironhide', combat: false, level1: 'Natural AC 13 when unarmored (does not stack with worn armor).', level2: 'Natural AC becomes 15 when unarmored.' },
  { id: 'sniper', name: 'Sniper', combat: true, grantsSkill: 'Shoot', level1: 'Aim as an action for +4 to hit and doubled range on your next shot.', level2: 'Aimed shots add your Shoot skill in extra damage dice.' },
  { id: 'specialist', name: 'Specialist', combat: false, level1: 'Pick one skill: roll it with 3d6 keep-2, and treat a 7 as an 8.', level2: 'Choose a second specialist skill.' },
  { id: 'star-captain', name: 'Star Captain', combat: false, grantsSkill: 'Lead', level1: 'Grant allies your Lead bonus on a shared task; ships you command run smoother.', level2: 'Once per scene, let an ally reroll a failed check.' },
  { id: 'tinker', name: 'Tinker', combat: false, grantsSkill: 'Fix', level1: 'Jury-rig broken tech for a scene; +2 to improvise repairs.', level2: 'Permanently improve a device once per downtime.' },
  { id: 'unarmed-combatant', name: 'Unarmed Combatant', combat: true, grantsSkill: 'Punch', level1: 'Unarmed strikes do 1d6 + shock; +1 to hit unarmed.', level2: 'Unarmed strikes do 1d8; grapples are far harder to escape.' },
  { id: 'wanderer', name: 'Wanderer', combat: false, grantsSkill: 'Survive', level1: 'Never lost in the wild; find food and water for a small group.', level2: 'Guide a group at full pace through hostile terrain.' },
  { id: 'shocking-assault', name: 'Shocking Assault', combat: true, level1: 'On a melee hit, add your character level to the weapon shock damage.', level2: 'Melee shock applies even against foes normally immune.' },
  { id: 'savage-fray', name: 'Savage Fray', combat: true, level1: 'Drop a foe in melee and you may immediately move and strike again.', level2: 'The bonus attack can target any foe within your movement.' },
  { id: 'whirlwind-assault', name: 'Whirlwind Assault', combat: true, level1: 'Make a melee attack against every adjacent enemy once per scene.', level2: 'Use Whirlwind Assault as often as you like.' },
];

export function getSwnFocus(id: string): SwnFocus | undefined {
  const key = id.toLowerCase();
  return SWN_FOCI.find((f) => f.id === key || f.name.toLowerCase() === key);
}

export function takenFocusIds(sheet: SheetData): string[] {
  const v = sheet.foci;
  return Array.isArray(v) ? (v as SheetData[]).map((r) => str(r, 'id', '')).filter(Boolean) : [];
}

/** Add or level-up a focus, granting its skill and applying HP boosts. */
export function applyFocus(sheet: SheetData, id: string): SheetData {
  const focus = getSwnFocus(id);
  if (!focus) return {};
  const list = rows(sheet, 'foci').map((r) => ({ ...r }));
  const existing = list.find((r) => str(r, 'id', '') === focus.id);
  const newLevel = existing ? Math.min(2, num(existing, 'level', 1) + 1) : 1;
  const desc = newLevel >= 2 && focus.level2 ? focus.level2 : focus.level1;
  if (existing) { existing.level = newLevel; existing.notes = desc; }
  else list.push({ id: focus.id, name: focus.name, level: 1, combat: focus.combat, notes: focus.level1 });

  const patch: SheetData = { foci: list };
  if (focus.grantsSkill && !existing) patch.skills = grantSkill({ ...sheet }, focus.grantsSkill, 0);
  if (focus.hpPerLevel && !existing) {
    const add = focus.hpPerLevel * Math.max(1, num(sheet, 'level', 1));
    patch.maxHp = num(sheet, 'maxHp', 0) + add;
    patch.hp = num(sheet, 'hp', 0) + add;
  }
  return patch;
}

// ---------- equipment packages ----------

export interface SwnPackage {
  id: string;
  name: string;
  desc: string;
  weapons: Array<{ name: string; bonus?: number; damage: string; range?: number; notes?: string }>;
  armor: Array<{ name: string; ac: number; notes?: string }>;
  items: Array<{ name: string; qty?: number; enc?: number; notes?: string }>;
  credits: number;
}

export const SWN_PACKAGES: SwnPackage[] = [
  {
    id: 'soldier', name: 'A — Soldier', desc: 'Front-line combatant kit.', credits: 50,
    weapons: [{ name: 'Combat Rifle', damage: '1d12', range: 100, notes: 'ranged' }, { name: 'Knife', damage: '1d4', range: 5 }],
    armor: [{ name: 'Combat Field Uniform', ac: 15 }],
    items: [{ name: 'Ammo x2', qty: 2 }, { name: 'Compad' }, { name: 'Backpack' }, { name: 'Rations x7', qty: 7 }],
  },
  {
    id: 'scoundrel', name: 'B — Scoundrel', desc: 'Sneak and sidearm.', credits: 150,
    weapons: [{ name: 'Semi-Auto Pistol', damage: '1d6+1', range: 30, notes: 'ranged' }, { name: 'Monoblade Knife', damage: '1d6', range: 5 }],
    armor: [{ name: 'Woven Bodysuit', ac: 13 }],
    items: [{ name: 'Ammo x2', qty: 2 }, { name: 'Lockpick / Datajack tools' }, { name: 'Compad' }, { name: 'Climbing gear' }],
  },
  {
    id: 'technician', name: 'C — Technician', desc: 'Fixer and field engineer.', credits: 100,
    weapons: [{ name: 'Semi-Auto Pistol', damage: '1d6+1', range: 30, notes: 'ranged' }],
    armor: [{ name: 'Woven Bodysuit', ac: 13 }],
    items: [{ name: "Postech toolkit" }, { name: 'Metatool' }, { name: 'Compad' }, { name: 'Spare parts' }, { name: 'Vacc skin' }],
  },
  {
    id: 'spacer', name: 'D — Spacer', desc: 'Voidfarer essentials.', credits: 120,
    weapons: [{ name: 'Semi-Auto Pistol', damage: '1d6+1', range: 30, notes: 'ranged' }],
    armor: [{ name: 'Vacc Suit', ac: 13, notes: 'sealed' }],
    items: [{ name: 'Compad' }, { name: 'Toolkit' }, { name: 'Oxygen supply' }, { name: 'Grav chute' }],
  },
  {
    id: 'diplomat', name: 'E — Face', desc: 'Talker and negotiator.', credits: 400,
    weapons: [{ name: 'Holdout Pistol', damage: '1d6', range: 20, notes: 'concealable' }],
    armor: [{ name: 'Armored Undersuit', ac: 12, notes: 'concealed' }],
    items: [{ name: 'Fine clothing' }, { name: 'Compad' }, { name: 'Bribe fund tokens' } ],
  },
  {
    id: 'psychic', name: 'F — Psychic', desc: 'Mind over matter.', credits: 200,
    weapons: [{ name: 'Semi-Auto Pistol', damage: '1d6+1', range: 30, notes: 'ranged' }],
    armor: [{ name: 'Woven Bodysuit', ac: 13 }],
    items: [{ name: 'Compad' }, { name: 'Rations x7', qty: 7 }, { name: 'Meditation focus' }],
  },
];

export function getSwnPackage(id: string): SwnPackage | undefined {
  return SWN_PACKAGES.find((p) => p.id === id);
}

/** Add a package's weapons/armor/gear + credits to the sheet. */
export function applyPackage(sheet: SheetData, id: string): SheetData {
  const pkg = getSwnPackage(id);
  if (!pkg) return {};
  const attacks = rows(sheet, 'attacks').map((r) => ({ ...r }));
  for (const w of pkg.weapons) attacks.push({ name: w.name, bonus: w.bonus ?? 0, damage: w.damage, range: w.range ?? 5, notes: w.notes ?? '' });
  const armor = rows(sheet, 'armor').map((r) => ({ ...r }));
  for (const a of pkg.armor) armor.push({ name: a.name, ac: a.ac, notes: a.notes ?? '' });
  const inventory = rows(sheet, 'inventory').map((r) => ({ ...r }));
  for (const it of pkg.items) inventory.push({ name: it.name, qty: it.qty ?? 1, enc: it.enc ?? 1, notes: it.notes ?? 'package' });
  return { attacks, armor, inventory, credits: num(sheet, 'credits', 0) + pkg.credits };
}

// ---------- level-up ----------

export interface SwnLevelPlan {
  classId: string;
  className: string;
  fromLevel: number;
  toLevel: number;
  attackBonus: number;
  ability: string;
  first: boolean;
  hpBonusPerLevel: number;
  /** Fixed HP at level 1 (max hit die + CON + class bonus). */
  firstHp: number;
  /** Average HP gained per later level. */
  avgHp: number;
}

export function planLevelUpSwn(sheet: SheetData, classId: string, toLevel: number): SwnLevelPlan | null {
  const cls = getSwnClass(classId);
  if (!cls) return null;
  const conMod = swnMod(num(sheet, 'con', 10));
  const first = toLevel <= 1;
  return {
    classId: cls.id, className: cls.name,
    fromLevel: num(sheet, 'level', 0), toLevel,
    attackBonus: swnAttackBonus(cls.id, toLevel),
    ability: cls.ability, first,
    hpBonusPerLevel: cls.hpBonusPerLevel,
    firstHp: Math.max(1, 6 + conMod + cls.hpBonusPerLevel),
    avgHp: Math.max(1, 4 + conMod + cls.hpBonusPerLevel),
  };
}

export interface SwnLevelChoices {
  hpGained: number;
  background?: string;
}

export function applyLevelUpSwn(sheet: SheetData, classId: string, toLevel: number, choices: SwnLevelChoices): SheetData {
  const cls = getSwnClass(classId);
  if (!cls) return {};
  const first = toLevel <= 1;
  const gain = Math.max(1, Math.floor(choices.hpGained));
  const patch: SheetData = {
    level: toLevel,
    class: cls.name,
    attackBonus: swnAttackBonus(cls.id, toLevel),
  };
  if (first) {
    patch.maxHp = gain;
    patch.hp = gain;
    // Record the class ability among the character's foci/abilities.
    const foci = rows(sheet, 'foci').map((r) => ({ ...r }));
    if (!foci.some((r) => str(r, 'id', '') === `class-${cls.id}`)) {
      foci.push({ id: `class-${cls.id}`, name: `${cls.name} (class)`, level: 1, combat: false, notes: cls.ability });
    }
    patch.foci = foci;
    if (choices.background) {
      const bgPatch = applyBackground({ ...sheet, ...patch }, choices.background);
      Object.assign(patch, bgPatch);
    }
  } else {
    patch.maxHp = num(sheet, 'maxHp', 0) + gain;
    patch.hp = num(sheet, 'hp', 0) + gain;
  }
  return patch;
}
