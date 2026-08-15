import { useState } from 'react';
import { TIME_STEPS } from 'shared';
import { intents, useGameStore } from '../store/game';
import { ConfirmButton } from '../util/ConfirmButton';

/** "Day 3 · 14:22" — the same reading the server puts on its report card. */
function clockLabel(seconds: number): string {
  const day = Math.floor(seconds / 86_400) + 1;
  const hh = String(Math.floor((seconds % 86_400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  return `Day ${day} · ${hh}:${mm}`;
}

/**
 * The GM's clock.
 *
 * SWADE hangs a surprising amount on elapsed time — Power Points coming back,
 * Fatigue clearing, the Golden Hour closing over someone's wounds — and none
 * of it can happen while the only clock in the room is the real one. This
 * moves the world's.
 *
 * A round is disabled while combat runs: the initiative tracker is already
 * advancing rounds, and two things ticking durations would run every power
 * out twice as fast. The longer steps ask twice, because a mis-clicked day
 * is expensive.
 */
export function TimeMenu() {
  const isDm = useGameStore((s) => s.isDm());
  const seconds = useGameStore((s) => s.clockSeconds);
  const inCombat = useGameStore((s) => s.initiativeState.active);
  const moveLocked = useGameStore((s) => s.moveLocked);
  const [open, setOpen] = useState(false);
  if (!isDm) return null;

  return (
    <div className="time-menu">
      {/* The chip is a clock, not a readout: the date and time are the first
          thing inside the panel, where somebody who wants them has asked. */}
      <button
        className={`time-chip ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Advance the in-world clock — ${clockLabel(seconds)}`}
      >
        ⏱
      </button>
      {open && (
        <div className="time-panel">
          <div className="benny-head">
            <strong>Advance time</strong>
            <span className="dim">{clockLabel(seconds)}</span>
          </div>
          {TIME_STEPS.map((step) => {
            const blocked = step.id === 'round' && inCombat;
            const heavy = step.id === 'hour' || step.id === 'day';
            const title = blocked
              ? 'Combat is running — the initiative tracker advances rounds.'
              : step.id === 'round' ? 'Six seconds. Running powers lose a round; Aiming and Defending lapse.'
                : step.id === 'minute' ? 'Ten rounds. Anything shorter than a minute has run out.'
                  : step.id === 'hour' ? 'An hour of rest: 5 Power Points back, and ordinary Fatigue clears.'
                    : 'A full day.';
            if (blocked) {
              return (
                <button key={step.id} disabled title={title}>
                  {step.icon} {step.label} <span className="dim">— in combat</span>
                </button>
              );
            }
            return heavy ? (
              <ConfirmButton
                key={step.id}
                className=""
                title={title}
                confirmLabel={`Really advance ${step.label}?`}
                onConfirm={() => intents.advanceTime(step.id)}
              >
                {step.icon} {step.label}
              </ConfirmButton>
            ) : (
              <button key={step.id} title={title} onClick={() => intents.advanceTime(step.id)}>
                {step.icon} {step.label}
              </button>
            );
          })}
          {/* Freezing the board is a TIME move — "nothing happens until I
              say" — which is why it lives with the clock and not in settings.
              One button, two states, announced in chat either way. */}
          <button
            className={moveLocked ? 'time-lock on' : 'time-lock'}
            title={moveLocked
              ? 'Players cannot move any tokens. Click to unlock.'
              : 'Freeze every player token where it stands (the DM can still move anything).'}
            onClick={() => intents.setMoveLock(!moveLocked)}
          >
            {moveLocked ? '🔒 Movement locked — unlock' : '🔓 Lock movement'}
          </button>
          <span className="dim" style={{ fontSize: 11 }}>
            Bennies are drawn per session, not per day — that button lives in the Benny menu.
          </span>
        </div>
      )}
    </div>
  );
}
