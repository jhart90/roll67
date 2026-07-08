import { useEffect, useState } from 'react';
import type { DoorType } from 'shared';
import { intents, useGameStore } from '../store/game';

/** Floating editor for a door/gate selected with the cursor tool (right-click,
 *  DM only) -- change door<->gate, toggle open/closed, and lock it behind a
 *  generic or named key item without deleting and redrawing it. */
export function DoorInspector() {
  const map = useGameStore((s) => s.map);
  const isDm = useGameStore((s) => s.isDm());
  const door = useGameStore((s) =>
    s.selectedDoorId ? s.dmGeometry?.doors.find((d) => d.id === s.selectedDoorId) : undefined);

  const isGeneric = !door?.keyName || door.keyName === 'Key';
  const [customKey, setCustomKey] = useState(isGeneric ? '' : door?.keyName ?? '');
  const [keyMode, setKeyMode] = useState<'generic' | 'specific'>(isGeneric ? 'generic' : 'specific');

  useEffect(() => {
    setCustomKey(isGeneric ? '' : door?.keyName ?? '');
    setKeyMode(isGeneric ? 'generic' : 'specific');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [door?.id]);

  if (!isDm || !map || !door) return null;

  function update(patch: Partial<{ type: DoorType; open: boolean; locked: boolean; keyName: string | null }>) {
    if (!door || !map) return;
    intents.upsertDoor(map.id, { ...door, ...patch });
  }

  const type = door.type ?? 'door';

  return (
    <div className="token-inspector">
      <div className="dock-header">
        <h3>{type === 'gate' ? 'Gate' : 'Door'}</h3>
        <button
          className="link danger"
          onClick={() => {
            intents.deleteDoor(map.id, door.id);
            useGameStore.getState().selectDoor(null);
          }}
        >
          delete
        </button>
      </div>
      <div className="inspector-grid">
        <label>
          Type
          <select value={type} onChange={(e) => update({ type: e.target.value as DoorType })}>
            <option value="door">Door — blocks movement &amp; sight when closed</option>
            <option value="gate">Gate — blocks movement, always see-through</option>
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, gridColumn: '1 / -1' }}>
          <div className="toggle-row">
            <span>{door.open ? 'Open' : 'Closed'}</span>
            <label className="toggle-switch">
              <input type="checkbox" checked={door.open} onChange={(e) => update({ open: e.target.checked })} />
              <span className="slider" />
            </label>
          </div>
          <div className="toggle-row">
            <span>{door.locked ? 'Locked' : 'Unlocked'}</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={!!door.locked}
                onChange={(e) => update({ locked: e.target.checked, keyName: e.target.checked ? (door.keyName || 'Key') : null })}
              />
              <span className="slider" />
            </label>
          </div>
        </div>

        {door.locked && (
          <>
            <label>
              Key
              <select
                value={keyMode}
                onChange={(e) => {
                  const mode = e.target.value as 'generic' | 'specific';
                  setKeyMode(mode);
                  if (mode === 'generic') {
                    setCustomKey('');
                    update({ keyName: 'Key' });
                  }
                }}
              >
                <option value="generic">Generic Key</option>
                <option value="specific">Specific item…</option>
              </select>
            </label>
            {keyMode === 'specific' && (
              <label>
                Item name
                <input
                  type="text"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  onBlur={() => {
                    const name = customKey.trim() || 'Key';
                    update({ keyName: name });
                    if (name === 'Key') setKeyMode('generic');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  placeholder="e.g. Rusty Brass Key"
                />
              </label>
            )}
          </>
        )}
      </div>
      <p className="dim" style={{ fontSize: 12 }}>
        {door.locked
          ? `Players need "${door.keyName || 'Key'}" in an owned character's inventory to open this.`
          : 'Unlocked — anyone within reach can open it.'}
      </p>
    </div>
  );
}
