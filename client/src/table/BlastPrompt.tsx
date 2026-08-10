import { useEffect, useState } from 'react';
import { intents, useGameStore } from '../store/game';

/**
 * A live grenade just landed on you. The blast is genuinely parked on the
 * server while this is up, so the countdown is not decoration — when it hits
 * zero the fuse runs out and the thing goes off where it lies.
 *
 * Only one person gets to act on it: the grenade is a single physical object,
 * so whoever grabs it or lies on it first settles it for the whole blast.
 * Everyone else's prompt is dismissed the moment that happens.
 */
export function BlastPrompt() {
  const offer = useGameStore((s) => s.blastOffer);
  const [left, setLeft] = useState(0);

  // Re-seed the clock for each new blast, then tick it down. Keyed on the
  // blast id so a second grenade doesn't inherit the first one's remainder.
  useEffect(() => {
    if (!offer) return;
    const end = Date.now() + offer.graceMs;
    setLeft(Math.ceil(offer.graceMs / 1000));
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [offer?.blastId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer) return null;

  return (
    <div className="sheet-backdrop" style={{ zIndex: 92 }}>
      <div className="panel levelup blast-modal">
        <div className="dock-header">
          <h3>💣 {offer.label} lands at your feet!</h3>
          <span className="spacer" />
          <span className={`blast-fuse ${left <= 5 ? 'urgent' : ''}`}>{left}s</span>
        </div>
        <p className="dim" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          Thrown by <b>{offer.throwerName}</b>. Decide before the fuse runs out — do nothing and it
          goes off exactly where it landed.
        </p>

        {offer.candidates.map((c) => (
          <div key={c.tokenId} className="blast-candidate">
            <strong>{c.name}</strong>
            {c.onHold && <span className="stk-tag" title="On Hold — a softer penalty on the grab">on Hold</span>}

            <button className="roll-btn" onClick={() => intents.blastResponse(offer.blastId, c.characterId, 'potato')}>
              <span>🤾 Throw it back — Athletics {c.potatoMod}</span>
              <span className="roll-btn-expr">
                {c.onHold ? 'poised to move, so only −2' : 'a desperate grab at a lit fuse'}
              </span>
            </button>
            <ul className="cook-notes">
              <li><b className="good">Success:</b> it lands back at {offer.throwerName}'s feet instead.</li>
              <li><b className="bad">Failure:</b> you can't get hold of it — the blast goes off as it lay.</li>
              <li><b className="bad">Critical Failure:</b> it goes off in your hand, re-centred on you, at damage as if thrown with a raise.</li>
            </ul>

            {offer.canCover && (
              <>
                <button className="roll-btn" onClick={() => intents.blastResponse(offer.blastId, c.characterId, 'cover')}>
                  <span>🛡️ Throw yourself on it</span>
                  <span className="roll-btn-expr">no roll — you either do it or you don't</span>
                </button>
                <ul className="cook-notes">
                  <li><b className="bad">You take double damage</b> and get no dive clear.</li>
                  <li><b className="good">Everyone else</b> in the blast has your Toughness taken off their damage.</li>
                </ul>
              </>
            )}

            <button onClick={() => intents.blastResponse(offer.blastId, c.characterId, 'none')}>
              Stand fast — take your chances with the blast
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
