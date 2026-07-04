import { intents, useGameStore } from '../store/game';
import { DieShape } from './DiceShapes';

const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
const COUNTS = [1, 2, 3, 4, 5, 6];

const DICE_PALETTE = [
  '#d26c6c', '#d2a56c', '#d2d26c', '#7ed28a', '#6cd2c8',
  '#6c9bd2', '#b06cd2', '#d26cb0', '#c9cfdd', '#3a3f4d',
];

/** Pick the color everyone sees when your 3D dice roll across the table. */
function DiceColorPicker() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const current = you ? members.find((m) => m.userId === you.userId)?.diceColor ?? null : null;

  return (
    <div className="dice-color-row">
      <span className="dim" style={{ fontSize: 11 }}>Your dice:</span>
      <button
        className={`link ${current === null ? 'active' : ''}`}
        style={{ fontSize: 11 }}
        title="Use the per-die default colors"
        onClick={() => intents.setDiceColor(null)}
      >
        default
      </button>
      {DICE_PALETTE.map((c) => (
        <button
          key={c}
          className={`dice-color-swatch ${current === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => intents.setDiceColor(c)}
        />
      ))}
      <input
        type="color"
        className="dice-color-custom"
        value={current ?? '#6c9bd2'}
        title="Custom color"
        onChange={(e) => intents.setDiceColor(e.target.value)}
      />
    </div>
  );
}

/** Quick-roll panel: click to roll 1-6 dice of any standard type. */
export function DiceRoller({ onClose }: { onClose: () => void }) {
  return (
    <div className="dice-panel">
      <div className="dock-header">
        <h3>Roll dice</h3>
        <button className="link" onClick={onClose}>close</button>
      </div>
      <table className="dice-grid">
        <tbody>
          {DICE_TYPES.map((sides) => (
            <tr key={sides}>
              <td className="dice-type">
                <button
                  className="dice-type-btn"
                  title={`Roll 1d${sides}`}
                  onClick={() => intents.chat(`/r 1d${sides}`)}
                >
                  <DieShape sides={sides} size={26} />
                  <span>D{sides}</span>
                </button>
              </td>
              {COUNTS.map((n) => (
                <td key={n}>
                  <button
                    className="dice-count-btn"
                    title={`Roll ${n}d${sides}`}
                    onClick={() => intents.chat(`/r ${n}d${sides}`)}
                  >
                    {n}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <DiceColorPicker />
      <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Rolls go to chat for everyone. Use /r in chat for modifiers (e.g. /r 2d6+3).
      </p>
    </div>
  );
}
