import { intents, useGameStore } from '../store/game';

/**
 * A move ran into a wall the DM put a check on — a cliff, a river, a hedge.
 * The player picks which of the DM's skills to roll (each at its own target
 * number) or stays put. Same shape and place as the run prompt, and never
 * up at the same time as it: the wall is asked about first, and a pass
 * re-sends the move so the Pace question comes after, where it belongs.
 */
export function WallCheckPrompt() {
  const prompt = useGameStore((s) => s.wallCheckPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt">
      <strong>🧗 {prompt.name} can't just walk through that</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Getting across takes a roll. Pick a skill — beat its target number and the move goes ahead
        {prompt.checks.length > 1 ? '; any one of them will do' : ''}. Fail and {prompt.name} stays where they are.
      </span>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {prompt.checks.map((c) => (
          <button
            key={c.skill}
            className="primary"
            style={{ width: 'auto' }}
            onClick={() => intents.wallCheckRoll(prompt.tokenId, prompt.wallId, c.skill, prompt.q, prompt.r)}
          >
            🎲 {c.skill} (TN {c.tn})
          </button>
        ))}
        <button onClick={() => useGameStore.setState({ wallCheckPrompt: null })}>Stay put</button>
      </div>
    </div>
  );
}
