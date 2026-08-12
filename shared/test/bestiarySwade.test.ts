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
    for (const c of ['People', 'Soldiers & Lawmen', 'Creatures', 'Undead & Horrors', 'Animals', 'Machines', 'Vehicles', 'Dinosaurs', 'Robo-Dinosaurs']) {
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

  it('keeps most dinosaurs inside Novice-party reach', () => {
    const dinos = NPCS_SWADE.filter((n) => n.category === 'Dinosaurs');
    expect(dinos.length).toBeGreaterThanOrEqual(15);
    // The bulk of the roster should be tier 0-2 so a starting party has real choices.
    const novice = dinos.filter((n) => n.challenge <= 2);
    expect(novice.length).toBeGreaterThan(dinos.length / 2);
    for (const d of novice) {
      expect(d.hp, `${d.name} is too tough for Novices`).toBeLessThanOrEqual(18);
      const armor = (d.sheet.armor ?? []) as Array<{ armor?: number }>;
      const worst = Math.max(0, ...armor.map((a) => a.armor ?? 0));
      expect(worst, `${d.name} armor outclasses Novice damage`).toBeLessThanOrEqual(5);
    }
  });

  it('pitches robo-dinosaurs above their organic counterparts', () => {
    const robos = NPCS_SWADE.filter((n) => n.category === 'Robo-Dinosaurs');
    expect(robos.length).toBeGreaterThanOrEqual(8);
    for (const r of robos) {
      expect(r.sheet.armor, `${r.name} needs plating`).toBeTruthy();
      expect(String(r.sheet.immune ?? ''), `${r.name} should be a construct`).toMatch(/poison/);
    }
    const avg = (xs: typeof NPCS_SWADE) => xs.reduce((s, n) => s + n.challenge, 0) / xs.length;
    expect(avg(robos)).toBeGreaterThan(avg(NPCS_SWADE.filter((n) => n.category === 'Dinosaurs')));
  });

  it('gives the Robo T-Rex boss the full boss kit', () => {
    const boss = NPCS_SWADE.find((n) => n.name === 'Robo T-Rex');
    expect(boss, 'Robo T-Rex should exist').toBeTruthy();
    expect(boss!.challengeLabel).toBe('Wild Card');
    const attacks = (boss!.sheet.attacks ?? []) as Array<{ name: string; damage: string }>;
    // A melee threat, an area attack, a ranged option and a fear effect.
    expect(attacks.length).toBeGreaterThanOrEqual(4);
    expect(boss!.hp).toBeGreaterThan(35);
    expect(String(boss!.sheet.notes ?? '')).toMatch(/[Ww]eak point/);
  });

  it('builds vehicles as spawnable tokens with armor and a crew note', () => {
    const vehicles = NPCS_SWADE.filter((n) => n.category === 'Vehicles');
    expect(vehicles.length).toBeGreaterThanOrEqual(15);
    for (const v of vehicles) {
      expect(v.sheet.armor, `${v.name} needs a chassis`).toBeTruthy();
      expect(String(v.sheet.notes ?? ''), `${v.name} should note its crew`).toMatch(/Crew/);
    }
  });

  /**
   * The Spice Coast set is a whole scenario's cast — two ships and both their
   * crews plus the port around them — pitched at six Novices with one Advance
   * apiece. What it must keep is the pitch: Extras a starting party can
   * actually fight, and no boss it cannot reach.
   */
  describe('the Spice Coast scenario set', () => {
    const spice = NPCS_SWADE.filter((n) => n.category === 'Spice Coast (Scenario)');
    const extras = spice.filter((n) => n.challengeLabel === 'Extra' && !/Indiaman|Brigantine/.test(n.name));

    it('fields both ships and both crews', () => {
      expect(spice.length).toBeGreaterThanOrEqual(30);
      for (const ship of ['East Indiaman', 'Pirate Brigantine']) {
        const v = spice.find((n) => n.name === ship);
        expect(v, `${ship} should exist`).toBeTruthy();
        expect(v!.sheet.armor, `${ship} needs a hull`).toBeTruthy();
        expect(String(v!.sheet.notes ?? ''), `${ship} should note its crew`).toMatch(/Crew/);
      }
      // Each ship has a Wild Card at the top of its chain of command.
      for (const boss of ['VOC Captain', 'Pirate Captain']) {
        expect(spice.find((n) => n.name === boss)?.challengeLabel, boss).toBe('Wild Card');
      }
    });

    it('keeps every Extra inside a Novice party’s reach', () => {
      expect(extras.length).toBeGreaterThanOrEqual(20);
      for (const e of extras) {
        expect(e.hp, `${e.name} is too tough for an Extra`).toBeLessThanOrEqual(16);
        // Parry 7+ on a mook means a Novice needs a raise to touch it.
        expect(e.ac, `${e.name} out-parries a starting hero`).toBeLessThanOrEqual(6);
        const armor = (e.sheet.armor ?? []) as Array<{ armor?: number }>;
        expect(Math.max(0, ...armor.map((a) => a.armor ?? 0)), `${e.name} armor`).toBeLessThanOrEqual(2);
      }
    });

    it('keeps the pirate captain the hardest thing in the set', () => {
      const boss = spice.find((n) => n.name === 'Pirate Captain')!;
      const others = spice.filter((n) => n.name !== 'Pirate Captain' && !/Indiaman|Brigantine/.test(n.name));
      expect(Math.max(...others.map((n) => n.hp))).toBeLessThan(boss.hp);
      // A boss with one attack is a boss the party solves once and repeats.
      expect((boss.sheet.attacks as unknown[] ?? []).length).toBeGreaterThanOrEqual(3);
    });
  });

  /**
   * A template is measured either in feet (cones) or in tiles beyond the
   * target (SWADE's Small/Medium/Large blasts). sheetFor used to copy a shape
   * only when a FOOT size came with it, so every tile-based blast in the
   * bestiary — swarms, the Lich, the war machines, the tail sweeps, the
   * vehicle guns — arrived on the sheet as a plain single-target attack and
   * silently stopped being an area at the table.
   */
  it('carries every declared blast template through to the sheet', () => {
    const withArea = NPCS_SWADE.flatMap((n) =>
      ((n.sheet.attacks ?? []) as Array<Record<string, unknown>>)
        .filter((a) => a.aoeShape)
        .map((a) => ({ npc: n.name, attack: String(a.name), shape: a.aoeShape, hexes: a.aoeHexes, ft: a.aoeSize })));
    // Both kinds must survive, and a shape must never arrive sizeless.
    expect(withArea.filter((a) => typeof a.hexes === 'number').length).toBeGreaterThanOrEqual(20);
    expect(withArea.filter((a) => typeof a.ft === 'number').length).toBeGreaterThanOrEqual(5);
    for (const a of withArea) {
      expect(a.hexes ?? a.ft, `${a.npc} — ${a.attack} has a shape but no size`).toBeTruthy();
    }
    // Spot-checks across the kinds of thing that were losing their area.
    const find = (npc: string, attack: string) =>
      ((NPCS_SWADE.find((n) => n.name === npc)!.sheet.attacks ?? []) as Array<Record<string, unknown>>)
        .find((a) => a.name === attack)!;
    expect(find('Rat Swarm', 'Swarming Bites')).toMatchObject({ aoeShape: 'sphere', aoeHexes: 1 });
    expect(find('Zombie Horde', 'Clawing Mass')).toMatchObject({ aoeShape: 'sphere', aoeHexes: 3 });
    expect(find('War Mech', 'Missile Pod')).toMatchObject({ aoeShape: 'sphere', aoeHexes: 5 });
    expect(find('Young Dragon', 'Fiery Breath')).toMatchObject({ aoeShape: 'cone', aoeSize: 54 });
  });
});
