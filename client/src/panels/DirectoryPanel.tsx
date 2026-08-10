import { useEffect, useState } from 'react';
import { useGameStore, intents } from '../store/game';
import type { WorldVisState } from 'shared';
import { HandoutsSection } from './HandoutsPanel';
import { RollableTables } from './RollableTables';
import { AnchoredMenu } from '../util/AnchoredMenu';

const SYSTEM_LABEL: Record<string, string> = { dnd5e: 'D&D 5e', swn: 'SWN' };

function Branch({ title, count, children, defaultOpen = false }: {
  title: string; count: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="dir-branch">
      <button className="dir-branch-head" onClick={() => setOpen((v) => !v)}>
        <span className={`dir-caret ${open ? 'open' : ''}`}>▸</span>
        {title}
        <span className="dir-count">{count}</span>
      </button>
      {open && <div className="dir-branch-body">{children}</div>}
    </div>
  );
}

/** DM-only glyph for an entry's player-visibility state. */
function VisBadge({ vis }: { vis?: WorldVisState }) {
  if (!vis) return null;
  const glyph = vis === 'reveal' ? '👁' : vis === 'hide' ? '🚫' : vis === 'seen' ? '·' : '?';
  const tip = vis === 'reveal' ? 'Force-revealed to all players'
    : vis === 'hide' ? 'Hidden from all players'
      : vis === 'seen' ? 'Discovered by the party' : 'Not yet seen by any player';
  return <span className="dir-vis" title={tip}>{glyph}</span>;
}

interface VisMenu { kind: 'map' | 'token' | 'character'; key: string; name: string; x: number; y: number }

/** Campaign directory: shared reference of everything introduced so far. */
export function DirectoryPanel() {
  const you = useGameStore((s) => s.you);
  const dir = useGameStore((s) => s.directory);
  const isDm = you?.role === 'dm';

  // Refresh when the tab opens so the tree is current.
  useEffect(() => { intents.requestDirectory(); }, []);

  const [visMenu, setVisMenu] = useState<VisMenu | null>(null);
  const onVisMenu = (kind: VisMenu['kind'], key: string, name: string) => (e: React.MouseEvent) => {
    if (!isDm) return;
    e.preventDefault();
    setVisMenu({ kind, key, name, x: e.clientX, y: e.clientY });
  };
  const canOpen = (id: string) => useGameStore.getState().characters.some((c) => c.id === id);

  return (
    <div className="dock-panel">
      <RollableTables />
      <HandoutsSection />

      <div className="dir-tree">
        <div className="dock-header">
          <h3>Campaign Directory</h3>
          <button className="link" onClick={() => intents.requestDirectory()}>refresh</button>
        </div>
        {!dir && <p className="dim">Loading…</p>}
        {dir && (
          <>
            <Branch title="Maps" count={dir.maps.length} defaultOpen>
              {dir.maps.map((m) => <div key={m.id} className="dir-item" onContextMenu={onVisMenu('map', m.id, m.name)}><VisBadge vis={m.vis} />{m.name}</div>)}
              {dir.maps.length === 0 && <div className="dir-empty">No maps yet.</div>}
            </Branch>

            <Branch title="Characters" count={dir.characters.length}>
              {dir.characters.map((c) => (
                <div key={c.id} className="dir-item" onContextMenu={onVisMenu('character', c.id, c.name)}>
                  <VisBadge vis={c.vis} />
                  {canOpen(c.id)
                    ? <button className="dir-link" onClick={() => useGameStore.getState().openSheet(c.id)}>{c.name}</button>
                    : <span>{c.name}</span>}
                  <span className="dir-tag">
                    {c.owner ? c.owner : 'NPC'} · {SYSTEM_LABEL[c.system] ?? c.system}
                  </span>
                  {isDm && (
                    <button className="link" style={{ marginLeft: 4, fontSize: 11 }} onClick={() => intents.saveToCompendium(c.id)}>
                      save to compendium
                    </button>
                  )}
                </div>
              ))}
              {dir.characters.length === 0 && <div className="dir-empty">None yet.</div>}
            </Branch>

            <Branch title="Tokens on maps" count={dir.tokens.length}>
              {dir.tokens.map((t, i) => (
                <div key={t.id ?? i} className="dir-item" onContextMenu={onVisMenu('token', t.id, t.name)}>
                  <VisBadge vis={t.vis} />{t.name}
                  <span className="dir-tag">{t.mapName}{t.gm ? ' · GM' : ''}</span>
                </div>
              ))}
              {dir.tokens.length === 0 && <div className="dir-empty">None placed yet.</div>}
            </Branch>

            <Branch title="Weapons & attacks" count={dir.weapons.length}>
              {dir.weapons.map((w) => <div key={w} className="dir-item">{w}</div>)}
              {dir.weapons.length === 0 && <div className="dir-empty">None yet.</div>}
            </Branch>

            <Branch title="Spells & powers" count={dir.spells.length}>
              {dir.spells.map((s) => <div key={s} className="dir-item">{s}</div>)}
              {dir.spells.length === 0 && <div className="dir-empty">None yet.</div>}
            </Branch>

            <Branch title="Items & gear" count={dir.items.length}>
              {dir.items.map((it) => <div key={it} className="dir-item">{it}</div>)}
              {dir.items.length === 0 && <div className="dir-empty">None yet.</div>}
            </Branch>

            <p className="dim dir-note">
              {isDm
                ? 'You see everything. Players see maps, visible tokens, party characters, and the party’s shared gear/spells.'
                : 'Shared party reference — everyone in the campaign sees this.'}
            </p>
          </>
        )}
      </div>
      {visMenu && (
        <AnchoredMenu x={visMenu.x} y={visMenu.y} className="dir-vis-menu" onMouseLeave={() => setVisMenu(null)}>
          <div className="dim" style={{ padding: '2px 8px', fontSize: 11 }}>{visMenu.name}</div>
          <button onClick={() => { intents.worldOverride(visMenu.kind, visMenu.key, 'reveal'); setVisMenu(null); }}>👁 Reveal to all players</button>
          <button onClick={() => { intents.worldOverride(visMenu.kind, visMenu.key, 'hide'); setVisMenu(null); }}>🚫 Hide from all players</button>
          <button onClick={() => { intents.worldOverride(visMenu.kind, visMenu.key, 'clear'); setVisMenu(null); }}>↺ Follow what they've seen</button>
        </AnchoredMenu>
      )}
    </div>
  );
}
