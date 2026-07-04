import type { SheetData } from '../types.js';
import { fmtMod, num, rows, str } from './types.js';
import { getClass5e } from './classes5e.js';

/**
 * DMG "Monster Statistics by Challenge Rating" (p.274): the approximate AC,
 * HP, attack bonus, damage-per-round, and save DC a monster of a given CR
 * should have. Used to generically "level up" NPCs that have no PC class
 * (almost all of them — the compendium/NPC library hardcodes `class:
 * "Monster"`), since the PC leveling wizard has nothing to apply for them.
 */
export interface CrTier {
  cr: number;
  label: string;
  ac: number;
  hpMin: number;
  hpMax: number;
  atk: number;
  dprMin: number;
  dprMax: number;
  dc: number;
}

export const CR_TABLE_5E: CrTier[] = [
  { cr: 0, label: '0', ac: 13, hpMin: 1, hpMax: 6, atk: 3, dprMin: 0, dprMax: 1, dc: 13 },
  { cr: 0.125, label: '1/8', ac: 13, hpMin: 7, hpMax: 35, atk: 3, dprMin: 2, dprMax: 3, dc: 13 },
  { cr: 0.25, label: '1/4', ac: 13, hpMin: 36, hpMax: 49, atk: 3, dprMin: 4, dprMax: 5, dc: 13 },
  { cr: 0.5, label: '1/2', ac: 13, hpMin: 50, hpMax: 70, atk: 3, dprMin: 6, dprMax: 8, dc: 13 },
  { cr: 1, label: '1', ac: 13, hpMin: 71, hpMax: 85, atk: 3, dprMin: 9, dprMax: 14, dc: 13 },
  { cr: 2, label: '2', ac: 13, hpMin: 86, hpMax: 100, atk: 3, dprMin: 15, dprMax: 20, dc: 13 },
  { cr: 3, label: '3', ac: 13, hpMin: 101, hpMax: 115, atk: 4, dprMin: 21, dprMax: 26, dc: 13 },
  { cr: 4, label: '4', ac: 14, hpMin: 116, hpMax: 130, atk: 5, dprMin: 27, dprMax: 32, dc: 14 },
  { cr: 5, label: '5', ac: 15, hpMin: 131, hpMax: 145, atk: 6, dprMin: 33, dprMax: 38, dc: 15 },
  { cr: 6, label: '6', ac: 15, hpMin: 146, hpMax: 160, atk: 6, dprMin: 39, dprMax: 44, dc: 15 },
  { cr: 7, label: '7', ac: 15, hpMin: 161, hpMax: 175, atk: 6, dprMin: 45, dprMax: 50, dc: 15 },
  { cr: 8, label: '8', ac: 16, hpMin: 176, hpMax: 190, atk: 7, dprMin: 51, dprMax: 56, dc: 16 },
  { cr: 9, label: '9', ac: 16, hpMin: 191, hpMax: 205, atk: 7, dprMin: 57, dprMax: 62, dc: 16 },
  { cr: 10, label: '10', ac: 17, hpMin: 206, hpMax: 220, atk: 7, dprMin: 63, dprMax: 68, dc: 16 },
  { cr: 11, label: '11', ac: 17, hpMin: 221, hpMax: 235, atk: 8, dprMin: 69, dprMax: 74, dc: 17 },
  { cr: 12, label: '12', ac: 17, hpMin: 236, hpMax: 250, atk: 8, dprMin: 75, dprMax: 80, dc: 17 },
  { cr: 13, label: '13', ac: 18, hpMin: 251, hpMax: 265, atk: 8, dprMin: 81, dprMax: 86, dc: 18 },
  { cr: 14, label: '14', ac: 18, hpMin: 266, hpMax: 280, atk: 8, dprMin: 87, dprMax: 92, dc: 18 },
  { cr: 15, label: '15', ac: 18, hpMin: 281, hpMax: 295, atk: 8, dprMin: 93, dprMax: 98, dc: 18 },
  { cr: 16, label: '16', ac: 18, hpMin: 296, hpMax: 310, atk: 9, dprMin: 99, dprMax: 104, dc: 18 },
  { cr: 17, label: '17', ac: 19, hpMin: 311, hpMax: 325, atk: 10, dprMin: 105, dprMax: 110, dc: 19 },
  { cr: 18, label: '18', ac: 19, hpMin: 326, hpMax: 340, atk: 10, dprMin: 111, dprMax: 116, dc: 19 },
  { cr: 19, label: '19', ac: 19, hpMin: 341, hpMax: 355, atk: 10, dprMin: 117, dprMax: 122, dc: 19 },
  { cr: 20, label: '20', ac: 19, hpMin: 356, hpMax: 400, atk: 10, dprMin: 123, dprMax: 140, dc: 19 },
  { cr: 21, label: '21', ac: 19, hpMin: 401, hpMax: 445, atk: 11, dprMin: 141, dprMax: 158, dc: 20 },
  { cr: 22, label: '22', ac: 19, hpMin: 446, hpMax: 490, atk: 11, dprMin: 159, dprMax: 176, dc: 20 },
  { cr: 23, label: '23', ac: 19, hpMin: 491, hpMax: 535, atk: 11, dprMin: 177, dprMax: 194, dc: 20 },
  { cr: 24, label: '24', ac: 19, hpMin: 536, hpMax: 580, atk: 12, dprMin: 195, dprMax: 212, dc: 21 },
  { cr: 25, label: '25', ac: 19, hpMin: 581, hpMax: 625, atk: 12, dprMin: 213, dprMax: 230, dc: 21 },
  { cr: 26, label: '26', ac: 19, hpMin: 626, hpMax: 670, atk: 12, dprMin: 231, dprMax: 248, dc: 21 },
  { cr: 27, label: '27', ac: 19, hpMin: 671, hpMax: 715, atk: 13, dprMin: 249, dprMax: 266, dc: 22 },
  { cr: 28, label: '28', ac: 19, hpMin: 716, hpMax: 760, atk: 13, dprMin: 267, dprMax: 284, dc: 22 },
  { cr: 29, label: '29', ac: 19, hpMin: 761, hpMax: 805, atk: 13, dprMin: 285, dprMax: 302, dc: 22 },
  { cr: 30, label: '30', ac: 19, hpMin: 806, hpMax: 850, atk: 14, dprMin: 303, dprMax: 320, dc: 23 },
];

/** True when this sheet's `class` text isn't a recognized PC class — the
 *  signal that the PC-style Level Up wizard has nothing to work with and the
 *  generic CR-based boost should be offered instead. Blank `class` (a brand
 *  new sheet) is NOT included — that's the normal first-time PC setup case. */
export function needsNpcBoost(classText: string): boolean {
  const trimmed = classText.trim();
  return trimmed.length > 0 && !getClass5e(trimmed);
}

/** The CR_TABLE_5E row whose HP band best matches the sheet's current max HP. */
function currentCrIndex(sheet: SheetData): number {
  const hp = num(sheet, 'maxHp', 10);
  let idx = 0;
  for (let i = 0; i < CR_TABLE_5E.length; i++) {
    if (hp >= CR_TABLE_5E[i].hpMin) idx = i;
  }
  return idx;
}

export interface NpcBoostPlan {
  fromCr: string;
  toCr: string;
  steps: number;
  newMaxHp: number;
  newAc: number;
  attackBonusGain: number;
  damageBonusGain: number;
  newLevel: number;
  /** Informational only — an approximate spell save DC a caster at the new
   *  tier should have (5e's derive() computes the real one from level/ability,
   *  this is just what the CR table would suggest as a sanity check). */
  approxSaveDc: number;
}

/** Compute what boosting this NPC up `steps` CR tiers would look like. */
export function planNpcBoost(sheet: SheetData, steps = 1): NpcBoostPlan {
  const fromIdx = currentCrIndex(sheet);
  const toIdx = Math.min(CR_TABLE_5E.length - 1, fromIdx + Math.max(1, steps));
  const from = CR_TABLE_5E[fromIdx];
  const to = CR_TABLE_5E[toIdx];
  const curAc = num(sheet, 'ac', 10);
  const curHp = num(sheet, 'maxHp', 10);
  return {
    fromCr: from.label,
    toCr: to.label,
    steps: toIdx - fromIdx,
    newMaxHp: Math.max(curHp + 1, Math.round((to.hpMin + to.hpMax) / 2)),
    newAc: Math.max(curAc, to.ac),
    attackBonusGain: Math.max(0, to.atk - from.atk),
    // DPR is tracked across the whole stat block, not per-attack — split the
    // gain in two so a typical 1-2-attack monster lands close to the table.
    damageBonusGain: Math.max(0, Math.round(((to.dprMin + to.dprMax) / 2 - (from.dprMin + from.dprMax) / 2) / 2)),
    newLevel: Math.max(1, Math.round(to.cr)),
    approxSaveDc: to.dc,
  };
}

/** Append (or increase an existing trailing) flat modifier on a damage
 *  expression, e.g. "2d8+3" + 2 -> "2d8+5", "1d6" + 2 -> "1d6+2". */
function bumpDamageExpr(expr: string, bonus: number): string {
  const trimmed = expr.trim();
  if (!trimmed || bonus <= 0) return expr;
  const m = trimmed.match(/^(.*?)([+-]\d+)\s*$/);
  if (m) return `${m[1]}${fmtMod(Number(m[2]) + bonus)}`;
  return `${trimmed}+${bonus}`;
}

/** Build the sheet patch for an NPC CR boost: HP/AC rise directly, every
 *  attack row's bonus/damage rises by the same flat amount (monsters bake
 *  these in as plain numbers rather than deriving them from level+ability),
 *  and `level` rises so any spellcasting NPC's derived save DC/attack — which
 *  DOES scale off level+ability — moves up too. */
export function applyNpcBoost(sheet: SheetData, plan: NpcBoostPlan): SheetData {
  const patch: SheetData = {
    maxHp: plan.newMaxHp,
    hp: Math.min(plan.newMaxHp, num(sheet, 'hp', 0) + (plan.newMaxHp - num(sheet, 'maxHp', 0))),
    ac: plan.newAc,
    level: plan.newLevel,
  };
  if (plan.attackBonusGain > 0 || plan.damageBonusGain > 0) {
    patch.attacks = rows(sheet, 'attacks').map((a) => ({
      ...a,
      bonus: num(a, 'bonus', 0) + plan.attackBonusGain,
      damage: bumpDamageExpr(str(a, 'damage', ''), plan.damageBonusGain),
    }));
  }
  return patch;
}
