import { useMemo, useState } from 'react';
import type { KeyItem, SheetData } from 'shared';
import { keyCount, keyScopeLabel, keysOnSheet } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * The Keyring (players) and the Key Manager (DM) — a 🔑 chip sitting beside
 * the Benny chip and wearing the same clothes.
 *
 * A player's ring counts the keys they carry and lists what each one opens.
 * The DM's manager cuts new keys — generic, for one door or chest, for every
 * door or chest on a map, or a master — hands them to a character, and shows
 * at a glance who is carrying what.
 */
export function KeyringMenu() {
  const you = useGameStore((s) => s.you);
  const characters = useGameStore((s) => s.characters);
  const maps = useGameStore((s) => s.mapsMeta);
  const mapObjects = useGameStore((s) => s.mapObjects);
  const doors = useGameStore((s) => s.dmGeometry?.doors);
  const currentMapId = useGameStore((s) => s.map?.id ?? null);
  const [open, setOpen] = useState(false);
  const plateOpen = useGameStore((s) => {
    const t = s.selectedTokenId ? s.tokens[s.selectedTokenId] : undefined;
    if (!t?.nameplate || !s.you) return false;
    return !(t.characterId && s.characters.some((c) => c.id === t.characterId && c.ownerUserId === s.you!.userId));
  });

  const isDm = you?.role === 'dm';
  const mine = useMemo(
    () => characters.filter((c) => c.ownerUserId === you?.userId),
    [characters, you?.userId],
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
    <div className={`keyring-menu${plateOpen ? ' raised' : ''}`}>
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
    const [holder, setHolder] = useState('');
    const chests = Object.values(mapObjects).filter((o) => o.kind === 'chest');
    const doorList = doors ?? [];

    const cut = () => {
      const to = characters.find((c) => c.id === holder);
      if (!to) return;
      const row: SheetData = {
        name: name.trim() || 'Key', qty: 1, weight: 0, isKey: true, keyScope: scope,
        ...(scope === 'door' || scope === 'chest' ? { keyTargetId: target } : {}),
        ...(scope === 'allDoors' || scope === 'allChests' ? { keyMapId: mapId ?? '' } : {}),
        notes: keyScopeLabel({ name, scope, qty: 1, targetId: target, mapId: mapId ?? undefined }, mapName(mapId ?? undefined)),
      };
      const inv = Array.isArray(to.sheet.inventory) ? [...(to.sheet.inventory as SheetData[])] : [];
      // A second copy of an identical key stacks rather than cluttering.
      const same = inv.findIndex((r) => r.isKey === true && r.name === row.name
        && r.keyScope === row.keyScope && (r.keyTargetId ?? '') === (row.keyTargetId ?? '')
        && (r.keyMapId ?? '') === (row.keyMapId ?? ''));
      if (same >= 0) inv[same] = { ...inv[same], qty: Number(inv[same].qty ?? 1) + 1 };
      else inv.push(row);
      intents.updateCharacter(to.id, { inventory: inv });
    };

    const needsTarget = scope === 'door' || scope === 'chest';
    const ready = !!holder && (!needsTarget || !!target);

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
        <label className="key-field">Give to
          <select value={holder} onChange={(e) => setHolder(e.target.value)}>
            <option value="">— pick a character —</option>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.ownerUserId ? '' : ' (NPC)'}</option>)}
          </select>
        </label>
        <button className="primary" disabled={!ready} onClick={cut}>Cut key</button>

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
