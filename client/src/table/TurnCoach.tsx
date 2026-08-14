import { intents, useGameStore } from '../store/game';

/**
 * The shape of a SWADE turn, for whoever is taking one.
 *
 * A turn in this system is not a list of boxes to tick — it is a loop the
 * table learns: shake it off, look around, move, do the thing, see what it
 * cost, hand over. New players lose turns to the parts they cannot see
 * coming (the Shaken roll that comes FIRST, the second action that makes both
 * harder), so this says where they are in that loop and what is still open.
 *
 * It reports rather than enforces. Nothing here gates a button: Assess and
 * Resolve are thinking, not mechanics, and a turn spent standing still doing
 * nothing is a legitimate turn. The only thing it insists on is the one the
 * rules insist on — that a Shaken character deals with being Shaken.
 */
type StageState = 'todo' | 'now' | 'done' | 'skip';

interface Stage {
  id: string;
  label: string;
  state: StageState;
  hint: string;
}

export function TurnCoach() {
  const you = useGameStore((s) => s.you);
  const system = useGameStore((s) => s.campaign?.system);
  const init = useGameStore((s) => s.initiativeState);
  const budgets = useGameStore((s) => s.moveBudgets);
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const asUser = useGameStore((s) => s.asUserId());
  const isDm = useGameStore((s) => s.isDm());
  const viewingAs = useGameStore((s) => s.viewingAs);
  const bennyState = useGameStore((s) => s.bennyState);
  const soakOffer = useGameStore((s) => s.soakOffer);

  const entry = init.entries[init.turnIdx];
  const token = entry?.tokenId ? tokens[entry.tokenId] : undefined;
  const ch = token?.characterId ? characters.find((c) => c.id === token.characterId) : undefined;
  /**
   * Whose turn this coach is for.
   *
   * A player's own character, obviously. In "view as" that is whoever the DM
   * is standing in for — asUserId() already answers as them, which is the
   * whole point of it. And the DM's own turn: when the thing that is up
   * answers to nobody but them, the loop is theirs to walk and the coach is
   * as much use to them as to anybody.
   *
   * What it is NOT is a checklist over somebody else's character.
   */
  const mine = !!ch && (ch.ownerUserId === asUser || (isDm && !viewingAs && !ch.ownerUserId));
  const budget = entry?.tokenId ? budgets[entry.tokenId] : undefined;
  if (!you || system !== 'swade' || !init.active || !entry || !mine || !budget) return null;

  const moveLeft = Math.max(0, budget.pace + (budget.runBonus ?? 0) - budget.moved);
  const acted = budget.actions > 0;
  const moved = budget.moved > 0;
  // The one rule this thing enforces, because the rules do: a Shaken
  // character's turn starts with getting up off the floor.
  const shaken = budget.shaken;
  const reroll = ch ? bennyState[ch.id] : undefined;
  const openBenny = !!soakOffer || !!reroll?.canRerollTrait || !!reroll?.canRerollDamage;

  const nextPenalty = budget.actions >= 2 ? -4 : budget.actions === 1 ? -2 : 0;

  const stages: Stage[] = [
    {
      id: 'recover',
      label: 'Recover',
      state: shaken ? 'now' : 'done',
      hint: shaken
        ? 'Shaken: roll Spirit to shake it off, or spend a Benny. Until then you may move but not act.'
        : 'Nothing holding you — no Shaken, no condition to clear first.',
    },
    {
      id: 'assess',
      label: 'Assess',
      state: shaken ? 'todo' : 'now',
      hint: 'What is this turn FOR? The threat, the objective, the ally who needs you — and where you stand relative to it. Thinking, not a roll.',
    },
    {
      id: 'move',
      label: 'Move',
      state: moved ? 'done' : 'todo',
      hint: moved
        ? `${budget.moved}″ spent, ${moveLeft}″ left. Movement can come before, between or after your actions.`
        : `${moveLeft}″ of Pace, and none of it spent. Running adds a d6 but costs −2 on everything else this turn.`,
    },
    {
      id: 'act',
      label: 'Act',
      state: acted ? 'done' : 'todo',
      hint: acted
        ? `${budget.actions} action${budget.actions === 1 ? '' : 's'} taken. Another would put every one of them at ${nextPenalty}.`
        : 'One action is free of penalty. Two make both −2, three make all three −4 — declare before you roll.',
    },
    {
      id: 'resolve',
      label: 'Resolve',
      state: openBenny ? 'now' : acted ? 'done' : 'todo',
      hint: openBenny
        ? 'A roll is still open to a Benny — reroll it, or Soak what it cost you.'
        : 'Damage beats Toughness to Shake, and every raise over it is a Wound. Worth a Benny?',
    },
    {
      id: 'reset',
      label: 'Reset',
      state: shaken ? 'todo' : (acted || moved) ? 'now' : 'todo',
      hint: 'Everything spent that you meant to spend? Then hand the round on.',
    },
  ];

  // Ready to hand over: the thing the rules demanded is dealt with, and the
  // turn has actually been used for something.
  const ready = !shaken && (acted || moved) && !openBenny;

  return (
    <div className="turn-coach">
      <div className="tc-chevrons">
        {stages.map((s) => (
          <div key={s.id} className={`tc-step tc-${s.state}`} title={s.hint}>
            <span className="tc-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="tc-foot">
        <span className="tc-hint">{stages.find((s) => s.state === 'now')?.hint ?? stages[5].hint}</span>
        <button
          className={`tc-end${ready ? ' ready' : ''}`}
          title={ready ? 'Hand the round on' : 'You can end early — this only lights up once the turn has been used'}
          onClick={() => intents.endTurn()}
        >
          End turn
        </button>
      </div>
    </div>
  );
}
