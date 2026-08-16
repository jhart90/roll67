import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { ShelfStage } from './Bookshelf';

/** Set once a login/registration ever succeeds in this browser — returning
 *  members get the sign-in form first; a fresh visitor gets the new-account
 *  side as the door's first offer. */
const MEMBER_FLAG = 'roll67.hasAccount';

type Mode = 'login' | 'register' | 'forgot';

/**
 * The front door: the same bookshelf the members' shelf uses, with the
 * sign-in card floating over the summoning circle on the desk. The books are
 * furniture here — they belong to whoever signs in.
 */
export function Login() {
  const { login, register, forgotPassword } = useAuthStore();
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(MEMBER_FLAG) ? 'login' : 'register'),
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function go(next: Mode) {
    setMode(next);
    setError('');
    setSent('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        setSent(await forgotPassword(account));
      } else {
        if (mode === 'login') await login(username, password);
        else await register(username, password, email.trim() || undefined);
        localStorage.setItem(MEMBER_FLAG, '1');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === 'register';
  const title = mode === 'forgot' ? 'Lost password' : registering ? 'New account' : 'Sign in';

  return (
    <ShelfStage
      overlay={(
        <>
          <div className="shelf-topbar">
            <span className="shelf-brand">ROLL67</span>
          </div>
          <div className="portal-card portal-login">
            <h2 className="portal-title">{title}</h2>

            {mode === 'forgot' ? (
              <form onSubmit={submit} className="portal-form">
                <p className="portal-hint" style={{ margin: '0 0 4px' }}>
                  Your name or the email on your account. We'll send a link that lets you
                  choose a new password.
                </p>
                <input
                  placeholder="Name or email"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  autoFocus
                  autoComplete="username"
                />
                {error && <p className="error">{error}</p>}
                {/* Deliberately says nothing about whether the account was
                    found — see the server's forgot-password handler. */}
                {sent && <p className="portal-ok">{sent}</p>}
                <button type="submit" className="portal-cta" disabled={busy || !account.trim()}>
                  {busy ? 'Sending…' : '✉ Send reset link'}
                </button>
              </form>
            ) : (
              <form onSubmit={submit} className="portal-form">
                <input
                  placeholder="Name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                />
                {registering && (
                  <>
                    <input
                      type="email"
                      placeholder="Email (optional)"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                    {/* Said plainly at the one moment it can still be acted on.
                        There is no other way back into an account. */}
                    <p className="portal-hint" style={{ margin: 0 }}>
                      Only used to recover a lost password. Without one, a forgotten
                      password can't be reset.
                    </p>
                  </>
                )}
                {error && <p className="error">{error}</p>}
                <button type="submit" className="portal-cta" disabled={busy}>
                  {registering ? '🎲 Create account' : '▶ Enter'}
                </button>
              </form>
            )}

            <button
              className="link portal-switch"
              onClick={() => go(registering ? 'login' : 'register')}
            >
              {registering ? 'Already a member? Sign in' : 'First visit? Create an account →'}
            </button>
            {mode === 'login' && (
              <button className="link portal-switch" onClick={() => go('forgot')}>
                Forgotten your password?
              </button>
            )}
            {mode === 'forgot' && (
              <button className="link portal-switch" onClick={() => go('login')}>
                ← Back to sign in
              </button>
            )}
          </div>
        </>
      )}
    />
  );
}
