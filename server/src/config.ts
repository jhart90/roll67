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

export function ensureDataDirs(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
