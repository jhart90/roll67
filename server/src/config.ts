import path from 'node:path';
import fs from 'node:fs';

export const PORT = Number(process.env.PORT ?? 3001);

/** Railway volume mount in production; ./data locally. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), '..', 'data');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = path.join(DATA_DIR, 'roll67.db');

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024; // 15 MB
export const CHAT_TAIL = 200;

// ---------- password recovery ----------

/** How long a reset link stays good. Short on purpose: it is a bearer key to
 *  the account sitting in an inbox. */
export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Where reset links point.
 *
 * Set this in production. The fallback builds the link from the request's own
 * Host header, which is attacker-controlled — someone can POST /forgot-password
 * with `Host: evil.example` and the victim's inbox receives a link to a site
 * that harvests the token. Fine for localhost, not for a real deployment, so
 * unset-in-production is logged loudly at boot.
 */
export const APP_URL = (process.env.APP_URL ?? '').replace(/\/+$/, '');

/** Resend's HTTPS API (https://resend.com). Empty = no mail is sent, and reset
 *  links are written to the server log for the operator to pass along. */
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
export const MAIL_FROM = process.env.MAIL_FROM ?? 'Roll67 <onboarding@resend.dev>';

export function ensureDataDirs(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
