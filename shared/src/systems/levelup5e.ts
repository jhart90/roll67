import type { SheetData } from '../types.js';
import { num, rows, str } from './types.js';
import {
  getClass5e, profBonusForLevel, spellSlotsForClass, type ClassFeature,
} from './classes5e.js';

export interface LevelUpPlan {
  classId: string;
  className: string;
  fromLevel: number;
  toLevel: number;
  hitDie: number;
  /** Class (chassis) features gained at the target level. */
  featuresGained: ClassFeature[];
  /** The subclass grants a feature at the target level. */
  gainsSubclassFeature: boolean;
  /** Must choose a subclass at this level (and none is set yet). */
  needsSubclass: boolean;
  subclassLabel: string;
  subclasses: string[];
  /** Ability Score Improvement / feat at this level. */
  asi: boolean;
  /** Number of skill proficiencies to choose (first level only). */
  needsSkills: number;
  skillList: string[];
  spellAbility?: string;
  isCaster: boolean;
  /** Spell slots [L1..L9] at the target level. */
  spellSlots: number[];
  profBonus: number;
  /** Average HP gained (rounded up half die) + CON mod. */
  avgHp: number;
  /** True when this is the character's first level in the class (initial setup). */
  first: boolean;
  /** Fixed HP for the first level (max hit die + CON mod). */
  firstHp: number;
}

/** Compute what leveling this character into `classId` at `toLevel` grants. */
export function planLevelUp(sheet: SheetData, classId: string, toLevel: number): LevelUpPlan | null {
  const cls = getClass5e(classId);
  if (!cls) return null;
  const fromLevel = num(sheet, 'level', 0);
  const conMod = Math.floor((num(sheet, 'con', 10) - 10) / 2);
  const hasSubclass = str(sheet, 'subclass', '').trim().length > 0;
  const first = str(sheet, 'class', '').trim().length === 0;
  const roundUp = cls.id === 'artificer';
  return {
    classId: cls.id, className: cls.name, fromLevel, toLevel, hitDie: cls.hitDie,
    featuresGained: cls.features.filter((f) => f.level === toLevel),
    gainsSubclassFeature: cls.subclassFeatureLevels.includes(toLevel),
    needsSubclass: toLevel >= cls.subclassLevel && !hasSubclass,
    subclassLabel: cls.subclassLabel,
    subclasses: cls.subclasses,
    asi: cls.asiLevels.includes(toLevel),
    needsSkills: first ? cls.skillCount : 0,
    skillList: cls.skillList,
    spellAbility: cls.spellAbility,
    isCaster: cls.caster !== 'none',
    spellSlots: spellSlotsForClass(cls.caster, toLevel, roundUp),
    profBonus: profBonusForLevel(toLevel),
    avgHp: Math.max(1, Math.floor(cls.hitDie / 2) + 1 + conMod),
    first,
    firstHp: Math.max(1, cls.hitDie + conMod),
  };
}

export interface LevelUpChoices {
  /** HP gained this level (rolled or average). */
  hpGained: number;
  subclass?: string;
  /** ASI: +1 to a and b (same ability twice = +2), or a named feat. */
  asi?: { mode: 'asi' | 'feat'; a?: string; b?: string; featName?: string; featText?: string };
  /** First-level skill proficiency ids. */
  skills?: string[];
}

/** Build the sheet patch that applies a level-up + the player's choices. */
export function applyLevelUp(sheet: SheetData, classId: string, toLevel: number, choices: LevelUpChoices): SheetData {
  const cls = getClass5e(classId);
  if (!cls) return {};
  const first = str(sheet, 'class', '').trim().length === 0;
  const patch: SheetData = { level: toLevel, class: cls.name };

  // HP: level 1 sets max to the rolled/max value; later levels add and heal.
  const gain = Math.max(1, Math.floor(choices.hpGained));
  if (first) {
    patch.maxHp = gain;
    patch.hp = gain;
  } else {
    patch.maxHp = num(sheet, 'maxHp', 0) + gain;
    patch.hp = num(sheet, 'hp', 0) + gain;
  }

  // First level of the class: saves, hit die, spellcasting, skill picks.
  if (first) {
    patch[`save_${cls.saves[0]}`] = true;
    patch[`save_${cls.saves[1]}`] = true;
    patch.hitDice = `1d${cls.hitDie}`;
    if (cls.spellAbility) { patch.spellAbility = cls.spellAbility; patch.spellClass = cls.name; }
    for (const s of choices.skills ?? []) patch[`skill_${s}`] = true;
  }

  if (choices.subclass) patch.subclass = choices.subclass;

  // Ability Score Improvement (+1 to each of a/b; a===b yields +2, capped at 20).
  if (choices.asi?.mode === 'asi') {
    const merged = { ...sheet, ...patch };
    for (const ab of [choices.asi.a, choices.asi.b]) {
      if (!ab) continue;
      const cur = num(merged, ab, 10);
      const next = Math.min(20, cur + 1);
      patch[ab] = next;
      merged[ab] = next;
    }
  }

  // Spell slots: set absolutely from the class table at the new level.
  if (cls.caster !== 'none') {
    const slots = spellSlotsForClass(cls.caster, toLevel, cls.id === 'artificer');
    for (let i = 0; i < 9; i++) patch[`slots${i + 1}`] = slots[i];
  }

  // Record features (class chassis, a subclass-feature marker, and any feat).
  const featureRows = rows(sheet, 'features').slice();
  for (const feat of cls.features.filter((f) => f.level === toLevel)) {
    featureRows.push({ name: feat.name, source: `${cls.name} ${toLevel}`, description: feat.desc });
  }
  if (cls.subclassFeatureLevels.includes(toLevel)) {
    const sc = choices.subclass || str({ ...sheet, ...patch }, 'subclass', cls.subclassLabel);
    featureRows.push({ name: `${sc} feature`, source: `${sc} ${toLevel}`, description: 'See your subclass for this level’s feature.' });
  }
  if (choices.asi?.mode === 'feat' && choices.asi.featName?.trim()) {
    featureRows.push({ name: choices.asi.featName.trim(), source: `Feat ${toLevel}`, description: choices.asi.featText ?? '' });
  }
  patch.features = featureRows;

  return patch;
}
