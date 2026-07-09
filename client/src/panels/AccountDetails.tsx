import { useState } from 'react';
import { api } from '../api';
import { intents, useGameStore } from '../store/game';

export function AccountDetails({ onClose }: { onClose: () => void }) {
  const you = useGameStore((s) => s.you);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!currentPassword) { setStatus({ ok: false, msg: 'Enter your current password.' }); return; }
    if (newPassword && newPassword !== confirmPassword) { setStatus({ ok: false, msg: 'New passwords do not match.' }); return; }
    if (!newUsername && !newPassword) { setStatus({ ok: false, msg: 'Nothing to change.' }); return; }

    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, string> = { currentPassword };
      if (newUsername) body.newUsername = newUsername;
      if (newPassword) body.newPassword = newPassword;
      const { user } = await api.post<{ user: { id: string; username: string } }>('/api/account', body);
      if (newUsername && user.username !== you?.username) {
        intents.setUsername(user.username);
      }
      setStatus({ ok: true, msg: 'Account updated.' });
      setCurrentPassword('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="account-details">
      <div className="dock-header">
        <h3>Account Details</h3>
        <span className="spacer" />
        <button className="link" onClick={onClose}>close</button>
      </div>
      <div className="account-form">
        <label>
          Current password <span className="dim">(required)</span>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <hr />
        <label>
          New username <span className="dim">(leave blank to keep: {you?.username})</span>
          <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={you?.username} />
        </label>
        <label>
          New password <span className="dim">(leave blank to keep current)</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        {newPassword && (
          <label>
            Confirm new password
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
        )}
        {status && (
          <div className={status.ok ? 'account-success' : 'account-error'}>{status.msg}</div>
        )}
        <button onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}
