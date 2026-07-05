import { useState } from 'react';
import type { Handout } from 'shared';
import { intents, useGameStore } from '../store/game';
import { UploadProgressBar } from '../util/UploadProgressBar';
import { useUploadProgress } from '../util/useUploadProgress';

export function HandoutEditor({ handout, onDone }: { handout: Handout | null; onDone: () => void }) {
  const campaign = useGameStore((s) => s.campaign)!;
  const [title, setTitle] = useState(handout?.title ?? '');
  const [body, setBody] = useState(handout?.bodyMd ?? '');
  const [uploading, setUploading] = useState(false);
  const { progress, upload } = useUploadProgress();
  const [assetId, setAssetId] = useState<string | null>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await upload(file, campaign.id, 'handout');
      setAssetId(res.assetId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (handout) {
      intents.updateHandout(handout.id, { title: title.trim(), bodyMd: body, ...(assetId ? { assetId } : {}) });
    } else {
      intents.createHandout(title.trim(), body, assetId);
    }
    onDone();
  }

  return (
    <form onSubmit={save} className="stack">
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label>
        Text
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="upload-label">
        Image
        <input type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
        <UploadProgressBar progress={progress} />
      </label>
      <div className="row">
        <button type="submit" className="primary" style={{ width: 'auto' }}>Save</button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** A pop-up window to edit a handout, with share-to-all / share-to-specific
 *  controls. Opened from the World tree. */
export function HandoutWindow({ handout, onClose }: { handout: Handout | null; onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign)!;
  const isDm = useGameStore((s) => s.you?.role === 'dm');
  const players = useGameStore((s) => s.members).filter((m) => m.role === 'player');
  const [title, setTitle] = useState(handout?.title ?? '');
  const [body, setBody] = useState(handout?.bodyMd ?? '');
  const [uploading, setUploading] = useState(false);
  const { progress, upload } = useUploadProgress();
  const [assetId, setAssetId] = useState<string | null>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await upload(file, campaign.id, 'handout');
      setAssetId(res.assetId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function save() {
    if (!title.trim()) return;
    if (handout) intents.updateHandout(handout.id, { title: title.trim(), bodyMd: body, ...(assetId ? { assetId } : {}) });
    else intents.createHandout(title.trim(), body, assetId);
    onClose();
  }

  return (
      <div className="panel levelup handout-window">
        <div className="dock-header">
          <h3>{handout ? 'Edit handout' : 'New handout'}</h3>
        </div>

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label>
          Text
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="upload-label">
          Image
          <input type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
          <UploadProgressBar progress={progress} />
        </label>
        {handout?.imageUrl && !assetId && <img className="handout-img" src={handout.imageUrl} alt={handout.title} />}

        <div className="row" style={{ marginTop: 4 }}>
          <button className="primary" style={{ width: 'auto' }} onClick={save}>Save</button>
          {handout && (
            <button className="link danger" onClick={() => { if (confirm(`Delete handout "${handout.title}"?`)) { intents.deleteHandout(handout.id); onClose(); } }}>delete</button>
          )}
        </div>

        {handout && isDm && (
          <div className="handout-share">
            <h4>Share with players</h4>
            <div className="share-controls">
              <button
                className={`btn btn-sm ${handout.sharedAll ? 'btn-accent' : ''}`}
                onClick={() => intents.shareHandout(handout.id, handout.sharedAll ? 'none' : 'all')}
              >
                {handout.sharedAll ? '✓ All players' : 'Share to all players'}
              </button>
              {!handout.sharedAll && (
                <>
                  <span className="dim" style={{ alignSelf: 'center' }}>Share to…</span>
                  {players.map((m) => {
                    const has = handout.sharedWith.includes(m.userId);
                    return (
                      <button
                        key={m.userId}
                        className={`btn btn-sm ${has ? 'btn-accent' : ''}`}
                        onClick={() => {
                          const next = has ? handout.sharedWith.filter((id) => id !== m.userId) : [...handout.sharedWith, m.userId];
                          intents.shareHandout(handout.id, next.length ? next : 'none');
                        }}
                      >
                        {m.username}{has ? ' ✓' : ''}
                      </button>
                    );
                  })}
                  {players.length === 0 && <span className="dim">No players have joined yet.</span>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
  );
}

function ShareControls({ handout }: { handout: Handout }) {
  // Select the stable array and filter in render — a filtering selector
  // returns a fresh array every read and loops React into a crash.
  const allMembers = useGameStore((s) => s.members);
  const members = allMembers.filter((m) => m.role === 'player');
  return (
    <div className="share-controls">
      <span className="dim">share:</span>
      <button
        className={`link ${handout.sharedAll ? 'active-share' : ''}`}
        onClick={() => intents.shareHandout(handout.id, handout.sharedAll ? 'none' : 'all')}
      >
        {handout.sharedAll ? 'shared with all ✓' : 'all players'}
      </button>
      {!handout.sharedAll && members.map((m) => {
        const has = handout.sharedWith.includes(m.userId);
        return (
          <button
            key={m.userId}
            className={`link ${has ? 'active-share' : ''}`}
            onClick={() => {
              const next = has
                ? handout.sharedWith.filter((id) => id !== m.userId)
                : [...handout.sharedWith, m.userId];
              intents.shareHandout(handout.id, next.length ? next : 'none');
            }}
          >
            {m.username}{has ? ' ✓' : ''}
          </button>
        );
      })}
    </div>
  );
}

/** Handouts UI as a plain section (no outer dock-panel) for composing into
 * the Directory panel. */
export function HandoutsSection() {
  const you = useGameStore((s) => s.you);
  const handoutList = useGameStore((s) => s.handoutList);
  const [editing, setEditing] = useState<Handout | null | 'new'>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!you) return null;
  const isDm = you.role === 'dm';
  const open = handoutList.find((h) => h.id === openId);

  if (editing !== null) {
    return (
      <div className="dir-section">
        <div className="dock-header"><h3>{editing === 'new' ? 'New handout' : 'Edit handout'}</h3></div>
        <HandoutEditor handout={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      </div>
    );
  }

  if (open) {
    return (
      <div className="dir-section">
        <div className="dock-header">
          <h3>{open.title}</h3>
          <button className="link" onClick={() => setOpenId(null)}>back</button>
        </div>
        {open.imageUrl && <img className="handout-img" src={open.imageUrl} alt={open.title} />}
        <p className="handout-body">{open.bodyMd}</p>
        {isDm && (
          <>
            <ShareControls handout={open} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="link" onClick={() => setEditing(open)}>edit</button>
              <button
                className="link danger"
                onClick={() => {
                  if (confirm(`Delete handout "${open.title}"?`)) {
                    intents.deleteHandout(open.id);
                    setOpenId(null);
                  }
                }}
              >
                delete
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="dir-section">
      <div className="dock-header">
        <h3>Handouts & Journal</h3>
        {isDm && <button className="link" onClick={() => setEditing('new')}>+ new</button>}
      </div>
      <ul className="handout-list">
        {handoutList.map((h) => (
          <li key={h.id}>
            <button className="char-name" onClick={() => setOpenId(h.id)}>{h.title}</button>
            {isDm && (
              <span className="dim" style={{ fontSize: 11 }}>
                {h.sharedAll ? 'all players' : h.sharedWith.length ? `${h.sharedWith.length} player(s)` : 'DM only'}
              </span>
            )}
          </li>
        ))}
        {handoutList.length === 0 && <p className="dim">Nothing here yet.</p>}
      </ul>
    </div>
  );
}
