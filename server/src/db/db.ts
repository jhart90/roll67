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
// FK enforcement is deferred until after all migrations — SQLite's ALTER TABLE
// RENAME silently redirects FK references in other tables when foreign_keys is
// ON, which corrupts constraints if the renamed table is later dropped.

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

// Repair FK references broken by migrateAssetsAudioKind running with foreign_keys=ON.
// The RENAME redirected FK constraints in maps/tokens/handouts/audio_tracks to point
// to the temp table name; after DROP that table the constraints became invalid.
// Fix: rebuild affected tables from scratch (standard SQLite table-rebuild approach).
function repairBrokenAssetFKs(): void {
  const hasBrokenFK = (table: string) =>
    (db.pragma(`foreign_key_list(${table})`) as Array<{ table: string }>)
      .some((fk) => fk.table.includes('_pre_audio_migration'));

  if (!hasBrokenFK('maps') && !hasBrokenFK('tokens') && !hasBrokenFK('handouts') && !hasBrokenFK('audio_tracks')) return;

  console.log('Rebuilding tables to fix corrupted FK references from assets migration');
  db.pragma('legacy_alter_table = ON');

  function rebuild(table: string, createSql: string, indexes: string[]): void {
    if (!hasBrokenFK(table)) return;
    const cols = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
    const colList = cols.join(', ');
    const tmp = `${table}__fk_rebuild`;
    db.exec(createSql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${tmp}`));
    db.exec(`INSERT INTO ${tmp} (${colList}) SELECT ${colList} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
    for (const idx of indexes) db.exec(idx);
  }

  rebuild('maps', `CREATE TABLE maps (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL, bg_asset_id TEXT REFERENCES assets(id), grid_json TEXT NOT NULL,
    walls_json TEXT NOT NULL DEFAULT '[]', doors_json TEXT NOT NULL DEFAULT '[]',
    lights_json TEXT NOT NULL DEFAULT '[]', parent_id TEXT, spawn_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0)`,
    ['CREATE INDEX IF NOT EXISTS idx_maps_campaign ON maps(campaign_id)']);

  rebuild('tokens', `CREATE TABLE tokens (
    id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    character_id TEXT REFERENCES characters(id) ON DELETE SET NULL, name TEXT NOT NULL,
    art_asset_id TEXT REFERENCES assets(id), q INTEGER NOT NULL, r INTEGER NOT NULL,
    layer TEXT NOT NULL CHECK (layer IN ('token', 'gm')), size INTEGER NOT NULL DEFAULT 1,
    shape TEXT NOT NULL DEFAULT 'circle', color TEXT NOT NULL DEFAULT '#6c9bd2',
    vision_json TEXT, bar_json TEXT, light_json TEXT)`,
    ['CREATE INDEX IF NOT EXISTS idx_tokens_map ON tokens(map_id)',
     'CREATE INDEX IF NOT EXISTS idx_tokens_character ON tokens(character_id)']);

  rebuild('handouts', `CREATE TABLE handouts (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', asset_id TEXT REFERENCES assets(id),
    shared_all INTEGER NOT NULL DEFAULT 0, parent_id TEXT, folder_id TEXT,
    created_at INTEGER NOT NULL)`,
    ['CREATE INDEX IF NOT EXISTS idx_handouts_campaign ON handouts(campaign_id)']);

  rebuild('audio_tracks', `CREATE TABLE audio_tracks (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`, []);

  db.pragma('legacy_alter_table = OFF');
  console.log('FK repair complete');
}
repairBrokenAssetFKs();

// Fix orphaned FK references that can cause "FOREIGN KEY constraint failed" on
// any UPDATE to the affected row.  Runs once per boot; harmless if no orphans.
db.exec(`UPDATE maps SET bg_asset_id = NULL WHERE bg_asset_id IS NOT NULL AND bg_asset_id NOT IN (SELECT id FROM assets)`);
db.exec(`UPDATE tokens SET art_asset_id = NULL WHERE art_asset_id IS NOT NULL AND art_asset_id NOT IN (SELECT id FROM assets)`);
db.exec(`UPDATE tokens SET character_id = NULL WHERE character_id IS NOT NULL AND character_id NOT IN (SELECT id FROM characters)`);

// Clamp oversized grids that can crash vision/rendering (max 200x200).
for (const row of db.prepare(`SELECT id, grid_json FROM maps`).all() as Array<{ id: string; grid_json: string }>) {
  try {
    const g = JSON.parse(row.grid_json);
    if (g.cols > 200 || g.rows > 200) {
      g.cols = Math.min(g.cols, 200);
      g.rows = Math.min(g.rows, 200);
      db.prepare(`UPDATE maps SET grid_json = ? WHERE id = ?`).run(JSON.stringify(g), row.id);
      console.log(`Clamped oversized grid on map ${row.id} to ${g.cols}x${g.rows}`);
    }
  } catch { /* malformed json handled by normalizeGrid at read time */ }
}

// Enable FK enforcement now that all migrations and repairs are complete.
db.pragma('foreign_keys = ON');

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
