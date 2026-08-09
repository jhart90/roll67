import { useState } from 'react';
import { useAuthStore } from '../store/auth';

/** Set once a login/registration ever succeeds in this browser — returning
 *  members get the sign-in form first; a fresh visitor gets NEW MEMBERSHIP
 *  as the storefront's primary call to action. */
const MEMBER_FLAG = 'roll67.hasAccount';

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
    <div className="center-screen retro-lobby">
      <div className="store-sign">
        <span className="store-sign-name">ROLL67</span>
        <span className="store-sign-sub">GAMES &amp; TABLETOP · HEX-GRID VIRTUAL TABLETOP</span>
      </div>
      <div className="checker-strip" aria-hidden />

      <div className="member-card">
        <div className="member-card-head">
          <span className="member-card-title">
            {registering ? '★ NEW MEMBERSHIP ★' : 'MEMBER SIGN-IN'}
          </span>
          <span className="open-sign">OPEN</span>
        </div>
        {registering && (
          <p className="member-card-blurb">
            Free membership card. No late fees. Dice always in stock.
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            Member name
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="retro-cta" disabled={busy}>
            {registering ? '🎲 CREATE NEW ACCOUNT' : '▶ LOG IN'}
          </button>
        </form>
        <button
          className="taped-note"
          onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }}
        >
          {registering ? 'Already a member? Sign in here' : 'First visit? Create a new account →'}
        </button>
      </div>

      <p className="store-footer">BE KIND · ROLL TWENTIES · EST. 1967</p>
    </div>
  );
}
