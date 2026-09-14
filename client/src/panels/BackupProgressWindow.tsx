import { useGameStore } from '../store/game';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * The campaign backup, as it happens.
 *
 * A campaign's worth of map art can be hundreds of megabytes, and the old
 * button said "packing it up…" and nothing more until the browser's own
 * download appeared — long enough that people clicked it again. This shows
 * the two things that are actually going on: the server assembling the
 * file (no bytes yet), then the bytes coming down against the exact total
 * the server declared. It lives in a window so it can be dragged out of the
 * way, or minimized, while the table carries on.
 */
export function BackupProgressWindow() {
  const p = useGameStore((s) => s.backupProgress);
  if (!p) return <div className="dim" style={{ padding: 12 }}>No backup in progress.</div>;
  const pct = p.total > 0 ? Math.min(100, Math.floor((p.received / p.total) * 100)) : 0;
  const packing = p.phase === 'packing';
  const label = p.phase === 'failed' ? 'Backup failed'
    : p.phase === 'done' ? 'Backup saved'
      : packing ? 'Packing up the campaign…' : `Downloading… ${pct}%`;
  return (
    <div style={{ width: 'min(420px, 90vw)', padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong>{label}</strong>
      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={packing ? undefined : pct}
        style={{ height: 14, borderRadius: 999, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', overflow: 'hidden' }}
      >
        <div
          className={packing ? 'backup-bar-indeterminate' : undefined}
          style={{
            height: '100%', borderRadius: 999,
            width: packing ? '35%' : `${pct}%`,
            background: p.phase === 'failed' ? '#d26c6c' : p.phase === 'done' ? '#7ed28a' : 'var(--accent)',
            transition: packing ? undefined : 'width 0.2s ease-out',
          }}
        />
      </div>
      <span className="dim" style={{ fontSize: 12 }}>
        {p.phase === 'failed' ? (p.error ?? 'Something went wrong.')
          : packing ? 'Gathering every sheet, map, wall, chest and image on the server. Large campaigns take a moment here — the bar starts moving once the first bytes arrive.'
            : p.phase === 'done' ? `${fmtBytes(p.total)} in ${p.files} file${p.files === 1 ? '' : 's'}${p.name ? ` — ${p.name}` : ''}. Keep it somewhere that isn’t this server.`
              : `${fmtBytes(p.received)} of ${fmtBytes(p.total)} · ${p.files} file${p.files === 1 ? '' : 's'} inside`}
      </span>
    </div>
  );
}
