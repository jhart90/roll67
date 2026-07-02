import { useState } from 'react';
import { useAuthStore } from '../store/auth';

export function Login() {
  const { login, register } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="panel login-panel">
        <h1 className="wordmark">Roll67</h1>
        <p className="tagline">hex-grid virtual tabletop</p>
        <form onSubmit={submit}>
          <label>
            Username
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
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={busy}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
