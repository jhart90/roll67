import { Router } from 'express';
import {
  createSession, hashPassword, requireAuth, validPassword, validUsername,
  verifyPassword, type AuthedRequest,
} from '../auth.js';
import { campaigns, sessions, users } from '../db/repos.js';

export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!validUsername(username)) {
    res.status(400).json({ error: 'Username must be 2-24 characters (letters, numbers, _ or -).' });
    return;
  }
  if (!validPassword(password)) {
    res.status(400).json({ error: 'Password must be at least 4 characters.' });
    return;
  }
  if (users.byUsername(username)) {
    res.status(409).json({ error: 'That username is taken.' });
    return;
  }
  const user = users.create(username, hashPassword(password));
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

authRouter.post('/account', requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newUsername, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, req.user!.password_hash)) {
    res.status(403).json({ error: 'Current password is incorrect.' });
    return;
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
  if (newPassword !== undefined) {
    if (!validPassword(newPassword)) {
      res.status(400).json({ error: 'Password must be at least 4 characters.' });
      return;
    }
    users.setPassword(req.user!.id, hashPassword(newPassword));
  }
  const updated = users.byId(req.user!.id)!;
  res.json({ user: { id: updated.id, username: updated.username } });
});

// ---------- campaigns (REST: list/create/join happen outside the live table) ----------

export const campaignRouter = Router();
campaignRouter.use(requireAuth);

campaignRouter.get('/', (req: AuthedRequest, res) => {
  const mine = campaigns.forUser(req.user!.id).map((c) => ({
    id: c.id,
    name: c.name,
    system: c.system,
    role: c.role,
    // The invite code is DM-only information.
    inviteCode: c.role === 'dm' ? c.inviteCode : null,
  }));
  res.json({ campaigns: mine });
});

campaignRouter.post('/', (req: AuthedRequest, res) => {
  const { name, system } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 60) {
    res.status(400).json({ error: 'Campaign name required (max 60 chars).' });
    return;
  }
  if (system !== 'dnd5e' && system !== 'swn') {
    res.status(400).json({ error: 'System must be dnd5e or swn.' });
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
