import { useEffect, useState } from 'react';
import { conditionsOf, num } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * A Wild Card went down: their fate is a choice, not a timer. Soak with a
 * Benny (if one is in hand — a soaked Wound stands them right back up), or
 * proceed to the Incapacitation Vigor roll. The DM gets a third option for
 * their own Wild Cards: skip the roll and call it — dead.
 */
export function IncapPrompt() {
  const prompt = useGameStore((s) => s.incapPrompt);
  const character = useGameStore((s) => s.characters.find((c) => c.id === prompt?.characterId));
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  const [soaked, setSoaked] = useState(false);

  useEffect(() => { setSoaked(false); }, [prompt?.characterId]);

  // A successful Soak (or healing) stood them back up — emergency over.
  const upAgain = !!prompt && !!character && !conditionsOf(character.sheet).includes('incapacitated');
  useEffect(() => {
    if (upAgain) useGameStore.setState({ incapPrompt: null });
  }, [upAgain]);
  if (!prompt || upAgain) return null;

  const bennies = character ? num(character.sheet, 'bennies', 0) : 0;
  const canSoak = !soaked && prompt.canSoak && bennies > 0;
  const dmToken = isDm && !!character && !character.ownerUserId;

  return (
    <div className="soak-prompt incap-prompt">
      <strong>⚕️ {prompt.name} has been incapacitated!</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        The Incapacitation Vigor roll decides their fate: a <b>critical failure</b> kills them
        outright; a <b>failure</b> means a permanent Injury and Bleeding Out; a <b>success</b> (4+)
        an Injury until all Wounds heal; a <b>raise</b> (8+) an Injury for just 24 hours.
        {prompt.canSoak && ' Or spend a Benny to Soak first — removing a Wound stands them back up and skips all of this.'}
      </span>
      <div className="row">
        <button
          className="benny-soak-btn"
          disabled={!canSoak}
          title={canSoak
            ? `Vigor roll: the success and each raise remove a fresh Wound (${bennies} Benn${bennies === 1 ? 'y' : 'ies'} left)`
            : soaked ? 'The Soak has been rolled — the Vigor roll is all that remains.' : 'No Benny to spend (or no fresh wounds to Soak).'}
          onClick={() => { setSoaked(true); intents.soakRoll(prompt.characterId, true); }}
        >
          🪙 Soak with a Benny
        </button>
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.incapRoll(prompt.characterId)}>
          🎲 Roll Vigor
        </button>
        {dmToken && (
          <button
            className="danger"
            title="Skip the Incapacitation roll: this Wild Card dies and is out of the fight."
            onClick={() => intents.incapDeath(prompt.characterId)}
          >
            💀 Mark as dead
          </button>
        )}
      </div>
    </div>
  );
}
