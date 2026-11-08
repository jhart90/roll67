import { useState } from 'react';
import {
  DT_ROUNDS_DEFAULT, DT_TOKENS_DEFAULT, isTaskComplication, taskRound, taskStatus,
  type InitiativeEntry, type InitiativeState,
} from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * The running Dramatic Task, as everyone at the table sees it: a row of Task
 * Token pips, the round it is on out of how many it has, and — for the DM —
 * the hands to move tokens and end it. Rolls are counted from the chat log's
 * right-click menu, where the roll already is.
 */
export function DramaticTaskBar({ state, compact = false }: { state: InitiativeState; compact?: boolean }) {
  const isDm = useGameStore((s) => s.isDm());
  const [showLog, setShowLog] = useState(false);
  const task = state.dramaticTask;
  if (!task) return null;
  const status = taskStatus(task, state.round);
  const round = Math.min(taskRound(task, state.round), task.maxRounds);
  const pips = Array.from({ length: task.tokensNeeded }, (_, i) => i < task.tokens);
  const extra = Math.max(0, task.tokens - task.tokensNeeded);

  return (
    <div className={`dtask-bar dtask-${status}${compact ? ' compact' : ''}`}>
      <div className="dtask-head">
        <span className="dtask-name" title="Dramatic Task: earn the tokens before the rounds run out">⏳ {task.name}</span>
        <span className="spacer" />
        <span className="dtask-round">
          {status === 'complete' ? 'done ✅'
            : status === 'outOfTime' ? 'out of time'
              : `round ${round} of ${task.maxRounds}`}
        </span>
      </div>
      <div className="dtask-pips" title={`${task.tokens} of ${task.tokensNeeded} Task Tokens`}>
        {pips.map((on, i) => <span key={i} className={`dtask-pip${on ? ' on' : ''}`} />)}
        {extra > 0 && <span className="dtask-extra">+{extra}</span>}
        <span className="dtask-count">{task.tokens}/{task.tokensNeeded}</span>
      </div>
      {isDm && !compact && (
        <div className="row dtask-controls">
          <button title="Take a Task Token away" onClick={() => intents.dtaskAdjust(-1)}>−1</button>
          <button title="Award a Task Token — for an action that earned one" onClick={() => intents.dtaskAdjust(1)}>+1</button>
          <button title="Award two — a success with a raise" onClick={() => intents.dtaskAdjust(2)}>+2</button>
          <span className="spacer" />
          {task.log.length > 0 && (
            <button className="link" onClick={() => setShowLog((v) => !v)}>{showLog ? 'hide log' : 'log'}</button>
          )}
          <button className="link danger" title="End the task — the fight, if any, carries on" onClick={() => intents.dtaskEnd()}>end task</button>
        </div>
      )}
      {isDm && !compact && (
        <p className="dim dtask-hint">Right-click a roll in chat → “Count toward the task” to score it (a Club in the roller’s hand is −2).</p>
      )}
      {showLog && !compact && (
        <ol className="dtask-log">
          {task.log.slice().reverse().map((l, i) => (
            <li key={i}><span className="dim">r{l.round}</span> {l.who}: {l.delta > 0 ? `+${l.delta}` : l.delta} — {l.why}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The ♣ beside a combatant who holds a Complication while a task runs. */
export function ComplicationMark({ state, entry }: { state: InitiativeState; entry: InitiativeEntry }) {
  if (!state.dramaticTask || !isTaskComplication(entry.card)) return null;
  return <span className="dtask-club" title="Complication: a Club this round — −2 on rolls toward the Dramatic Task, and failing one is a disaster">♣</span>;
}

/** Setting up a task: what it is, how many tokens, how many rounds. */
export function DramaticTaskPrompt({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [tokens, setTokens] = useState(DT_TOKENS_DEFAULT);
  const [rounds, setRounds] = useState(DT_ROUNDS_DEFAULT);

  function start() {
    intents.dtaskStart(name.trim() || 'Dramatic Task', tokens, rounds);
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Start a Dramatic Task</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>
        <label className="lu-field">
          What is at stake
          <input value={name} maxLength={60} placeholder="e.g. Shut down the Inpu Sentinel" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') start(); }} autoFocus />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <label className="lu-field" style={{ flex: 1 }}>
            Task Tokens needed
            <input type="number" min={1} max={30} value={tokens}
              onChange={(e) => setTokens(Math.max(1, Math.min(30, Number(e.target.value) || DT_TOKENS_DEFAULT)))} />
          </label>
          <label className="lu-field" style={{ flex: 1 }}>
            Rounds
            <input type="number" min={1} max={20} value={rounds}
              onChange={(e) => setRounds(Math.max(1, Math.min(20, Number(e.target.value) || DT_ROUNDS_DEFAULT)))} />
          </label>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          It starts on this round of the tracker and counts its rounds off it. A success on a roll toward
          the task earns a token, each raise another. Anyone dealt a Club has a Complication: −2, and
          failing that roll is a disaster. In a fight, award tokens by hand for actions that earn them.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" style={{ width: 'auto' }} onClick={start}>⏳ Start the task</button>
        </div>
      </div>
    </div>
  );
}
