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

/**
 * A vehicle was hit hard enough to threaten control: the book gives the
 * driver a maneuvering roll to hold it, and the engine does not yet know who
 * is driving — so the DM stands in. "Held it" is the driver making that roll;
 * "roll the table" is them failing it. Chases will make this automatic.
 */
export function VehicleOocPrompt() {
  const prompt = useGameStore((s) => s.vehicleOocPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt">
      <strong>🌀 {prompt.name} is fighting for control</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        The hit reached its Toughness, so the driver must make a maneuvering roll or the
        vehicle goes Out of Control. Decide whether the driver held it — or roll the table.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.vehicleOocRoll(prompt.characterId, true)}>
          🎲 Out of Control (2d6)
        </button>
        <button onClick={() => intents.vehicleOocRoll(prompt.characterId, false)}>
          🛞 The driver holds it
        </button>
      </div>
    </div>
  );
}

/**
 * Hours have passed and something in the party's hands is damaged.
 *
 * A Wound on a hull is two hours under it with a spanner and a Repair roll —
 * so the amount of downtime is the number of attempts, and the clock is what
 * turns a wrecked getaway car into a problem for the story. Asked rather than
 * rolled, like every other handful of dice the GM did not call for.
 */
export function RepairPrompt() {
  const prompt = useGameStore((s) => s.repairPrompt);
  if (!prompt) return null;
  const n = prompt.names.length;
  return (
    <div className="soak-prompt">
      <strong>🔧 {n} damaged {n === 1 ? 'machine' : 'machines'}, and {prompt.hours} hour{prompt.hours === 1 ? '' : 's'} to work</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        {prompt.names.join(', ')}. Two hours a Wound: the best Repair in the party rolls, mending
        one Wound on a success and two on a raise — and a Critical Failure breaks something else
        getting at it. A wreck stops being a wreck once its Wounds come back under the cap.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.repairRoll(true)}>
          🔧 Spend the time on repairs
        </button>
        <button onClick={() => intents.repairRoll(false)}>Leave them broken</button>
      </div>
    </div>
  );
}
