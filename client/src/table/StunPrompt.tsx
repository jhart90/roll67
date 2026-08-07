import { intents, useGameStore } from '../store/game';

/**
 * Your character starts their turn Stunned: the free Vigor roll to come to
 * is theirs to make — same click-to-roll pattern as Shaken and Bleeding Out.
 */
export function StunPrompt() {
  const prompt = useGameStore((s) => s.stunPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt">
      <strong>⭐ {prompt.name} is Stunned!</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Free Vigor roll at the start of your turn: 4+ and you come to — but stay Vulnerable and
        Distracted until the end of your next turn. A <b>raise</b> (8+) clears those too. Fail and
        you stay Stunned: no moving, no acting. (You're Prone either way until you stand.)
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.stunRoll(prompt.characterId)}>
          🎲 Roll Vigor
        </button>
      </div>
    </div>
  );
}
