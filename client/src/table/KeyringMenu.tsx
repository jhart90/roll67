import { useEffect, useMemo, useState } from 'react';
import type { ContentEntry, KeyItem } from 'shared';
import { contentSlug, keyCount, keyScopeLabel, keysOnSheet } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * The Keyring (players) and the Key Manager (DM) — a 🔑 chip sitting beside
 * the Benny chip and wearing the same clothes.
 *
 * A player's ring counts the keys they carry and lists what each one opens.
 * The DM's manager cuts new keys — generic, for one door or chest, for every
 * door or chest on a map, or a master — into the campaign's compendium, and
 * shows at a glance who is carrying what.
 */
export function KeyringMenu() {
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((s) => s.characters);
  const maps = useGameStore((s) => s.mapsMeta);
  const mapObjects = useGameStore((s) => s.mapObjects);
  const doors = useGameStore((s) => s.dmGeometry?.doors);
  const currentMapId = useGameStore((s) => s.map?.id ?? null);
  const system = useGameStore((s) => s.campaign?.system ?? 'dnd5e');
  const asUser = useGameStore((s) => s.asUserId());
  const [open, setOpen] = useState(false);
  // The door editor can send the DM straight here to cut the key it needs.
  const summoned = useGameStore((s) => s.keyManagerOpen);
  useEffect(() => {
    if (summoned) { setOpen(true); useGameStore.setState({ keyManagerOpen: false }); }
  }, [summoned]);
  const isDm = useGameStore((s) => s.isDm());
  const mine = useMemo(
    () => characters.filter((c) => c.ownerUserId === asUser),
    [characters, asUser],
  );
  const myKeys = useMemo(
    () => mine.flatMap((c) => keysOnSheet(c.sheet).map((k) => ({ k, owner: c.name }))),
    [mine],
  );
  const total = useMemo(() => mine.reduce((n, c) => n + keyCount(c.sheet), 0), [mine]);

  const mapName = (id?: string) => maps.find((m) => m.id === id)?.name ?? 'that map';
  const targetName = (k: KeyItem) => {
    if (k.scope === 'chest') return Object.values(mapObjects).find((o) => o.id === k.targetId)?.name;
    if (k.scope === 'door') return 'door';
    return undefined;
  };
  const describe = (k: KeyItem) => keyScopeLabel(k, mapName(k.mapId), targetName(k));

  if (!you) return null;

  return (
    <div className="keyring-menu">
      <button className="keyring-chip" onClick={() => setOpen((o) => !o)} title={isDm ? 'Key Manager' : 'Your keyring'}>
        🔑{isDm ? ' DM' : ` ${total}`}
      </button>
      {open && (isDm
        ? <KeyManager onClose={() => setOpen(false)} currentMapId={currentMapId} />
        : (
          <div className="keyring-panel">
            <div className="benny-head">
              <strong>Keyring</strong>
              <span className="dim">{total} key{total === 1 ? '' : 's'}</span>
            </div>
            {myKeys.length === 0 && <p className="dim" style={{ fontSize: 12, margin: 0 }}>You aren’t carrying any keys.</p>}
            {myKeys.map(({ k, owner }, i) => (
              <div key={i} className="key-row">
                <span className="key-name">🔑 {k.name}{k.qty > 1 ? ` ×${k.qty}` : ''}</span>
                <span className="dim key-what">{describe(k)}</span>
                {mine.length > 1 && <span className="dim key-who">{owner}</span>}
              </div>
            ))}
          </div>
        ))}
    </div>
  );

  /** The DM's side: cut keys, see who holds them, hand them out. */
  function KeyManager({ onClose, currentMapId: mapId }: { onClose: () => void; currentMapId: string | null }) {
    const [name, setName] = useState('Brass Key');
    const [scope, setScope] = useState<KeyItem['scope']>('generic');
    const [target, setTarget] = useState('');
    const chests = Object.values(mapObjects).filter((o) => o.kind === 'chest');
    const doorList = doors ?? [];

    /**
     * Cutting a key files it in the campaign's compendium rather than pushing
     * it onto one character. From there it can be stocked into a chest, put on
     * a shop's shelf, or added to any sheet — all the things a key is actually
     * for, none of which "give it to Kira right now" could do.
     */
    const cut = () => {
      const keyName = name.trim() || 'Key';
      const subtitle = keyScopeLabel(
        { name: keyName, scope, qty: 1, targetId: target, mapId: mapId ?? undefined },
        mapName(mapId ?? undefined),
      );
      const entry: ContentEntry = {
        // Scope and target are in the id, so two keys that open different
        // things never collide — and re-cutting the same key is idempotent.
        id: contentSlug(system, 'key', `${keyName} ${scope} ${target || mapId || ''}`),
        system, kind: 'key', name: keyName, category: 'Keys', order: 1,
        subtitle,
        key: {
          scope,
          ...(scope === 'door' || scope === 'chest' ? { targetId: target } : {}),
          ...(scope === 'allDoors' || scope === 'allChests' ? { mapId: mapId ?? '' } : {}),
        },
      };
      intents.createCustomItem(JSON.stringify(entry));
      useGameStore.getState().toast(`🔑 ${keyName} is in the Compendium under Keys.`, 'info');
    };

    const needsTarget = scope === 'door' || scope === 'chest';
    const ready = !needsTarget || !!target;

    return (
      <div className="keyring-panel wide">
        <div className="benny-head">
          <strong>Key Manager</strong>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <label className="key-field">Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brass Key" />
        </label>
        <label className="key-field">Opens
          <select value={scope} onChange={(e) => { setScope(e.target.value as KeyItem['scope']); setTarget(''); }}>
            <option value="generic">Locks that name it</option>
            <option value="door">One specific door</option>
            <option value="chest">One specific chest</option>
            <option value="allDoors">Every door in {mapName(mapId ?? undefined)}</option>
            <option value="allChests">Every chest in {mapName(mapId ?? undefined)}</option>
            <option value="master">Everything (master key)</option>
          </select>
        </label>
        {scope === 'door' && (
          <label className="key-field">Door
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— pick a door —</option>
              {doorList.map((dr, i) => <option key={dr.id} value={dr.id}>Door {i + 1}{dr.locked ? ' (locked)' : ''}</option>)}
            </select>
          </label>
        )}
        {scope === 'chest' && (
          <label className="key-field">Chest
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— pick a chest —</option>
              {chests.map((c) => <option key={c.id} value={c.id}>{c.name}{c.locked ? ' (locked)' : ''}</option>)}
            </select>
          </label>
        )}
        <button className="primary" disabled={!ready} onClick={cut}>Cut key</button>
        <p className="dim" style={{ fontSize: 11, margin: '4px 0 0' }}>
          Cut keys go to the Compendium under <strong>Keys</strong> — stock one into a
          chest, put it on a shop's shelf, or add it to a sheet from there.
        </p>

        <div className="key-roster">
          <h5>Who holds what</h5>
          {characters.every((c) => keyCount(c.sheet) === 0) && (
            <p className="dim" style={{ fontSize: 12, margin: 0 }}>Nobody is carrying a key yet.</p>
          )}
          {characters.filter((c) => keyCount(c.sheet) > 0).map((c) => (
            <div key={c.id} className="key-holder">
              <strong>{c.name}</strong>
              {keysOnSheet(c.sheet).map((k, i) => (
                <span key={i} className="key-pill" title={describe(k)}>
                  🔑 {k.name}{k.qty > 1 ? ` ×${k.qty}` : ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
}
