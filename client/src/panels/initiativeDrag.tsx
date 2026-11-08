import { useState } from 'react';
import type { InitiativeEntry } from 'shared';
import { intents } from '../store/game';

type Where = 'before' | 'after' | 'onto';

/**
 * The DM's drag and drop on the initiative list, shared by the Initiative tab
 * and the floating tracker.
 *
 * While a row is held over another, the top or bottom quarter of that row
 * means "the gap above / below it" — drawn as a dotted line — and the middle
 * means "onto it": a dashed outline, and on release the two act as a group on
 * the target's card. Releasing over the row being dragged, or over its own
 * group, does nothing.
 */
export function useInitiativeDrag(entries: InitiativeEntry[], enabled: boolean) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ targetId: string; where: Where } | null>(null);

  const dragged = dragId ? entries.find((e) => e.id === dragId) : undefined;
  // A leader carries its members; none of them is a place to drop it.
  const carried = new Set(
    dragged ? (dragged.groupId ? [dragged.id] : entries.filter((e) => e.id === dragged.id || e.groupId === dragged.id).map((e) => e.id)) : [],
  );

  function clear() { setDragId(null); setDrop(null); }

  function rowProps(entry: InitiativeEntry) {
    if (!enabled) return {};
    return {
      draggable: true,
      onDragStart: (ev: React.DragEvent) => {
        // Typing in a row's name or value box is not a drag.
        if ((ev.target as HTMLElement).closest('input, select, button')) { ev.preventDefault(); return; }
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', entry.id);
        setDragId(entry.id);
      },
      onDragOver: (ev: React.DragEvent) => {
        if (!dragId || carried.has(entry.id)) { setDrop(null); return; }
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        const y = (ev.clientY - r.top) / Math.max(1, r.height);
        const leadId = entry.groupId ?? entry.id;
        // Already in this group: the middle of its rows is not a new grouping.
        const ontoOk = dragged?.groupId !== leadId;
        const where: Where = y < 0.28 ? 'before' : y > 0.72 ? 'after' : (ontoOk ? 'onto' : (y < 0.5 ? 'before' : 'after'));
        if (drop?.targetId !== entry.id || drop.where !== where) setDrop({ targetId: entry.id, where });
      },
      onDrop: (ev: React.DragEvent) => {
        ev.preventDefault();
        if (dragId && drop && drop.targetId === entry.id) intents.initMove(dragId, drop.targetId, drop.where);
        clear();
      },
      onDragEnd: clear,
    };
  }

  /** Classes for one row: where the drop would land, and whether it is the one in hand. */
  function rowClass(entry: InitiativeEntry): string {
    const c: string[] = [];
    if (enabled) c.push('init-draggable');
    if (carried.has(entry.id)) c.push('init-dragging');
    if (drop?.targetId === entry.id) c.push(`init-drop-${drop.where}`);
    return c.join(' ');
  }

  return { rowProps, rowClass, listProps: { onDragLeave: (ev: React.DragEvent) => { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setDrop(null); } } };
}

/** Whether this row sits in a group whose leader is also on this list. */
export function isGroupMember(entry: InitiativeEntry, entries: InitiativeEntry[]): boolean {
  return !!entry.groupId && entries.some((e) => e.id === entry.groupId);
}

/** The asterisk on a card moved by hand. */
export function ManualMark({ entry }: { entry: InitiativeEntry }) {
  if (!entry.manualOrder) return null;
  return <span className="init-manual" title="Moved by hand: it keeps this card, but the card no longer decides where it stands. The DM’s sort, or the next deal, puts it back in card order.">*</span>;
}
