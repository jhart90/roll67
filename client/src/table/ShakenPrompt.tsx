import { intents, useGameStore } from '../store/game';

/**
 * Your character starts their turn Shaken: the free Spirit roll to recover
 * is theirs to make. Succeeding (4+) removes Shaken; a Benny removes it
 * outright without a roll (the Benny menu handles that path).
 */
export function ShakenPrompt() {
  const prompt = useGameStore((s) => s.shakenPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt">
      <strong>💫 {prompt.name} is Shaken!</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Free Spirit roll at the start of your turn: 4+ and you shake it off and act normally.
        Fail and you're stuck with free actions only. (A Benny also clears Shaken instantly —
        see the 🪙 menu.)
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.shakenRoll(prompt.characterId)}>
          🎲 Roll Spirit
        </button>
      </div>
    </div>
  );
}
