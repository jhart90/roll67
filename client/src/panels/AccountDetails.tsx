import { useEffect, useState } from 'react';
import { api } from '../api';
import { intents, useGameStore } from '../store/game';

interface AccountUser { id: string; username: string; email: string | null }

export function AccountDetails({ onClose }: { onClose: () => void }) {
  const you = useGameStore((s) => s.you);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // The address on file, and the field's working copy. Kept apart so an
  // untouched field submits nothing at all — sending back what we loaded would
  // make "I didn't touch it" indistinguishable from "set it to this".
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void api.get<{ user: AccountUser }>('/api/account')
      .then(({ user }) => {
        if (!live) return;
        setSavedEmail(user.email);
        setEmail(user.email ?? '');
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const emailChanged = email.trim().toLowerCase() !== (savedEmail ?? '');

  async function onSave() {
    if (!currentPassword) { setStatus({ ok: false, msg: 'Enter your current password.' }); return; }
    if (newPassword && newPassword !== confirmPassword) { setStatus({ ok: false, msg: 'New passwords do not match.' }); return; }
    if (!newUsername && !newPassword && !emailChanged) { setStatus({ ok: false, msg: 'Nothing to change.' }); return; }

    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, string> = { currentPassword };
      if (newUsername) body.newUsername = newUsername;
      if (newPassword) body.newPassword = newPassword;
      if (emailChanged) body.newEmail = email.trim();
      const { user } = await api.post<{ user: AccountUser }>('/api/account', body);
      if (newUsername && user.username !== you?.username) {
        intents.setUsername(user.username);
      }
      setSavedEmail(user.email);
      setEmail(user.email ?? '');
      setStatus({
        ok: true,
        msg: newPassword ? 'Account updated. Your other devices have been signed out.' : 'Account updated.',
      });
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

  void onClose; // the WindowFrame's own ✕ closes us — no second header needed
  return (
    <div className="account-details">
      <div className="account-form">
        <label>
          Current password <span className="dim">(required to change anything)</span>
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <hr />
        <label>
          Recovery email{' '}
          <span className="dim">
            {savedEmail
              ? '(where a lost-password link is sent; clear it to remove)'
              : '(none on file — without one, a forgotten password cannot be reset)'}
          </span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <hr />
        <label>
          New username <span className="dim">(leave blank to keep: {you?.username})</span>
          <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={you?.username} />
        </label>
        <label>
          New password <span className="dim">(leave blank to keep current)</span>
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <label>
          Confirm new password <span className="dim">(type it again to be certain)</span>
          <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <span className="account-error" style={{ fontSize: 12 }}>Passwords don't match yet.</span>
          )}
        </label>
        {status && (
          <div className={status.ok ? 'account-success' : 'account-error'}>{status.msg}</div>
        )}
        <button onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}
