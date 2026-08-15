import { Component, type ReactNode } from 'react';

/**
 * The floor under the whole app.
 *
 * A render error anywhere in the tree used to unmount the root and leave a
 * black screen mid-session — which at a live table reads as "the game ate
 * itself", when the truth is one component threw once. React offers no
 * recovery without a boundary, so this is the boundary: it names the error,
 * offers a reload, and the session state (which lives on the server) comes
 * back exactly as it was.
 *
 * A class component because that is still the only way to catch render
 * errors; nothing else in the codebase needs one.
 */
export class ErrorScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="panel" style={{ maxWidth: 440, padding: '18px 22px' }}>
          <h3 style={{ marginTop: 0 }}>💥 Something broke on this screen</h3>
          <p className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>
            The table itself is fine — everything lives on the server. Reload and
            you will land back exactly where you were.
          </p>
          <p className="dim" style={{ fontSize: 11, fontFamily: 'monospace', overflowWrap: 'break-word' }}>
            {String(this.state.error)}
          </p>
          <button className="btn btn-accent" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
