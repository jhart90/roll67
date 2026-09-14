import { useGameStore } from '../store/game';

/**
 * "🔒 Dice locked" — in the top bar, red, impossible to miss.
 *
 * The locks announce themselves in chat when they are thrown, and nowhere
 * else: someone who joined after the announcement, or scrolled past it, had
 * no way to know why their dice were dead. This is the standing answer.
 *
 * Who sees it: a player whenever THEY are locked (the whole table, or just
 * them); the DM whenever anything is locked at all, with the names, since
 * they are the one who can lift it.
 */
export function LockBanner() {
  const you = useGameStore((s) => s.you);
  const isDm = useGameStore((s) => s.isDm());
  const viewingAs = useGameStore((s) => s.viewingAs);
  const moveLocked = useGameStore((s) => s.moveLocked);
  const rollLocked = useGameStore((s) => s.rollLocked);
  const members = useGameStore((s) => s.members);
  const myMove = useGameStore((s) => s.myMoveLocked());
  const myRoll = useGameStore((s) => s.myRollLocked());
  if (!you) return null;

  let label: string;
  let detail: string;
  if (isDm && !viewingAs) {
    const diceNames = rollLocked ? [] : members.filter((m) => m.role === 'player' && m.rollLocked).map((m) => m.username);
    const moveNames = moveLocked ? [] : members.filter((m) => m.role === 'player' && m.moveLocked).map((m) => m.username);
    if (!rollLocked && !moveLocked && diceNames.length === 0 && moveNames.length === 0) return null;
    const whole = rollLocked && moveLocked ? 'Dice + Movement locked'
      : rollLocked ? 'Dice locked' : moveLocked ? 'Movement locked' : '';
    const parts: string[] = [];
    if (whole) parts.push(`${whole} for everyone`);
    if (diceNames.length) parts.push(`dice: ${diceNames.join(', ')}`);
    if (moveNames.length) parts.push(`movement: ${moveNames.join(', ')}`);
    label = whole || (diceNames.length && moveNames.length ? 'Dice + Movement locked' : diceNames.length ? 'Dice locked' : 'Movement locked');
    detail = parts.join(' · ');
  } else {
    if (!myMove && !myRoll) return null;
    label = myMove && myRoll ? 'Dice + Movement locked' : myRoll ? 'Dice locked' : 'Movement locked';
    detail = myMove && myRoll ? 'The DM is holding your dice and your token — no rolls, no moves until it lifts.'
      : myRoll ? 'The DM is holding the dice — no rolls (chat, sheet, macro or attack) until it lifts.'
        : 'The DM has frozen the board — your tokens stay where they stand until it lifts.';
  }
  return (
    <span className="lock-banner" title={detail}>
      🔒 {label}
      {isDm && !viewingAs && <span className="lock-banner-detail">{detail}</span>}
    </span>
  );
}
