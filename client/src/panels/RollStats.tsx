import { useEffect, useState } from 'react';
import type { RollStatKeySummary, RollStatsSummary, RollStatsUserBlock } from 'shared';
import { intents, useGameStore } from '../store/game';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** One key's stats: count, mean, mode, luck, and its result histogram. */
function KeyBlock({ k }: { k: RollStatKeySummary }) {
  const peak = Math.max(...k.hist.map((h) => h.count), 1);
  return (
    <div className="rollstats-key">
      <div className="rollstats-key-head">
        <strong>{k.key}</strong>
        <span className="dim">×{k.count}</span>
        <span>mean {fmt(k.mean)}</span>
        <span>mode {k.mode}</span>
        <span title="Percent of the maximum possible pips — 100% is max on every die.">
          🍀 {k.luck.toFixed(1)}%
        </span>
      </div>
      <div className="rollstats-hist" role="img" aria-label={`${k.key} results histogram`}>
        {k.hist.map((h) => (
          <div
            key={h.value}
            className="rollstats-bar"
            style={{ height: `${Math.max(8, (h.count / peak) * 100)}%` }}
            title={`${h.value}: rolled ${h.count}×`}
          >
            <span className="rollstats-bar-label">{h.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The full stat sheet for one scope: lifetime, luck, by-size, by-amount. */
export function RollStatsView({ summary }: { summary: RollStatsSummary }) {
  if (summary.lifetime === 0) return <p className="dim" style={{ margin: 8 }}>No rolls recorded yet — go throw some dice!</p>;
  return (
    <div className="rollstats">
      <div className="rollstats-topline">
        <span><strong>{summary.lifetime}</strong> lifetime dice</span>
        <span title="Percent of the maximum possible pips across every die ever rolled — 100% would mean rolling max on every single die.">
          🍀 Luckiness <strong>{summary.luck.toFixed(1)}%</strong>
        </span>
      </div>
      <h4>By die size <span className="dim">(a 2d4 roll counts as two d4s)</span></h4>
      {summary.bySize.map((k) => <KeyBlock key={k.key} k={k} />)}
      <h4>By dice amount <span className="dim">(a 2d4 roll counts once, by its total)</span></h4>
      {summary.byAmount.map((k) => <KeyBlock key={k.key} k={k} />)}
    </div>
  );
}

/** Per-user sections with a picker when more than one user has rolled. */
function UserBlocks({ users, emptyNote }: { users: RollStatsUserBlock[]; emptyNote: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (users.length === 0) return <p className="dim" style={{ margin: 8 }}>{emptyNote}</p>;
  const active = users.find((u) => u.userId === picked) ?? users[0];
  return (
    <div>
      {users.length > 1 && (
        <div className="rollstats-users">
          {users.map((u) => (
            <button
              key={u.userId}
              className={u.userId === active.userId ? 'active' : ''}
              onClick={() => setPicked(u.userId)}
            >
              {u.username} <span className="dim">({u.summary.lifetime})</span>
            </button>
          ))}
        </div>
      )}
      {users.length === 1 && <p className="dim" style={{ margin: '4px 8px' }}>{active.username}</p>}
      <RollStatsView summary={active.summary} />
    </div>
  );
}

/** Account window: every member of this campaign, lifetime dice career each. */
export function RollStatsWindow() {
  const data = useGameStore((s) => s.rollStatsData['account']);
  useEffect(() => { intents.getRollStats(); }, []);
  return (
    <div className="rollstats-window">
      {!data
        ? <p className="dim" style={{ margin: 8 }}>Crunching the numbers…</p>
        : <UserBlocks users={data.users} emptyNote="Nobody in this campaign has rolled yet." />}
    </div>
  );
}

/** Character-sheet tab: this character's rolls, broken out by who rolled them. */
export function RollStatsTab({ characterId }: { characterId: string }) {
  const data = useGameStore((s) => s.rollStatsData[characterId]);
  useEffect(() => { intents.getRollStats(characterId); }, [characterId]);
  return (
    <div className="rollstats-window">
      {!data
        ? <p className="dim" style={{ margin: 8 }}>Crunching the numbers…</p>
        : <UserBlocks users={data.users} emptyNote="No rolls recorded for this character yet." />}
    </div>
  );
}
