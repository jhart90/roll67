import { useState } from 'react';
import type { GameSystem } from 'shared';
import { useAuthStore } from '../store/auth';

const SYSTEM_LABELS: Record<GameSystem, string> = {
  dnd5e: 'D&D 5e',
  swn: 'Stars Without Number',
  swade: 'Savage Worlds (SWADE)',
};

/** Spine color per system, like game boxes shelved by publisher. */
const SYSTEM_SPINE: Record<GameSystem, string> = {
  dnd5e: '#b03030',
  swn: '#2456c9',
  swade: '#2a8a4a',
};

export function CampaignList({ onOpen }: { onOpen: (campaignId: string) => void }) {
  const { user, campaignList, createCampaign, joinCampaign, logout } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [system, setSystem] = useState<GameSystem>('dnd5e');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createCampaign(name, system);
      setName('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign.');
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await joinCampaign(inviteCode);
      setInviteCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join campaign.');
    }
  }

  return (
    <div className="center-screen retro-lobby">
      <div className="store-sign">
        <span className="store-sign-name">ROLL67</span>
        <span className="store-sign-sub">GAMES &amp; TABLETOP · HEX-GRID VIRTUAL TABLETOP</span>
      </div>
      <div className="checker-strip" aria-hidden />

      <div className="member-card shelf-card">
        <div className="member-card-head">
          <span className="member-card-title">YOUR SHELF</span>
          <span className="name-tag" title="Your membership">
            <span className="name-tag-hello">MEMBER</span>
            {user?.username}
            <button className="link" onClick={logout}>log out</button>
          </span>
        </div>

        {campaignList.length === 0 && (
          <p className="member-card-blurb">
            Empty shelf! Start a campaign below, or punch in a friend&rsquo;s invite code.
          </p>
        )}
        <ul className="shelf-list">
          {campaignList.map((c) => (
            <li key={c.id}>
              <button
                className="shelf-box"
                style={{ borderLeftColor: SYSTEM_SPINE[c.system] }}
                onClick={() => onOpen(c.id)}
                title="Open this campaign"
              >
                <span className="shelf-box-name">{c.name}</span>
                <span className="shelf-box-meta">
                  {SYSTEM_LABELS[c.system]} · {c.role === 'dm' ? "you're the DM" : 'Player'}
                </span>
              </button>
              {c.inviteCode && (
                <span className="price-sticker" title="Share this code with your players">
                  invite <code>{c.inviteCode}</code>
                </span>
              )}
            </li>
          ))}
        </ul>

        {showCreate ? (
          <form onSubmit={handleCreate} className="stack new-campaign-form">
            <label>
              Campaign name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label>
              System
              <select value={system} onChange={(e) => setSystem(e.target.value as GameSystem)}>
                <option value="dnd5e">D&amp;D 5e</option>
                <option value="swn">Stars Without Number</option>
                <option value="swade">Savage Worlds (SWADE)</option>
              </select>
            </label>
            <div className="row">
              <button type="submit" className="retro-cta" style={{ width: 'auto' }}>OPEN FOR BUSINESS</button>
              <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="retro-cta" onClick={() => setShowCreate(true)}>
            🎲 START A NEW CAMPAIGN <span className="retro-cta-sub">(you&rsquo;re the DM)</span>
          </button>
        )}

        <form onSubmit={handleJoin} className="rental-slot">
          <span className="rental-slot-label">GOT AN INVITE CODE?</span>
          <input
            placeholder="XXXXXX"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button type="submit" disabled={inviteCode.length < 6}>JOIN</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <p className="store-footer">BE KIND · ROLL TWENTIES · EST. 1967</p>
    </div>
  );
}
