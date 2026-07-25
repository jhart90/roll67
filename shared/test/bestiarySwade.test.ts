import { describe, it, expect } from 'vitest';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import { SKILLS_SWADE } from '../src/systems/swade.js';
import { roll } from '../src/dice/roller.js';

const DIE = /^d(4|6|8|10|12)$/;
const ATTRS = ['agility', 'smarts', 'spirit', 'strength', 'vigor'] as const;

describe('SWADE bestiary', () => {
  it('has grown well past the original 25 stat blocks', () => {
    expect(NPCS_SWADE.length).toBeGreaterThanOrEqual(90);
  });

  it('gives every entry a unique id and name', () => {
    const ids = NPCS_SWADE.map((n) => n.id);
    const names = NPCS_SWADE.map((n) => n.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers the genre categories the table actually needs', () => {
    const cats = new Set(NPCS_SWADE.map((n) => n.category));
    for (const c of ['People', 'Soldiers & Lawmen', 'Creatures', 'Undead & Horrors', 'Animals', 'Machines', 'Vehicles']) {
      expect(cats, `missing category ${c}`).toContain(c);
    }
  });

  it('gives every entry legal attribute dice', () => {
    for (const npc of NPCS_SWADE) {
      for (const a of ATTRS) {
        expect(npc.sheet[a], `${npc.name}.${a}`).toMatch(DIE);
      }
    }
  });

  it('only uses skills the SWADE system knows about', () => {
    const known = new Set(SKILLS_SWADE as readonly string[]);
    for (const npc of NPCS_SWADE) {
      for (const row of (npc.sheet.skills ?? []) as Array<{ name: string; die: string }>) {
        expect(known, `${npc.name} has unknown skill "${row.name}"`).toContain(row.name);
        expect(row.die, `${npc.name}.${row.name}`).toMatch(DIE);
      }
    }
  });

  it('gives every attack a rollable damage expression', () => {
    for (const npc of NPCS_SWADE) {
      for (const atk of (npc.sheet.attacks ?? []) as Array<{ name: string; damage: string }>) {
        if (!atk.damage || atk.damage === '0') continue; // save-only effects deal no dice damage
        expect(() => roll(atk.damage), `${npc.name} / ${atk.name}: "${atk.damage}"`).not.toThrow();
      }
    }
  });

  it('keeps Toughness and Parry in sane ranges', () => {
    for (const npc of NPCS_SWADE) {
      expect(npc.hp, `${npc.name} Toughness`).toBeGreaterThan(0);
      expect(npc.hp, `${npc.name} Toughness`).toBeLessThanOrEqual(60);
      expect(npc.ac, `${npc.name} Parry`).toBeGreaterThanOrEqual(0);
    }
  });

  it('scales challenge tiers with survivability', () => {
    const tier0 = NPCS_SWADE.filter((n) => n.challenge === 0);
    const tier6 = NPCS_SWADE.filter((n) => n.challenge === 6);
    expect(tier0.length).toBeGreaterThan(0);
    expect(tier6.length).toBeGreaterThan(0);
    const avg = (xs: typeof NPCS_SWADE) => xs.reduce((s, n) => s + n.hp, 0) / xs.length;
    expect(avg(tier6)).toBeGreaterThan(avg(tier0));
  });

  it('marks Wild Cards distinctly from Extras', () => {
    const labels = new Set(NPCS_SWADE.map((n) => n.challengeLabel));
    expect(labels).toEqual(new Set(['Wild Card', 'Extra']));
    expect(NPCS_SWADE.filter((n) => n.challengeLabel === 'Wild Card').length).toBeGreaterThan(5);
  });

  it('builds vehicles as spawnable tokens with armor and a crew note', () => {
    const vehicles = NPCS_SWADE.filter((n) => n.category === 'Vehicles');
    expect(vehicles.length).toBeGreaterThanOrEqual(15);
    for (const v of vehicles) {
      expect(v.sheet.armor, `${v.name} needs a chassis`).toBeTruthy();
      expect(String(v.sheet.notes ?? ''), `${v.name} should note its crew`).toMatch(/Crew/);
    }
  });
});
