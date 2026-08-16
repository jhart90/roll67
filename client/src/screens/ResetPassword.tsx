import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store/auth';
import { ShelfStage } from './Bookshelf';

/**
 * The token arrives in the URL fragment (`#reset=…`), not the query string.
 *
 * A fragment is never sent to the server, so the link cannot end up in an
 * access log or a Referer header on the way to whatever the page loads next —
 * which matters, because for the hour it lives this string IS the account.
 */
export function resetTokenFromUrl(): string | null {
  const m = /(?:^|&)reset=([^&]+)/.exec(window.location.hash.replace(/^#/, ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Take the token back out of the address bar once it has been spent or found
 *  wanting, so a reload does not re-run a dead link. */
function clearTokenFromUrl(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

/**
 * The other end of the reset mail: prove the link is good, then choose a new
 * password. Succeeding signs you straight in — holding the link was the proof,
 * and the password you just typed is the one you would type again.
 */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Ask before showing a form: an expired link should say so now, not after
  // someone has picked a password and typed it twice.
  useEffect(() => {
    let live = true;
    void api.post<{ valid: boolean; username?: string }>('/api/reset-password/check', { token })
      .then((r) => {
        if (!live) return;
        if (r.valid) setUsername(r.username ?? '');
        else setError('That reset link has expired or has already been used.');
      })
      .catch(() => { if (live) setError('Could not check that link. Try again in a moment.'); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Those two passwords do not match.'); return; }
    setError('');
    setBusy(true);
    try {
      await resetPassword(token, password);
      // Signed in; the App will render the shelf once the token is gone from
      // the address bar.
      clearTokenFromUrl();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset that password.');
      setBusy(false);
    }
  }

  const dead = !checking && username === null;

  return (
    <ShelfStage
      overlay={(
        <>
          <div className="shelf-topbar">
            <span className="shelf-brand">ROLL67</span>
          </div>
          <div className="portal-card portal-login">
            <h2 className="portal-title">{dead ? 'Link expired' : 'Choose a new password'}</h2>

            {checking && <p className="portal-hint">Checking that link…</p>}

            {dead && (
              <>
                <p className="portal-hint">{error}</p>
                <button
                  className="portal-cta"
                  onClick={() => { clearTokenFromUrl(); onDone(); }}
                >
                  ▶ Back to sign in
                </button>
              </>
            )}

            {!checking && username !== null && (
              <form onSubmit={submit} className="portal-form">
                <p className="portal-hint" style={{ margin: '0 0 4px' }}>
                  Setting a new password for <strong>{username}</strong>. Every other
                  device signed in as this account will be signed out.
                </p>
                <input
                  type="password"
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  placeholder="New password again"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
                {password && confirm && password !== confirm && (
                  <p className="portal-hint">Those two don't match yet.</p>
                )}
                {error && <p className="error">{error}</p>}
                <button
                  type="submit"
                  className="portal-cta"
                  disabled={busy || password.length < 4 || password !== confirm}
                >
                  {busy ? 'Saving…' : '🔑 Set password and sign in'}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    />
  );
}
