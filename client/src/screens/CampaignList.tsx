import { useMemo, useRef, useState } from 'react';
import type { GameSystem } from 'shared';
import { authHeaders } from '../api';
import { useAuthStore, type CampaignListItem } from '../store/auth';
import { BOOK_BOTTOM, BOOK_SLOTS, ShelfStage } from './Bookshelf';

const SYSTEM_LABELS: Record<GameSystem, string> = {
  dnd5e: 'D&D 5e',
  swn: 'Stars Without Number',
  swade: 'Savage Worlds (SWADE)',
};

/**
 * The shelf: your campaigns ARE the books.
 *
 * Eleven tomes stand in the painting, so an account gets eleven campaign
 * slots. A joined campaign takes a book and letters its name down the spine;
 * an empty book stays part of the furniture. Books can be dragged onto one
 * another to rearrange which campaign lives where — the assignment is the
 * account's, saved server-side, so your shelf looks the same from any
 * machine.
 */
export function CampaignList({ onOpen }: { onOpen: (campaignId: string) => void }) {
  const { user, campaignList, createCampaign, joinCampaign, logout, saveShelf } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [system, setSystem] = useState<GameSystem>('dnd5e');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string[] | null>(null);
  /** A backup file that names a campaign already on this server, waiting for
   *  the DM to say whether it may overwrite it. */
  const [pending, setPending] = useState<{ file: File; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);

  /**
   * Who sits in which book. Stored slots win; anything unplaced (a campaign
   * just joined, or a clash after leaving one) fills the first free book in
   * list order, so the shelf is always fully seated without anyone arranging
   * it first.
   */
  const seats = useMemo(() => {
    const byBook: Array<CampaignListItem | null> = Array(BOOK_SLOTS.length).fill(null);
    const unplaced: CampaignListItem[] = [];
    for (const c of campaignList) {
      const s = c.shelfSlot;
      if (typeof s === 'number' && s >= 0 && s < BOOK_SLOTS.length && !byBook[s]) byBook[s] = c;
      else unplaced.push(c);
    }
    for (const c of unplaced) {
      const free = byBook.findIndex((x) => x === null);
      if (free >= 0) byBook[free] = c;
    }
    // More campaigns than books: whatever would not fit waits on the desk
    // (rendered in the portal card). Eleven per account is the shelf's cap.
    const overflow = campaignList.filter((c) => !byBook.includes(c));
    return { byBook, overflow };
  }, [campaignList]);

  function persist(byBook: Array<CampaignListItem | null>) {
    const slots: Record<string, number> = {};
    byBook.forEach((c, i) => { if (c) slots[c.id] = i; });
    void saveShelf(slots);
  }

  function dropOn(target: number) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === target) return;
    const next = [...seats.byBook];
    [next[from], next[target]] = [next[target], next[from]];
    persist(next);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createCampaign(name, system);
      setName('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign.');
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await joinCampaign(inviteCode);
      setInviteCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join campaign.');
    }
  }

  /** Restore-from-backup — the same flow the old shelf had, reskinned. */
  async function sendRestore(file: File, replace: boolean) {
    setError('');
    setRestoreNote(null);
    setRestoring(true);
    try {
      const body = new FormData();
      body.append('file', file);
      if (replace) body.append('replace', 'true');
      const res = await fetch('/api/campaigns/restore', { method: 'POST', headers: authHeaders(), body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!replace && typeof data.error === 'string' && data.error.includes('already on this server')) {
          setPending({ file, message: data.error });
          return;
        }
        throw new Error(data.error ?? 'Restore failed.');
      }
      setPending(null);
      await useAuthStore.getState().loadCampaigns();
      const rows = Object.values(data.rows ?? {}).reduce((sum: number, n) => sum + Number(n), 0);
      setRestoreNote([
        `Restored "${data.name}" — ${rows} rows and ${data.files} file${data.files === 1 ? '' : 's'}.`,
        ...(data.notes ?? []),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  }

  const hovered = hover !== null ? seats.byBook[hover] : null;

  return (
    <ShelfStage
      overlay={(
        <>
          {/* Slim chrome: the wordmark and the person, out of the painting's way. */}
          <div className="shelf-topbar">
            <span className="shelf-brand">ROLL67</span>
            <span className="spacer" />
            <span className="shelf-member">{user?.username}</span>
            <button className="link" onClick={logout}>log out</button>
          </div>

          {/* The plaque: whatever book the cursor is on, spelled out. */}
          {hovered && (
            <div className="shelf-plaque">
              <strong>{hovered.name}</strong>
              <span>{SYSTEM_LABELS[hovered.system]} · {hovered.role === 'dm' ? 'you are the DM' : 'player'}</span>
              {hovered.inviteCode && <span className="shelf-plaque-invite">invite <code>{hovered.inviteCode}</code></span>}
              <span className="dim">click to open · drag onto another book to rearrange</span>
            </div>
          )}

          {/* The portal card: everything that is not "open a campaign". */}
          <div className="portal-card">
            {showCreate ? (
              <form onSubmit={handleCreate} className="portal-form">
                <input
                  placeholder="Campaign name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <select value={system} onChange={(e) => setSystem(e.target.value as GameSystem)}>
                  <option value="dnd5e">D&amp;D 5e</option>
                  <option value="swn">Stars Without Number</option>
                  <option value="swade">Savage Worlds (SWADE)</option>
                </select>
                <div className="portal-row">
                  <button type="submit" className="portal-cta">🎲 Summon it</button>
                  <button type="button" className="link" onClick={() => setShowCreate(false)}>cancel</button>
                </div>
              </form>
            ) : (
              <div className="portal-row">
                <button className="portal-cta" onClick={() => setShowCreate(true)}>🎲 New campaign</button>
                <form onSubmit={handleJoin} className="portal-join">
                  <input
                    placeholder="INVITE CODE"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    maxLength={6}
                  />
                  <button type="submit" disabled={inviteCode.length < 6}>Join</button>
                </form>
                <button
                  className="link"
                  disabled={restoring}
                  title="Rebuild a campaign from a .r67campaign backup file"
                  onClick={() => fileRef.current?.click()}
                >
                  {restoring ? 'restoring…' : '📼 restore'}
                </button>
              </div>
            )}
            {campaignList.length === 0 && !showCreate && (
              <p className="portal-hint">The shelf is bare — summon a campaign, or join a friend’s with their code.</p>
            )}
            {seats.overflow.length > 0 && (
              <p className="portal-hint">
                No books left — also yours:{' '}
                {seats.overflow.map((c) => (
                  <button key={c.id} className="link" onClick={() => onOpen(c.id)}>{c.name}</button>
                ))}
              </p>
            )}
            {error && <p className="error">{error}</p>}
            {pending && (
              <div className="portal-hint">
                <p>{pending.message}</p>
                <button className="link danger" disabled={restoring} onClick={() => void sendRestore(pending.file, true)}>
                  overwrite it
                </button>{' '}
                <button className="link" onClick={() => setPending(null)}>keep it</button>
              </div>
            )}
            {restoreNote && (
              <div className="portal-hint">
                {restoreNote.map((line, i) => <p key={i} className={i === 0 ? '' : 'dim'}>{line}</p>)}
                <button className="link" onClick={() => setRestoreNote(null)}>dismiss</button>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".r67campaign"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void sendRestore(file, false);
            }}
          />
        </>
      )}
    >
      {BOOK_SLOTS.map((slot, i) => {
        const campaign = seats.byBook[i];
        return (
          <div
            key={i}
            className={`shelf-book${campaign ? ' occupied' : ''}${hover === i && campaign ? ' lit' : ''}`}
            style={{
              left: `${slot.left}%`,
              width: `${slot.width}%`,
              top: `${slot.top}%`,
              height: `${BOOK_BOTTOM - slot.top}%`,
            }}
            title={campaign ? `${campaign.name} — ${SYSTEM_LABELS[campaign.system]}` : undefined}
            draggable={!!campaign}
            onDragStart={(e) => {
              if (!campaign) { e.preventDefault(); return; }
              dragFrom.current = i;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', campaign.id);
            }}
            onDragOver={(e) => { if (dragFrom.current !== null) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); dropOn(i); }}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            onClick={() => campaign && onOpen(campaign.id)}
          >
            {campaign && (
              <span className="shelf-spine">{campaign.name}</span>
            )}
          </div>
        );
      })}
    </ShelfStage>
  );
}
