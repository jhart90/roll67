import { describe, expect, it } from 'vitest';
import type { Character } from '../src/types.js';
import { combatActions } from '../src/systems/combat.js';
import { swade } from '../src/systems/swade.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import { applyEntry, contentForSystem } from '../src/data/compendium.js';

// The KV20 delve's opposition: every trick in the waves has to reach the
// table as a real action, not as a sentence in the notes.

const npc = (name: string) => {
  const e = NPCS_SWADE.find((n) => n.name === name);
  if (!e) throw new Error(`no NPC ${name}`);
  return e;
};
const actionsOf = (name: string) => {
  const ch: Character = { id: 'n', campaignId: 'x', ownerUserId: 'u', name, system: 'swade', sheet: npc(name).sheet };
  return combatActions(ch);
};
const action = (who: string, label: string) => {
  const a = actionsOf(who).find((x) => x.label.startsWith(label));
  if (!a) throw new Error(`${who} has no ${label}`);
  return a;
};

describe('KV20 bestiary', () => {
  it('lands every stat block on the Toughness and Parry the waves were tuned for', () => {
    const expected: Record<string, [number, number]> = {
      'Tomb Robber': [5, 5],
      'Amenpanefer, Stonemason & Gang Boss': [7, 6],
      'Medjay Patrolman': [6, 7],
      'Khepri Swarm (Golden Scarabs)': [7, 4],
      'Ushabti Drone': [5, 5],
      'Canopic Turret (Hapy)': [7, 2],
      'Sahu Frame (Techno-Mummy)': [8, 6],
      'Inpu Sentinel': [10, 7],
      'Ba-Bird Drone': [5, 2],
      'Servant of the Shining Khepri': [5, 5],
    };
    for (const [name, [t, p]] of Object.entries(expected)) {
      expect(npc(name).hp, `${name} Toughness`).toBe(t);
      expect(npc(name).ac, `${name} Parry`).toBe(p);
    }
  });

  it("Hapy's shriek is a cone everyone resists with Spirit −1 or is Shaken", () => {
    const a = action('Canopic Turret (Hapy)', 'Sonic Shriek');
    expect(a.attackExpr).toBeNull();
    expect(a.saveId).toBe('spirit');
    expect(a.saveMod).toBe(-1);
    expect(a.appliesCondition).toBe('shaken');
    expect(a.aoe?.shape).toBe('cone');
    expect(a.evadable).toBeFalsy();
  });

  it("Imsety's pulse is Vigor −1 or Stunned; the Golden Scarab's resists are −2", () => {
    const a = action('Canopic Turret (Imsety)', 'Neural Pulse');
    expect([a.saveId, a.saveMod, a.appliesCondition]).toEqual(['vigor', -1, 'stunned']);
    const flash = action('Golden Scarab, Necropolis Guardian', 'Blinding Solar Flash');
    const pulse = action('Golden Scarab, Necropolis Guardian', 'Stun Pulse');
    expect(flash.saveMod).toBe(-2);
    expect(pulse.saveMod).toBe(-2);
  });

  it("Duamutef's dart rolls to hit and a hit leaves the target Vulnerable", () => {
    const a = action('Canopic Turret (Duamutef)', 'Tracking Dart');
    expect(a.attackExpr).toBeTruthy();
    expect(a.saveId).toBeUndefined();
    expect(a.appliesCondition).toBe('vulnerable');
    expect(a.conditionSaveId).toBeUndefined();
  });

  it('grabs hit first, then the target resists the hold', () => {
    const grip = action('Sahu Frame (Techno-Mummy)', 'Crushing Grip');
    expect(grip.attackExpr).toBeTruthy();
    expect([grip.conditionSaveId, grip.appliesCondition]).toEqual(['agility', 'entangled']);
    expect(grip.conditionDc).toBeGreaterThan(0);
    const grab = action('Ushabti Drone', 'Clinging Grab');
    expect([grab.conditionSaveId, grab.appliesCondition]).toEqual(['strength', 'entangled']);
    const pounce = action('Inpu Sentinel', 'Pounce');
    expect([pounce.conditionSaveId, pounce.appliesCondition, pounce.ap]).toEqual(['agility', 'prone', 2]);
  });

  it('the scarab swarm covers a Medium template nobody can dive out of', () => {
    const shock = action('Khepri Swarm (Golden Scarabs)', 'Shock Swarm');
    expect(shock.aoe).toMatchObject({ shape: 'sphere', sizeHexes: 3 });
    expect(shock.evadable).toBeFalsy();
    const snare = action('Khepri Swarm (Golden Scarabs)', 'Filament Snare');
    expect([snare.saveId, snare.appliesCondition]).toEqual(['agility', 'entangled']);
  });

  it('describes every move, and arrives with it in hand', () => {
    const kv20 = NPCS_SWADE.filter((n) => n.category === 'Egypt'
      && !/Nekhet|Sabu|Khay|Menka|Golden Scarab,/.test(n.name));
    expect(kv20.length).toBe(13);
    for (const n of kv20) {
      for (const atk of n.sheet.attacks as Array<Record<string, unknown>>) {
        expect(String(atk.notes ?? '').length, `${n.name}: ${atk.name}`).toBeGreaterThan(60);
        expect(atk.wielded, `${n.name}: ${atk.name}`).toBe(true);
      }
    }
  });

  it("the cultists' lamp is thrown with Athletics, and the Khemet patches heal", () => {
    expect(action('Servant of the Shining Khepri', 'Thrown Oil Lamp').thrown).toBe(true);
    const patch = action('Nekhet, Khemet Field Commander', 'Compact Medical Patch');
    expect(patch.effect).toBe('heal');
    expect(patch.healsWounds).toBe(true);
    expect(action('Menka, Khemet Enforcer', 'Emergency Medical Patch').effect).toBe('heal');
  });
});

describe('KV20 salvage in the compendium', () => {
  const rowFor = (name: string) => {
    const entry = contentForSystem('swade').find((e) => e.name === name);
    if (!entry) throw new Error(`no compendium entry ${name}`);
    return applyEntry(entry, swade.defaultSheet())!.row as Record<string, unknown>;
  };

  it('reads "<Trait> roll −N or <Condition>" into a live resist', () => {
    expect(rowFor('Hapy Shriek Emitter')).toMatchObject({ save: 'spirit', saveMod: -1, condition: 'shaken', aoeShape: 'cone' });
    expect(rowFor('Solar Flash Lens')).toMatchObject({ save: 'agility', saveMod: -2, condition: 'distracted' });
    expect(rowFor('Neural Pulse Emitter')).toMatchObject({ save: 'vigor', saveMod: -1, condition: 'stunned' });
  });

  it('keeps the plain Stun Gun working, with no modifier', () => {
    const row = rowFor('Stun Gun');
    expect(row).toMatchObject({ save: 'vigor', condition: 'stunned' });
    expect(row.saveMod).toBeUndefined();
  });

  it('turns "a hit leaves the target Vulnerable" into an on-hit condition', () => {
    const row = rowFor('Duamutef Dart Launcher');
    expect(row.condition).toBe('vulnerable');
    expect(row.save).toBeUndefined();
  });

  it('carries the Khemet weapons, armour and patches', () => {
    expect(rowFor('Concealed Pulse Projector')).toMatchObject({ ap: 2, ammo: 20 });
    expect(rowFor('Khemet Reactive Mesh')).toMatchObject({ armor: 3 });
    expect(rowFor('Khemet Medical Patch')).toMatchObject({ effect: 'heal' });
  });
});
