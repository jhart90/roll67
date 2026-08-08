import { num } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * Your character starts their turn Shaken: the free Spirit roll to recover
 * is theirs to make — or a Benny clears it outright, right from this window.
 */
export function ShakenPrompt() {
  const prompt = useGameStore((s) => s.shakenPrompt);
  const character = useGameStore((s) => s.characters.find((c) => c.id === prompt?.characterId));
  if (!prompt) return null;
  const bennies = character ? num(character.sheet, 'bennies', 0) : 0;
  const spendBenny = () => {
    intents.bennyUse(prompt.characterId, 'recover-shaken');
    useGameStore.setState({ shakenPrompt: null });
  };
  return (
    <div className="soak-prompt">
      <strong>💫 {prompt.name} is Shaken!</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Make a free Spirit roll at the start of your turn:
      </span>
      <ul className="dim shaken-outcomes">
        <li><b style={{ color: '#2fe04a' }}>4+</b> and you shake it off and act normally</li>
        <li><b style={{ color: '#e05252' }}>Fail</b> and you're stuck with free actions only</li>
        <li>(A <b style={{ color: '#d9a520' }}>Benny</b> also clears Shaken status instantly — see the 🪙 menu)</li>
      </ul>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.shakenRoll(prompt.characterId)}>
          🎲 Roll Spirit
        </button>
        <button
          className="benny-soak-btn"
          disabled={bennies <= 0}
          title={bennies > 0
            ? `Spend a Benny to clear Shaken without a roll (${bennies} Benn${bennies === 1 ? 'y' : 'ies'} left)`
            : 'No Benny to spend.'}
          onClick={spendBenny}
        >
          🪙 Spend a Benny
        </button>
      </div>
    </div>
  );
}
