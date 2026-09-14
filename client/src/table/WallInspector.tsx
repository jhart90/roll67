import type { WallCrossCheck, WallType } from 'shared';
import { SKILLS_SWADE } from 'shared';
import { intents, useGameStore } from '../store/game';

/** Floating editor for a wall selected with the cursor tool (DM only) --
 *  lets a solid wall become a window/one-way/stainedglass (or back) without redrawing it. */
export function WallInspector() {
  const map = useGameStore((s) => s.map);
  const isDm = useGameStore((s) => s.isDm());
  const system = useGameStore((s) => s.campaign?.system);
  const wall = useGameStore((s) =>
    s.selectedWallId ? s.dmGeometry?.walls.find((w) => w.id === s.selectedWallId) : undefined);

  if (!isDm || !map || !wall) return null;

  function update(patch: Partial<{ type: WallType; flip: boolean; glassColor: string; rainbow: boolean; crossChecks: WallCrossCheck[] }>) {
    if (!wall || !map) return;
    intents.upsertWall(map.id, { ...wall, ...patch });
  }

  const type = wall.type ?? 'solid';
  const checks = wall.crossChecks ?? [];
  const skills = system === 'swade' ? SKILLS_SWADE : [];
  function setCheck(i: number, patch: Partial<WallCrossCheck>) {
    update({ crossChecks: checks.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  }

  return (
    <div className="token-inspector">
      <div className="dock-header">
        <h3>Wall</h3>
        <button
          className="link danger"
          onClick={() => {
            intents.deleteWall(map.id, wall.id);
            useGameStore.getState().selectWall(null);
          }}
        >
          delete
        </button>
      </div>
      <div className="inspector-grid">
        <label>
          Type
          <select value={type} onChange={(e) => update({ type: e.target.value as WallType })}>
            <option value="solid">Solid — blocks movement &amp; sight</option>
            <option value="window">Window — blocks movement, see-through</option>
            <option value="oneway">One-way — see out, not in</option>
            <option value="stainedglass">Stained glass — tints light passing through</option>
          </select>
        </label>
        {type === 'oneway' && (
          <label>
            <input type="checkbox" checked={!!wall.flip} onChange={(e) => update({ flip: e.target.checked })} />
            {' '}Flip blocked side
          </label>
        )}
        {type === 'stainedglass' && (
          <>
            <label>
              Glass color
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="color"
                  value={wall.glassColor || '#cc4444'}
                  onChange={(e) => update({ glassColor: e.target.value })}
                  style={{ width: 36, height: 28, border: 'none', padding: 0, cursor: 'pointer' }}
                />
              </div>
            </label>
            <label>
              <input type="checkbox" checked={!!wall.rainbow} onChange={(e) => update({ rainbow: e.target.checked })} />
              {' '}Rainbow (splits light into 6 color bands)
            </label>
          </>
        )}
        {/* A crossing check turns the wall into something a player can TRY —
            a cliff, a river, a hedge. Any listed skill at its own target
            number gets them over; the player picks which to roll. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 12 }}>Crossing check</strong>
            <span className="dim" style={{ fontSize: 11 }}>
              {checks.length === 0 ? 'none — players cannot cross' : 'players roll one of these to cross'}
            </span>
          </div>
          {checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              {skills.length > 0 ? (
                <select value={c.skill} onChange={(e) => setCheck(i, { skill: e.target.value })} style={{ flex: 1, margin: 0 }}>
                  {!skills.includes(c.skill) && <option value={c.skill}>{c.skill}</option>}
                  {skills.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={c.skill} placeholder="Skill" onChange={(e) => setCheck(i, { skill: e.target.value })} style={{ flex: 1, margin: 0 }} />
              )}
              <span className="dim" style={{ fontSize: 11 }}>TN</span>
              <input
                type="number" min={1} max={30} value={c.tn}
                onChange={(e) => setCheck(i, { tn: Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 4))) })}
                style={{ width: 56, margin: 0 }}
              />
              <button className="link danger" title="Remove this option" onClick={() => update({ crossChecks: checks.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button
            className="link"
            style={{ marginTop: 4, fontSize: 12 }}
            onClick={() => update({ crossChecks: [...checks, { skill: skills.find((s) => !checks.some((c) => c.skill === s)) ?? skills[0] ?? 'Athletics', tn: 4 }] })}
          >
            + add a skill option
          </button>
        </div>
      </div>
    </div>
  );
}
