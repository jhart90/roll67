import { useState } from 'react';
import type { GameSystem } from 'shared';
import { useAuthStore } from '../store/auth';

const SYSTEM_LABELS: Record<GameSystem, string> = {
  dnd5e: 'D&D 5e',
  swn: 'Stars Without Number',
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
    <div className="center-screen">
      <div className="panel campaign-panel">
        <div className="panel-header">
          <h1 className="wordmark small">Roll67</h1>
          <div className="user-chip">
            {user?.username}
            <button className="link" onClick={logout}>log out</button>
          </div>
        </div>

        <h2>Your campaigns</h2>
        {campaignList.length === 0 && <p className="dim">No campaigns yet — create one or join with an invite code.</p>}
        <ul className="campaign-list">
          {campaignList.map((c) => (
            <li key={c.id}>
              <button className="campaign-row" onClick={() => onOpen(c.id)}>
                <span className="campaign-name">{c.name}</span>
                <span className="campaign-meta">
                  {SYSTEM_LABELS[c.system]} · {c.role === 'dm' ? 'DM' : 'Player'}
                </span>
              </button>
              {c.inviteCode && (
                <span className="invite-code" title="Share this code with your players">
                  invite: <code>{c.inviteCode}</code>
                </span>
              )}
            </li>
          ))}
        </ul>

        {showCreate ? (
          <form onSubmit={handleCreate} className="stack">
            <label>
              Campaign name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label>
              System
              <select value={system} onChange={(e) => setSystem(e.target.value as GameSystem)}>
                <option value="dnd5e">D&amp;D 5e</option>
                <option value="swn">Stars Without Number</option>
              </select>
            </label>
            <div className="row">
              <button type="submit" className="primary">Create</button>
              <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="primary" onClick={() => setShowCreate(true)}>New campaign (you DM)</button>
        )}

        <form onSubmit={handleJoin} className="row join-row">
          <input
            placeholder="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button type="submit" disabled={inviteCode.length < 6}>Join</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
