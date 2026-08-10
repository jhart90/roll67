import { describe, expect, it } from 'vitest';
import { counterSharedWith, type Counter } from '../src/types.js';

const counter = (over: Partial<Counter> = {}): Counter => ({
  id: 'c1', campaignId: 'camp', mapId: 'm1', name: 'Doom Clock',
  color: '#d92626', max: 6, value: 3,
  visible: true, sharedWith: null, position: 'top',
  ...over,
});

describe('counterSharedWith', () => {
  it('shares with the whole table when the list is null', () => {
    const c = counter();
    expect(counterSharedWith(c, 'alice')).toBe(true);
    expect(counterSharedWith(c, 'anyone-at-all')).toBe(true);
  });

  it('shares with only the named players', () => {
    const c = counter({ sharedWith: ['alice', 'bob'] });
    expect(counterSharedWith(c, 'alice')).toBe(true);
    expect(counterSharedWith(c, 'bob')).toBe(true);
    expect(counterSharedWith(c, 'carol')).toBe(false);
  });

  // The distinction that makes the three-state control work: an empty list is
  // "nobody", which is NOT the same as null.
  it('shares with nobody when the list is empty', () => {
    expect(counterSharedWith(counter({ sharedWith: [] }), 'alice')).toBe(false);
  });

  it('hides from everyone when not visible, however it is shared', () => {
    expect(counterSharedWith(counter({ visible: false }), 'alice')).toBe(false);
    expect(counterSharedWith(counter({ visible: false, sharedWith: ['alice'] }), 'alice')).toBe(false);
  });
});
