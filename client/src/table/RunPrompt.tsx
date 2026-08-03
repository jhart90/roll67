import { intents, useGameStore } from '../store/game';

/**
 * That move is farther than this turn's remaining Pace: running adds a d6 of
 * movement but costs −2 on everything else the character does this turn.
 * The choice is the player's — never auto-rolled.
 */
export function RunPrompt() {
  const prompt = useGameStore((s) => s.runPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt">
      <strong>🏃 {prompt.name} needs to run to get there</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Pace {prompt.pace}{prompt.moved > 0 ? ` (already moved ${prompt.moved})` : ''} isn't enough
        for that move. Running rolls a d6 and adds it to this turn's movement — but takes
        <b> −2 on all other actions</b> until your next turn. Roll it, then move again.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.runRoll(prompt.tokenId)}>
          🎲 Roll to Run (+1d6 Pace, −2 actions)
        </button>
        <button onClick={() => useGameStore.setState({ runPrompt: null })}>Stay put</button>
      </div>
    </div>
  );
}
