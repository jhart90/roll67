import { swadePace, swadeParry, swadeToughness, type GameSystem, type SheetData } from 'shared';

/**
 * System-appropriate stat columns for the NPC pickers. 5e/SWN keep the
 * classic AC/HP pair; SWADE has no hit points — attacks target Parry, damage
 * targets Toughness, and Pace decides who closes or escapes — so those are
 * the numbers a DM actually shops by.
 */
export interface NpcStatCol {
  label: string;
  /** Header tooltip explaining what the number means. */
  title: string;
  cell: (row: { ac: number; hp: number; sheet: SheetData }) => string | number;
}

export function npcStatCols(system: GameSystem): NpcStatCol[] {
  if (system === 'swade') {
    return [
      { label: 'Parry', title: 'Melee attacks must meet or beat this (TN)', cell: (r) => swadeParry(r.sheet) },
      { label: 'Tough', title: 'Damage rolls must meet or beat this to Shake or wound (armor included)', cell: (r) => swadeToughness(r.sheet) },
      { label: 'Pace', title: 'Hexes of movement per turn', cell: (r) => swadePace(r.sheet) },
    ];
  }
  return [
    { label: 'AC', title: 'Armor Class — attacks must meet or beat this', cell: (r) => r.ac },
    { label: 'HP', title: 'Hit points', cell: (r) => r.hp },
  ];
}

/** The stat used by the "toughest first" sort: Toughness in SWADE, HP elsewhere. */
export function npcDurability(system: GameSystem, row: { hp: number; sheet: SheetData }): number {
  return system === 'swade' ? swadeToughness(row.sheet) : row.hp;
}

/** "Bite 1d12!+1d8! · Tail Sweep 1d12!+1d6!" — for row hover tooltips. */
export function npcAttackSummary(sheet: SheetData): string {
  const rows = Array.isArray(sheet.attacks) ? (sheet.attacks as SheetData[]) : [];
  const parts = rows
    .filter((a) => typeof a.damage === 'string' && a.damage !== '0' && a.damage !== '')
    .slice(0, 3)
    .map((a) => `${a.name} ${a.damage}`);
  return parts.join(' · ');
}
