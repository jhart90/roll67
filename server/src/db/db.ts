import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DB_PATH, ensureDataDirs } from '../config.js';
import { contentForSystem } from 'shared';

/** Every ammunition entry by name: what a round weighs now, and what the box
 *  it came in used to be written as. Built once, read by the repair below. */
const AMMO_BY_NAME = new Map(
  contentForSystem('swade')
    .filter((e) => e.category === 'Ammunition' && e.gear?.weight && e.gear.qty)
    .map((e) => [e.name, { perUnit: e.gear!.weight!, box: e.gear!.weight! * e.gear!.qty! }]),
);

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
function ensureColumn(table: string, column: string, ddl: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}
ensureColumn('campaign_members', 'map_id', 'map_id TEXT');
// What the "who is rolling" banner says while a roll's dice are in the air.
ensureColumn('chat_messages', 'callout_json', 'callout_json TEXT');
// The status badges over a token. Mirrored from the sheet like bar_json is,
// because what is wrong with a creature is public at a table — the players
// can SEE that the ogre is reeling — but sheets are not.
if (ensureColumn('tokens', 'conditions_json', 'conditions_json TEXT')) {
  // Backfill from the sheets so a campaign in progress does not have to wait
  // for each character's next save before its players can see who is Shaken.
  db.exec(`UPDATE tokens SET conditions_json = (
             SELECT json_extract(c.sheet_json, '$.conditions') FROM characters c WHERE c.id = tokens.character_id
           ) WHERE character_id IS NOT NULL`);
}
// SWADE: the GM's own Benny pool — one per player character each session,
// plus whatever the villains' Jokers pay in.
// Mounts. A token can only be ridden if the DM says so — nothing is mountable
// by default, or every crate and corpse on the map would be a horse.
ensureColumn('tokens', 'mountable', 'mountable INTEGER NOT NULL DEFAULT 0');
// …and this is the rider's link to the mount carrying them.
ensureColumn('tokens', 'mounted_on', 'mounted_on TEXT');
// How many riders a mount carries: one for a horse, a crew for a boat.
ensureColumn('tokens', 'max_riders', 'max_riders INTEGER NOT NULL DEFAULT 1');
// Who has the wheel. A boat with six aboard needs one of them to answer for
// its Parry and its control rolls, and the DM decides which — blank means the
// first one who climbed on.
ensureColumn('tokens', 'driver_token_id', 'driver_token_id TEXT');
ensureColumn('campaigns', 'gm_bennies', 'gm_bennies INTEGER NOT NULL DEFAULT 0');
// In-world elapsed seconds. Every time-based rule in SWADE — the Golden Hour,
// Power Points coming back, Natural Healing — is measured against this rather
// than against the wall clock, because a session is not a day.
ensureColumn('campaigns', 'clock_seconds', 'clock_seconds INTEGER NOT NULL DEFAULT 0');
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
ensureColumn('maps', 'terrain_json', "terrain_json TEXT NOT NULL DEFAULT '[]'");
// Ground no token may stand on — a chasm, lava, deep water.
ensureColumn('maps', 'blocked_json', "blocked_json TEXT NOT NULL DEFAULT '[]'");
ensureColumn('maps', 'texts_json', "texts_json TEXT NOT NULL DEFAULT '[]'");
ensureColumn('maps', 'is_scene', 'is_scene INTEGER NOT NULL DEFAULT 0');
ensureColumn('tokens', 'revealed_at', 'revealed_at INTEGER');
// Chests lock like doors: a flag plus the inventory item that opens them.
ensureColumn('map_objects', 'locked', 'locked INTEGER NOT NULL DEFAULT 0');
ensureColumn('map_objects', 'key_name', 'key_name TEXT');
// A container can BE a character: the token carries the chest / is the shop.
ensureColumn('map_objects', 'linked_character_id', 'linked_character_id TEXT');
ensureColumn('users', 'dice_color', 'dice_color TEXT');
ensureColumn('users', 'dice_text_color', 'dice_text_color TEXT');
// Chat shows "Character (Player)" for anything a character did.
ensureColumn('chat_messages', 'from_character', 'from_character TEXT');
// WHICH character, not just their name — two tokens can share one. The dice
// overlay reads a character's own dice colors off this.
ensureColumn('chat_messages', 'character_id', 'character_id TEXT');
ensureColumn('chat_messages', 'action_name', 'action_name TEXT');
ensureColumn('chat_messages', 'outcome_note', 'outcome_note TEXT');
// A sheet card posted into the log, rendered as the card rather than a sentence.
ensureColumn('chat_messages', 'card_json', 'card_json TEXT');
// The cast card a message belongs to, so hiding the card hides the whole
// resolution — every roll, every impact — rather than one line of it.
ensureColumn('chat_messages', 'thread_id', 'thread_id INTEGER');
// SWADE colors dice by their role in the roll rather than by die size, so it
// gets its own three-slot palette. Null in any slot falls back to the default.
ensureColumn('users', 'dice_trait_color', 'dice_trait_color TEXT');
ensureColumn('users', 'dice_wild_color', 'dice_wild_color TEXT');
ensureColumn('users', 'dice_raise_color', 'dice_raise_color TEXT');
ensureColumn('users', 'player_color', 'player_color TEXT');
// Share of this account's dice that carom off a wall (0-100); NULL = default.
ensureColumn('users', 'dice_bounce_pct', 'dice_bounce_pct INTEGER');
// How this account's aced dice celebrate; NULL = the default flash.
ensureColumn('users', 'dice_ace_style', 'dice_ace_style TEXT');
// Whether this player wants the combat turn guide over their map. Travels
// with presence so a DM standing in for them sees what THEY would see.
ensureColumn('users', 'turn_guide', 'turn_guide INTEGER');
// Per-account audio mix (0..1), so a player's levels follow them to any
// device instead of living only in one browser's localStorage.
ensureColumn('users', 'music_volume', 'music_volume REAL');
ensureColumn('users', 'sfx_volume', 'sfx_volume REAL');
// Per-player world knowledge: what a player has seen belongs to THAT player,
// not the party — a brand-new member starts with a blank map, not everything
// the veterans already scouted. Rebuilds world_discovery with a user_id
// column; each CURRENT player member inherits the party's accumulated
// knowledge so nothing vanishes for them, while future members start fresh.
// (No other table references world_discovery, so the rebuild is FK-safe.)
function migratePerPlayerDiscovery(): void {
  const cols = db.prepare(`PRAGMA table_info(world_discovery)`).all() as Array<{ name: string }>;
  if (cols.length === 0 || cols.some((c) => c.name === 'user_id')) return;
  db.exec(`
    CREATE TABLE world_discovery_v2 (
      campaign_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('map', 'token', 'character')),
      key TEXT NOT NULL,
      PRIMARY KEY (campaign_id, user_id, kind, key)
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO world_discovery_v2 (campaign_id, user_id, kind, key)
    SELECT d.campaign_id, m.user_id, d.kind, d.key
    FROM world_discovery d
    JOIN campaign_members m ON m.campaign_id = d.campaign_id AND m.role = 'player'
  `);
  db.exec('DROP TABLE world_discovery');
  db.exec('ALTER TABLE world_discovery_v2 RENAME TO world_discovery');
}
migratePerPlayerDiscovery();

// One-time data migrations that must run exactly once regardless of schema
// shape, tracked by name.
db.exec('CREATE TABLE IF NOT EXISTS meta_migrations (name TEXT PRIMARY KEY, ran_at INTEGER NOT NULL)');
function runOnce(name: string, fn: () => void): void {
  const done = db.prepare('SELECT 1 FROM meta_migrations WHERE name = ?').get(name);
  if (done) return;
  fn();
  db.prepare('INSERT INTO meta_migrations (name, ran_at) VALUES (?, ?)').run(name, Date.now());
}
// Shops and rollable tables created under the old players-visible-by-default
// rules go hidden; the DM opens each deliberately (the checkbox still works
// exactly as before).
runOnce('hide-legacy-shops-tables', () => {
  db.exec('UPDATE shops SET players_can_buy = 0');
  db.exec('UPDATE rollable_tables SET players_can_roll = 0');
});
// Player-run characters and SWADE Wild Cards now default to a 1.5-hex
// hexagon. Bring existing tokens up to it — but only ones still sitting at
// the old 1-hex circle default, so any size/shape the DM chose on purpose
// survives untouched.
runOnce('protagonist-token-look', () => {
  db.exec(`
    UPDATE tokens SET size = 1.5, shape = 'hexagon'
    WHERE size = 1 AND shape = 'circle' AND character_id IN (
      SELECT id FROM characters
      WHERE owner_user_id IS NOT NULL
         OR (system = 'swade' AND json_extract(sheet_json, '$.wildCard') = 1)
    )
  `);
});

// Chest-folder unification: folders can be placed on maps as chests
ensureColumn('world_folders', 'items_json', "items_json TEXT NOT NULL DEFAULT '[]'");
ensureColumn('world_folders', 'display_kind', "display_kind TEXT NOT NULL DEFAULT 'folder'");
ensureColumn('world_folders', 'art_asset_id', 'art_asset_id TEXT');
// Map objects: link to world folders / shops
ensureColumn('map_objects', 'world_folder_id', 'world_folder_id TEXT');
ensureColumn('map_objects', 'shop_id', 'shop_id TEXT');
ensureColumn('map_objects', 'interact_range', "interact_range INTEGER NOT NULL DEFAULT 1");
// Walking merchants: shop linked to a character
ensureColumn('shops', 'linked_character_id', 'linked_character_id TEXT');
ensureColumn('shops', 'art_asset_id', 'art_asset_id TEXT');

// map_objects CHECK constraint: add 'shop' kind (same pattern as migrateAssetsAudioKind).
function migrateMapObjectsShopKind(): void {
  const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'map_objects'`).get() as
    | { sql: string }
    | undefined;
  if (!table || table.sql.includes("'shop'")) return;
  const oldCols = (db.prepare(`PRAGMA table_info(map_objects)`).all() as Array<{ name: string }>).map((c) => c.name);
  const allCols = oldCols.join(', ');
  db.exec('ALTER TABLE map_objects RENAME TO map_objects_pre_shop');
  db.exec(`
    CREATE TABLE map_objects (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK (kind IN ('item', 'chest', 'shop')),
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      art_asset_id TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      world_folder_id TEXT,
      shop_id TEXT,
      interact_range INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`INSERT INTO map_objects (${allCols}) SELECT ${allCols} FROM map_objects_pre_shop`);
  db.exec('DROP TABLE map_objects_pre_shop');
  db.exec('CREATE INDEX IF NOT EXISTS idx_map_objects_map ON map_objects(map_id)');
}
migrateMapObjectsShopKind();

// campaigns/custom_npcs system CHECK constraints: add 'swade' via rename-
// rebuild-copy. CRITICAL: campaigns is FK-referenced by a dozen child tables
// (campaign_members, characters, maps, ...), and two separate SQLite
// behaviors will destroy them during a rename-rebuild:
//  - ALTER TABLE RENAME rewrites every child table's REFERENCES clause to
//    follow the rename (gated by legacy_alter_table, NOT by foreign_keys),
//    stranding them pointing at the dropped temp table; and
//  - better-sqlite3 opens connections with foreign_keys ON (the "deferred
//    until after migrations" note at the top of this file is not actually
//    true), so DROP TABLE runs an implicit DELETE FROM whose ON DELETE
//    CASCADE wipes every child row.
// Both pragmas must be flipped for the duration of the rebuild.
function migrateSystemSwade(table: string, createSql: string): void {
  const existing = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
    | { sql: string }
    | undefined;
  if (!existing || existing.sql.includes("'swade'")) return;
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name).join(', ');
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_pre_swade`);
    db.exec(createSql);
    db.exec(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM ${table}_pre_swade`);
    db.exec(`DROP TABLE ${table}_pre_swade`);
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}
migrateSystemSwade('campaigns', `
  CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    system TEXT NOT NULL CHECK (system IN ('dnd5e', 'swn', 'swade')),
    dm_user_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT UNIQUE NOT NULL,
    active_map_id TEXT,
    created_at INTEGER NOT NULL
  )
`);
migrateSystemSwade('custom_npcs', `
  CREATE TABLE custom_npcs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    system TEXT NOT NULL CHECK (system IN ('dnd5e', 'swn', 'swade')),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Player Added',
    challenge_label TEXT NOT NULL DEFAULT '',
    ac INTEGER NOT NULL DEFAULT 10,
    hp INTEGER NOT NULL DEFAULT 1,
    sheet_json TEXT NOT NULL DEFAULT '{}',
    color TEXT,
    art_asset_id TEXT,
    created_at INTEGER NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_custom_npcs_user ON custom_npcs(user_id)');

// Lifetime roll statistics: one aggregate row per (scope, key, result). The
// account view sums rows across characters; the character view groups them by
// the user who was rolling. Empty-string ids stand in for "none" so the
// primary key stays NOT NULL.
db.exec(`
  CREATE TABLE IF NOT EXISTS roll_stats (
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    character_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('die', 'expr')),
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, user_id, character_id, kind, key, value)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_roll_stats_character ON roll_stats(campaign_id, character_id)');

// World-tab knowledge: what the party has actually seen (vision-discovered
// tokens/characters/maps) and the DM's manual reveal/hide overrides.
db.exec(`
  CREATE TABLE IF NOT EXISTS world_discovery (
    campaign_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('map', 'token', 'character')),
    key TEXT NOT NULL,
    PRIMARY KEY (campaign_id, user_id, kind, key)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS world_override (
    campaign_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('map', 'token', 'character')),
    key TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('reveal', 'hide')),
    PRIMARY KEY (campaign_id, kind, key)
  )
`);

// DM counters: giant segmented bars pinned to the top/bottom of a map pane
// (doom clocks, ritual progress, castle HP). Hidden from players until shown.
db.exec(`
  CREATE TABLE IF NOT EXISTS counters (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    map_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Counter',
    color TEXT NOT NULL DEFAULT '#d92626',
    max INTEGER NOT NULL DEFAULT 3,
    value INTEGER NOT NULL DEFAULT 3,
    visible INTEGER NOT NULL DEFAULT 0,
    position TEXT NOT NULL DEFAULT 'top' CHECK (position IN ('top', 'bottom')),
    created_at INTEGER NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_counters_map ON counters(map_id)');

// counters CHECK constraint: add the 'left'/'right' side slots (same pattern
// as migrateMapObjectsShopKind). Safe as a plain rename-rebuild — counters
// declares no REFERENCES and no other table references it, so there are no FK
// clauses for ALTER TABLE RENAME to rewrite.
function migrateCounterSideSlots(): void {
  const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'counters'`).get() as
    | { sql: string }
    | undefined;
  if (!table || table.sql.includes("'left'")) return;
  const allCols = (db.prepare(`PRAGMA table_info(counters)`).all() as Array<{ name: string }>).map((c) => c.name).join(', ');
  db.exec('ALTER TABLE counters RENAME TO counters_pre_sides');
  db.exec(`
    CREATE TABLE counters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      map_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Counter',
      color TEXT NOT NULL DEFAULT '#d92626',
      max INTEGER NOT NULL DEFAULT 3,
      value INTEGER NOT NULL DEFAULT 3,
      visible INTEGER NOT NULL DEFAULT 0,
      position TEXT NOT NULL DEFAULT 'top' CHECK (position IN ('top', 'bottom', 'left', 'right')),
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`INSERT INTO counters (${allCols}) SELECT ${allCols} FROM counters_pre_sides`);
  db.exec('DROP TABLE counters_pre_sides');
  db.exec('CREATE INDEX IF NOT EXISTS idx_counters_map ON counters(map_id)');
}
migrateCounterSideSlots();

// Per-player counter sharing: a JSON array of user ids, or NULL for the whole
// table. Added AFTER the rebuild above on purpose — that migration copies the
// column list it finds and recreates the table from a fixed DDL, so a column
// added before it would be selected into a table that has no room for it.
// NULL is both "never set" and "everyone", which is what old counters want.
ensureColumn('counters', 'shared_with', 'shared_with TEXT');

// A briefing image shown to players above a chest's or a shop's contents —
// the handout half of "here is what you are looking at".
ensureColumn('map_objects', 'detail_asset_id', 'detail_asset_id TEXT');
// Jukebox playlists: which of the three tabs a track sits on.
ensureColumn('audio_tracks', 'playlist', 'playlist INTEGER NOT NULL DEFAULT 0');
ensureColumn('shops', 'detail_asset_id', 'detail_asset_id TEXT');

// Manual world-tree ordering: rank per "kind:id" key, campaign-scoped.
// Items without a rank sort after ranked ones, alphabetically.
db.exec(`
  CREATE TABLE IF NOT EXISTS world_sort (
    campaign_id TEXT NOT NULL,
    key TEXT NOT NULL,
    sort_order REAL NOT NULL,
    PRIMARY KEY (campaign_id, key)
  )
`);

// Per-player private notes on characters they do not control (public sheet).
// Keyed by viewer + character: each player sees only their own scribbles.
db.exec(`
  CREATE TABLE IF NOT EXISTS private_notes (
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, character_id)
  )
`);

// DM-only secret notes per character. Deliberately NOT a sheet field: owners
// receive their full sheets, so anything in there would leak to the player.
db.exec(`
  CREATE TABLE IF NOT EXISTS dm_notes (
    character_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT ''
  )
`);

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

/**
 * Ammunition already on a sheet, weighed by the box.
 *
 * The gear table prints "2 lbs / 50 rounds" and the compendium used to hand
 * that straight to the row — where weight means "one of these" and is
 * multiplied by how many are held. Forty rounds weighed eighty pounds. The
 * compendium now divides (see contentSwade), but rows written before it did
 * are still carrying a box each, so they are corrected here.
 *
 * Precise on purpose: only a row that still holds EXACTLY the old box weight
 * is touched. A weight somebody has since typed themselves is theirs.
 */
function repairAmmoRowWeights(): void {
  const rows = db.prepare("SELECT id, sheet_json FROM characters WHERE system = 'swade'").all() as
    Array<{ id: string; sheet_json: string }>;
  let fixed = 0;
  for (const row of rows) {
    let sheet: Record<string, unknown>;
    try { sheet = JSON.parse(row.sheet_json) as Record<string, unknown>; } catch { continue; }
    const inv = sheet.inventory;
    if (!Array.isArray(inv)) continue;
    let touched = false;
    for (const item of inv as Array<Record<string, unknown>>) {
      if (!item || typeof item.name !== 'string' || !item.caliber) continue;
      const entry = AMMO_BY_NAME.get(item.name);
      if (!entry) continue;
      const weight = Number(item.weight);
      // A hundredth of a pound of slack: the per-round figure is rounded for
      // a legible sheet, so the box it multiplies back up to is close rather
      // than identical to the number the table printed.
      if (!Number.isFinite(weight) || Math.abs(weight - entry.box) > 0.01) continue;
      item.weight = entry.perUnit;
      touched = true;
      fixed++;
    }
    if (touched) {
      db.prepare('UPDATE characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(sheet), row.id);
    }
  }
  if (fixed > 0) console.log(`Repaired ${fixed} ammunition row(s) weighed by the box instead of the round`);
}
try { repairAmmoRowWeights(); } catch (e) { console.error('ammo weight repair skipped', e); }

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
