import { Router, type Request } from 'express';
import {
  createSession, hashPassword, hashResetToken, newResetToken, requireAuth,
  validEmail, validPassword, validUsername, verifyPassword, type AuthedRequest,
} from '../auth.js';
import { APP_URL, RESET_TTL_MS } from '../config.js';
import { campaigns, normalizeEmail, passwordResets, sessions, users } from '../db/repos.js';
import { resetEmail, sendMail } from '../mail.js';

export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  const { username, password, email } = req.body ?? {};
  if (!validUsername(username)) {
    res.status(400).json({ error: 'Username must be 2-24 characters (letters, numbers, _ or -).' });
    return;
  }
  if (!validPassword(password)) {
    res.status(400).json({ error: 'Password must be at least 4 characters.' });
    return;
  }
  // Optional from the first screen on — an account with no address is a
  // complete account, it just has no way back if the password is lost.
  const normalized = normalizeEmail(email);
  if (normalized !== null && !validEmail(normalized)) {
    res.status(400).json({ error: "That doesn't look like an email address." });
    return;
  }
  if (users.byUsername(username)) {
    res.status(409).json({ error: 'That username is taken.' });
    return;
  }
  if (normalized && users.byEmail(normalized)) {
    res.status(409).json({ error: 'That email is already on another account.' });
    return;
  }
  const user = users.create(username, hashPassword(password), normalized);
  const token = createSession(user.id);
  res.json({ token, user: { id: user.id, username: user.username } });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = typeof username === 'string' ? users.byUsername(username) : undefined;
  if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Wrong username or password.' });
    return;
  }
  const token = createSession(user.id);
  res.json({ token, user: { id: user.id, username: user.username } });
});

authRouter.post('/logout', requireAuth, (req: AuthedRequest, res) => {
  const header = req.headers.authorization!;
  sessions.delete(header.slice(7));
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: { id: req.user!.id, username: req.user!.username } });
});

/** The account panel's own view of itself — the one place an email is echoed
 *  back, and only to the session that owns it. */
authRouter.get('/account', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: { id: req.user!.id, username: req.user!.username, email: req.user!.email } });
});

authRouter.post('/account', requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newUsername, newPassword, newEmail } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, req.user!.password_hash)) {
    res.status(403).json({ error: 'Current password is incorrect.' });
    return;
  }
  // Validate everything before writing anything: a bad email must not leave a
  // half-applied change behind it.
  let nextEmail: string | null | undefined;
  if (newEmail !== undefined) {
    nextEmail = normalizeEmail(newEmail);
    if (nextEmail !== null && !validEmail(nextEmail)) {
      res.status(400).json({ error: "That doesn't look like an email address." });
      return;
    }
    if (nextEmail !== null && nextEmail !== req.user!.email) {
      const holder = users.byEmail(nextEmail);
      if (holder && holder.id !== req.user!.id) {
        res.status(409).json({ error: 'That email is already on another account.' });
        return;
      }
    }
  }
  if (newUsername !== undefined) {
    const trimmed = String(newUsername).trim();
    if (!validUsername(trimmed)) {
      res.status(400).json({ error: 'Username must be 2-24 characters (letters, numbers, _ or -).' });
      return;
    }
    if (trimmed.toLowerCase() !== req.user!.username.toLowerCase()) {
      const existing = users.byUsername(trimmed);
      if (existing && existing.id !== req.user!.id) {
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
    }
    users.rename(req.user!.id, trimmed);
  }
  if (nextEmail !== undefined) users.setEmail(req.user!.id, nextEmail);
  if (newPassword !== undefined) {
    if (!validPassword(newPassword)) {
      res.status(400).json({ error: 'Password must be at least 4 characters.' });
      return;
    }
    users.setPassword(req.user!.id, hashPassword(newPassword));
    // Whoever else was signed in as this account is signed out, and any reset
    // link still sitting in an inbox stops working. Both matter most in the
    // case this feature exists for: the password was changed BECAUSE someone
    // else had it.
    sessions.deleteForUserExcept(req.user!.id, req.headers.authorization!.slice(7));
    passwordResets.invalidateForUser(req.user!.id);
  }
  const updated = users.byId(req.user!.id)!;
  res.json({ user: { id: updated.id, username: updated.username, email: updated.email } });
});

// ---------- password recovery ----------

/**
 * Where a reset link points.
 *
 * APP_URL wins whenever it is set, because the fallback trusts the request's
 * own Host header — see the note on APP_URL in config.ts.
 */
function linkBase(req: Request): string {
  if (APP_URL) return APP_URL;
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwarded || req.protocol || 'http';
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

/**
 * A crude fixed-window limiter, in memory.
 *
 * Enough for what it guards: reset mail is the one unauthenticated thing here
 * that costs money to send and lands in someone else's inbox, so the thing to
 * prevent is a stranger using this endpoint to flood an address. Per-process
 * state, so it resets on deploy and does not span Railway replicas — fine at
 * this scale, and worth replacing with the DB if the server is ever more than
 * one process.
 */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateHits = new Map<string, number[]>();
function overLimit(key: string, max: number): boolean {
  const t = Date.now();
  const recent = (rateHits.get(key) ?? []).filter((at) => t - at < RATE_WINDOW_MS);
  recent.push(t);
  rateHits.set(key, recent);
  // Bounded: sweep whole keys that have gone quiet rather than letting one map
  // entry per attacker IP live forever.
  if (rateHits.size > 2000) {
    for (const [k, list] of rateHits) {
      if (list.every((at) => t - at >= RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  return recent.length > max;
}

/**
 * Ask for a reset link.
 *
 * Answers identically no matter what happened — account found or not, email on
 * file or not, mail sent or not. Any difference here (wording, status, even
 * response time to a useful degree) turns this endpoint into a way to ask the
 * server "does this person have an account", which it should not be. The
 * operator learns the truth from the log; the stranger at the door does not.
 */
authRouter.post('/forgot-password', async (req, res) => {
  const account = typeof (req.body ?? {}).account === 'string' ? req.body.account.trim() : '';
  const ip = req.ip ?? 'unknown';
  const uniform = {
    ok: true,
    message: 'If that account exists and has an email on file, a reset link is on its way.',
  };

  if (!account || overLimit(`ip:${ip}`, 10) || overLimit(`account:${account.toLowerCase()}`, 4)) {
    res.json(uniform);
    return;
  }

  // Housekeeping rides along with the only route that makes rows: anything a
  // full day past expiry is dead weight.
  passwordResets.purge(24 * 60 * 60 * 1000);

  // People type either one into the box, and the box says so.
  const normalized = normalizeEmail(account);
  const user = users.byUsername(account) ?? (normalized ? users.byEmail(normalized) : undefined);
  if (!user?.email) {
    console.log(`password reset requested for "${account}" — ${user ? 'no email on file' : 'no such account'}`);
    res.json(uniform);
    return;
  }

  const token = newResetToken();
  passwordResets.create(user.id, hashResetToken(token), RESET_TTL_MS);
  const link = `${linkBase(req)}/#reset=${token}`;
  const sent = await sendMail({ to: user.email, ...resetEmail(user.username, link, RESET_TTL_MS / 60000) });
  console.log(`password reset link issued for "${user.username}" (mail ${sent ? 'sent' : 'NOT sent — see above'})`);
  res.json(uniform);
});

/** Is this link worth showing a form for? Asked by the reset screen on open so
 *  an expired link says so immediately instead of after typing a password. */
authRouter.post('/reset-password/check', (req, res) => {
  const token = typeof (req.body ?? {}).token === 'string' ? req.body.token : '';
  if (overLimit(`check:${req.ip ?? 'unknown'}`, 60)) {
    res.status(429).json({ error: 'Too many attempts. Wait a while and try again.' });
    return;
  }
  const found = token ? passwordResets.peek(hashResetToken(token)) : undefined;
  res.json(found ? { valid: true, username: found.username } : { valid: false });
});

/** Spend the link and set the new password. */
authRouter.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (overLimit(`reset:${req.ip ?? 'unknown'}`, 30)) {
    res.status(429).json({ error: 'Too many attempts. Wait a while and try again.' });
    return;
  }
  if (!validPassword(newPassword)) {
    res.status(400).json({ error: 'Password must be at least 4 characters.' });
    return;
  }
  const userId = typeof token === 'string' && token ? passwordResets.consume(hashResetToken(token)) : undefined;
  if (!userId) {
    res.status(400).json({ error: 'That reset link has expired or has already been used.' });
    return;
  }
  const user = users.byId(userId);
  if (!user) {
    res.status(400).json({ error: 'That account no longer exists.' });
    return;
  }
  users.setPassword(user.id, hashPassword(newPassword));
  // Everything the old password could reach is cut off: other sessions, and
  // any second reset link that was issued before this one was spent.
  sessions.deleteForUser(user.id);
  passwordResets.invalidateForUser(user.id);
  // Straight in — holding the link was the proof, and making them retype the
  // password they just chose proves nothing.
  const session = createSession(user.id);
  console.log(`password reset completed for "${user.username}"`);
  res.json({ token: session, user: { id: user.id, username: user.username } });
});

// ---------- campaigns (REST: list/create/join happen outside the live table) ----------

export const campaignRouter = Router();
campaignRouter.use(requireAuth);

campaignRouter.get('/', (req: AuthedRequest, res) => {
  const slots = users.shelfSlots(req.user!.id);
  const mine = campaigns.forUser(req.user!.id).map((c) => ({
    id: c.id,
    name: c.name,
    system: c.system,
    role: c.role,
    // The invite code is DM-only information.
    inviteCode: c.role === 'dm' ? c.inviteCode : null,
    // Which book on the lobby shelf this campaign lives in. Null = never
    // placed; the client seats it in the first free slot.
    shelfSlot: typeof slots[c.id] === 'number' ? slots[c.id] : null,
  }));
  res.json({ campaigns: mine });
});

/**
 * Rearrange the shelf: which book holds which campaign.
 *
 * Validated down to exactly what the shelf can mean — integer slots 0..10,
 * one campaign per slot, only campaigns this account is actually in — because
 * this is a raw JSON column and the lobby renders whatever it says.
 */
campaignRouter.post('/shelf', (req: AuthedRequest, res) => {
  const raw = (req.body ?? {}).slots;
  if (!raw || typeof raw !== 'object') { res.status(400).json({ error: 'slots required' }); return; }
  const mine = new Set(campaigns.forUser(req.user!.id).map((c) => c.id));
  const clean: Record<string, number> = {};
  const taken = new Set<number>();
  for (const [campaignId, slot] of Object.entries(raw as Record<string, unknown>)) {
    if (!mine.has(campaignId)) continue;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 10) continue;
    if (taken.has(slot)) continue;
    taken.add(slot);
    clean[campaignId] = slot;
  }
  users.setShelfSlots(req.user!.id, clean);
  res.json({ ok: true });
});

campaignRouter.post('/', (req: AuthedRequest, res) => {
  const { name, system } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 60) {
    res.status(400).json({ error: 'Campaign name required (max 60 chars).' });
    return;
  }
  if (system !== 'dnd5e' && system !== 'swn' && system !== 'swade') {
    res.status(400).json({ error: 'System must be dnd5e, swn, or swade.' });
    return;
  }
  const campaign = campaigns.create(name.trim(), system, req.user!.id);
  res.json({ campaign });
});

campaignRouter.post('/join', (req: AuthedRequest, res) => {
  const { inviteCode } = req.body ?? {};
  const campaign = typeof inviteCode === 'string' ? campaigns.byInviteCode(inviteCode.trim()) : undefined;
  if (!campaign) {
    res.status(404).json({ error: 'No campaign with that invite code.' });
    return;
  }
  const existing = campaigns.memberRole(campaign.id, req.user!.id);
  if (!existing) campaigns.addMember(campaign.id, req.user!.id, 'player');
  res.json({ campaign: { id: campaign.id, name: campaign.name, system: campaign.system, role: existing ?? 'player' } });
});
