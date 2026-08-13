import { CHASE_INCREMENTS, cardShort, chaseIncrement, isRedCard } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * The Chase Card track, across the top of the map.
 *
 * A chase abstracts distance: everyone stands on a card, and how many cards
 * apart two people are — times the increment for this kind of chase — is the
 * range between them. That is why a chase can run over ANY map at any scale.
 * The map stays the scenery it always was; this ribbon is the distance.
 *
 * Sits under the counters and over everything else, like the roll callout,
 * and never takes a click meant for a token.
 */
export function ChaseTrack() {
  const chase = useGameStore((s) => s.initiativeState.chase);
  const isDm = useGameStore((s) => s.isDm());
  const asUser = useGameStore((s) => s.asUserId());
  const characters = useGameStore((s) => s.characters);
  const tokens = useGameStore((s) => s.tokens);
  const turnEntryId = useGameStore((s) => s.initiativeState.entries[s.initiativeState.turnIdx]?.id ?? null);
  if (!chase) return null;

  const yards = chaseIncrement(chase.incrementId);
  const label = CHASE_INCREMENTS.find((c) => c.id === chase.incrementId)?.label ?? '';

  /** Whose chip you may drive: yours, or anyone's if you are the DM. */
  const mine = (tokenId: string | null) => {
    if (isDm) return true;
    const tok = tokenId ? tokens[tokenId] : null;
    const ch = tok?.characterId ? characters.find((c) => c.id === tok.characterId) : null;
    return !!ch && ch.ownerUserId === asUser;
  };

  // The leader is whoever stands furthest along; everyone else reads their
  // distance from them, which is the number the table actually asks for.
  const lead = Math.max(...chase.participants.map((p) => p.cardIdx));

  return (
    <div className="chase-track">
      <div className="chase-head">
        <strong>🏁 Chase</strong>
        <span className="dim">{label} · {yards} yards a card</span>
        {isDm && <button className="link" onClick={() => intents.chaseEnd()}>end chase</button>}
      </div>
      <div className="chase-cards">
        {chase.track.map((card, idx) => {
          const here = chase.participants.filter((p) => p.cardIdx === idx);
          return (
            <div key={idx} className={`chase-card ${isRedCard(card) ? 'red' : 'black'}`}>
              <span className="cc-face">{cardShort(card)}</span>
              <div className="cc-riders">
                {here.map((p) => (
                  <span
                    key={p.entryId}
                    className={`cc-chip ${p.entryId === turnEntryId ? 'up' : ''}`}
                    style={p.color ? { borderColor: p.color } : undefined}
                    title={`${p.name} — ${p.maneuverSkill}`
                      + (p.cardIdx === lead ? ' · in the lead' : ` · ${(lead - p.cardIdx) * yards} yards behind the leader`)}
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* Controls for whoever is up: the maneuver is once per turn, so the
          buttons vanish the moment it is spent rather than failing on click. */}
      <div className="chase-controls">
        {chase.participants.filter((p) => p.entryId === turnEntryId && mine(p.tokenId)).map((p) => (
          <span key={p.entryId} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {p.movedThisTurn ? (
              <span className="dim">{p.name} has manoeuvred this turn.</span>
            ) : (
              <>
                <span className="dim">{p.name} ({p.maneuverSkill}):</span>
                <button title="Free action: a maneuvering roll moves you one card, two on a raise."
                  onClick={() => intents.chaseMove(p.entryId, 'free', 'forward')}>▶ Gain a card</button>
                <button title="Spend your ACTION on it instead for +2 to the roll."
                  onClick={() => intents.chaseMove(p.entryId, 'action', 'forward')}>▶▶ …as an action (+2)</button>
                <button title="Fall back deliberately — no roll, but no more manoeuvring this turn."
                  onClick={() => intents.chaseMove(p.entryId, 'dropBack', 'back')}>◀ Drop back</button>
              </>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
