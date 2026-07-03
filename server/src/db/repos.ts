import type {
  CampaignInfo, Character, ChatKind, ChatMessage, Door, Drawing, GameSystem,
  GridConfig, Handout, InitiativeState, Light, Macro, MapDef, MapMeta,
  RollableTable, RollBreakdown, Role, Token, Wall,
} from 'shared';
import { db, newId, now } from './db.js';

// ---------- users & sessions ----------

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

export const users = {
  create(username: string, passwordHash: string): UserRow {
    const id = newId();
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, username, passwordHash, now());
    return { id, username, password_hash: passwordHash };
  },
  byUsername(username: string): UserRow | undefined {
    return db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as UserRow | undefined;
  },
  byId(id: string): UserRow | undefined {
    return db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
};

export const sessions = {
  create(userId: string, ttlMs: number): string {
    const token = newId() + newId();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now(), now() + ttlMs);
    return token;
  },
  resolve(token: string): UserRow | undefined {
    const row = db.prepare(
      `SELECT u.id, u.username, u.password_hash FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    ).get(token, now()) as UserRow | undefined;
    return row;
  },
  delete(token: string): void {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },
};

// ---------- campaigns ----------

interface CampaignRow {
  id: string;
  name: string;
  system: GameSystem;
  dm_user_id: string;
  invite_code: string;
  active_map_id: string | null;
}

function toCampaignInfo(row: CampaignRow): CampaignInfo {
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    dmUserId: row.dm_user_id,
    inviteCode: row.invite_code,
    activeMapId: row.active_map_id,
  };
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  return code;
}

export const campaigns = {
  create(name: string, system: GameSystem, dmUserId: string): CampaignInfo {
    const id = newId();
    let inviteCode = makeInviteCode();
    while (db.prepare('SELECT 1 FROM campaigns WHERE invite_code = ?').get(inviteCode)) {
      inviteCode = makeInviteCode();
    }
    db.prepare(
      'INSERT INTO campaigns (id, name, system, dm_user_id, invite_code, active_map_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    ).run(id, name, system, dmUserId, inviteCode, now());
    db.prepare('INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, ?)')
      .run(id, dmUserId, 'dm');
    return toCampaignInfo({ id, name, system, dm_user_id: dmUserId, invite_code: inviteCode, active_map_id: null });
  },
  byId(id: string): CampaignInfo | undefined {
    const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
    return row ? toCampaignInfo(row) : undefined;
  },
  byInviteCode(code: string): CampaignInfo | undefined {
    const row = db.prepare('SELECT * FROM campaigns WHERE invite_code = ?').get(code.toUpperCase()) as CampaignRow | undefined;
    return row ? toCampaignInfo(row) : undefined;
  },
  forUser(userId: string): Array<CampaignInfo & { role: Role }> {
    const rows = db.prepare(
      `SELECT c.*, m.role FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id
       WHERE m.user_id = ? ORDER BY c.created_at`,
    ).all(userId) as Array<CampaignRow & { role: Role }>;
    return rows.map((r) => ({ ...toCampaignInfo(r), role: r.role }));
  },
  addMember(campaignId: string, userId: string, role: Role): void {
    db.prepare('INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, ?)')
      .run(campaignId, userId, role);
  },
  memberRole(campaignId: string, userId: string): Role | undefined {
    const row = db.prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, userId) as { role: Role } | undefined;
    return row?.role;
  },
  members(campaignId: string): Array<{ userId: string; username: string; role: Role; mapId: string | null }> {
    return (db.prepare(
      `SELECT m.user_id as userId, u.username, m.role, m.map_id as mapId FROM campaign_members m
       JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ?`,
    ).all(campaignId) as Array<{ userId: string; username: string; role: Role; mapId: string | null }>);
  },
  setActiveMap(campaignId: string, mapId: string | null): void {
    db.prepare('UPDATE campaigns SET active_map_id = ? WHERE id = ?').run(mapId, campaignId);
  },
  /** Set (or clear) a member's personal map override. */
  setMemberMap(campaignId: string, userId: string, mapId: string | null): void {
    db.prepare('UPDATE campaign_members SET map_id = ? WHERE campaign_id = ? AND user_id = ?')
      .run(mapId, campaignId, userId);
  },
  /** Clear every member override pointing at a (deleted) map. */
  clearMapAssignments(mapId: string): void {
    db.prepare('UPDATE campaign_members SET map_id = NULL WHERE map_id = ?').run(mapId);
  },
  /**
   * The map a member is currently viewing: their personal override if it
   * still exists, else the campaign's active (party) map.
   */
  viewMapIdFor(campaignId: string, userId: string): string | null {
    const row = db.prepare(
      `SELECT m.map_id as mapId, c.active_map_id as activeMapId
       FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
       WHERE m.campaign_id = ? AND m.user_id = ?`,
    ).get(campaignId, userId) as { mapId: string | null; activeMapId: string | null } | undefined;
    if (!row) return null;
    if (row.mapId) {
      const exists = db.prepare('SELECT 1 FROM maps WHERE id = ?').get(row.mapId);
      if (exists) return row.mapId;
    }
    return row.activeMapId;
  },
};

// ---------- assets ----------

export interface AssetRow {
  id: string;
  campaign_id: string;
  kind: string;
  filename: string;
  ext: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
}

export const assets = {
  create(a: Omit<AssetRow, 'id'> & { uploaderId: string }): AssetRow {
    const id = newId();
    db.prepare(
      `INSERT INTO assets (id, campaign_id, uploader_id, kind, filename, ext, mime, bytes, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, a.campaign_id, a.uploaderId, a.kind, a.filename, a.ext, a.mime, a.bytes, a.width, a.height, now());
    return { id, ...a };
  },
  byId(id: string): AssetRow | undefined {
    return db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  },
  urlFor(id: string | null): string | null {
    if (!id) return null;
    const row = assets.byId(id);
    return row ? `/uploads/${row.id}.${row.ext}` : null;
  },
};

// ---------- characters ----------

interface CharacterRow {
  id: string;
  campaign_id: string;
  owner_user_id: string | null;
  name: string;
  system: GameSystem;
  sheet_json: string;
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    system: row.system,
    sheet: JSON.parse(row.sheet_json),
  };
}

export const characters = {
  create(campaignId: string, ownerUserId: string | null, name: string, system: GameSystem, sheet: object): Character {
    const id = newId();
    db.prepare(
      `INSERT INTO characters (id, campaign_id, owner_user_id, name, system, sheet_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, campaignId, ownerUserId, name, system, JSON.stringify(sheet), now(), now());
    return toCharacter({ id, campaign_id: campaignId, owner_user_id: ownerUserId, name, system, sheet_json: JSON.stringify(sheet) });
  },
  byId(id: string): Character | undefined {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as CharacterRow | undefined;
    return row ? toCharacter(row) : undefined;
  },
  forCampaign(campaignId: string): Character[] {
    const rows = db.prepare('SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at').all(campaignId) as CharacterRow[];
    return rows.map(toCharacter);
  },
  update(id: string, name: string | undefined, sheet: object): void {
    if (name !== undefined) {
      db.prepare('UPDATE characters SET name = ?, sheet_json = ?, updated_at = ? WHERE id = ?')
        .run(name, JSON.stringify(sheet), now(), id);
    } else {
      db.prepare('UPDATE characters SET sheet_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(sheet), now(), id);
    }
  },
  delete(id: string): void {
    db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  },
};

// ---------- maps ----------

interface MapRow {
  id: string;
  campaign_id: string;
  name: string;
  bg_asset_id: string | null;
  grid_json: string;
  walls_json: string;
  doors_json: string;
  lights_json: string;
  sort_order: number;
}

export const DEFAULT_GRID: GridConfig = {
  hexSize: 40,
  originX: 0,
  originY: 0,
  cols: 40,
  rows: 30,
  globalIllumination: true,
  feetPerHex: 5,
};

function toMapDef(row: MapRow): MapDef & { campaignId: string; bgAssetId: string | null } {
  const bg = row.bg_asset_id ? assets.byId(row.bg_asset_id) : undefined;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    sortOrder: row.sort_order,
    bgAssetId: row.bg_asset_id,
    bgUrl: bg ? `/uploads/${bg.id}.${bg.ext}` : null,
    bgWidth: bg?.width ?? 0,
    bgHeight: bg?.height ?? 0,
    grid: JSON.parse(row.grid_json),
    walls: JSON.parse(row.walls_json),
    doors: JSON.parse(row.doors_json),
    lights: JSON.parse(row.lights_json),
  };
}

export const maps = {
  create(campaignId: string, name: string): MapDef & { campaignId: string; bgAssetId: string | null } {
    const id = newId();
    const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM maps WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    db.prepare(
      'INSERT INTO maps (id, campaign_id, name, bg_asset_id, grid_json, sort_order) VALUES (?, ?, ?, NULL, ?, ?)',
    ).run(id, campaignId, name, JSON.stringify(DEFAULT_GRID), maxOrder + 1);
    return maps.byId(id)!;
  },
  byId(id: string): (MapDef & { campaignId: string; bgAssetId: string | null }) | undefined {
    const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id) as MapRow | undefined;
    return row ? toMapDef(row) : undefined;
  },
  forCampaign(campaignId: string): MapMeta[] {
    const rows = db.prepare('SELECT id, name, sort_order FROM maps WHERE campaign_id = ? ORDER BY sort_order').all(campaignId) as Array<{ id: string; name: string; sort_order: number }>;
    return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order }));
  },
  update(id: string, fields: { name?: string; bgAssetId?: string | null }): void {
    if (fields.name !== undefined) db.prepare('UPDATE maps SET name = ? WHERE id = ?').run(fields.name, id);
    if (fields.bgAssetId !== undefined) db.prepare('UPDATE maps SET bg_asset_id = ? WHERE id = ?').run(fields.bgAssetId, id);
  },
  setGrid(id: string, grid: GridConfig): void {
    db.prepare('UPDATE maps SET grid_json = ? WHERE id = ?').run(JSON.stringify(grid), id);
  },
  setWalls(id: string, walls: Wall[]): void {
    db.prepare('UPDATE maps SET walls_json = ? WHERE id = ?').run(JSON.stringify(walls), id);
  },
  setDoors(id: string, doors: Door[]): void {
    db.prepare('UPDATE maps SET doors_json = ? WHERE id = ?').run(JSON.stringify(doors), id);
  },
  setLights(id: string, lights: Light[]): void {
    db.prepare('UPDATE maps SET lights_json = ? WHERE id = ?').run(JSON.stringify(lights), id);
  },
  delete(id: string): void {
    db.prepare('DELETE FROM maps WHERE id = ?').run(id);
  },
};

// ---------- tokens ----------

interface TokenRow {
  id: string;
  map_id: string;
  character_id: string | null;
  name: string;
  art_asset_id: string | null;
  q: number;
  r: number;
  layer: 'token' | 'gm';
  size: number;
  color: string;
  vision_json: string | null;
  bar_json: string | null;
}

function toToken(row: TokenRow): Token {
  return {
    id: row.id,
    mapId: row.map_id,
    characterId: row.character_id,
    name: row.name,
    artUrl: assets.urlFor(row.art_asset_id),
    q: row.q,
    r: row.r,
    layer: row.layer,
    size: row.size,
    color: row.color,
    vision: row.vision_json ? JSON.parse(row.vision_json) : null,
    bar: row.bar_json ? JSON.parse(row.bar_json) : null,
  };
}

export const tokens = {
  create(t: {
    mapId: string; characterId: string | null; name: string; artAssetId: string | null;
    q: number; r: number; layer: 'token' | 'gm'; size: number; color: string;
    vision: object | null; bar: object | null;
  }): Token {
    const id = newId();
    db.prepare(
      `INSERT INTO tokens (id, map_id, character_id, name, art_asset_id, q, r, layer, size, color, vision_json, bar_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, t.mapId, t.characterId, t.name, t.artAssetId, t.q, t.r, t.layer, t.size, t.color,
      t.vision ? JSON.stringify(t.vision) : null, t.bar ? JSON.stringify(t.bar) : null,
    );
    return tokens.byId(id)!;
  },
  byId(id: string): Token | undefined {
    const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined;
    return row ? toToken(row) : undefined;
  },
  forMap(mapId: string): Token[] {
    const rows = db.prepare('SELECT * FROM tokens WHERE map_id = ?').all(mapId) as TokenRow[];
    return rows.map(toToken);
  },
  forCharacter(characterId: string): Token[] {
    const rows = db.prepare('SELECT * FROM tokens WHERE character_id = ?').all(characterId) as TokenRow[];
    return rows.map(toToken);
  },
  move(id: string, q: number, r: number): void {
    db.prepare('UPDATE tokens SET q = ?, r = ? WHERE id = ?').run(q, r, id);
  },
  update(id: string, patch: {
    name?: string; layer?: 'token' | 'gm'; size?: number; color?: string;
    characterId?: string | null; artAssetId?: string | null;
    vision?: object | null; bar?: object | null;
  }): void {
    const cur = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined;
    if (!cur) return;
    db.prepare(
      `UPDATE tokens SET name = ?, layer = ?, size = ?, color = ?, character_id = ?, art_asset_id = ?, vision_json = ?, bar_json = ?
       WHERE id = ?`,
    ).run(
      patch.name ?? cur.name,
      patch.layer ?? cur.layer,
      patch.size ?? cur.size,
      patch.color ?? cur.color,
      patch.characterId !== undefined ? patch.characterId : cur.character_id,
      patch.artAssetId !== undefined ? patch.artAssetId : cur.art_asset_id,
      patch.vision !== undefined ? (patch.vision ? JSON.stringify(patch.vision) : null) : cur.vision_json,
      patch.bar !== undefined ? (patch.bar ? JSON.stringify(patch.bar) : null) : cur.bar_json,
      id,
    );
  },
  delete(id: string): void {
    db.prepare('DELETE FROM tokens WHERE id = ?').run(id);
  },
};

// ---------- fog ----------

export const fog = {
  get(userId: string, mapId: string): Int32Array {
    const row = db.prepare('SELECT hexes FROM fog_explored WHERE user_id = ? AND map_id = ?')
      .get(userId, mapId) as { hexes: Buffer } | undefined;
    if (!row) return new Int32Array(0);
    return new Int32Array(row.hexes.buffer, row.hexes.byteOffset, row.hexes.byteLength / 4);
  },
  set(userId: string, mapId: string, hexes: Int32Array): void {
    // The map (or user) may have been deleted between compute and flush;
    // losing fog memory for a deleted map is correct, crashing is not.
    if (!db.prepare('SELECT 1 FROM maps WHERE id = ?').get(mapId)) return;
    const buf = Buffer.from(hexes.buffer, hexes.byteOffset, hexes.byteLength);
    try {
      db.prepare(
        `INSERT INTO fog_explored (user_id, map_id, hexes) VALUES (?, ?, ?)
         ON CONFLICT(user_id, map_id) DO UPDATE SET hexes = excluded.hexes`,
      ).run(userId, mapId, buf);
    } catch (err) {
      console.warn('fog flush skipped:', err instanceof Error ? err.message : err);
    }
  },
  clearMap(mapId: string): void {
    db.prepare('DELETE FROM fog_explored WHERE map_id = ?').run(mapId);
  },
};

// ---------- handouts ----------

interface HandoutRow {
  id: string;
  campaign_id: string;
  title: string;
  body_md: string;
  asset_id: string | null;
  shared_all: number;
}

function toHandout(row: HandoutRow): Handout {
  const shares = db.prepare('SELECT user_id FROM handout_shares WHERE handout_id = ?').all(row.id) as Array<{ user_id: string }>;
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.body_md,
    imageUrl: assets.urlFor(row.asset_id),
    sharedAll: !!row.shared_all,
    sharedWith: shares.map((s) => s.user_id),
  };
}

export const handouts = {
  create(campaignId: string, title: string, bodyMd: string, assetId: string | null): Handout {
    const id = newId();
    db.prepare('INSERT INTO handouts (id, campaign_id, title, body_md, asset_id, shared_all, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(id, campaignId, title, bodyMd, assetId, now());
    return handouts.byId(id)!;
  },
  byId(id: string): Handout | undefined {
    const row = db.prepare('SELECT * FROM handouts WHERE id = ?').get(id) as HandoutRow | undefined;
    return row ? toHandout(row) : undefined;
  },
  forCampaign(campaignId: string): Handout[] {
    const rows = db.prepare('SELECT * FROM handouts WHERE campaign_id = ? ORDER BY created_at').all(campaignId) as HandoutRow[];
    return rows.map(toHandout);
  },
  update(id: string, fields: { title?: string; bodyMd?: string; assetId?: string | null }): void {
    const cur = db.prepare('SELECT * FROM handouts WHERE id = ?').get(id) as HandoutRow | undefined;
    if (!cur) return;
    db.prepare('UPDATE handouts SET title = ?, body_md = ?, asset_id = ? WHERE id = ?').run(
      fields.title ?? cur.title,
      fields.bodyMd ?? cur.body_md,
      fields.assetId !== undefined ? fields.assetId : cur.asset_id,
      id,
    );
  },
  share(id: string, to: string[] | 'all' | 'none'): void {
    db.prepare('DELETE FROM handout_shares WHERE handout_id = ?').run(id);
    if (to === 'all') {
      db.prepare('UPDATE handouts SET shared_all = 1 WHERE id = ?').run(id);
    } else if (to === 'none') {
      db.prepare('UPDATE handouts SET shared_all = 0 WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE handouts SET shared_all = 0 WHERE id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO handout_shares (handout_id, user_id) VALUES (?, ?)');
      for (const userId of to) ins.run(id, userId);
    }
  },
  delete(id: string): void {
    db.prepare('DELETE FROM handouts WHERE id = ?').run(id);
  },
};

// ---------- macros ----------

interface MacroRow {
  id: string; name: string; command: string; sort_order: number;
  color: string | null; character_id: string | null; rollable_id: string | null;
}

export const macros = {
  forUser(userId: string, campaignId: string): Macro[] {
    const rows = db.prepare(
      'SELECT id, name, command, sort_order, color, character_id, rollable_id FROM macros WHERE user_id = ? AND campaign_id = ? ORDER BY sort_order',
    ).all(userId, campaignId) as MacroRow[];
    return rows.map((r) => ({
      id: r.id, name: r.name, command: r.command, sortOrder: r.sort_order,
      color: r.color, characterId: r.character_id, rollableId: r.rollable_id,
    }));
  },
  byId(id: string): Macro | undefined {
    const r = db.prepare('SELECT id, name, command, sort_order, color, character_id, rollable_id FROM macros WHERE id = ?')
      .get(id) as MacroRow | undefined;
    return r ? { id: r.id, name: r.name, command: r.command, sortOrder: r.sort_order, color: r.color, characterId: r.character_id, rollableId: r.rollable_id } : undefined;
  },
  save(userId: string, campaignId: string, macro: {
    id?: string; name: string; command: string;
    color?: string | null; characterId?: string | null; rollableId?: string | null;
  }): void {
    if (macro.id) {
      db.prepare('UPDATE macros SET name = ?, command = ?, color = ?, character_id = ?, rollable_id = ? WHERE id = ? AND user_id = ?')
        .run(macro.name, macro.command, macro.color ?? null, macro.characterId ?? null, macro.rollableId ?? null, macro.id, userId);
    } else {
      const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM macros WHERE user_id = ? AND campaign_id = ?')
        .get(userId, campaignId) as { m: number | null }).m ?? -1;
      db.prepare('INSERT INTO macros (id, user_id, campaign_id, name, command, sort_order, color, character_id, rollable_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), userId, campaignId, macro.name, macro.command, maxOrder + 1, macro.color ?? null, macro.characterId ?? null, macro.rollableId ?? null);
    }
  },
  reorder(userId: string, campaignId: string, macroIds: string[]): void {
    const stmt = db.prepare('UPDATE macros SET sort_order = ? WHERE id = ? AND user_id = ? AND campaign_id = ?');
    const tx = db.transaction((ids: string[]) => {
      ids.forEach((id, i) => stmt.run(i, id, userId, campaignId));
    });
    tx(macroIds);
  },
  delete(userId: string, macroId: string): void {
    db.prepare('DELETE FROM macros WHERE id = ? AND user_id = ?').run(macroId, userId);
  },
};

// ---------- rollable tables ----------

interface TableRow {
  id: string; name: string; players_can_roll: number; items_json: string; sort_order: number;
}

function toTable(r: TableRow): RollableTable {
  const raw = JSON.parse(r.items_json) as Array<{ text: string; weight?: number }>;
  return {
    id: r.id,
    name: r.name,
    playersCanRoll: !!r.players_can_roll,
    items: raw.map((it) => ({ text: it.text, weight: typeof it.weight === 'number' && it.weight > 0 ? it.weight : 1 })),
  };
}

export const rollableTables = {
  forCampaign(campaignId: string): RollableTable[] {
    const rows = db.prepare('SELECT * FROM rollable_tables WHERE campaign_id = ? ORDER BY sort_order, name').all(campaignId) as TableRow[];
    return rows.map(toTable);
  },
  byId(id: string): (RollableTable & { campaignId: string }) | undefined {
    const r = db.prepare('SELECT * FROM rollable_tables WHERE id = ?').get(id) as (TableRow & { campaign_id: string }) | undefined;
    return r ? { ...toTable(r), campaignId: r.campaign_id } : undefined;
  },
  create(campaignId: string, name: string): RollableTable {
    const id = newId();
    const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM rollable_tables WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    db.prepare('INSERT INTO rollable_tables (id, campaign_id, name, players_can_roll, items_json, sort_order) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, campaignId, name, '[]', maxOrder + 1);
    return { id, name, playersCanRoll: true, items: [] };
  },
  update(id: string, fields: { name?: string; playersCanRoll?: boolean; items?: RollableTable['items'] }): void {
    const cur = db.prepare('SELECT * FROM rollable_tables WHERE id = ?').get(id) as TableRow | undefined;
    if (!cur) return;
    db.prepare('UPDATE rollable_tables SET name = ?, players_can_roll = ?, items_json = ? WHERE id = ?').run(
      fields.name ?? cur.name,
      fields.playersCanRoll !== undefined ? (fields.playersCanRoll ? 1 : 0) : cur.players_can_roll,
      fields.items !== undefined ? JSON.stringify(fields.items) : cur.items_json,
      id,
    );
  },
  delete(id: string): void {
    db.prepare('DELETE FROM rollable_tables WHERE id = ?').run(id);
  },
};

// ---------- chat ----------

export const chat = {
  add(campaignId: string, msg: {
    userId: string | null; fromName: string; kind: ChatKind; text: string;
    roll: RollBreakdown | null; recipients: string[] | null;
  }): ChatMessage {
    const at = now();
    const info = db.prepare(
      `INSERT INTO chat_messages (campaign_id, user_id, from_name, kind, text, roll_json, recipients_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      campaignId, msg.userId, msg.fromName, msg.kind, msg.text,
      msg.roll ? JSON.stringify(msg.roll) : null,
      msg.recipients ? JSON.stringify(msg.recipients) : null,
      at,
    );
    return {
      id: Number(info.lastInsertRowid),
      kind: msg.kind,
      fromUserId: msg.userId,
      fromName: msg.fromName,
      text: msg.text,
      roll: msg.roll,
      recipients: msg.recipients,
      at,
    };
  },
  /** Last N messages visible to the given user (whispers filtered). */
  tailFor(campaignId: string, userId: string, username: string, isDm: boolean, limit: number): ChatMessage[] {
    const rows = db.prepare(
      'SELECT * FROM chat_messages WHERE campaign_id = ? ORDER BY id DESC LIMIT ?',
    ).all(campaignId, limit * 2) as Array<{
      id: number; user_id: string | null; from_name: string; kind: ChatKind; text: string;
      roll_json: string | null; recipients_json: string | null; created_at: number;
    }>;
    const out: ChatMessage[] = [];
    for (const r of rows) {
      const recipients = r.recipients_json ? (JSON.parse(r.recipients_json) as string[]) : null;
      if (r.kind === 'whisper' && !isDm && r.user_id !== userId && !recipients?.includes(username)) continue;
      out.push({
        id: r.id,
        kind: r.kind,
        fromUserId: r.user_id,
        fromName: r.from_name,
        text: r.text,
        roll: r.roll_json ? JSON.parse(r.roll_json) : null,
        recipients,
        at: r.created_at,
      });
      if (out.length >= limit) break;
    }
    return out.reverse();
  },
};

// ---------- initiative ----------

export const EMPTY_INITIATIVE: InitiativeState = { entries: [], turnIdx: 0, round: 1, active: false };

export const initiative = {
  get(campaignId: string): InitiativeState {
    const row = db.prepare('SELECT state_json FROM initiative WHERE campaign_id = ?').get(campaignId) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) : structuredClone(EMPTY_INITIATIVE);
  },
  set(campaignId: string, state: InitiativeState): void {
    db.prepare(
      `INSERT INTO initiative (campaign_id, state_json) VALUES (?, ?)
       ON CONFLICT(campaign_id) DO UPDATE SET state_json = excluded.state_json`,
    ).run(campaignId, JSON.stringify(state));
  },
};

// ---------- drawings ----------

interface DrawingRow {
  id: string;
  map_id: string;
  author_id: string;
  layer: 'map' | 'gm';
  shape_json: string;
}

function toDrawing(row: DrawingRow): Drawing {
  return {
    id: row.id,
    mapId: row.map_id,
    authorId: row.author_id,
    layer: row.layer,
    shape: JSON.parse(row.shape_json),
  };
}

export const drawings = {
  add(mapId: string, authorId: string, layer: 'map' | 'gm', shape: object): Drawing {
    const id = newId();
    db.prepare('INSERT INTO drawings (id, map_id, author_id, layer, shape_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, mapId, authorId, layer, JSON.stringify(shape), now());
    return toDrawing({ id, map_id: mapId, author_id: authorId, layer, shape_json: JSON.stringify(shape) });
  },
  byId(id: string): Drawing | undefined {
    const row = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id) as DrawingRow | undefined;
    return row ? toDrawing(row) : undefined;
  },
  forMap(mapId: string): Drawing[] {
    const rows = db.prepare('SELECT * FROM drawings WHERE map_id = ? ORDER BY created_at').all(mapId) as DrawingRow[];
    return rows.map(toDrawing);
  },
  delete(id: string): void {
    db.prepare('DELETE FROM drawings WHERE id = ?').run(id);
  },
  clearLayer(mapId: string, layer: 'map' | 'gm'): void {
    db.prepare('DELETE FROM drawings WHERE map_id = ? AND layer = ?').run(mapId, layer);
  },
};
