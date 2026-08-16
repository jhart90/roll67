import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { ShelfStage } from './Bookshelf';

/** Set once a login/registration ever succeeds in this browser — returning
 *  members get the sign-in form first; a fresh visitor gets the new-account
 *  side as the door's first offer. */
const MEMBER_FLAG = 'roll67.hasAccount';

/**
 * The front door: the same bookshelf the members' shelf uses, with the
 * sign-in card floating over the summoning circle on the desk. The books are
 * furniture here — they belong to whoever signs in.
 */
export function Login() {
  const { login, register } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>(
    () => (localStorage.getItem(MEMBER_FLAG) ? 'login' : 'register'),
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      localStorage.setItem(MEMBER_FLAG, '1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === 'register';

  return (
    <ShelfStage
      overlay={(
        <>
          <div className="shelf-topbar">
            <span className="shelf-brand">ROLL67</span>
          </div>
          <div className="portal-card portal-login">
            <h2 className="portal-title">{registering ? 'New account' : 'Sign in'}</h2>
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
              {error && <p className="error">{error}</p>}
              <button type="submit" className="portal-cta" disabled={busy}>
                {registering ? '🎲 Create account' : '▶ Enter'}
              </button>
            </form>
            <button
              className="link portal-switch"
              onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }}
            >
              {registering ? 'Already a member? Sign in' : 'First visit? Create an account →'}
            </button>
          </div>
        </>
      )}
    />
  );
}
