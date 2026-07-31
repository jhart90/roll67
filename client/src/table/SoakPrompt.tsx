import { intents, useGameStore } from '../store/game';

/**
 * Your Wild Card just took wounds — spend a Benny to Soak? A Vigor roll where
 * the success and each raise remove one of the wounds just dealt; soaking all
 * of them shakes off the Shaken too. Declining keeps the wounds and the Benny.
 */
export function SoakPrompt() {
  const offer = useGameStore((s) => s.soakOffer);
  if (!offer) return null;
  return (
    <div className="soak-prompt">
      <strong>
        {offer.name} took {offer.wounds} Wound{offer.wounds === 1 ? '' : 's'}!
      </strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Spend a Benny to Soak? Vigor roll — the success and each raise remove one of these wounds.
        Soaking them all steadies you too. ({offer.bennies} Benn{offer.bennies === 1 ? 'y' : 'ies'} left)
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.soakRoll(offer.characterId, true)}>
          🎲 Spend a Benny — Soak
        </button>
        <button onClick={() => intents.soakRoll(offer.characterId, false)}>Keep the wounds</button>
      </div>
    </div>
  );
}
