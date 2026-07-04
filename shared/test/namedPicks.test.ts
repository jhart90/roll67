import { describe, expect, it } from 'vitest';
import {
  applyNamedPick, INFUSIONS_5E, INVOCATIONS_5E, METAMAGIC_5E, takenPickIds,
} from '../src/systems/namedPicks5e.js';
import { wildShapeMaxCr } from '../src/systems/features5e.js';

describe('named picks (Invocations / Metamagic / Infusions)', () => {
  it('records a pick and a matching feature entry', () => {
    const patch = applyNamedPick({}, 'invocations', INVOCATIONS_5E, 'agonizing-blast');
    expect(patch.invocations).toEqual(['agonizing-blast']);
    const feats = patch.features as Array<{ name: string }>;
    expect(feats.some((f) => f.name === 'Agonizing Blast')).toBe(true);
  });

  it('does not duplicate an already-taken pick', () => {
    const sheet = { invocations: ['agonizing-blast'] };
    expect(applyNamedPick(sheet, 'invocations', INVOCATIONS_5E, 'agonizing-blast')).toEqual({});
  });

  it('ignores an unknown id', () => {
    expect(applyNamedPick({}, 'metamagic', METAMAGIC_5E, 'not-a-real-one')).toEqual({});
  });

  it('each catalog has unique ids', () => {
    for (const catalog of [INVOCATIONS_5E, METAMAGIC_5E, INFUSIONS_5E]) {
      expect(new Set(catalog.map((p) => p.id)).size).toBe(catalog.length);
    }
  });

  it('takenPickIds tolerates a missing/malformed list', () => {
    expect(takenPickIds({}, 'metamagic')).toEqual([]);
    expect(takenPickIds({ metamagic: 'not-an-array' }, 'metamagic')).toEqual([]);
  });
});

describe('Wild Shape max CR by level/circle', () => {
  it('scales the land-druid CR cap with level', () => {
    expect(wildShapeMaxCr({ class: 'Druid', level: 2 })).toBe(0.25);
    expect(wildShapeMaxCr({ class: 'Druid', level: 4 })).toBe(0.5);
    expect(wildShapeMaxCr({ class: 'Druid', level: 8 })).toBe(1);
  });

  it('Circle of the Moon has no CR limit from level 2', () => {
    expect(wildShapeMaxCr({ class: 'Druid', level: 2, subclass: 'Circle of the Moon' })).toBeNull();
  });
});
