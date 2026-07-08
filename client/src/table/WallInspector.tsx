import type { WallType } from 'shared';
import { intents, useGameStore } from '../store/game';

/** Floating editor for a wall selected with the cursor tool (DM only) --
 *  lets a solid wall become a window/one-way (or back) without redrawing it. */
export function WallInspector() {
  const map = useGameStore((s) => s.map);
  const isDm = useGameStore((s) => s.isDm());
  const wall = useGameStore((s) =>
    s.selectedWallId ? s.dmGeometry?.walls.find((w) => w.id === s.selectedWallId) : undefined);

  if (!isDm || !map || !wall) return null;

  function update(patch: Partial<{ type: WallType; flip: boolean }>) {
    if (!wall || !map) return;
    intents.upsertWall(map.id, { ...wall, ...patch });
  }

  const type = wall.type ?? 'solid';

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
          </select>
        </label>
        {type === 'oneway' && (
          <label>
            <input type="checkbox" checked={!!wall.flip} onChange={(e) => update({ flip: e.target.checked })} />
            {' '}Flip blocked side
          </label>
        )}
      </div>
    </div>
  );
}
