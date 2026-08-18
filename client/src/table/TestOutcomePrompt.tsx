import { useState } from 'react';
import { intents, useGameStore } from '../store/game';

/**
 * The judgement seat: a Test has been won and the DM chooses what it earns.
 *
 * The dice were public; this window is not — only DM screens receive the
 * prompt. Distracted and Vulnerable are the book's two prizes; on a raise
 * Shaken rides along, pre-ticked because the book says "also", untickable
 * because the book also says "as the GM allows". "No condition" is for the
 * subjective outcomes — a tripped foe knocked prone by hand instead, a bit
 * of fiction that needs no checkbox.
 */
export function TestOutcomePrompt() {
  const prompt = useGameStore((s) => s.testPrompt);
  const [shaken, setShaken] = useState(true);
  if (!prompt) return null;

  const rule = (outcome: 'distracted' | 'vulnerable' | 'none') =>
    intents.testOutcome({ testId: prompt.testId, outcome, shaken: prompt.raise && shaken });

  return (
    <div className="sheet-backdrop" style={{ zIndex: 62 }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Test won — your ruling</h3>
        </div>
        <p style={{ margin: '4px 0' }}>
          <strong>{prompt.attackerName}</strong>'s {prompt.skill} Test lands on{' '}
          <strong>{prompt.targetName}</strong> by {prompt.margin}
          {prompt.raise ? ' — a raise' : ''}.
        </p>

        {prompt.raise && (
          <label className="lu-pick" style={{ margin: '4px 0' }}>
            <input type="checkbox" checked={shaken} onChange={(e) => setShaken(e.target.checked)} />
            <span>…and Shaken, for the raise</span>
          </label>
        )}

        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button
            className="primary" style={{ width: 'auto' }}
            title="−2 to their next action, ends after it"
            onClick={() => rule('distracted')}
          >
            Distracted
          </button>
          <button
            className="primary" style={{ width: 'auto' }}
            title="Actions against them get +2 until the end of their next turn"
            onClick={() => rule('vulnerable')}
          >
            Vulnerable
          </button>
          <button
            title="Something subjective instead — narrate it yourself"
            onClick={() => rule('none')}
          >
            No condition
          </button>
        </div>
      </div>
    </div>
  );
}
