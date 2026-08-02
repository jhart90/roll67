import { intents, useGameStore } from '../store/game';

/**
 * Your character is Bleeding Out — the start-of-turn Vigor roll is yours to
 * make, not the server's. Explains the stakes and hands you the die.
 */
export function BleedPrompt() {
  const prompt = useGameStore((s) => s.bleedPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt bleed-prompt">
      <strong>🩸 {prompt.name} is Bleeding Out!</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        You must make a Vigor roll right now: on a <b>failure</b> you die, on a <b>success</b> (4+)
        you hold on until your next turn, and on a <b>raise</b> (8+) you stabilize and stop
        Bleeding Out. Healing received before your next turn also saves you.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.bleedRoll(prompt.characterId)}>
          🎲 Roll Vigor
        </button>
      </div>
    </div>
  );
}
