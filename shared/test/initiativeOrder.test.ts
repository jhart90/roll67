import { describe, expect, it } from 'vitest';
import type { InitiativeEntry } from '../src/types.js';
import { compareCardEntries } from '../src/systems/cards.js';
import {
  arrangeInitiative, moveInitiativeEntry, syncInitiativeGroups, ungroupInitiativeEntry,
} from '../src/systems/initiativeOrder.js';

const e = (id: string, rank: number, over: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id, tokenId: `t-${id}`, name: id, value: rank, hidden: false,
  card: { rank, suit: 'spades' }, drawSeq: rank, ...over,
});
const ids = (list: InitiativeEntry[]) => list.map((x) => x.id).join(' ');
const byCard = (a: InitiativeEntry, b: InitiativeEntry) => compareCardEntries(a, b, 'suit');

describe('moving by hand', () => {
  const base = [e('A', 14), e('B', 10), e('C', 7), e('D', 3)];

  it('drops a row into a gap, keeps its card, and pins it', () => {
    const out = moveInitiativeEntry(base, 'D', 'A', 'after')!;
    expect(ids(out)).toBe('A D B C');
    const d = out.find((x) => x.id === 'D')!;
    expect(d.manualOrder).toBe(true);
    expect(d.card?.rank).toBe(3);
  });

  it('keeps a pinned row in place when the rest re-sort', () => {
    const moved = moveInitiativeEntry(base, 'D', 'A', 'before')!;
    // Somebody new dealt in with a King: the free rows sort around D.
    const out = arrangeInitiative([...moved, e('K', 13)], byCard);
    expect(ids(out)).toBe('D A K B C');
  });

  it('refuses a drop onto itself', () => {
    expect(moveInitiativeEntry(base, 'B', 'B', 'onto')).toBeNull();
  });
});

describe('groups', () => {
  const base = [e('Chief', 12), e('R1', 9), e('R2', 5), e('Medjay', 4)];

  it('dropping onto a row makes it the leader and shares its card', () => {
    const out = moveInitiativeEntry(base, 'R2', 'R1', 'onto')!;
    expect(ids(out)).toBe('Chief R1 R2 Medjay');
    const r2 = out.find((x) => x.id === 'R2')!;
    expect(r2.groupId).toBe('R1');
    expect(r2.card?.rank).toBe(9);
    expect(r2.value).toBe(9);
  });

  it('dropping onto a member joins that member’s leader — no nesting', () => {
    let out = moveInitiativeEntry(base, 'R2', 'R1', 'onto')!;
    out = moveInitiativeEntry(out, 'Medjay', 'R2', 'onto')!;
    expect(ids(out)).toBe('Chief R1 R2 Medjay');
    expect(out.find((x) => x.id === 'Medjay')!.groupId).toBe('R1');
  });

  it('a leader dropped onto another row brings its whole group', () => {
    let out = moveInitiativeEntry(base, 'R2', 'R1', 'onto')!;
    out = moveInitiativeEntry(out, 'R1', 'Chief', 'onto')!;
    expect(ids(out)).toBe('Chief R1 R2 Medjay');
    expect(out.filter((x) => x.groupId === 'Chief').map((x) => x.id)).toEqual(['R1', 'R2']);
    expect(out.every((x) => x.id === 'Chief' || x.id === 'Medjay' || x.card?.rank === 12)).toBe(true);
  });

  it('moving a leader carries its members to the new gap', () => {
    let out = moveInitiativeEntry(base, 'R2', 'R1', 'onto')!;
    out = moveInitiativeEntry(out, 'R1', 'Medjay', 'after')!;
    expect(ids(out)).toBe('Chief Medjay R1 R2');
  });

  it('a member dragged out to a gap leaves the group, pinned there', () => {
    let out = moveInitiativeEntry(base, 'R2', 'R1', 'onto')!;
    out = moveInitiativeEntry(out, 'R2', 'Chief', 'before')!;
    const r2 = out.find((x) => x.id === 'R2')!;
    expect(ids(out)).toBe('R2 Chief R1 Medjay');
    expect(r2.groupId).toBeUndefined();
    expect(r2.manualOrder).toBe(true);
  });

  it('a row dropped between a leader and its member joins that group', () => {
    let out = moveInitiativeEntry(base, 'R2', 'R1', 'onto')!;
    out = moveInitiativeEntry(out, 'Medjay', 'R1', 'after')!;
    expect(ids(out)).toBe('Chief R1 Medjay R2');
    expect(out.find((x) => x.id === 'Medjay')!.groupId).toBe('R1');
  });

  it('the group sorts as one unit by its leader’s card', () => {
    let out = moveInitiativeEntry(base, 'Chief', 'Medjay', 'onto')!;
    // Medjay (4) leads Chief now; a new deal gives the leader a Queen.
    out.find((x) => x.id === 'Medjay')!.card = { rank: 12, suit: 'hearts' };
    out = arrangeInitiative(out, byCard);
    expect(ids(out)).toBe('Medjay Chief R1 R2');
    expect(out.find((x) => x.id === 'Chief')!.card?.rank).toBe(12);
  });

  it('a removed leader hands the group to its first member', () => {
    let out = moveInitiativeEntry(base, 'R1', 'Chief', 'onto')!;
    out = moveInitiativeEntry(out, 'R2', 'Chief', 'onto')!;
    const left = out.filter((x) => x.id !== 'Chief');
    syncInitiativeGroups(left);
    expect(left.find((x) => x.id === 'R1')!.groupId).toBeUndefined();
    expect(left.find((x) => x.id === 'R2')!.groupId).toBe('R1');
  });

  it('ungroup puts the member right after its group, alone', () => {
    let out = moveInitiativeEntry(base, 'R2', 'Chief', 'onto')!;
    out = moveInitiativeEntry(out, 'R1', 'Chief', 'onto')!;
    out = ungroupInitiativeEntry(out, 'R2')!;
    expect(ids(out)).toBe('Chief R1 R2 Medjay');
    expect(out.find((x) => x.id === 'R2')!.groupId).toBeUndefined();
  });
});
