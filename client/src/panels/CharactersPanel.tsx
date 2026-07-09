import { useState } from 'react';
import type { Character } from 'shared';
import { intents, useGameStore } from '../store/game';
import { NpcLibrary } from './NpcLibrary';

const TOKEN_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#d2d26c', '#d26cb0'];
let colorIdx = 0;

export function CharactersPanel() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const characters = useGameStore((s) => s.characters);
  const members = useGameStore((s) => s.members);
  const map = useGameStore((s) => s.map);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState<string>('npc');
  const [showLibrary, setShowLibrary] = useState(false);

  if (!you || !campaign) return null;
  const isDm = you.role === 'dm';

  const mine = characters.filter((c) => c.ownerUserId === you.userId);
  const others = characters.filter((c) => c.ownerUserId !== you.userId);
  const visible = isDm ? characters : [...mine, ...others.filter((c) => c.ownerUserId !== null)];

  function ownerName(c: Character): string {
    if (!c.ownerUserId) return 'NPC';
    return members.find((m) => m.userId === c.ownerUserId)?.username ?? '?';
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !campaign) return;
    const ownerUserId = !isDm ? undefined : owner === 'npc' ? null : owner;
    intents.createCharacter(name.trim(), campaign.system, ownerUserId);
    setName('');
  }

  function placeToken(c: Character) {
    if (!map) return;
    const q = Math.floor(map.grid.cols / 2);
    const r = Math.floor(map.grid.rows / 2);
    const axialQ = q - (r - (r & 1)) / 2;
    const artAssetId = typeof c.sheet.tokenImageAssetId === 'string' ? c.sheet.tokenImageAssetId : undefined;
    const savedColor = typeof c.sheet.tokenColor === 'string' ? c.sheet.tokenColor : undefined;
    intents.createToken({
      mapId: map.id,
      name: c.name,
      q: axialQ,
      r,
      characterId: c.id,
      layer: c.ownerUserId ? 'token' : 'gm',
      color: savedColor || TOKEN_COLORS[colorIdx++ % TOKEN_COLORS.length],
      artAssetId,
    });
  }

  return (
    <div className="dock-panel">
      <div className="dock-header">
        <h3>Characters</h3>
        {isDm && <button className="link" onClick={() => setShowLibrary(true)}>+ NPC library</button>}
      </div>
      {showLibrary && <NpcLibrary onClose={() => setShowLibrary(false)} />}
      <ul className="char-list">
        {visible.map((c) => (
          <li key={c.id}>
            <div className="char-row">
              <button className="char-name" onClick={() => useGameStore.getState().openSheet(c.id)}>
                {c.name}
              </button>
              <span className={`char-owner ${c.ownerUserId ? '' : 'npc'}`}>{ownerName(c)}</span>
            </div>
            <div className="char-actions">
              {isDm && map && (
                <button className="link" onClick={() => placeToken(c)}>place token</button>
              )}
              {isDm && (
                <button className="link" onClick={() => { intents.saveToCompendium(c.id); }}>
                  save to compendium
                </button>
              )}
              {isDm && (
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Delete character "${c.name}"?`)) intents.deleteCharacter(c.id);
                  }}
                >
                  delete
                </button>
              )}
            </div>
          </li>
        ))}
        {visible.length === 0 && <p className="dim">No characters yet.</p>}
      </ul>

      <form onSubmit={create} className="stack">
        <label>
          New character
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>
        {isDm && (
          <label>
            Owner
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="npc">NPC (DM only)</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.username}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" disabled={!name.trim()}>Create</button>
      </form>
    </div>
  );
}
