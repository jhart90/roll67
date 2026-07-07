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

// SQLite can't ALTER a CHECK constraint, so databases created before 'audio'
// was a valid asset kind need their `assets` table rebuilt from scratch.
function migrateAssetsAudioKind(): void {
  const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assets'`).get() as
    | { sql: string }
    | undefined;
  if (!table || table.sql.includes("'audio'")) return;
  const oldCols = (db.prepare(`PRAGMA table_info(assets)`).all() as Array<{ name: string }>).map((c) => c.name);
  const baseCols = ['id', 'campaign_id', 'uploader_id', 'kind', 'filename', 'ext', 'mime', 'bytes', 'width', 'height', 'created_at'];
  const extraCols = ['folder_id', 'title'].filter((c) => oldCols.includes(c));
  db.exec('ALTER TABLE assets RENAME TO assets_pre_audio_migration');
  db.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      uploader_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('map', 'token', 'handout', 'audio')),
      filename TEXT NOT NULL,
      ext TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  for (const c of extraCols) db.exec(`ALTER TABLE assets ADD COLUMN ${c} TEXT`);
  const allCols = [...baseCols, ...extraCols].join(', ');
  db.exec(`INSERT INTO assets (${allCols}) SELECT ${allCols} FROM assets_pre_audio_migration`);
  db.exec('DROP TABLE assets_pre_audio_migration');
}
migrateAssetsAudioKind();

// Additive migrations for databases created before a column existed.
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('campaign_members', 'map_id', 'map_id TEXT');
ensureColumn('macros', 'color', 'color TEXT');
ensureColumn('macros', 'character_id', 'character_id TEXT');
ensureColumn('macros', 'rollable_id', 'rollable_id TEXT');
ensureColumn('macros', 'action_id', 'action_id TEXT');
ensureColumn('assets', 'folder_id', 'folder_id TEXT');
ensureColumn('assets', 'title', 'title TEXT');
ensureColumn('handouts', 'folder_id', 'folder_id TEXT');
ensureColumn('tokens', 'shape', "shape TEXT NOT NULL DEFAULT 'circle'");
ensureColumn('tokens', 'light_json', 'light_json TEXT');
ensureColumn('chat_messages', 'hidden', 'hidden INTEGER NOT NULL DEFAULT 0');
ensureColumn('chat_messages', 'undo_json', 'undo_json TEXT');
// Unified world tree: any entity can be parented to any other by id.
ensureColumn('characters', 'parent_id', 'parent_id TEXT');
ensureColumn('handouts', 'parent_id', 'parent_id TEXT');
ensureColumn('shops', 'parent_id', 'parent_id TEXT');
ensureColumn('rollable_tables', 'parent_id', 'parent_id TEXT');
ensureColumn('maps', 'parent_id', 'parent_id TEXT');
ensureColumn('maps', 'spawn_json', 'spawn_json TEXT');
ensureColumn('users', 'dice_color', 'dice_color TEXT');
ensureColumn('users', 'dice_text_color', 'dice_text_color TEXT');
ensureColumn('users', 'player_color', 'player_color TEXT');

// better-sqlite3 does NOT cache prepared statements: every db.prepare()
// recompiles the SQL. Repo methods run on hot paths (every token move
// prepares several statements), so memoize by SQL text -- all repo SQL is
// static strings, making the cache small and bounded.
const stmtCache = new Map<string, Database.Statement<unknown[]>>();
export function stmt(sql: string): Database.Statement<unknown[]> {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare<unknown[]>(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export function newId(): string {
  return crypto.randomBytes(9).toString('hex');
}

export function now(): number {
  return Date.now();
}
