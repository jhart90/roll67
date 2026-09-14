import { useState } from 'react';
import type { PlayingCard } from 'shared';
import { buildDeck, cardName, INITIATIVE_SLOTS, slotLabel } from 'shared';
import { intents } from '../store/game';

/**
 * Where a placeholder stands in the card order, as one <select> value:
 * "slot:-2", or "card:14:spades" / "card:15:red" for the jokers. The list
 * runs in turn order — the three slots before the deck, then every card
 * from the Jokers down to the deuce of clubs, then the three slots after.
 */
export type Placement = { slot: number } | { card: PlayingCard };

export function placementValue(p: { slot?: number; card?: PlayingCard }): string {
  if (p.slot !== undefined && p.slot !== 0) return `slot:${p.slot}`;
  if (p.card) return p.card.rank === 15 ? `card:15:${p.card.joker ?? 'red'}` : `card:${p.card.rank}:${p.card.suit}`;
  return '';
}

export function parsePlacement(v: string): Placement | null {
  const [kind, a, b] = v.split(':');
  if (kind === 'slot') return { slot: Number(a) };
  if (kind === 'card') {
    const rank = Number(a);
    if (rank === 15) return { card: { rank: 15, suit: null, joker: b === 'black' ? 'black' : 'red' } };
    return { card: { rank, suit: b as PlayingCard['suit'] } };
  }
  return null;
}

/** The deck in turn order: Jokers first, then Aces down to deuces, Spades
 *  high within a rank — the same order the tracker sorts them. */
const DECK_IN_ORDER: PlayingCard[] = [...buildDeck()].sort((x, y) => {
  if (y.rank !== x.rank) return y.rank - x.rank;
  const s = (c: PlayingCard) => (c.suit === 'spades' ? 4 : c.suit === 'hearts' ? 3 : c.suit === 'diamonds' ? 2 : c.suit === 'clubs' ? 1 : 0);
  if (s(y) !== s(x)) return s(y) - s(x);
  return (x.joker === 'red' ? 0 : 1) - (y.joker === 'red' ? 0 : 1);
});

export function PlacementSelect({ value, onChange, title }: { value: string; onChange: (p: Placement) => void; title?: string }) {
  return (
    <select
      value={value}
      title={title}
      style={{ width: 'auto', margin: 0, fontSize: 12 }}
      onChange={(e) => { const p = parsePlacement(e.target.value); if (p) onChange(p); }}
    >
      <option value="" disabled>card or slot…</option>
      <optgroup label="Before every card">
        {INITIATIVE_SLOTS.filter((s) => s < 0).map((s) => (
          <option key={s} value={`slot:${s}`}>{slotLabel(s)}{s === -3 ? ' — acts first' : ''}</option>
        ))}
      </optgroup>
      <optgroup label="A card from the deck">
        {DECK_IN_ORDER.map((c) => (
          <option key={placementValue({ card: c })} value={placementValue({ card: c })}>
            {c.rank === 15 ? `🃏 ${c.joker === 'black' ? 'Black' : 'Red'} Joker` : cardName(c)}
          </option>
        ))}
      </optgroup>
      <optgroup label="After every card">
        {INITIATIVE_SLOTS.filter((s) => s > 0).map((s) => (
          <option key={s} value={`slot:${s}`}>{slotLabel(s)}{s === 3 ? ' — acts last' : ''}</option>
        ))}
      </optgroup>
    </select>
  );
}

/**
 * The DM's "add a placeholder" line under the tracker: a name, and either a
 * place in the card order or (rolled initiative) a plain number. For the
 * rising lava, the fuse, the thing with no sheet.
 */
export function AddPlaceholder({ cardMode }: { cardMode: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [value, setValue] = useState(10);
  if (!open) {
    return (
      <button className="link" style={{ fontSize: 12 }} title="A row with no token behind it — rising lava, a fuse, a creature with no sheet. It keeps its place every round." onClick={() => setOpen(true)}>
        + placeholder
      </button>
    );
  }
  const ready = name.trim() !== '' && (!cardMode || placement !== null);
  function add() {
    if (!ready) return;
    intents.initAdd({ placeholder: true, name: name.trim(), ...(cardMode ? placement! : { value }) });
    setName(''); setPlacement(null); setOpen(false);
  }
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        autoFocus placeholder="Rising lava" value={name} maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setOpen(false); }}
        style={{ flex: 1, minWidth: 120, margin: 0, fontSize: 12 }}
      />
      {cardMode
        ? <PlacementSelect value={placement ? placementValue(placement) : ''} onChange={setPlacement} title="Where it acts in the round" />
        : <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value) || 0)} title="Initiative — higher acts first" style={{ width: 64, margin: 0, fontSize: 12 }} />}
      <button className="primary" style={{ width: 'auto' }} disabled={!ready} onClick={add}>Add</button>
      <button className="link" onClick={() => setOpen(false)}>cancel</button>
    </div>
  );
}
