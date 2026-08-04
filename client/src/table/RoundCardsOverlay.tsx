import { useEffect, useState } from 'react';
import { useGameStore } from '../store/game';
import { CardFace } from '../util/PlayingCardView';

/** Pause before the first flip, gap between flips, and the linger after. */
const LEAD_MS = 500;
const FLIP_STAGGER_MS = 650;
const LINGER_MS = 2800;

/**
 * SWADE round 2+ auto-deal: everyone's fresh Action Card appears face down
 * with the combatant's name above it, then they flip over one at a time,
 * left to right (two rows when the battle runs past six combatants).
 */
export function RoundCardsOverlay() {
  const deal = useGameStore((s) => s.roundCardsDeal);
  const [flipped, setFlipped] = useState(0);

  useEffect(() => {
    if (!deal) return;
    setFlipped(0);
    const timers = deal.cards.map((_, i) =>
      setTimeout(() => setFlipped(i + 1), LEAD_MS + i * FLIP_STAGGER_MS));
    const done = setTimeout(
      () => useGameStore.setState({ roundCardsDeal: null }),
      LEAD_MS + deal.cards.length * FLIP_STAGGER_MS + LINGER_MS,
    );
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [deal?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!deal || deal.cards.length === 0) return null;
  return (
    <div className="card-draw-overlay round-cards-overlay">
      <div className="round-cards-title">🂠 Round {deal.round} — new action cards</div>
      <div
        className="round-cards-grid"
        style={{ gridTemplateColumns: `repeat(${Math.min(6, deal.cards.length)}, auto)` }}
      >
        {deal.cards.map((c, i) => (
          <div key={`${deal.seq}-${i}`} className="round-card">
            <div className="round-card-name">{c.name}</div>
            {i < flipped
              ? (
                <div className="card-flipper">
                  <div className="card-back" />
                  <CardFace card={c.card} />
                </div>
              )
              : <div className="card-back" />}
          </div>
        ))}
      </div>
    </div>
  );
}
