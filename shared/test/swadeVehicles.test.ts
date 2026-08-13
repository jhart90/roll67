import { describe, expect, it } from 'vitest';
import {
  isVehicle, maneuveringSkillFor, rollOutOfControl, rollVehicleCrit,
  vehicleHandling, vehicleSeats, vehicleTopSpeed, vehicleWoundCap,
} from '../src/systems/swadeVehicles.js';
import { swadeToughness, swade } from '../src/systems/swade.js';

/** An rng that replays a scripted sequence of d6 faces. */
const faces = (...vals: number[]) => {
  let i = 0;
  return () => ((vals[i++] ?? 6) - 1) / 6;
};

describe('the vehicle stat block', () => {
  it('reads Toughness off the plate, not off a Vigor die it does not have', () => {
    expect(swadeToughness({ vehicle: true, vehicleToughness: 57, vigor: 'd4' })).toBe(57);
    // …and an ordinary creature is untouched by the branch.
    expect(swadeToughness({ vigor: 'd8' })).toBe(6);
  });

  it('is Wrecked on the Wild Card ladder: 3 Wounds, more with Size', () => {
    expect(vehicleWoundCap({ size: 0 })).toBe(3);   // a car
    expect(vehicleWoundCap({ size: 5 })).toBe(4);   // Large
    expect(vehicleWoundCap({ size: 9 })).toBe(5);   // Huge — an Abrams
    expect(vehicleWoundCap({ size: 14 })).toBe(6);  // Gargantuan — a galleon
    expect(vehicleWoundCap({ size: 9, maxWoundsOverride: 2 })).toBe(2);
  });

  it('loses a point of Handling per Wound, to a floor of −4', () => {
    expect(vehicleHandling({ handling: 1, wounds: 0 })).toBe(1);
    expect(vehicleHandling({ handling: 1, wounds: 2 })).toBe(-1);
    expect(vehicleHandling({ handling: -2, wounds: 3, guidanceHits: 2 })).toBe(-4);
  });

  it('loses a tenth of its base Top Speed per Locomotion hit', () => {
    expect(vehicleTopSpeed({ topSpeed: 120, locomotionHits: 0 })).toBe(120);
    expect(vehicleTopSpeed({ topSpeed: 120, locomotionHits: 3 })).toBe(84);
  });

  it('seats the crew and the passengers', () => {
    expect(vehicleSeats({ crew: 1, passengers: 5 })).toBe(6);
    expect(vehicleSeats({ crew: 20, passengers: 80 })).toBe(100);
    expect(vehicleSeats({})).toBe(1);
  });

  it('answers to the maneuvering skill its kind demands', () => {
    expect(maneuveringSkillFor({ vehicleKind: 'ground' })).toBe('Driving');
    expect(maneuveringSkillFor({ vehicleKind: 'watercraft' })).toBe('Boating');
    expect(maneuveringSkillFor({ vehicleKind: 'aircraft' })).toBe('Piloting');
    expect(maneuveringSkillFor({ vehicleKind: 'spacecraft' })).toBe('Piloting');
  });

  it('gets the machine tab set, and only machines do', () => {
    expect(isVehicle({ vehicle: true })).toBe(true);
    expect(isVehicle({})).toBe(false);
    expect(swade.vehicleTabs?.length).toBeGreaterThan(0);
  });
});

describe('the Out of Control table', () => {
  it('maps the book bands: collision low, Distracted mid, Glitch on boxcars', () => {
    expect(rollOutOfControl(faces(1, 1)).label).toBe('Major Collision');
    expect(rollOutOfControl(faces(1, 2)).label).toBe('Minor Collision');
    expect(rollOutOfControl(faces(3, 4)).label).toBe('Distracted');
    expect(rollOutOfControl(faces(5, 5)).label).toBe('Vulnerable');
    expect(rollOutOfControl(faces(6, 6)).label).toBe('Glitch');
  });

  it('rolls the Major Collision d4 as real wounds, 1 through 4', () => {
    // Third face feeds the d4: a scripted 4 → 1 + floor(3/6·4)… the rng
    // yields (4−1)/6, and 1 + floor(0.5·4) = 3.
    const r = rollOutOfControl(faces(1, 1, 4));
    expect(r.vehicleWounds).toBeGreaterThanOrEqual(1);
    expect(r.vehicleWounds).toBeLessThanOrEqual(4);
    expect(r.crits).toBe(1);
    expect(r.condition).toBe('distracted');
  });
});

describe('the Vehicle Critical Hits table', () => {
  it('maps the book bands', () => {
    expect(rollVehicleCrit(faces(1, 1)).label).toBe('Scratch and Dent');
    expect(rollVehicleCrit(faces(1, 2)).label).toBe('Guidance / Traction');
    expect(rollVehicleCrit(faces(2, 3)).label).toBe('Locomotion');
    expect(rollVehicleCrit(faces(3, 4)).label).toBe('Chassis');
    expect(rollVehicleCrit(faces(4, 5)).label).toBe('Crew');
    expect(rollVehicleCrit(faces(5, 6)).label).toBe('Weapon');
    expect(rollVehicleCrit(faces(6, 6)).label).toBe('System');
  });

  it('accumulates on the right sheet fields', () => {
    expect(rollVehicleCrit(faces(1, 2)).patchField).toBe('guidanceHits');
    expect(rollVehicleCrit(faces(2, 3)).patchField).toBe('locomotionHits');
    expect(rollVehicleCrit(faces(3, 4)).patchField).toBeUndefined();
  });

  it('rerolls Crew for a Glitch, which jars machines loose but hurts nobody', () => {
    // Scripted to land on Crew (4+5), then reroll to Chassis (3+4).
    const r = rollVehicleCrit(faces(4, 5, 3, 4), { rerollCrew: true });
    expect(r.label).toBe('Chassis');
  });
});
