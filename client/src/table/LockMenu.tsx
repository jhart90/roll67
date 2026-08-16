import { useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { playerColorFor } from '../util/playerColor';

/**
 * The DM's padlock: who may move, and who may roll.
 *
 * Both locks exist at two scopes, and the panel shows both — a switch for the
 * whole table, then one pill per player. The pill is the answer to "can this
 * person act RIGHT NOW", so it reads green or red on the EFFECTIVE state:
 * while the table-wide lock is on, every pill is red, because every player is
 * in fact frozen. The pills go quiet at the same time, since toggling a
 * personal lock underneath a table-wide one changes nothing anybody can see —
 * a control that does nothing is worse than a control that is plainly off.
 *
 * Freezing one player is deliberately quiet: the table-wide locks announce
 * themselves in chat, but singling someone out is usually a private
 * correction, and a public callout is not the DM's only way to say it.
 */
export function LockMenu() {
  const isDm = useGameStore((s) => s.isDm());
  const moveLocked = useGameStore((s) => s.moveLocked);
  const rollLocked = useGameStore((s) => s.rollLocked);
  const members = useGameStore((s) => s.members);
  const [open, setOpen] = useState(false);
  if (!isDm) return null;

  const players = members.filter((m) => m.role === 'player');
  const anyLocked = moveLocked || rollLocked
    || players.some((p) => p.moveLocked || p.rollLocked);

  return (
    <div className="lock-menu">
      <button
        className={`lock-chip ${open ? 'open' : ''} ${anyLocked ? 'engaged' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={anyLocked ? 'Something is locked — open to see what' : 'Lock movement or dice'}
      >
        {anyLocked ? '🔒' : '🔓'}
      </button>
      {open && (
        <div className="lock-panel">
          <div className="benny-head">
            <strong>Locks</strong>
            <span className="dim">the DM is never locked</span>
          </div>

          <LockSection
            kind="move"
            label="Movement"
            allLocked={moveLocked}
            allTitle={moveLocked
              ? 'Players cannot move any tokens. Click to unlock.'
              : 'Freeze every player token where it stands (the DM can still move anything).'}
            onAll={() => intents.setMoveLock(!moveLocked)}
            players={players}
          />

          <LockSection
            kind="roll"
            label="Dice"
            allLocked={rollLocked}
            allTitle={rollLocked
              ? 'Players cannot roll anything. Click to unlock.'
              : 'Hold every player’s dice — no rolls, from chat, sheet, macro or attack.'}
            onAll={() => intents.setRollLock(!rollLocked)}
            players={players}
          />
        </div>
      )}
    </div>
  );
}

function LockSection({ kind, label, allLocked, allTitle, onAll, players }: {
  kind: 'move' | 'roll';
  label: string;
  allLocked: boolean;
  allTitle: string;
  onAll: () => void;
  players: Array<{ userId: string; username: string; moveLocked: boolean; rollLocked: boolean; playerColor: string | null; role: 'dm' | 'player' }>;
}) {
  return (
    <div className="lock-section">
      <button
        className={allLocked ? 'lock-all on' : 'lock-all'}
        title={allTitle}
        onClick={onAll}
      >
        {allLocked ? `🔒 ${label} locked — unlock` : `🔓 Lock ${label.toLowerCase()}`}
      </button>
      {players.length === 0 && <span className="dim lock-empty">No players yet.</span>}
      <div className="lock-pills">
        {players.map((p) => {
          const own = kind === 'move' ? p.moveLocked : p.rollLocked;
          // What the DM is actually looking at: can this person act now?
          const stuck = allLocked || own;
          return (
            <button
              key={p.userId}
              className={`lock-pill ${stuck ? 'locked' : 'free'}`}
              disabled={allLocked}
              style={{ borderColor: playerColorFor(p) }}
              title={allLocked
                ? `The whole table's ${label.toLowerCase()} is locked — lift that to set players one by one.`
                : own
                  ? `${p.username} cannot ${kind === 'move' ? 'move' : 'roll'}. Click to release them.`
                  : `${p.username} can ${kind === 'move' ? 'move' : 'roll'}. Click to lock just them.`}
              onClick={() => intents.setPlayerLock(p.userId, kind, !own)}
            >
              {stuck ? '🔒' : '🔓'} {p.username}
            </button>
          );
        })}
      </div>
    </div>
  );
}
