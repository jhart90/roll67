import { isRedCard, rankShort, SUIT_SYMBOL, type PlayingCard } from 'shared';

/** A full playing-card face rendered in CSS — real suit pips (♠♥♦♣), rank
 *  corners, red/black coloring, and a 🃏 treatment for the jokers. */
export function CardFace({ card, small }: { card: PlayingCard; small?: boolean }) {
  const color = isRedCard(card) ? 'red' : 'black';
  if (card.rank === 15 || !card.suit) {
    return (
      <div className={`card-face ${color} ${small ? 'small' : ''}`}>
        <span className="card-corner">🃏</span>
        <span className="card-center joker">🃏</span>
        <span className="card-joker-label">JOKER</span>
        <span className="card-corner flip">🃏</span>
      </div>
    );
  }
  const suit = SUIT_SYMBOL[card.suit];
  const rank = rankShort(card.rank);
  return (
    <div className={`card-face ${color} ${small ? 'small' : ''}`}>
      <span className="card-corner">{rank}<em>{suit}</em></span>
      <span className="card-center">{card.rank >= 11 && card.rank <= 13 ? rank : suit}</span>
      {card.rank >= 11 && card.rank <= 13 && <span className="card-under-center">{suit}</span>}
      <span className="card-corner flip">{rank}<em>{suit}</em></span>
    </div>
  );
}

/** Inline chip for lists/chat: "J♥" in white with the right suit color. */
export function CardChip({ card }: { card: PlayingCard }) {
  const color = isRedCard(card) ? 'red' : 'black';
  if (card.rank === 15 || !card.suit) {
    return <span className={`card-chip ${color}`} title={color === 'red' ? 'Red Joker' : 'Black Joker'}>🃏</span>;
  }
  return (
    <span className={`card-chip ${color}`}>
      {rankShort(card.rank)}{SUIT_SYMBOL[card.suit]}
    </span>
  );
}
