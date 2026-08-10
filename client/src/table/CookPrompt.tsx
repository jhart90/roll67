import { useGameStore } from '../store/game';

/**
 * Asked once, the moment a grenade's blast is placed and before it leaves the
 * hand: cook it or throw it straight? Both sides of the trade are spelled out,
 * because the choice is only interesting if you can see what it costs.
 */
export function CookPrompt() {
  const prompt = useGameStore((s) => s.cookPrompt);
  if (!prompt) return null;
  const confirm = (cook: boolean) => useGameStore.getState().confirmAoeTargeting(cook);

  return (
    <div className="sheet-backdrop" style={{ zIndex: 90 }}>
      <div className="panel levelup cook-modal">
        <div className="dock-header"><h3>💣 {prompt.label} — cook it?</h3></div>
        <p className="dim" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          Counting off a few seconds before you throw. It’s a <b>free action</b> either way.
        </p>

        <button className="roll-btn" onClick={() => confirm(true)}>
          <span>🔥 Cook it — Smarts roll</span>
          <span className="roll-btn-expr">timed right, nobody throws it back or dives clear</span>
        </button>
        <ul className="cook-notes">
          <li><b className="good">Success:</b> it goes off the instant it lands — no throwing back, no Evasion.</li>
          <li><b className="bad">Failure:</b> the timing is off; it can still be thrown back or evaded.</li>
          <li><b className="bad">Critical Failure:</b> it goes off in your hand — the blast re-centres on you, at damage as if thrown with a raise.</li>
        </ul>

        <button className="roll-btn" onClick={() => confirm(false)}>
          <span>🫳 Throw it straight</span>
          <span className="roll-btn-expr">no Smarts roll, no risk to you</span>
        </button>
        <ul className="cook-notes">
          <li>Anyone caught in the blast may dive clear (<b>Agility −2</b>), and one of them could pick it up and throw it back.</li>
        </ul>

        <button onClick={() => useGameStore.setState({ cookPrompt: null, aoeTargeting: null })}>Cancel the throw</button>
      </div>
    </div>
  );
}
