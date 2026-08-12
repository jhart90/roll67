import { intents, useGameStore } from '../store/game';

/**
 * The fight is over and there are Extras face-down on the floor.
 *
 * The book gives each of them a Vigor roll to pull through, which is where
 * prisoners, witnesses and inconvenient survivors come from. But it is the
 * DM's story: sometimes the mooks are simply dead and rolling a dozen dice to
 * confirm it wastes everyone's time. So this asks rather than assumes, and
 * skipping is a real answer, not a cancel.
 */
export function AftermathPrompt() {
  const prompt = useGameStore((s) => s.aftermathPrompt);
  if (!prompt) return null;
  const n = prompt.names.length;
  return (
    <div className="soak-prompt">
      <strong>⚔️ {n} Extra{n === 1 ? '' : 's'} down when the fighting stopped</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        {prompt.names.join(', ')}. Rolling gives each of them a Vigor check to survive their
        wounds — those who make it need patching up, guarding, or questioning. Skipping means
        none of them were getting up.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.aftermathRoll(true)}>
          🎲 Roll for the fallen
        </button>
        <button onClick={() => intents.aftermathRoll(false)}>
          💀 Skip — they died
        </button>
        <button onClick={() => useGameStore.setState({ aftermathPrompt: null })}>Decide later</button>
      </div>
    </div>
  );
}

/**
 * Days have passed and somebody is still carrying wounds. Natural healing is
 * a Vigor roll every five days — and every day for anything that regenerates
 * slowly — but a week of downtime should not fire a dozen dice the instant
 * the clock moves, so it asks.
 */
export function HealingPrompt() {
  const prompt = useGameStore((s) => s.healingPrompt);
  if (!prompt) return null;
  const n = prompt.names.length;
  return (
    <div className="soak-prompt">
      <strong>🌿 {n} wounded {n === 1 ? 'is' : 'are'} due a natural healing roll</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        {prompt.names.join(', ')}. A Vigor roll mends one Wound, two on a raise — and a
        Critical Failure means the injury has gone bad and costs another.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.healingRoll(true)}>
          🎲 Roll natural healing
        </button>
        <button onClick={() => intents.healingRoll(false)}>Not yet</button>
      </div>
    </div>
  );
}
