import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DB_PATH, ensureDataDirs } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ensureDataDirs();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

export function newId(): string {
  return crypto.randomBytes(9).toString('hex');
}

export function now(): number {
  return Date.now();
}
