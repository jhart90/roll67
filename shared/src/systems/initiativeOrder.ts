/**
 * The DM's hand on the initiative order: moving a combatant by hand, and
 * grouping combatants so they act together on one card.
 *
 * Two kinds of row:
 *
 *  - a UNIT: a combatant on their own, or a group's leader. Units are what the
 *    cards (or rolled values) put in order.
 *  - a MEMBER: in a group (`groupId` = its leader's entry id). Members follow
 *    their leader directly, in the order the DM left them, and carry the
 *    leader's card or value — they act on it, one after another, each still
 *    taking their own turn so every per-token rule (Pace, multi-action,
 *    Shaken) works exactly as before.
 *
 * A unit the DM moved by hand is `manualOrder`: it keeps the place it was put
 * in when anything re-sorts (somebody dealt in, a placeholder re-carded), and
 * the tracker marks its card with an asterisk, because its card no longer
 * explains where it stands. A fresh deal, or the DM's "sort", lets the cards
 * decide again.
 *
 * Pure functions over the entry list; the server keeps the turn pointer on
 * the same person across any of them.
 */
import type { InitiativeEntry } from '../types.js';

export type InitiativeCompare = (a: InitiativeEntry, b: InitiativeEntry) => number;

/** Where a dragged row is dropped, relative to the row under the pointer. */
export type InitiativeDropWhere = 'before' | 'after' | 'onto';

/**
 * Make the groups consistent, in place:
 *  - a member whose leader is gone, or is itself a member, is re-pointed at
 *    the real top of that chain, or — if there is none — becomes a unit;
 *  - a leader that was removed hands its group to its first member;
 *  - every member wears its leader's card, slot and value.
 */
export function syncInitiativeGroups(entries: InitiativeEntry[]): void {
  const byId = new Map(entries.map((e) => [e.id, e]));
  // The removed-leader case: members pointing at an id that is not here.
  // The first such member (in list order) leads the rest.
  const orphanLeads = new Map<string, string>();
  for (const e of entries) {
    if (!e.groupId || byId.has(e.groupId)) continue;
    const heir = orphanLeads.get(e.groupId);
    if (!heir) { orphanLeads.set(e.groupId, e.id); delete e.groupId; continue; }
    e.groupId = heir;
  }
  for (const e of entries) {
    if (!e.groupId) continue;
    // Follow the chain to the top; a loop or a dead end makes this a unit.
    let lead = byId.get(e.groupId);
    const seen = new Set([e.id]);
    while (lead?.groupId && !seen.has(lead.id)) { seen.add(lead.id); lead = byId.get(lead.groupId); }
    if (!lead || lead.groupId || lead.id === e.id) { delete e.groupId; continue; }
    e.groupId = lead.id;
  }
  for (const e of entries) {
    if (!e.groupId) continue;
    const lead = byId.get(e.groupId)!;
    if (lead.card) e.card = { ...lead.card }; else delete e.card;
    if (lead.slot !== undefined) e.slot = lead.slot; else delete e.slot;
    e.value = lead.value;
    e.drawSeq = lead.drawSeq;
    // A member is placed by its leader, never by hand.
    delete e.manualOrder;
  }
}

/**
 * Put the entries in order: units by `compare`, except units moved by hand,
 * which hold their place among the units; each leader's members straight
 * after it, in their current relative order. Returns a new array.
 */
export function arrangeInitiative(entries: InitiativeEntry[], compare: InitiativeCompare): InitiativeEntry[] {
  const list = entries.slice();
  syncInitiativeGroups(list);
  const units = list.filter((e) => !e.groupId);
  const members = new Map<string, InitiativeEntry[]>();
  for (const e of list) {
    if (!e.groupId) continue;
    const arr = members.get(e.groupId) ?? [];
    arr.push(e);
    members.set(e.groupId, arr);
  }
  // Pinned units keep their index among the units; the rest fill the gaps
  // in card order. Array.sort is stable, so ties keep their current order.
  const free = units.filter((u) => !u.manualOrder).sort(compare);
  const ordered: InitiativeEntry[] = [];
  let f = 0;
  for (const u of units) ordered.push(u.manualOrder ? u : free[f++]);
  return ordered.flatMap((u) => [u, ...(members.get(u.id) ?? [])]);
}

/** The ids of a unit and its members, in list order. */
function groupSpan(entries: InitiativeEntry[], leadId: string): string[] {
  return entries.filter((e) => e.id === leadId || e.groupId === leadId).map((e) => e.id);
}

/**
 * Drop `entryId` relative to `targetId`. Returns the new list, or null when
 * the drop means nothing (onto itself, onto its own group, unknown ids).
 *
 * - 'onto': the target's group (or the target, now a leader) takes the
 *   dragged row — and, if the dragged row led a group, all of its members.
 *   The target stays where it is; the newcomers go to the end of its group.
 * - 'before' / 'after': the dragged row (with its members, if it leads) moves
 *   to that gap. Landing between a group's rows makes it a member of that
 *   group; anywhere else it is a unit of its own, pinned there by hand.
 */
export function moveInitiativeEntry(
  entries: InitiativeEntry[], entryId: string, targetId: string, where: InitiativeDropWhere,
): InitiativeEntry[] | null {
  const list = entries.map((e) => ({ ...e }));
  syncInitiativeGroups(list);
  const dragged = list.find((e) => e.id === entryId);
  const target = list.find((e) => e.id === targetId);
  if (!dragged || !target || dragged.id === target.id) return null;

  // A leader carries its whole group; a member travels alone.
  const carried = dragged.groupId ? [dragged.id] : groupSpan(list, dragged.id);
  if (carried.includes(target.id)) return null;
  const moving = list.filter((e) => carried.includes(e.id));
  const rest = list.filter((e) => !carried.includes(e.id));

  if (where === 'onto') {
    const leadId = target.groupId ?? target.id;
    if (dragged.groupId === leadId) return null;
    for (const m of moving) { m.groupId = leadId; delete m.manualOrder; }
    const span = groupSpan(rest, leadId);
    const at = rest.findIndex((e) => e.id === span[span.length - 1]) + 1;
    rest.splice(at, 0, ...moving);
    syncInitiativeGroups(rest);
    return rest;
  }

  const tIdx = rest.findIndex((e) => e.id === target.id);
  const at = where === 'before' ? tIdx : tIdx + 1;
  const prev = rest[at - 1];
  const next = rest[at];
  // Between two rows of the same group: join it.
  const prevGroup = prev ? (prev.groupId ?? prev.id) : null;
  const joins = !!prev && !!next && next.groupId !== undefined && next.groupId === prevGroup;
  if (joins) {
    for (const m of moving) { m.groupId = prevGroup!; delete m.manualOrder; }
  } else {
    // A member dropped out of its group stands alone; a unit stays a unit
    // (its members, if it leads, come with it untouched).
    delete dragged.groupId;
    dragged.manualOrder = true;
  }
  rest.splice(at, 0, ...moving);
  syncInitiativeGroups(rest);
  return rest;
}

/** Take one member out of its group, placing it right after the group. */
export function ungroupInitiativeEntry(entries: InitiativeEntry[], entryId: string): InitiativeEntry[] | null {
  const list = entries.map((e) => ({ ...e }));
  syncInitiativeGroups(list);
  const e = list.find((x) => x.id === entryId);
  if (!e?.groupId) return null;
  const leadId = e.groupId;
  const rest = list.filter((x) => x.id !== entryId);
  const span = groupSpan(rest, leadId);
  const at = rest.findIndex((x) => x.id === span[span.length - 1]) + 1;
  delete e.groupId;
  e.manualOrder = true;
  rest.splice(at, 0, e);
  return rest;
}
