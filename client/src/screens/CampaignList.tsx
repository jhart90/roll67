import { useMemo, useRef, useState } from 'react';
import type { GameSystem } from 'shared';
import { api, authHeaders } from '../api';
import { useAuthStore, type CampaignListItem } from '../store/auth';
import { BOOK_BOTTOM, BOOK_SLOTS, SHELF_H, SHELF_W, ShelfStage } from './Bookshelf';

const SYSTEM_LABELS: Record<GameSystem, string> = {
  dnd5e: 'D&D 5e',
  swn: 'Stars Without Number',
  swade: 'Savage Worlds (SWADE)',
};

/**
 * Each book letters its spine in its own hand — a western playbill for the
 * cowboy-hat tome, blackletter for the dragon, a typewriter face for the
 * circuit-board one. Stacks lean on faces Windows actually ships, with plain
 * serifs underneath so a machine without them still gets a book, just a less
 * characterful one. `spacing` is letter-spacing in em and feeds the fitting
 * math below, which is why it lives here and not in the stylesheet.
 */
interface SpineFace {
  family: string;
  spacing: number;
  weight?: number;
  style?: 'italic';
  caps?: boolean;
}
const SPINE_FACES: SpineFace[] = [
  { family: "'Perpetua Titling MT', 'Trajan Pro', Georgia, serif", spacing: 0.10, weight: 900, caps: true },   // ⚔️
  { family: "Playbill, 'Rockwell Condensed', 'Bookman Old Style', serif", spacing: 0.14, weight: 700, caps: true }, // 🤠
  { family: "'Baskerville Old Face', Baskerville, Georgia, serif", spacing: 0.06, weight: 800 },               // 🔍
  { family: "'Perpetua Titling MT', 'Copperplate Gothic Bold', serif", spacing: 0.12, weight: 900, caps: true }, // 🏛️
  { family: "'Old English Text MT', 'Palatino Linotype', serif", spacing: 0.03, weight: 800 },                 // 🐉
  { family: "'Copperplate Gothic Bold', 'Eurostile', Georgia, serif", spacing: 0.12, weight: 800, caps: true }, // 🪐
  { family: "Rockwell, 'Bookman Old Style', Georgia, serif", spacing: 0.08, weight: 900, caps: true },          // ⭐
  { family: "Garamond, 'Palatino Linotype', Georgia, serif", spacing: 0.05, weight: 800, style: 'italic' },     // 🐙
  { family: "'OCR A Extended', Consolas, 'Courier New', monospace", spacing: 0.06, weight: 800 },               // 🔌
  { family: "Stencil, Impact, 'Arial Black', sans-serif", spacing: 0.10, weight: 700, caps: true },             // ☣️
  { family: "'Bookman Old Style', Georgia, serif", spacing: 0.07, weight: 900, caps: true },                    // 🔫
];

/**
 * Letter the spine as LARGE as the leather allows.
 *
 * The title is ordinary horizontal type turned a quarter turn as a BLOCK, not
 * vertical writing. The difference is what happens to a long name: a rotated
 * block wraps the way a book jacket does, into as many lines as it needs —
 * each line running the length of the spine, the stack of them filling its
 * width. Vertical writing could only ever add another column.
 *
 * So the fit is an ordinary "biggest type that fits this box" problem, the box
 * being the lettering zone laid on its side: as long as the gap between the
 * head ornament and the sigil, as wide as the book. Sizes are tried from
 * generous downwards and the first that fits wins, which is the largest that
 * does. Widths are measured once at a reference size and scaled, since both
 * canvas text and letter-spacing are linear in font size.
 */
const measureCtx = document.createElement('canvas').getContext('2d')!;
const REF = 100;
/** Width of one line at REF px, its letter-spacing included. */
function runLenRef(text: string, face: SpineFace): number {
  measureCtx.font = `${face.style ?? ''} ${face.weight ?? 600} ${REF}px ${face.family}`.trim();
  const t = face.caps ? text.toUpperCase() : text;
  return measureCtx.measureText(t).width + t.length * face.spacing * REF;
}

/** Greedy wrap at one font size; null if a single word cannot fit the run. */
function wrapAt(words: string[], face: SpineFace, fontSize: number, maxLen: number): string[] | null {
  const allowRef = (maxLen * REF) / fontSize;
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (runLenRef(w, face) > allowRef) return null;
    const trial = cur ? `${cur} ${w}` : w;
    if (runLenRef(trial, face) <= allowRef) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Line box as a multiple of the font size — tight, since these are caps. */
const SPINE_LINE_HEIGHT = 1.06;

function spineLayout(name: string, slotIdx: number): { lines: string[]; fontSize: number; spacing: number } {
  const slot = BOOK_SLOTS[slotIdx];
  const face = SPINE_FACES[slotIdx];
  // The zone on its side: length along the spine, width across it.
  const maxLen = ((slot.textBottom - slot.textTop) / 100) * SHELF_H * 0.97;
  const maxStack = (slot.width / 100) * SHELF_W * 0.86;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [name], fontSize: 10, spacing: face.spacing };

  for (let fs = 92; fs >= 5; fs -= 0.5) {
    const lines = wrapAt(words, face, fs, maxLen);
    if (!lines) continue;
    if (lines.length * fs * SPINE_LINE_HEIGHT <= maxStack) {
      return { lines, fontSize: fs, spacing: face.spacing };
    }
  }
  // Nothing fits even at 5px — set it there rather than show nothing at all.
  return { lines: wrapAt(words, face, 5, maxLen) ?? [name], fontSize: 5, spacing: face.spacing };
}

/**
 * The account pill's dropdown: change password, set a recovery email, or leave.
 *
 * The recovery email lives here as well as in the table's account window
 * because this shelf is where everyone lands after signing in, and the table's
 * copy is only reachable from inside a campaign — a member who has not joined
 * one yet would have had nowhere at all to put an address, which is the exact
 * member most likely to still need one.
 */
function AccountMenu() {
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'menu' | 'password' | 'email'>('menu');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [email, setEmail] = useState('');
  // What the server holds, so an untouched field submits nothing. null until
  // loaded; the form asks on open rather than at mount, since most visits to
  // this shelf never touch the menu at all.
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [note, setNote] = useState('');

  function reset() {
    setPane('menu'); setNote(''); setCurrent(''); setNext('');
  }

  async function openEmail() {
    setPane('email'); setNote('');
    try {
      const { user: u } = await api.get<{ user: { email: string | null } }>('/api/account');
      setSavedEmail(u.email);
      setEmail(u.email ?? '');
    } catch {
      setNote('Could not load your account.');
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setNote('');
    try {
      await api.post('/api/account', { currentPassword: current, newPassword: next });
      setNote('Changed. Your other devices have been signed out.');
      setCurrent(''); setNext('');
      setPane('menu');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Failed.');
    }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setNote('');
    try {
      const { user: u } = await api.post<{ user: { email: string | null } }>('/api/account', {
        currentPassword: current, newEmail: email.trim(),
      });
      setSavedEmail(u.email);
      setEmail(u.email ?? '');
      setCurrent('');
      setNote(u.email ? `Saved. Reset links will go to ${u.email}.` : 'Removed.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Failed.');
    }
  }

  return (
    <div className="account-pill-wrap">
      <button className="account-pill" onClick={() => { setOpen((o) => !o); reset(); }}>
        {user?.username} <span className="account-pill-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="account-menu">
          {pane === 'password' && (
            <form className="account-menu-form" onSubmit={changePassword}>
              <input
                type="password" placeholder="Current password" autoFocus
                value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password"
              />
              <input
                type="password" placeholder="New password"
                value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password"
              />
              <div className="portal-row">
                <button type="submit" className="portal-cta portal-cta-small" disabled={!current || !next}>Change</button>
                <button type="button" className="link" onClick={reset}>back</button>
              </div>
            </form>
          )}
          {pane === 'email' && (
            <form className="account-menu-form" onSubmit={saveEmail}>
              <p className="portal-hint" style={{ margin: 0 }}>
                {savedEmail
                  ? 'Where a lost-password link is sent. Empty it to remove.'
                  : 'No address on file. Without one, a forgotten password cannot be reset.'}
              </p>
              <input
                type="email" placeholder="you@example.com" autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              />
              <input
                type="password" placeholder="Current password"
                value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password"
              />
              <div className="portal-row">
                <button
                  type="submit"
                  className="portal-cta portal-cta-small"
                  disabled={!current || email.trim().toLowerCase() === (savedEmail ?? '')}
                >
                  Save
                </button>
                <button type="button" className="link" onClick={reset}>back</button>
              </div>
            </form>
          )}
          {pane === 'menu' && (
            <>
              <button onClick={() => { setPane('password'); setNote(''); }}>Change password…</button>
              <button onClick={openEmail}>Recovery email…</button>
              <button onClick={logout}>Log out</button>
            </>
          )}
          {note && <p className="portal-hint">{note}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The shelf: your campaigns ARE the books.
 *
 * Eleven tomes stand in the painting, so an account gets eleven campaign
 * slots. A joined campaign takes a book and letters its name down the spine
 * in that book's own face; an empty book stays furniture. Books drag onto one
 * another to swap places, and the arrangement is the account's — saved
 * server-side, the same shelf on every machine.
 */
export function CampaignList({ onOpen }: { onOpen: (campaignId: string) => void }) {
  const { campaignList, createCampaign, joinCampaign, saveShelf } = useAuthStore();
  /** What the portal card is showing: the stacked menu, or one flow opened. */
  const [portal, setPortal] = useState<'menu' | 'join' | 'create'>('menu');
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
   * Who sits in which book. Stored slots win; anything unplaced fills the
   * first free book in list order, so the shelf is always fully seated
   * without anyone arranging it first.
   */
  const seats = useMemo(() => {
    const byBook: Array<CampaignListItem | null> = Array(BOOK_SLOTS.length).fill(null);
    const unplaced: CampaignListItem[] = [];
    for (const c of campaignList) {
      const s = c.shelfSlot;
      if (typeof s === 'number' && s >= 0 && s < BOOK_SLOTS.length && !byBook[s]) byBook[s] = c;
      else unplaced.push(c);
    }
    // Someone with exactly one campaign gets it in the CENTER book — the one
    // book on this screen they came for, seated where the eye lands. Only by
    // default: a stored slot means they shelved it themselves, and stands.
    if (campaignList.length === 1 && unplaced.length === 1) {
      byBook[Math.floor(BOOK_SLOTS.length / 2)] = unplaced.pop()!;
    }
    for (const c of unplaced) {
      const free = byBook.findIndex((x) => x === null);
      if (free >= 0) byBook[free] = c;
    }
    const overflow = campaignList.filter((c) => !byBook.includes(c));
    return { byBook, overflow };
  }, [campaignList]);
  /** One campaign on the whole shelf: its book is the screen's primary CTA. */
  const solo = campaignList.length === 1;

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
      setPortal('menu');
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
      setPortal('menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join campaign.');
    }
  }

  /** Restore-from-backup — the same flow as ever, reskinned. */
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
          <div className="shelf-topbar">
            <span className="shelf-brand">ROLL67</span>
            <span className="spacer" />
            <AccountMenu />
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

          {/* The portal card: one flow at a time. The stacked menu is the
              rest state; opening a flow clears the desk of the others. */}
          {/* Once there are books on the shelf, THEY are what this screen is
              for. The portal steps back — smaller and faded — and comes
              forward again when the cursor approaches it. It never steps back
              mid-flow: a form you are typing into must not be dimmed. */}
          <div className={`portal-card${campaignList.length > 0 && portal === 'menu' ? ' portal-card-quiet' : ''}`}>
            {portal === 'menu' && (
              <div className="portal-stack">
                <button className="portal-cta" onClick={() => { setPortal('create'); setError(''); }}>New Campaign</button>
                <button className="portal-cta" onClick={() => { setPortal('join'); setError(''); }}>Join Campaign</button>
                <button
                  className="portal-cta"
                  disabled={restoring}
                  title="Rebuild a campaign from a .r67campaign backup file"
                  onClick={() => fileRef.current?.click()}
                >
                  {restoring ? 'Restoring…' : 'Restore Campaign'}
                </button>
              </div>
            )}
            {portal === 'join' && (
              <form onSubmit={handleJoin} className="portal-form">
                <input
                  placeholder="INVITE CODE"
                  className="portal-invite"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  autoFocus
                />
                <div className="portal-row">
                  <button type="submit" className="portal-cta" disabled={inviteCode.length < 6}>Join</button>
                  <button type="button" className="link" onClick={() => setPortal('menu')}>back</button>
                </div>
              </form>
            )}
            {portal === 'create' && (
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
                  <button type="submit" className="portal-cta">Summon It</button>
                  <button type="button" className="link" onClick={() => setPortal('menu')}>back</button>
                </div>
              </form>
            )}
            {campaignList.length === 0 && portal === 'menu' && (
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
        const face = SPINE_FACES[i];
        const fit = campaign ? spineLayout(campaign.name, i) : null;
        return (
          <div
            key={i}
            className={`shelf-book${campaign ? ' occupied' : ''}${hover === i && campaign ? ' lit' : ''}${campaign && solo ? ' solo' : ''}`}
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
            {campaign && fit && (
              <span
                className="shelf-spine"
                data-lines={fit.lines.length}
                style={{
                  // Laid out flat and turned a quarter turn, so its WIDTH is
                  // the run along the spine and its HEIGHT is the stack across
                  // the book. Both in image pixels scaled by --su, like
                  // everything else on this shelf. Centred ON the zone, which
                  // is what holds it between the ornament and the sigil.
                  top: `${(((slot.textTop + slot.textBottom) / 2 - slot.top) / (BOOK_BOTTOM - slot.top)) * 100}%`,
                  width: `calc(var(--su) * ${(((slot.textBottom - slot.textTop) / 100) * SHELF_H).toFixed(1)}px)`,
                  height: `calc(var(--su) * ${((slot.width / 100) * SHELF_W).toFixed(1)}px)`,
                  fontFamily: face.family,
                  fontWeight: face.weight ?? 600,
                  fontStyle: face.style ?? 'normal',
                  textTransform: face.caps ? 'uppercase' : 'none',
                  letterSpacing: `${fit.spacing}em`,
                  fontSize: `calc(var(--su) * ${fit.fontSize.toFixed(1)}px)`,
                  lineHeight: SPINE_LINE_HEIGHT,
                }}
              >
                {fit.lines.map((line, li) => <span key={li}>{line}</span>)}
              </span>
            )}
          </div>
        );
      })}
    </ShelfStage>
  );
}
