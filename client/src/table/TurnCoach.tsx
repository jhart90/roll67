import { intents, useGameStore } from '../store/game';
import { useTopChrome } from '../util/topChrome';

/**
 * The shape of a SWADE turn, for whoever is taking one.
 *
 * Two things this is careful NOT to do.
 *
 * It does not invent phases. "Assess the battlefield" and "decide whether that
 * was worth a Benny" are good advice and terrible chevrons: a step you cannot
 * finish is a step that sits there unlit all turn, teaching the player that
 * the guide does not mean anything. Everything here is something you SPEND —
 * a roll, an inch of Pace, an action, a Benny — or the choice not to.
 *
 * And it does not pretend a turn is a queue. SWADE lets you move, shoot, move
 * again; the only thing that must come first is shaking off Shaken, and the
 * only thing that must come last is handing over. So the shape is a gate, a
 * band of things you spend in whatever order you like, and a door — not six
 * boxes in a row implying you walk them left to right.
 */
type LaneState = 'open' | 'spent' | 'blocked' | 'urgent';

export function TurnCoach() {
  const you = useGameStore((s) => s.you);
  const system = useGameStore((s) => s.campaign?.system);
  const init = useGameStore((s) => s.initiativeState);
  const budgets = useGameStore((s) => s.moveBudgets);
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const members = useGameStore((s) => s.members);
  const asUser = useGameStore((s) => s.asUserId());
  const isDm = useGameStore((s) => s.isDm());
  const viewingAs = useGameStore((s) => s.viewingAs);
  const bennyState = useGameStore((s) => s.bennyState);
  const soakOffer = useGameStore((s) => s.soakOffer);
  const top = useTopChrome();

  const entry = init.entries[init.turnIdx];
  const token = entry?.tokenId ? tokens[entry.tokenId] : undefined;
  const ch = token?.characterId ? characters.find((c) => c.id === token.characterId) : undefined;
  /**
   * Whose turn this is for: a player's own character, whoever the DM is
   * standing in for, or — on the DM's own screen — a token that answers to
   * nobody but them.
   */
  const mine = !!ch && (ch.ownerUserId === asUser || (isDm && !viewingAs && !ch.ownerUserId));
  /**
   * And whose SETTING decides. A guide is for the person being taught, so in
   * "view as" it follows the player being stood in for rather than the DM
   * looking over their shoulder.
   */
  const wants = members.find((m) => m.userId === asUser)?.turnGuide !== false;
  const budget = entry?.tokenId ? budgets[entry.tokenId] : undefined;
  if (!you || system !== 'swade' || !init.active || !entry || !mine || !budget || !wants) return null;

  const moveLeft = Math.max(0, budget.pace + (budget.runBonus ?? 0) - budget.moved);
  const acted = budget.actions;
  const shaken = budget.shaken;
  const reroll = ch ? bennyState[ch.id] : undefined;
  const openBenny = !!soakOffer || !!reroll?.canRerollTrait || !!reroll?.canRerollDamage;
  const nextPenalty = acted >= 2 ? -4 : acted === 1 ? -2 : 0;

  /** The band: everything a turn is made of spending, in any order. */
  const lanes: Array<{ id: string; label: string; sub: string; state: LaneState; hint: string }> = [
    {
      id: 'move',
      label: 'Move',
      sub: budget.moved > 0 ? `${moveLeft}″ left of ${budget.pace + (budget.runBonus ?? 0)}″` : `${moveLeft}″`,
      state: moveLeft <= 0 ? 'spent' : 'open',
      hint: 'Pace, spent in any order you like — before an action, between two, or after. Running adds a d6 and costs −2 on everything else this turn.',
    },
    {
      id: 'act',
      label: acted === 0 ? 'Act' : `Act ×${acted}`,
      sub: acted === 0 ? 'no penalty' : `next at ${nextPenalty}`,
      state: shaken ? 'blocked' : acted > 0 ? 'spent' : 'open',
      hint: shaken
        ? 'Shaken: free actions and movement only until you shake it off.'
        : acted === 0
          ? 'One action costs nothing. Declare a second before you roll and BOTH are −2; a third makes all three −4.'
          : `${acted} spent. Another would put every action this turn at ${nextPenalty}.`,
    },
  ];
  // Only a lane when there is something to spend it on — a Benny you cannot
  // use on anything is not a step of the turn.
  if (openBenny) {
    lanes.push({
      id: 'benny',
      label: 'Benny',
      sub: soakOffer ? 'soak?' : 'reroll?',
      state: 'urgent',
      hint: soakOffer
        ? 'Wounds just landed — a Benny buys a Vigor roll to take them back.'
        : 'That roll is still open: a Benny rerolls the whole thing, wild die and all.',
    });
  }

  // Ready to hand over: the one thing the rules demand is dealt with, and the
  // turn has been used for something.
  const ready = !shaken && (acted > 0 || budget.moved > 0) && !openBenny;

  return (
    <div className="turn-coach" style={{ top }}>
      {/* The gate. It is a step only while it is in the way. */}
      <div
        className={`tc-gate ${shaken ? 'urgent' : 'clear'}`}
        title={shaken
          ? 'Roll Spirit to shake it off, or spend a Benny. Until then: move, but no actions.'
          : 'Nothing holding you — no Shaken to clear before you act.'}
      >
        {shaken ? '⚡ Shake it off' : '✓ Clear'}
      </div>

      {/* The band. Side by side, because that is how they are spent. */}
      <div className="tc-band">
        {lanes.map((l) => (
          <div key={l.id} className={`tc-lane tc-${l.state}`} title={l.hint}>
            <span className="tc-lane-label">{l.label}</span>
            <span className="tc-lane-sub">{l.sub}</span>
          </div>
        ))}
      </div>

      {/* The door. */}
      <button
        className={`tc-end${ready ? ' ready' : ''}`}
        title={ready
          ? 'Hand the round on'
          : shaken
            ? 'You can still end early — but you are Shaken, and shaking it off is free to try'
            : 'You can end early; this lights up once the turn has been spent on something'}
        onClick={() => intents.endTurn()}
      >
        End turn ▸
      </button>
    </div>
  );
}
