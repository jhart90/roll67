import { useEffect, useState } from 'react';
import { parseRollKey, type RollStatKeySummary, type RollStatsSummary, type RollStatsUserBlock } from 'shared';
import { intents, useGameStore } from '../store/game';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Stable per-player colors for the stacked histograms + legend. */
const PLAYER_COLORS = ['#6ea8fe', '#f2a65a', '#7bd88f', '#e46e6e', '#b78af7', '#57c7d4', '#e0c04f', '#f28ac9'];

interface UserSlice { username: string; color: string; summary: RollStatsSummary }

/** One key merged across players: combined stats + per-player stacked bars. */
interface MergedKey {
  key: string;
  count: number;
  mean: number;
  mode: number;
  luck: number;
  /** value → per-slice counts (same order as slices). */
  hist: Array<{ value: number; parts: number[] }>;
}

function mergeKeys(slices: UserSlice[], pick: (s: RollStatsSummary) => RollStatKeySummary[]): MergedKey[] {
  const keys = new Map<string, Map<number, number[]>>();
  slices.forEach((slice, si) => {
    for (const k of pick(slice.summary)) {
      const vals = keys.get(k.key) ?? new Map<number, number[]>();
      keys.set(k.key, vals);
      for (const h of k.hist) {
        const parts = vals.get(h.value) ?? slices.map(() => 0);
        parts[si] += h.count;
        vals.set(h.value, parts);
      }
    }
  });
  const out: MergedKey[] = [];
  for (const [key, vals] of keys) {
    const { n, sides } = parseRollKey(key);
    const hist = [...vals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([value, parts]) => ({ value, parts }));
    const count = hist.reduce((a, h) => a + h.parts.reduce((x, y) => x + y, 0), 0);
    const pips = hist.reduce((a, h) => a + h.value * h.parts.reduce((x, y) => x + y, 0), 0);
    let mode = hist[0]?.value ?? 0;
    let modeCount = -1;
    for (const h of hist) {
      const c = h.parts.reduce((x, y) => x + y, 0);
      if (c > modeCount) { mode = h.value; modeCount = c; }
    }
    const max = n * sides;
    out.push({
      key, count, hist, mode,
      mean: count > 0 ? pips / count : 0,
      luck: max > 0 && count > 0 ? (pips / (max * count)) * 100 : 0,
    });
  }
  return out.sort((a, b) => {
    const pa = parseRollKey(a.key);
    const pb = parseRollKey(b.key);
    return pb.sides - pa.sides || pa.n - pb.n;
  });
}

/** One key's stats row: count, mean, mode, luck, and its stacked histogram. */
function KeyBlock({ k, slices, unit }: { k: MergedKey; slices: UserSlice[]; unit: string }) {
  const peak = Math.max(...k.hist.map((h) => h.parts.reduce((a, b) => a + b, 0)), 1);
  return (
    <div className="rollstats-key">
      <div className="rollstats-key-head">
        <strong>{k.key}</strong>
        <span className="dim">{k.count} {unit}</span>
        <span>mean {fmt(k.mean)}</span>
        <span>mode {k.mode}</span>
        <span title="Percent of the maximum possible pips — 100% is max on every die.">
          🍀 {k.luck.toFixed(1)}%
        </span>
      </div>
      <div className="rollstats-hist" role="img" aria-label={`${k.key} results histogram`}>
        {k.hist.map((h) => {
          const total = h.parts.reduce((a, b) => a + b, 0);
          return (
            <div
              key={h.value}
              className="rollstats-bar-stack"
              style={{ height: `${Math.max(8, (total / peak) * 100)}%` }}
              title={`${h.value}: ${total}×${slices.length > 1
                ? ` (${h.parts.map((c, i) => c > 0 ? `${slices[i].username} ${c}` : '').filter(Boolean).join(', ')})`
                : ''}`}
            >
              {h.parts.map((c, i) => c > 0 && (
                <div key={i} className="rollstats-seg" style={{ flexGrow: c, background: slices[i].color }} />
              ))}
              <span className="rollstats-bar-label">{h.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The full stat sheet for a set of player slices. One slice renders plain
 * bars; several render stacked per-player segments with a color legend.
 */
function StatsView({ slices }: { slices: UserSlice[] }) {
  const lifetime = slices.reduce((a, s) => a + s.summary.lifetime, 0);
  const rolls = slices.reduce((a, s) => a + s.summary.rolls, 0);
  const bySize = mergeKeys(slices, (s) => s.bySize);
  const byRoll = mergeKeys(slices, (s) => s.byAmount);
  // Overall luck re-derived from the merged size keys (pips over max pips).
  const pips = bySize.reduce((a, k) => a + (k.luck / 100) * parseRollKey(k.key).sides * k.count, 0);
  const maxPips = bySize.reduce((a, k) => a + parseRollKey(k.key).sides * k.count, 0);
  if (lifetime === 0) return <p className="dim" style={{ margin: 8 }}>No rolls recorded yet — go throw some dice!</p>;
  return (
    <div className="rollstats">
      <div className="rollstats-topline">
        <span><strong>{lifetime}</strong> lifetime dice</span>
        <span><strong>{rolls}</strong> rolls</span>
        <span title="Percent of the maximum possible pips across every die ever rolled — 100% would mean rolling max on every single die.">
          🍀 Luckiness <strong>{maxPips > 0 ? ((pips / maxPips) * 100).toFixed(1) : '0.0'}%</strong>
        </span>
      </div>
      {slices.length > 1 && (
        <div className="rollstats-legend">
          {slices.map((s) => (
            <span key={s.username} className="rollstats-legend-chip">
              <i style={{ background: s.color }} /> {s.username} ({s.summary.lifetime})
            </span>
          ))}
        </div>
      )}
      <h4>By die <span className="dim">(a 2d4 roll counts as two d4s)</span></h4>
      {bySize.map((k) => <KeyBlock key={k.key} k={k} slices={slices} unit="dice" />)}
      <h4>By roll <span className="dim">(a 2d4 roll counts once, by its total)</span></h4>
      {byRoll.map((k) => <KeyBlock key={k.key} k={k} slices={slices} unit="rolls" />)}
    </div>
  );
}

const toSlices = (users: RollStatsUserBlock[]): UserSlice[] =>
  users.map((u, i) => ({ username: u.username, color: PLAYER_COLORS[i % PLAYER_COLORS.length], summary: u.summary }));

/** Account window: every member of this campaign, one tab each. */
export function RollStatsWindow() {
  const data = useGameStore((s) => s.rollStatsData['account']);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { intents.getRollStats(); }, []);
  if (!data) return <div className="rollstats-window"><p className="dim" style={{ margin: 8 }}>Crunching the numbers…</p></div>;
  if (data.users.length === 0) return <div className="rollstats-window"><p className="dim" style={{ margin: 8 }}>Nobody in this campaign has rolled yet.</p></div>;
  const active = data.users.find((u) => u.userId === picked) ?? data.users[0];
  return (
    <div className="rollstats-window">
      {data.users.length > 1 && (
        <div className="rollstats-users">
          {data.users.map((u) => (
            <button key={u.userId} className={u.userId === active.userId ? 'active' : ''} onClick={() => setPicked(u.userId)}>
              {u.username} <span className="dim">({u.summary.lifetime})</span>
            </button>
          ))}
        </div>
      )}
      <StatsView slices={toSlices([active])} />
    </div>
  );
}

/**
 * Character-sheet tab: this character's rolls. When several players have
 * piloted the token, the histograms stack per player with a color legend.
 */
export function RollStatsTab({ characterId }: { characterId: string }) {
  const data = useGameStore((s) => s.rollStatsData[characterId]);
  useEffect(() => { intents.getRollStats(characterId); }, [characterId]);
  return (
    <div className="rollstats-window">
      {!data
        ? <p className="dim" style={{ margin: 8 }}>Crunching the numbers…</p>
        : data.users.length === 0
          ? <p className="dim" style={{ margin: 8 }}>No rolls recorded for this character yet.</p>
          : <StatsView slices={toSlices(data.users)} />}
    </div>
  );
}
