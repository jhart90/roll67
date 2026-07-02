import { intents } from '../store/game';
import { DieShape } from './DiceShapes';

const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
const COUNTS = [1, 2, 3, 4, 5, 6];

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
      <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Rolls go to chat for everyone. Use /r in chat for modifiers (e.g. /r 2d6+3).
      </p>
    </div>
  );
}
