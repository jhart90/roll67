import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import { SESSION_TTL_MS } from './config.js';
import { sessions, users, type UserRow } from './db/repos.js';

export interface AuthedRequest extends Request {
  user?: UserRow;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function createSession(userId: string): string {
  return sessions.create(userId, SESSION_TTL_MS);
}

function tokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Express middleware: requires a valid session, attaches req.user. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = tokenFromRequest(req);
  const user = token ? sessions.resolve(token) : undefined;
  if (!user) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  req.user = user;
  next();
}

/** Socket.IO middleware: resolves handshake auth token to a user. */
export function socketAuth(socket: Socket, next: (err?: Error) => void): void {
  const token = (socket.handshake.auth as { token?: string })?.token;
  const user = token ? sessions.resolve(token) : undefined;
  if (!user) {
    next(new Error('not authenticated'));
    return;
  }
  socket.data.userId = user.id;
  socket.data.username = user.username;
  next();
}

export function validUsername(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9_-]{2,24}$/.test(name);
}

export function validPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 4 && pw.length <= 128;
}

/**
 * Loose on purpose.
 *
 * The only real test of an address is whether mail sent to it arrives, and
 * this one gets exactly that test the moment it is used. So this rejects the
 * shapes that are certainly not addresses — no @, spaces, two @s, nothing
 * after the dot — and lets everything else through rather than arguing with
 * the long tail of what a valid address is.
 */
export function validEmail(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** A reset link's secret half: 32 random bytes, URL-safe. */
export function newResetToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** What gets stored for a token. See the password_resets table comment. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
