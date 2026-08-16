import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOADS_DIR } from '../config.js';
import { db } from './db.js';

/**
 * A whole campaign, out and back in.
 *
 * The point is a file the DM can put somewhere safe and later hand back to a
 * server that has never seen this campaign — a new Railway volume, a laptop,
 * a rebuilt box — and get the table back exactly as it stood: every sheet,
 * every wall, every chest, every image, the chat log, the initiative order,
 * the clock. Not a summary of the campaign. The campaign.
 *
 * Two decisions shape everything here.
 *
 * FIRST: rows are copied COLUMN-BLIND. Nothing in this file lists the columns
 * of anything — it reads `SELECT *` and writes back whatever columns the
 * target server also has. The schema grows by a column every week or so (see
 * the ensureColumn wall in db.ts), and a backup that enumerated columns would
 * be silently dropping the newest feature within a fortnight. What it does
 * know is which tables belong to a campaign and how each one is attached to
 * it, which changes far more slowly. A column the target doesn't have is
 * reported, not swallowed.
 *
 * SECOND: ids are PRESERVED, not remade. A campaign is a dense web of ids —
 * a token names a character, a chest names a shop, a sheet's key row names a
 * chest, a chat message names the roll it can undo — and half of those live
 * inside JSON blobs where no rewriting pass could reliably find them. So a
 * restore is a restore: the same ids, or nothing. That is why bringing one
 * back on top of a campaign that still exists has to say `replace` out loud.
 */

export const BACKUP_FORMAT = 1;
export const BACKUP_KIND = 'roll67.campaign';

/** How a table hangs off a campaign. */
type Scope =
  /** The `campaigns` row itself. */
  | 'self'
  /** Has a campaign_id column. */
  | 'campaign'
  /** Belongs to a map, which belongs to the campaign. */
  | 'map'
  /** Belongs to a handout, which belongs to the campaign. */
  | 'handout'
  /** The DM's own cross-campaign library, carried so a restore onto a fresh
   *  server doesn't arrive with an empty NPC shelf. */
  | 'dmLibrary';

/**
 * What to do with a user id that names nobody on the restoring server.
 *
 * This is the one thing a restore genuinely cannot reproduce: accounts. A
 * backup deliberately carries usernames and NOT password hashes — a file the
 * DM downloads should not be a credential store — so players re-register and
 * rejoin with the invite code, which the backup does preserve.
 *
 * 'drop'  the row is personal to that account and means nothing without it
 *         (their fog memory, their macros, their private notes)
 * 'null'  the column is optional and the row survives without it
 * 'dm'    the row must belong to somebody, and the restoring DM is the only
 *         person we know is there
 */
type MissingUser = 'drop' | 'null' | 'dm';

interface TableSpec {
  table: string;
  scope: Scope;
  /** Columns holding a user id. */
  users?: Array<[column: string, missing: MissingUser]>;
}

/**
 * Every table a campaign owns.
 *
 * Deliberately exhaustive rather than clever: `users`, `sessions`, `meta` and
 * the iron-dice ledger are server-wide and stay behind, and everything else in
 * the database is here. If a new table is added and not listed, it is not
 * backed up — so the guard test walks the live schema and fails on anything
 * unaccounted for, which is a better alarm than anyone's memory.
 */
const SPECS: TableSpec[] = [
  { table: 'campaigns', scope: 'self', users: [['dm_user_id', 'dm']] },
  { table: 'campaign_members', scope: 'campaign', users: [['user_id', 'drop']] },
  { table: 'asset_folders', scope: 'campaign' },
  { table: 'assets', scope: 'campaign', users: [['uploader_id', 'dm']] },
  { table: 'characters', scope: 'campaign', users: [['owner_user_id', 'null']] },
  { table: 'maps', scope: 'campaign' },
  { table: 'tokens', scope: 'map' },
  { table: 'map_objects', scope: 'map' },
  { table: 'drawings', scope: 'map', users: [['author_id', 'dm']] },
  { table: 'fog_explored', scope: 'map', users: [['user_id', 'drop']] },
  { table: 'door_memory', scope: 'map', users: [['user_id', 'drop']] },
  { table: 'handouts', scope: 'campaign' },
  { table: 'handout_shares', scope: 'handout', users: [['user_id', 'drop']] },
  { table: 'macros', scope: 'campaign', users: [['user_id', 'drop']] },
  { table: 'chat_messages', scope: 'campaign', users: [['user_id', 'null']] },
  { table: 'initiative', scope: 'campaign' },
  { table: 'audio_tracks', scope: 'campaign' },
  { table: 'soundboard_slots', scope: 'campaign' },
  { table: 'shops', scope: 'campaign' },
  { table: 'locations', scope: 'campaign' },
  { table: 'world_folders', scope: 'campaign' },
  { table: 'world_sort', scope: 'campaign' },
  { table: 'world_override', scope: 'campaign' },
  { table: 'world_discovery', scope: 'campaign', users: [['user_id', 'drop']] },
  { table: 'rollable_tables', scope: 'campaign' },
  { table: 'custom_items', scope: 'campaign' },
  { table: 'counters', scope: 'campaign' },
  { table: 'dm_notes', scope: 'campaign' },
  { table: 'private_notes', scope: 'campaign', users: [['user_id', 'drop']] },
  { table: 'roll_stats', scope: 'campaign', users: [['user_id', 'drop']] },
  { table: 'custom_npcs', scope: 'dmLibrary', users: [['user_id', 'dm']] },
];

/** Tables that exist but belong to the server, not to any campaign. */
export const SERVER_TABLES = new Set([
  'users', 'sessions', 'password_resets', 'meta', 'meta_migrations', 'sqlite_sequence',
  'iron_dice_seeds', 'iron_dice_state',
  // A pre-migration husk kept around by migrateAssetsAudioKind.
  'assets_pre_audio_migration',
]);

/** Every table this server actually has, for the coverage guard. */
export function liveTableNames(): string[] {
  return (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).all() as Array<{ name: string }>).map((r) => r.name);
}

export function backedUpTableNames(): string[] {
  return SPECS.map((s) => s.table);
}

type Row = Record<string, unknown>;

/** A BLOB, wrapped so it survives the round trip through JSON. */
interface B64 { $b64: string }
const isB64 = (v: unknown): v is B64 =>
  !!v && typeof v === 'object' && typeof (v as B64).$b64 === 'string';

function encodeValue(v: unknown): unknown {
  return Buffer.isBuffer(v) ? { $b64: v.toString('base64') } : v;
}
function decodeValue(v: unknown): unknown {
  return isB64(v) ? Buffer.from(v.$b64, 'base64') : v;
}

export interface CampaignBackup {
  formatVersion: number;
  kind: typeof BACKUP_KIND;
  exportedAt: number;
  campaign: { id: string; name: string; system: string };
  /** Everyone the rows below refer to, by name — see MissingUser. */
  users: Array<{ id: string; username: string }>;
  tables: Record<string, Row[]>;
  /** Uploaded files, in the order they follow the manifest in the file. */
  files: Array<{ name: string; bytes: number }>;
  /** Tables this server knew about when the backup was taken, so a restore
   *  can tell "you have nothing of that" from "that didn't exist yet". */
  tablesPresent: string[];
  /**
   * Tables this server has that the backup does not know how to carry.
   *
   * Recorded IN THE FILE rather than only asserted in a test, because the way
   * this breaks is silent: somebody adds a table, forgets to list it here, and
   * nobody finds out until a restore comes back missing something a year
   * later. A backup that is knowingly incomplete says so on its face.
   */
  unaccountedTables: string[];
}

/** Tables in this database that no spec claims and that aren't server-wide. */
export function unaccountedTables(): string[] {
  const claimed = new Set([...backedUpTableNames(), ...SERVER_TABLES]);
  return liveTableNames().filter((t) => !claimed.has(t)).sort();
}

function whereFor(scope: Scope): string {
  switch (scope) {
    case 'self': return 'WHERE id = ?';
    case 'campaign': return 'WHERE campaign_id = ?';
    case 'map': return 'WHERE map_id IN (SELECT id FROM maps WHERE campaign_id = ?)';
    case 'handout': return 'WHERE handout_id IN (SELECT id FROM handouts WHERE campaign_id = ?)';
    case 'dmLibrary': return 'WHERE user_id = (SELECT dm_user_id FROM campaigns WHERE id = ?)';
  }
}

const tableExists = (name: string): boolean =>
  !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

const columnsOf = (name: string): string[] =>
  (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((c) => c.name);

/**
 * Read a campaign out of the database.
 *
 * Returns the manifest and the list of files that have to travel with it —
 * the caller streams those, because holding a campaign's worth of map art in
 * memory to build one JSON string is how an export of a real campaign falls
 * over.
 */
export function collectCampaign(campaignId: string): { manifest: CampaignBackup; files: string[] } {
  const campaign = db.prepare('SELECT id, name, system FROM campaigns WHERE id = ?').get(campaignId) as
    | { id: string; name: string; system: string } | undefined;
  if (!campaign) throw new Error('No such campaign.');

  const tables: Record<string, Row[]> = {};
  const userIds = new Set<string>();
  for (const spec of SPECS) {
    if (!tableExists(spec.table)) continue;
    const rows = db.prepare(`SELECT * FROM ${spec.table} ${whereFor(spec.scope)}`).all(campaignId) as Row[];
    tables[spec.table] = rows.map((r) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(r)) out[k] = encodeValue(v);
      return out;
    });
    for (const [col] of spec.users ?? []) {
      for (const r of rows) if (typeof r[col] === 'string' && r[col]) userIds.add(r[col] as string);
    }
  }

  // Names, not hashes. See MissingUser.
  const users: CampaignBackup['users'] = [];
  for (const id of userIds) {
    const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id) as
      | { id: string; username: string } | undefined;
    if (u) users.push(u);
  }

  // Every uploaded file this campaign's assets point at. A row whose file has
  // gone missing is not an error worth failing the whole backup over — the
  // rest of the campaign is still worth rescuing — so it is simply not listed.
  const files: string[] = [];
  const fileEntries: CampaignBackup['files'] = [];
  for (const a of (tables.assets ?? []) as Array<{ id?: unknown; ext?: unknown }>) {
    if (typeof a.id !== 'string' || typeof a.ext !== 'string') continue;
    const name = `${a.id}.${a.ext}`;
    const full = path.join(UPLOADS_DIR, name);
    if (!fs.existsSync(full)) continue;
    files.push(full);
    fileEntries.push({ name, bytes: fs.statSync(full).size });
  }

  return {
    manifest: {
      formatVersion: BACKUP_FORMAT,
      kind: BACKUP_KIND,
      exportedAt: Date.now(),
      campaign,
      users,
      tables,
      files: fileEntries,
      tablesPresent: liveTableNames(),
      unaccountedTables: unaccountedTables(),
    },
    files,
  };
}

export interface RestoreReport {
  campaignId: string;
  name: string;
  replaced: boolean;
  /** Rows written, per table. */
  rows: Record<string, number>;
  files: number;
  /** Human-readable notes about anything that could not come back exactly. */
  notes: string[];
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function freshInviteCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM campaigns WHERE invite_code = ?').get(code)) return code;
  }
}

/** Wipe every row this campaign owns, so a replace leaves nothing behind. */
function deleteCampaignRows(campaignId: string): void {
  // Children before parents: FK enforcement is deferred inside the
  // transaction, but the map/handout-scoped subqueries need their parents
  // still standing to find their own rows.
  for (const spec of [...SPECS].reverse()) {
    if (!tableExists(spec.table)) continue;
    if (spec.scope === 'dmLibrary') continue;   // the DM's shelf is not the campaign's to erase
    db.prepare(`DELETE FROM ${spec.table} ${whereFor(spec.scope)}`).run(campaignId);
  }
}

/**
 * Put a campaign back.
 *
 * `dmUserId` becomes its DM whoever held it before: the person restoring the
 * file is the person who has it, and a campaign whose DM is an account that
 * doesn't exist here would be a campaign nobody could open.
 */
export function restoreCampaign(
  manifest: CampaignBackup, dmUserId: string, opts: { replace: boolean },
): RestoreReport {
  if (manifest?.kind !== BACKUP_KIND) throw new Error('That is not a Roll67 campaign backup.');
  if (!(manifest.formatVersion <= BACKUP_FORMAT)) {
    throw new Error(`That backup is version ${manifest.formatVersion}; this server reads up to ${BACKUP_FORMAT}.`);
  }
  const campaignId = manifest.campaign?.id;
  if (!campaignId) throw new Error('That backup names no campaign.');

  const existing = db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get(campaignId) as
    | { id: string; name: string } | undefined;
  if (existing && !opts.replace) {
    throw new Error(
      `"${existing.name}" is already on this server. A restore puts back the same ids, so it can only go on top `
      + 'of the campaign it came from — tick "replace" to overwrite it.',
    );
  }
  if (existing) {
    const role = db.prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, dmUserId) as { role?: string } | undefined;
    if (role?.role !== 'dm') throw new Error('Only that campaign’s DM can overwrite it.');
  }

  const notes: string[] = [];

  // Match the people up by name. Everyone else is dealt with per column.
  const userMap = new Map<string, string>();
  const unmatched: string[] = [];
  for (const u of manifest.users ?? []) {
    const local = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(u.username) as
      | { id: string } | undefined;
    if (local) userMap.set(u.id, local.id);
    else unmatched.push(u.username);
  }
  // Whoever ran the table before, the person holding the file runs it now.
  const originalDm = (manifest.tables?.campaigns?.[0]?.dm_user_id ?? null) as string | null;
  if (originalDm) userMap.set(originalDm, dmUserId);

  const rowCounts: Record<string, number> = {};
  const missingTables: string[] = [];
  const droppedColumns = new Set<string>();
  let droppedRows = 0;

  const run = db.transaction(() => {
    // Order-independent inserts: everything is checked at COMMIT instead of
    // row by row, so a token may land before the character it names.
    db.pragma('defer_foreign_keys = ON');
    if (existing) deleteCampaignRows(campaignId);

    for (const spec of SPECS) {
      const rows = manifest.tables?.[spec.table];
      if (!rows || rows.length === 0) continue;
      if (!tableExists(spec.table)) { missingTables.push(spec.table); continue; }
      const localCols = new Set(columnsOf(spec.table));
      let written = 0;

      for (const raw of rows) {
        const row: Row = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!localCols.has(k)) { droppedColumns.add(`${spec.table}.${k}`); continue; }
          row[k] = decodeValue(v);
        }

        // People.
        let skip = false;
        for (const [col, missing] of spec.users ?? []) {
          if (!(col in row)) continue;
          const original = row[col];
          if (typeof original !== 'string' || !original) continue;
          const mapped = userMap.get(original);
          if (mapped) { row[col] = mapped; continue; }
          if (missing === 'drop') { skip = true; break; }
          row[col] = missing === 'dm' ? dmUserId : null;
        }
        if (skip) { droppedRows++; continue; }

        // The campaign row itself needs its DM and a code nobody else holds.
        if (spec.scope === 'self') {
          row.dm_user_id = dmUserId;
          const clash = db.prepare('SELECT id FROM campaigns WHERE invite_code = ? AND id != ?')
            .get(row.invite_code as string, campaignId) as { id: string } | undefined;
          if (clash || typeof row.invite_code !== 'string' || !row.invite_code) {
            row.invite_code = freshInviteCode();
            notes.push(`The invite code was already in use here, so this campaign has a new one: ${row.invite_code}.`);
          }
        }

        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        db.prepare(
          `INSERT OR REPLACE INTO ${spec.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        ).run(...cols.map((c) => row[c] as never));
        written++;
      }
      rowCounts[spec.table] = written;
    }

    // The restoring DM must be able to open what they just restored, even if
    // the backup's member list had nothing to say about this account.
    db.prepare(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, 'dm')
       ON CONFLICT(campaign_id, user_id) DO UPDATE SET role = 'dm'`,
    ).run(campaignId, dmUserId);
  });
  run();

  if (unmatched.length) {
    notes.push(
      `No account here for ${unmatched.join(', ')} — their characters came back unowned. `
      + 'Once they register and join with the invite code, hand each character back from its sheet.',
    );
  }
  if (droppedRows) notes.push(`${droppedRows} personal rows (fog memory, macros, private notes) belonged to accounts this server doesn’t have.`);
  if (missingTables.length) notes.push(`This server has no ${missingTables.join(', ')} table — that data is in the file but could not be placed.`);
  if (droppedColumns.size) notes.push(`Columns this server doesn’t have yet: ${[...droppedColumns].join(', ')}.`);

  return {
    campaignId,
    name: manifest.campaign.name,
    replaced: !!existing,
    rows: rowCounts,
    files: 0,     // filled in by the caller, which is what actually wrote them
    notes,
  };
}

/**
 * The upload filenames this campaign's assets currently point at.
 *
 * Read BEFORE a replace, so the caller can tell which images the outgoing copy
 * owned and the incoming one does not — those are the files a replace should
 * clear up rather than leave lying in the volume forever.
 */
export function campaignAssetFiles(campaignId: string): string[] {
  return (db.prepare('SELECT id, ext FROM assets WHERE campaign_id = ?').all(campaignId) as
    Array<{ id: string; ext: string }>).map((r) => `${r.id}.${r.ext}`);
}
