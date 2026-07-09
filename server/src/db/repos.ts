import type {
  AssetFolder, AssetInfo, AudioTrack,
  CampaignInfo, Character, ChatKind, ChatMessage, Door, Drawing, GameSystem,
  GridConfig, Handout, InitiativeState, LocationNode, Light, LootItem, Macro, MapDef, MapMeta,
  RollableTable, RollBreakdown, Role, SheetData, Shop, ShopItem, Token, Wall, WorldFolder,
} from 'shared';
import { db, newId, now, stmt } from './db.js';

/**
 * JSON.parse that survives a corrupt row: one bad *_json column must degrade
 * to its empty default (and a loud log), not throw out of every read of that
 * table -- an unguarded parse made a single corrupted map/sheet row brick
 * every join of its campaign.
 */
function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    console.error(`corrupt JSON column ignored (${json.slice(0, 80)}...)`);
    return fallback;
  }
}

// ---------- users & sessions ----------

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

export const users = {
  create(username: string, passwordHash: string): UserRow {
    const id = newId();
    stmt('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, username, passwordHash, now());
    return { id, username, password_hash: passwordHash };
  },
  byUsername(username: string): UserRow | undefined {
    return stmt('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as UserRow | undefined;
  },
  byId(id: string): UserRow | undefined {
    return stmt('SELECT id, username, password_hash FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
  setDiceColor(userId: string, color: string | null): void {
    stmt('UPDATE users SET dice_color = ? WHERE id = ?').run(color, userId);
  },
  setDiceTextColor(userId: string, color: string | null): void {
    stmt('UPDATE users SET dice_text_color = ? WHERE id = ?').run(color, userId);
  },
  setPlayerColor(userId: string, color: string | null): void {
    stmt('UPDATE users SET player_color = ? WHERE id = ?').run(color, userId);
  },
  rename(userId: string, username: string): void {
    stmt('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
  },
  setPassword(userId: string, hash: string): void {
    stmt('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  },
};

export const sessions = {
  create(userId: string, ttlMs: number): string {
    const token = newId() + newId();
    stmt('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now(), now() + ttlMs);
    return token;
  },
  resolve(token: string): UserRow | undefined {
    const row = stmt(
      `SELECT u.id, u.username, u.password_hash FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    ).get(token, now()) as UserRow | undefined;
    return row;
  },
  delete(token: string): void {
    stmt('DELETE FROM sessions WHERE token = ?').run(token);
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
    while (stmt('SELECT 1 FROM campaigns WHERE invite_code = ?').get(inviteCode)) {
      inviteCode = makeInviteCode();
    }
    stmt(
      'INSERT INTO campaigns (id, name, system, dm_user_id, invite_code, active_map_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    ).run(id, name, system, dmUserId, inviteCode, now());
    stmt('INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, ?)')
      .run(id, dmUserId, 'dm');
    return toCampaignInfo({ id, name, system, dm_user_id: dmUserId, invite_code: inviteCode, active_map_id: null });
  },
  byId(id: string): CampaignInfo | undefined {
    const row = stmt('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
    return row ? toCampaignInfo(row) : undefined;
  },
  byInviteCode(code: string): CampaignInfo | undefined {
    const row = stmt('SELECT * FROM campaigns WHERE invite_code = ?').get(code.toUpperCase()) as CampaignRow | undefined;
    return row ? toCampaignInfo(row) : undefined;
  },
  forUser(userId: string): Array<CampaignInfo & { role: Role }> {
    const rows = stmt(
      `SELECT c.*, m.role FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id
       WHERE m.user_id = ? ORDER BY c.created_at`,
    ).all(userId) as Array<CampaignRow & { role: Role }>;
    return rows.map((r) => ({ ...toCampaignInfo(r), role: r.role }));
  },
  addMember(campaignId: string, userId: string, role: Role): void {
    stmt('INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role) VALUES (?, ?, ?)')
      .run(campaignId, userId, role);
  },
  memberRole(campaignId: string, userId: string): Role | undefined {
    const row = stmt('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, userId) as { role: Role } | undefined;
    return row?.role;
  },
  members(campaignId: string): Array<{ userId: string; username: string; role: Role; mapId: string | null; diceColor: string | null; diceTextColor: string | null; playerColor: string | null }> {
    return (stmt(
      `SELECT m.user_id as userId, u.username, m.role, m.map_id as mapId, u.dice_color as diceColor, u.dice_text_color as diceTextColor, u.player_color as playerColor FROM campaign_members m
       JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ?`,
    ).all(campaignId) as Array<{ userId: string; username: string; role: Role; mapId: string | null; diceColor: string | null; diceTextColor: string | null; playerColor: string | null }>);
  },
  setActiveMap(campaignId: string, mapId: string | null): void {
    stmt('UPDATE campaigns SET active_map_id = ? WHERE id = ?').run(mapId, campaignId);
  },
  /** Set (or clear) a member's personal map override. */
  setMemberMap(campaignId: string, userId: string, mapId: string | null): void {
    stmt('UPDATE campaign_members SET map_id = ? WHERE campaign_id = ? AND user_id = ?')
      .run(mapId, campaignId, userId);
  },
  /** Clear every member override pointing at a (deleted) map. */
  clearMapAssignments(mapId: string): void {
    stmt('UPDATE campaign_members SET map_id = NULL WHERE map_id = ?').run(mapId);
  },
  /**
   * The map a member is currently viewing: their personal override if it
   * still exists, else the campaign's active (party) map.
   */
  viewMapIdFor(campaignId: string, userId: string): string | null {
    const row = stmt(
      `SELECT m.map_id as mapId, c.active_map_id as activeMapId
       FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
       WHERE m.campaign_id = ? AND m.user_id = ?`,
    ).get(campaignId, userId) as { mapId: string | null; activeMapId: string | null } | undefined;
    if (!row) return null;
    if (row.mapId) {
      const exists = stmt('SELECT 1 FROM maps WHERE id = ?').get(row.mapId);
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
  folder_id?: string | null;
  title?: string | null;
}

function assetToInfo(r: AssetRow): AssetInfo {
  return {
    id: r.id,
    kind: r.kind as AssetInfo['kind'],
    url: `/uploads/${r.id}.${r.ext}`,
    title: r.title || r.filename,
    folderId: r.folder_id ?? null,
    width: r.width,
    height: r.height,
    mime: r.mime,
  };
}

export const assets = {
  create(a: Omit<AssetRow, 'id'> & { uploaderId: string; title?: string | null; folderId?: string | null }): AssetRow {
    const id = newId();
    stmt(
      `INSERT INTO assets (id, campaign_id, uploader_id, kind, filename, ext, mime, bytes, width, height, folder_id, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, a.campaign_id, a.uploaderId, a.kind, a.filename, a.ext, a.mime, a.bytes, a.width, a.height, a.folderId ?? null, a.title ?? null, now());
    return { id, ...a };
  },
  byId(id: string): AssetRow | undefined {
    return stmt('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  },
  /** Browsable art assets (images) for a campaign. */
  forCampaign(campaignId: string): AssetInfo[] {
    const rows = stmt(
      `SELECT * FROM assets WHERE campaign_id = ? AND kind != 'audio' ORDER BY created_at DESC`,
    ).all(campaignId) as AssetRow[];
    return rows.map(assetToInfo);
  },
  move(id: string, folderId: string | null): void {
    stmt('UPDATE assets SET folder_id = ? WHERE id = ?').run(folderId, id);
  },
  rename(id: string, title: string): void {
    stmt('UPDATE assets SET title = ? WHERE id = ?').run(title, id);
  },
  delete(id: string): void {
    stmt('DELETE FROM assets WHERE id = ?').run(id);
  },
  urlFor(id: string | null): string | null {
    if (!id) return null;
    const row = assets.byId(id);
    return row ? `/uploads/${row.id}.${row.ext}` : null;
  },
};

// ---------- asset folders ----------

export const assetFolders = {
  forCampaign(campaignId: string, kind?: 'art' | 'handout'): AssetFolder[] {
    const rows = kind
      ? stmt('SELECT id, name, kind FROM asset_folders WHERE campaign_id = ? AND kind = ? ORDER BY sort_order, name').all(campaignId, kind)
      : stmt('SELECT id, name, kind FROM asset_folders WHERE campaign_id = ? ORDER BY sort_order, name').all(campaignId);
    return rows as AssetFolder[];
  },
  byId(id: string): (AssetFolder & { campaignId: string }) | undefined {
    const r = stmt('SELECT id, name, kind, campaign_id FROM asset_folders WHERE id = ?').get(id) as (AssetFolder & { campaign_id: string }) | undefined;
    return r ? { id: r.id, name: r.name, kind: r.kind, campaignId: r.campaign_id } : undefined;
  },
  create(campaignId: string, name: string, kind: 'art' | 'handout'): AssetFolder {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM asset_folders WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO asset_folders (id, campaign_id, name, kind, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, campaignId, name, kind, maxOrder + 1);
    return { id, name, kind };
  },
  rename(id: string, name: string): void {
    stmt('UPDATE asset_folders SET name = ? WHERE id = ?').run(name, id);
  },
  delete(id: string): void {
    // Loose assets/handouts fall back to "unfiled" (folder_id null) -- one
    // transaction, so a crash mid-way can't strand items pointing at a
    // half-deleted folder.
    db.transaction(() => {
      stmt('UPDATE assets SET folder_id = NULL WHERE folder_id = ?').run(id);
      stmt('UPDATE handouts SET folder_id = NULL WHERE folder_id = ?').run(id);
      stmt('DELETE FROM asset_folders WHERE id = ?').run(id);
    })();
  },
};

// ---------- shops ----------

interface ShopRow {
  id: string; name: string; description: string; currency: string;
  players_can_buy: number; items_json: string; parent_id: string | null;
}
function toShop(r: ShopRow): Shop {
  const items = (safeParse<Array<Partial<ShopItem>>>(r.items_json, [])).map((it) => ({
    name: String(it.name ?? ''),
    price: typeof it.price === 'number' ? it.price : 0,
    qty: typeof it.qty === 'number' ? it.qty : -1,
    notes: String(it.notes ?? ''),
    // Carried "logic" for buy-transfer (optional).
    ...(it.contentId ? { contentId: String(it.contentId) } : {}),
    ...(it.effect === 'heal' || it.effect === 'damage' ? { effect: it.effect } : {}),
    ...(it.amount ? { amount: String(it.amount) } : {}),
    ...(typeof it.range === 'number' ? { range: it.range } : {}),
  }));
  return { id: r.id, name: r.name, description: r.description, currency: r.currency, playersCanBuy: !!r.players_can_buy, items, parentId: r.parent_id ?? null };
}

export const shops = {
  forCampaign(campaignId: string): Shop[] {
    const rows = stmt('SELECT * FROM shops WHERE campaign_id = ? ORDER BY sort_order, name').all(campaignId) as ShopRow[];
    return rows.map(toShop);
  },
  byId(id: string): (Shop & { campaignId: string }) | undefined {
    const r = stmt('SELECT * FROM shops WHERE id = ?').get(id) as (ShopRow & { campaign_id: string }) | undefined;
    return r ? { ...toShop(r), campaignId: r.campaign_id } : undefined;
  },
  create(campaignId: string, name: string, currency: string): Shop {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM shops WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO shops (id, campaign_id, name, currency, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, campaignId, name, currency, maxOrder + 1);
    return { id, name, description: '', currency, playersCanBuy: true, items: [] };
  },
  update(id: string, fields: { name?: string; description?: string; currency?: string; playersCanBuy?: boolean; items?: ShopItem[]; parentId?: string | null }): void {
    const cur = stmt('SELECT * FROM shops WHERE id = ?').get(id) as ShopRow | undefined;
    if (!cur) return;
    stmt('UPDATE shops SET name = ?, description = ?, currency = ?, players_can_buy = ?, items_json = ?, parent_id = ? WHERE id = ?').run(
      fields.name ?? cur.name,
      fields.description ?? cur.description,
      fields.currency ?? cur.currency,
      fields.playersCanBuy !== undefined ? (fields.playersCanBuy ? 1 : 0) : cur.players_can_buy,
      fields.items !== undefined ? JSON.stringify(fields.items) : cur.items_json,
      fields.parentId !== undefined ? fields.parentId : cur.parent_id,
      id,
    );
  },
  delete(id: string): void {
    stmt('DELETE FROM shops WHERE id = ?').run(id);
  },
};

// ---------- locations ----------

interface LocationRow {
  id: string; name: string; kind: string; notes: string;
  parent_id: string | null; visible_to_players: number; links_json: string;
}
function toLocation(r: LocationRow): LocationNode {
  const links = safeParse<{ npcIds?: string[]; shopIds?: string[]; handoutIds?: string[] }>(r.links_json, {});
  return {
    id: r.id, name: r.name, kind: r.kind as LocationNode['kind'], notes: r.notes,
    parentId: r.parent_id, visibleToPlayers: !!r.visible_to_players,
    npcIds: links.npcIds ?? [], shopIds: links.shopIds ?? [], handoutIds: links.handoutIds ?? [],
  };
}

export const locations = {
  forCampaign(campaignId: string): LocationNode[] {
    const rows = stmt('SELECT * FROM locations WHERE campaign_id = ? ORDER BY sort_order, name').all(campaignId) as LocationRow[];
    return rows.map(toLocation);
  },
  byId(id: string): (LocationNode & { campaignId: string }) | undefined {
    const r = stmt('SELECT * FROM locations WHERE id = ?').get(id) as (LocationRow & { campaign_id: string }) | undefined;
    return r ? { ...toLocation(r), campaignId: r.campaign_id } : undefined;
  },
  create(campaignId: string, name: string, parentId: string | null): LocationNode {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM locations WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO locations (id, campaign_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, campaignId, name, parentId, maxOrder + 1);
    return { id, name, kind: 'settlement', notes: '', parentId, visibleToPlayers: false, npcIds: [], shopIds: [], handoutIds: [] };
  },
  update(id: string, fields: Partial<Omit<LocationNode, 'id'>>): void {
    const cur = stmt('SELECT * FROM locations WHERE id = ?').get(id) as LocationRow | undefined;
    if (!cur) return;
    const curLoc = toLocation(cur);
    const links = {
      npcIds: fields.npcIds ?? curLoc.npcIds,
      shopIds: fields.shopIds ?? curLoc.shopIds,
      handoutIds: fields.handoutIds ?? curLoc.handoutIds,
    };
    stmt('UPDATE locations SET name = ?, kind = ?, notes = ?, parent_id = ?, visible_to_players = ?, links_json = ? WHERE id = ?').run(
      fields.name ?? cur.name,
      fields.kind ?? cur.kind,
      fields.notes ?? cur.notes,
      fields.parentId !== undefined ? fields.parentId : cur.parent_id,
      fields.visibleToPlayers !== undefined ? (fields.visibleToPlayers ? 1 : 0) : cur.visible_to_players,
      JSON.stringify(links),
      id,
    );
  },
  delete(id: string): void {
    // Re-parent children up to this node's parent.
    const cur = stmt('SELECT parent_id FROM locations WHERE id = ?').get(id) as { parent_id: string | null } | undefined;
    stmt('UPDATE locations SET parent_id = ? WHERE parent_id = ?').run(cur?.parent_id ?? null, id);
    stmt('DELETE FROM locations WHERE id = ?').run(id);
  },
};

// ---------- world folders (pure organization; no game behavior) ----------

interface WorldFolderRow {
  id: string; name: string; parent_id: string | null;
}
function toWorldFolder(r: WorldFolderRow): WorldFolder {
  return { id: r.id, name: r.name, parentId: r.parent_id };
}

export const worldFolders = {
  forCampaign(campaignId: string): WorldFolder[] {
    const rows = stmt('SELECT * FROM world_folders WHERE campaign_id = ? ORDER BY sort_order, name').all(campaignId) as WorldFolderRow[];
    return rows.map(toWorldFolder);
  },
  byId(id: string): (WorldFolder & { campaignId: string }) | undefined {
    const r = stmt('SELECT * FROM world_folders WHERE id = ?').get(id) as (WorldFolderRow & { campaign_id: string }) | undefined;
    return r ? { ...toWorldFolder(r), campaignId: r.campaign_id } : undefined;
  },
  create(campaignId: string, name: string, parentId: string | null): WorldFolder {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM world_folders WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO world_folders (id, campaign_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, campaignId, name, parentId, maxOrder + 1);
    return { id, name, parentId };
  },
  update(id: string, fields: Partial<Omit<WorldFolder, 'id'>>): void {
    const cur = stmt('SELECT * FROM world_folders WHERE id = ?').get(id) as WorldFolderRow | undefined;
    if (!cur) return;
    stmt('UPDATE world_folders SET name = ?, parent_id = ? WHERE id = ?').run(
      fields.name ?? cur.name,
      fields.parentId !== undefined ? fields.parentId : cur.parent_id,
      id,
    );
  },
  delete(id: string): void {
    // Re-parent children up to this node's parent (mirrors locations.delete).
    const cur = stmt('SELECT parent_id FROM world_folders WHERE id = ?').get(id) as { parent_id: string | null } | undefined;
    stmt('UPDATE world_folders SET parent_id = ? WHERE parent_id = ?').run(cur?.parent_id ?? null, id);
    stmt('DELETE FROM world_folders WHERE id = ?').run(id);
  },
};

// ---------- audio tracks ----------

export const audioTracks = {
  forCampaign(campaignId: string): AudioTrack[] {
    const rows = stmt(
      `SELECT t.id, t.title, a.ext, a.id as assetId FROM audio_tracks t
       JOIN assets a ON a.id = t.asset_id WHERE t.campaign_id = ? ORDER BY t.sort_order, t.title`,
    ).all(campaignId) as Array<{ id: string; title: string; ext: string; assetId: string }>;
    return rows.map((r) => ({ id: r.id, title: r.title, url: `/uploads/${r.assetId}.${r.ext}` }));
  },
  byId(id: string): { id: string; url: string; campaignId: string } | undefined {
    const r = stmt(
      `SELECT t.id, t.campaign_id, a.ext, a.id as assetId FROM audio_tracks t
       JOIN assets a ON a.id = t.asset_id WHERE t.id = ?`,
    ).get(id) as { id: string; campaign_id: string; ext: string; assetId: string } | undefined;
    return r ? { id: r.id, url: `/uploads/${r.assetId}.${r.ext}`, campaignId: r.campaign_id } : undefined;
  },
  add(campaignId: string, assetId: string, title: string): void {
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM audio_tracks WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO audio_tracks (id, campaign_id, asset_id, title, sort_order) VALUES (?, ?, ?, ?, ?)').run(newId(), campaignId, assetId, title, maxOrder + 1);
  },
  remove(id: string): void {
    stmt('DELETE FROM audio_tracks WHERE id = ?').run(id);
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
  parent_id?: string | null;
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    system: row.system,
    sheet: safeParse(row.sheet_json, {}),
    parentId: row.parent_id ?? null,
  };
}

export const characters = {
  create(campaignId: string, ownerUserId: string | null, name: string, system: GameSystem, sheet: object): Character {
    const id = newId();
    stmt(
      `INSERT INTO characters (id, campaign_id, owner_user_id, name, system, sheet_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, campaignId, ownerUserId, name, system, JSON.stringify(sheet), now(), now());
    return toCharacter({ id, campaign_id: campaignId, owner_user_id: ownerUserId, name, system, sheet_json: JSON.stringify(sheet) });
  },
  byId(id: string): Character | undefined {
    const row = stmt('SELECT * FROM characters WHERE id = ?').get(id) as CharacterRow | undefined;
    return row ? toCharacter(row) : undefined;
  },
  forCampaign(campaignId: string): Character[] {
    const rows = stmt('SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at').all(campaignId) as CharacterRow[];
    return rows.map(toCharacter);
  },
  update(id: string, name: string | undefined, sheet: object): void {
    if (name !== undefined) {
      stmt('UPDATE characters SET name = ?, sheet_json = ?, updated_at = ? WHERE id = ?')
        .run(name, JSON.stringify(sheet), now(), id);
    } else {
      stmt('UPDATE characters SET sheet_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(sheet), now(), id);
    }
  },
  setParent(id: string, parentId: string | null): void {
    stmt('UPDATE characters SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, now(), id);
  },
  setOwner(id: string, ownerUserId: string | null): void {
    stmt('UPDATE characters SET owner_user_id = ?, updated_at = ? WHERE id = ?').run(ownerUserId, now(), id);
  },
  delete(id: string): void {
    stmt('DELETE FROM characters WHERE id = ?').run(id);
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
  spawn_json: string | null;
  terrain_json: string;
  sort_order: number;
}

export const DEFAULT_GRID: GridConfig = {
  hexSize: 8,
  originX: 0,
  originY: 0,
  cols: 100,
  rows: 100,
  gridEnabled: true,
  lighting: 'light',
  feetPerHex: 5,
};

/** Backfills grids persisted before `gridEnabled`/`lighting` existed (which
 *  only ever had the old boolean `globalIllumination`). */
function normalizeGrid(raw: GridConfig & { globalIllumination?: boolean }): GridConfig {
  return {
    ...raw,
    gridEnabled: raw.gridEnabled ?? true,
    lighting: raw.lighting ?? (raw.globalIllumination ? 'light' : 'dark'),
  };
}

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
    grid: normalizeGrid(safeParse<GridConfig & { globalIllumination?: boolean }>(row.grid_json, {
      hexSize: 8, originX: 0, originY: 0, cols: 100, rows: 100, gridEnabled: true, lighting: 'light', feetPerHex: 5,
    })),
    walls: safeParse(row.walls_json, []),
    doors: safeParse(row.doors_json, []),
    lights: safeParse(row.lights_json, []),
    spawn: row.spawn_json ? safeParse(row.spawn_json, null) : null,
    terrain: safeParse(row.terrain_json, []),
  };
}

export const maps = {
  create(campaignId: string, name: string): MapDef & { campaignId: string; bgAssetId: string | null } {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM maps WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt(
      'INSERT INTO maps (id, campaign_id, name, bg_asset_id, grid_json, sort_order) VALUES (?, ?, ?, NULL, ?, ?)',
    ).run(id, campaignId, name, JSON.stringify(DEFAULT_GRID), maxOrder + 1);
    return maps.byId(id)!;
  },
  byId(id: string): (MapDef & { campaignId: string; bgAssetId: string | null }) | undefined {
    const row = stmt('SELECT * FROM maps WHERE id = ?').get(id) as MapRow | undefined;
    return row ? toMapDef(row) : undefined;
  },
  forCampaign(campaignId: string): MapMeta[] {
    const rows = stmt('SELECT id, name, sort_order, parent_id FROM maps WHERE campaign_id = ? ORDER BY sort_order').all(campaignId) as Array<{ id: string; name: string; sort_order: number; parent_id: string | null }>;
    return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, parentId: r.parent_id ?? null }));
  },
  update(id: string, fields: { name?: string; bgAssetId?: string | null; parentId?: string | null }): void {
    if (fields.name !== undefined) stmt('UPDATE maps SET name = ? WHERE id = ?').run(fields.name, id);
    if (fields.bgAssetId !== undefined) {
      try {
        stmt('UPDATE maps SET bg_asset_id = ? WHERE id = ?').run(fields.bgAssetId, id);
      } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
          console.error('FK error on bg_asset_id update — retrying with FK bypass', { id, bgAssetId: fields.bgAssetId, fkList: db.pragma('foreign_key_list(maps)') });
          db.pragma('foreign_keys = OFF');
          stmt('UPDATE maps SET bg_asset_id = ? WHERE id = ?').run(fields.bgAssetId, id);
          db.pragma('foreign_keys = ON');
        } else throw err;
      }
    }
    if (fields.parentId !== undefined) stmt('UPDATE maps SET parent_id = ? WHERE id = ?').run(fields.parentId, id);
  },
  setGrid(id: string, grid: GridConfig): void {
    stmt('UPDATE maps SET grid_json = ? WHERE id = ?').run(JSON.stringify(grid), id);
  },
  setSpawn(id: string, spawn: { q: number; r: number } | null): void {
    stmt('UPDATE maps SET spawn_json = ? WHERE id = ?').run(spawn ? JSON.stringify(spawn) : null, id);
  },
  setWalls(id: string, walls: Wall[]): void {
    stmt('UPDATE maps SET walls_json = ? WHERE id = ?').run(JSON.stringify(walls), id);
  },
  setDoors(id: string, doors: Door[]): void {
    stmt('UPDATE maps SET doors_json = ? WHERE id = ?').run(JSON.stringify(doors), id);
  },
  setLights(id: string, lights: Light[]): void {
    stmt('UPDATE maps SET lights_json = ? WHERE id = ?').run(JSON.stringify(lights), id);
  },
  setTerrain(id: string, terrain: number[]): void {
    stmt('UPDATE maps SET terrain_json = ? WHERE id = ?').run(JSON.stringify(terrain), id);
  },
  delete(id: string): void {
    stmt('DELETE FROM maps WHERE id = ?').run(id);
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
  shape: string | null;
  color: string;
  vision_json: string | null;
  bar_json: string | null;
  light_json: string | null;
  /** From the LEFT JOIN in TOKEN_SELECT — the art asset's file extension. */
  art_ext: string | null;
}

// Tokens are read on every vision pass (every move, for every viewer), so the
// art URL's asset extension is JOINed in here instead of a separate SELECT
// per token (the old assets.urlFor() N+1).
const TOKEN_SELECT = `
  SELECT tokens.*, assets.ext AS art_ext FROM tokens
  LEFT JOIN assets ON assets.id = tokens.art_asset_id`;

function toToken(row: TokenRow): Token {
  return {
    id: row.id,
    mapId: row.map_id,
    characterId: row.character_id,
    name: row.name,
    artUrl: row.art_asset_id && row.art_ext ? `/uploads/${row.art_asset_id}.${row.art_ext}` : null,
    q: row.q,
    r: row.r,
    layer: row.layer,
    size: row.size,
    shape: (row.shape as Token['shape']) ?? 'circle',
    color: row.color,
    vision: row.vision_json ? safeParse(row.vision_json, null) : null,
    bar: row.bar_json ? safeParse(row.bar_json, null) : null,
    light: row.light_json ? safeParse(row.light_json, null) : null,
  };
}

export const tokens = {
  create(t: {
    mapId: string; characterId: string | null; name: string; artAssetId: string | null;
    q: number; r: number; layer: 'token' | 'gm'; size: number; shape: string; color: string;
    vision: object | null; bar: object | null; light?: object | null;
  }): Token {
    const id = newId();
    stmt(
      `INSERT INTO tokens (id, map_id, character_id, name, art_asset_id, q, r, layer, size, shape, color, vision_json, bar_json, light_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, t.mapId, t.characterId, t.name, t.artAssetId, t.q, t.r, t.layer, t.size, t.shape, t.color,
      t.vision ? JSON.stringify(t.vision) : null, t.bar ? JSON.stringify(t.bar) : null,
      t.light ? JSON.stringify(t.light) : null,
    );
    return tokens.byId(id)!;
  },
  byId(id: string): Token | undefined {
    const row = stmt(`${TOKEN_SELECT} WHERE tokens.id = ?`).get(id) as TokenRow | undefined;
    return row ? toToken(row) : undefined;
  },
  forMap(mapId: string): Token[] {
    const rows = stmt(`${TOKEN_SELECT} WHERE tokens.map_id = ?`).all(mapId) as TokenRow[];
    return rows.map(toToken);
  },
  forCharacter(characterId: string): Token[] {
    const rows = stmt(`${TOKEN_SELECT} WHERE tokens.character_id = ?`).all(characterId) as TokenRow[];
    return rows.map(toToken);
  },
  move(id: string, q: number, r: number): void {
    stmt('UPDATE tokens SET q = ?, r = ? WHERE id = ?').run(q, r, id);
  },
  update(id: string, patch: {
    name?: string; layer?: 'token' | 'gm'; size?: number; shape?: string; color?: string;
    characterId?: string | null; artAssetId?: string | null;
    vision?: object | null; bar?: object | null; light?: object | null;
  }): void {
    const cur = stmt('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined;
    if (!cur) return;
    stmt(
      `UPDATE tokens SET name = ?, layer = ?, size = ?, shape = ?, color = ?, character_id = ?, art_asset_id = ?, vision_json = ?, bar_json = ?, light_json = ?
       WHERE id = ?`,
    ).run(
      patch.name ?? cur.name,
      patch.layer ?? cur.layer,
      patch.size ?? cur.size,
      patch.shape ?? cur.shape ?? 'circle',
      patch.color ?? cur.color,
      patch.characterId !== undefined ? patch.characterId : cur.character_id,
      patch.artAssetId !== undefined ? patch.artAssetId : cur.art_asset_id,
      patch.vision !== undefined ? (patch.vision ? JSON.stringify(patch.vision) : null) : cur.vision_json,
      patch.bar !== undefined ? (patch.bar ? JSON.stringify(patch.bar) : null) : cur.bar_json,
      patch.light !== undefined ? (patch.light ? JSON.stringify(patch.light) : null) : cur.light_json,
      id,
    );
  },
  delete(id: string): void {
    stmt('DELETE FROM tokens WHERE id = ?').run(id);
  },
};

// ---------- fog ----------

export const fog = {
  get(userId: string, mapId: string): Int32Array {
    const row = stmt('SELECT hexes FROM fog_explored WHERE user_id = ? AND map_id = ?')
      .get(userId, mapId) as { hexes: Buffer } | undefined;
    if (!row) return new Int32Array(0);
    return new Int32Array(row.hexes.buffer, row.hexes.byteOffset, row.hexes.byteLength / 4);
  },
  set(userId: string, mapId: string, hexes: Int32Array): void {
    // The map (or user) may have been deleted between compute and flush;
    // losing fog memory for a deleted map is correct, crashing is not.
    if (!stmt('SELECT 1 FROM maps WHERE id = ?').get(mapId)) return;
    const buf = Buffer.from(hexes.buffer, hexes.byteOffset, hexes.byteLength);
    try {
      stmt(
        `INSERT INTO fog_explored (user_id, map_id, hexes) VALUES (?, ?, ?)
         ON CONFLICT(user_id, map_id) DO UPDATE SET hexes = excluded.hexes`,
      ).run(userId, mapId, buf);
    } catch (err) {
      console.warn('fog flush skipped:', err instanceof Error ? err.message : err);
    }
  },
  clearMap(mapId: string): void {
    stmt('DELETE FROM fog_explored WHERE map_id = ?').run(mapId);
  },
};

// ---------- door memory ----------

export const doorMemory = {
  get(userId: string, mapId: string): Record<string, Door> {
    const row = stmt('SELECT doors_json FROM door_memory WHERE user_id = ? AND map_id = ?')
      .get(userId, mapId) as { doors_json: string } | undefined;
    if (!row) return {};
    try {
      return safeParse<Record<string, Door>>(row.doors_json, {});
    } catch {
      return {};
    }
  },
  set(userId: string, mapId: string, memory: Record<string, Door>): void {
    // Mirrors fog.set: the map (or user) may be gone by flush time.
    if (!stmt('SELECT 1 FROM maps WHERE id = ?').get(mapId)) return;
    try {
      stmt(
        `INSERT INTO door_memory (user_id, map_id, doors_json) VALUES (?, ?, ?)
         ON CONFLICT(user_id, map_id) DO UPDATE SET doors_json = excluded.doors_json`,
      ).run(userId, mapId, JSON.stringify(memory));
    } catch (err) {
      console.warn('door memory flush skipped:', err instanceof Error ? err.message : err);
    }
  },
  clearMap(mapId: string): void {
    stmt('DELETE FROM door_memory WHERE map_id = ?').run(mapId);
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
  folder_id?: string | null;
  parent_id?: string | null;
}

function toHandout(row: HandoutRow): Handout {
  const shares = stmt('SELECT user_id FROM handout_shares WHERE handout_id = ?').all(row.id) as Array<{ user_id: string }>;
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.body_md,
    imageUrl: assets.urlFor(row.asset_id),
    sharedAll: !!row.shared_all,
    sharedWith: shares.map((s) => s.user_id),
    folderId: row.folder_id ?? null,
    parentId: row.parent_id ?? null,
  };
}

export const handouts = {
  create(campaignId: string, title: string, bodyMd: string, assetId: string | null): Handout {
    const id = newId();
    stmt('INSERT INTO handouts (id, campaign_id, title, body_md, asset_id, shared_all, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(id, campaignId, title, bodyMd, assetId, now());
    return handouts.byId(id)!;
  },
  byId(id: string): Handout | undefined {
    const row = stmt('SELECT * FROM handouts WHERE id = ?').get(id) as HandoutRow | undefined;
    return row ? toHandout(row) : undefined;
  },
  forCampaign(campaignId: string): Handout[] {
    const rows = stmt('SELECT * FROM handouts WHERE campaign_id = ? ORDER BY created_at').all(campaignId) as HandoutRow[];
    return rows.map(toHandout);
  },
  update(id: string, fields: { title?: string; bodyMd?: string; assetId?: string | null; parentId?: string | null }): void {
    const cur = stmt('SELECT * FROM handouts WHERE id = ?').get(id) as HandoutRow | undefined;
    if (!cur) return;
    stmt('UPDATE handouts SET title = ?, body_md = ?, asset_id = ?, parent_id = ? WHERE id = ?').run(
      fields.title ?? cur.title,
      fields.bodyMd ?? cur.body_md,
      fields.assetId !== undefined ? fields.assetId : cur.asset_id,
      fields.parentId !== undefined ? fields.parentId : (cur.parent_id ?? null),
      id,
    );
  },
  share(id: string, to: string[] | 'all' | 'none'): void {
    // Clear-then-reinsert must be atomic: a crash between the DELETE and the
    // INSERTs would silently unshare the handout from everyone.
    db.transaction(() => {
      stmt('DELETE FROM handout_shares WHERE handout_id = ?').run(id);
      if (to === 'all') {
        stmt('UPDATE handouts SET shared_all = 1 WHERE id = ?').run(id);
      } else if (to === 'none') {
        stmt('UPDATE handouts SET shared_all = 0 WHERE id = ?').run(id);
      } else {
        stmt('UPDATE handouts SET shared_all = 0 WHERE id = ?').run(id);
        const ins = stmt('INSERT OR IGNORE INTO handout_shares (handout_id, user_id) VALUES (?, ?)');
        for (const userId of to) ins.run(id, userId);
      }
    })();
  },
  move(id: string, folderId: string | null): void {
    stmt('UPDATE handouts SET folder_id = ? WHERE id = ?').run(folderId, id);
  },
  delete(id: string): void {
    stmt('DELETE FROM handouts WHERE id = ?').run(id);
  },
};

// ---------- macros ----------

interface MacroRow {
  id: string; name: string; command: string; sort_order: number;
  color: string | null; character_id: string | null; rollable_id: string | null; action_id: string | null;
}

function toMacro(r: MacroRow): Macro {
  return {
    id: r.id, name: r.name, command: r.command, sortOrder: r.sort_order,
    color: r.color, characterId: r.character_id, rollableId: r.rollable_id, actionId: r.action_id,
  };
}

export const macros = {
  forUser(userId: string, campaignId: string): Macro[] {
    const rows = stmt(
      'SELECT id, name, command, sort_order, color, character_id, rollable_id, action_id FROM macros WHERE user_id = ? AND campaign_id = ? ORDER BY sort_order',
    ).all(userId, campaignId) as MacroRow[];
    return rows.map(toMacro);
  },
  byId(id: string): Macro | undefined {
    const r = stmt('SELECT id, name, command, sort_order, color, character_id, rollable_id, action_id FROM macros WHERE id = ?')
      .get(id) as MacroRow | undefined;
    return r ? toMacro(r) : undefined;
  },
  save(userId: string, campaignId: string, macro: {
    id?: string; name: string; command: string;
    color?: string | null; characterId?: string | null; rollableId?: string | null; actionId?: string | null;
  }): void {
    if (macro.id) {
      stmt('UPDATE macros SET name = ?, command = ?, color = ?, character_id = ?, rollable_id = ?, action_id = ? WHERE id = ? AND user_id = ?')
        .run(macro.name, macro.command, macro.color ?? null, macro.characterId ?? null, macro.rollableId ?? null, macro.actionId ?? null, macro.id, userId);
    } else {
      const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM macros WHERE user_id = ? AND campaign_id = ?')
        .get(userId, campaignId) as { m: number | null }).m ?? -1;
      stmt('INSERT INTO macros (id, user_id, campaign_id, name, command, sort_order, color, character_id, rollable_id, action_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), userId, campaignId, macro.name, macro.command, maxOrder + 1, macro.color ?? null, macro.characterId ?? null, macro.rollableId ?? null, macro.actionId ?? null);
    }
  },
  reorder(userId: string, campaignId: string, macroIds: string[]): void {
    const update = stmt('UPDATE macros SET sort_order = ? WHERE id = ? AND user_id = ? AND campaign_id = ?');
    const tx = db.transaction((ids: string[]) => {
      ids.forEach((id, i) => update.run(i, id, userId, campaignId));
    });
    tx(macroIds);
  },
  delete(userId: string, macroId: string): void {
    stmt('DELETE FROM macros WHERE id = ? AND user_id = ?').run(macroId, userId);
  },
};

// ---------- rollable tables ----------

interface TableRow {
  id: string; name: string; players_can_roll: number; items_json: string; sort_order: number; parent_id: string | null;
}

function toTable(r: TableRow): RollableTable {
  const raw = safeParse<Array<{ text: string; weight?: number }>>(r.items_json, []);
  return {
    id: r.id,
    name: r.name,
    playersCanRoll: !!r.players_can_roll,
    items: raw.map((it) => ({ text: it.text, weight: typeof it.weight === 'number' && it.weight > 0 ? it.weight : 1 })),
    parentId: r.parent_id ?? null,
  };
}

export const rollableTables = {
  forCampaign(campaignId: string): RollableTable[] {
    const rows = stmt('SELECT * FROM rollable_tables WHERE campaign_id = ? ORDER BY sort_order, name').all(campaignId) as TableRow[];
    return rows.map(toTable);
  },
  byId(id: string): (RollableTable & { campaignId: string }) | undefined {
    const r = stmt('SELECT * FROM rollable_tables WHERE id = ?').get(id) as (TableRow & { campaign_id: string }) | undefined;
    return r ? { ...toTable(r), campaignId: r.campaign_id } : undefined;
  },
  create(campaignId: string, name: string): RollableTable {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM rollable_tables WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO rollable_tables (id, campaign_id, name, players_can_roll, items_json, sort_order) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, campaignId, name, '[]', maxOrder + 1);
    return { id, name, playersCanRoll: true, items: [] };
  },
  update(id: string, fields: { name?: string; playersCanRoll?: boolean; items?: RollableTable['items']; parentId?: string | null }): void {
    const cur = stmt('SELECT * FROM rollable_tables WHERE id = ?').get(id) as TableRow | undefined;
    if (!cur) return;
    stmt('UPDATE rollable_tables SET name = ?, players_can_roll = ?, items_json = ?, parent_id = ? WHERE id = ?').run(
      fields.name ?? cur.name,
      fields.playersCanRoll !== undefined ? (fields.playersCanRoll ? 1 : 0) : cur.players_can_roll,
      fields.items !== undefined ? JSON.stringify(fields.items) : cur.items_json,
      fields.parentId !== undefined ? fields.parentId : cur.parent_id,
      id,
    );
  },
  delete(id: string): void {
    stmt('DELETE FROM rollable_tables WHERE id = ?').run(id);
  },
};

// ---------- chat ----------

interface ChatRow {
  id: number; user_id: string | null; from_name: string; kind: ChatKind; text: string;
  roll_json: string | null; recipients_json: string | null; hidden: number; created_at: number;
}

/** Redact a hidden message for non-DM recipients (DM sees the original). */
export function redactChat(msg: ChatMessage, isDm: boolean): ChatMessage {
  if (!msg.hidden || isDm) return msg;
  return { ...msg, text: 'The DM has hidden this message.', roll: null, recipients: null };
}

function toChatMsg(r: ChatRow): ChatMessage {
  return {
    id: r.id,
    kind: r.kind,
    fromUserId: r.user_id,
    fromName: r.from_name,
    text: r.text,
    roll: r.roll_json ? safeParse(r.roll_json, null) : null,
    recipients: r.recipients_json ? safeParse<string[] | null>(r.recipients_json, null) : null,
    at: r.created_at,
    hidden: r.hidden === 1,
  };
}

export const chat = {
  add(campaignId: string, msg: {
    userId: string | null; fromName: string; kind: ChatKind; text: string;
    roll: RollBreakdown | null; recipients: string[] | null;
  }, undo?: unknown): ChatMessage {
    const at = now();
    const info = stmt(
      `INSERT INTO chat_messages (campaign_id, user_id, from_name, kind, text, roll_json, recipients_json, hidden, undo_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      campaignId, msg.userId, msg.fromName, msg.kind, msg.text,
      msg.roll ? JSON.stringify(msg.roll) : null,
      msg.recipients ? JSON.stringify(msg.recipients) : null,
      undo ? JSON.stringify(undo) : null,
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
      hidden: false,
    };
  },
  byId(id: number): ChatMessage | undefined {
    const r = stmt('SELECT * FROM chat_messages WHERE id = ?').get(id) as ChatRow | undefined;
    return r ? toChatMsg(r) : undefined;
  },
  setHidden(id: number, hidden: boolean): void {
    stmt('UPDATE chat_messages SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  },
  /** The recorded reversible effects for a roll message (null once undone/absent). */
  undoFor(id: number): unknown {
    const r = stmt('SELECT undo_json FROM chat_messages WHERE id = ?').get(id) as { undo_json: string | null } | undefined;
    return r?.undo_json ? safeParse(r.undo_json, null) : null;
  },
  clearUndo(id: number): void {
    stmt('UPDATE chat_messages SET undo_json = NULL WHERE id = ?').run(id);
  },
  /** Last N messages visible to the given user (whispers filtered). */
  tailFor(campaignId: string, userId: string, username: string, isDm: boolean, limit: number): ChatMessage[] {
    const rows = stmt(
      'SELECT * FROM chat_messages WHERE campaign_id = ? ORDER BY id DESC LIMIT ?',
    ).all(campaignId, limit * 2) as ChatRow[];
    const out: ChatMessage[] = [];
    for (const r of rows) {
      const recipients = r.recipients_json ? safeParse<string[] | null>(r.recipients_json, null) : null;
      if (r.kind === 'whisper' && !isDm && r.user_id !== userId && !recipients?.includes(username)) continue;
      out.push(redactChat(toChatMsg(r), isDm));
      if (out.length >= limit) break;
    }
    return out.reverse();
  },
};

// ---------- initiative ----------

export const EMPTY_INITIATIVE: InitiativeState = { entries: [], turnIdx: 0, round: 1, active: false };

export const initiative = {
  get(campaignId: string): InitiativeState {
    const row = stmt('SELECT state_json FROM initiative WHERE campaign_id = ?').get(campaignId) as { state_json: string } | undefined;
    return row ? safeParse(row.state_json, structuredClone(EMPTY_INITIATIVE)) : structuredClone(EMPTY_INITIATIVE);
  },
  set(campaignId: string, state: InitiativeState): void {
    stmt(
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
    shape: safeParse(row.shape_json, { kind: 'line' as const, a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, color: '#fff', width: 1 }),
  };
}

export const drawings = {
  add(mapId: string, authorId: string, layer: 'map' | 'gm', shape: object): Drawing {
    const id = newId();
    stmt('INSERT INTO drawings (id, map_id, author_id, layer, shape_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, mapId, authorId, layer, JSON.stringify(shape), now());
    return toDrawing({ id, map_id: mapId, author_id: authorId, layer, shape_json: JSON.stringify(shape) });
  },
  byId(id: string): Drawing | undefined {
    const row = stmt('SELECT * FROM drawings WHERE id = ?').get(id) as DrawingRow | undefined;
    return row ? toDrawing(row) : undefined;
  },
  forMap(mapId: string): Drawing[] {
    const rows = stmt('SELECT * FROM drawings WHERE map_id = ? ORDER BY created_at').all(mapId) as DrawingRow[];
    return rows.map(toDrawing);
  },
  delete(id: string): void {
    stmt('DELETE FROM drawings WHERE id = ?').run(id);
  },
  clearLayer(mapId: string, layer: 'map' | 'gm'): void {
    stmt('DELETE FROM drawings WHERE map_id = ? AND layer = ?').run(mapId, layer);
  },
};

// ─── custom NPCs (user-scoped, reusable across campaigns) ──────────

interface CustomNpcRow {
  id: string;
  user_id: string;
  system: string;
  name: string;
  category: string;
  challenge_label: string;
  ac: number;
  hp: number;
  sheet_json: string;
  color: string | null;
  art_asset_id: string | null;
  created_at: number;
}

export interface CustomNpcDef {
  id: string;
  userId: string;
  system: GameSystem;
  name: string;
  category: string;
  challengeLabel: string;
  ac: number;
  hp: number;
  sheet: SheetData;
  color: string | null;
  artAssetId: string | null;
}

function toCustomNpc(row: CustomNpcRow): CustomNpcDef {
  return {
    id: row.id,
    userId: row.user_id,
    system: row.system as GameSystem,
    name: row.name,
    category: row.category,
    challengeLabel: row.challenge_label,
    ac: row.ac,
    hp: row.hp,
    sheet: safeParse(row.sheet_json, {}),
    color: row.color,
    artAssetId: row.art_asset_id,
  };
}

export const customNpcs = {
  forUser(userId: string): CustomNpcDef[] {
    return (stmt('SELECT * FROM custom_npcs WHERE user_id = ? ORDER BY name').all(userId) as CustomNpcRow[]).map(toCustomNpc);
  },
  forUserSystem(userId: string, system: GameSystem): CustomNpcDef[] {
    return (stmt('SELECT * FROM custom_npcs WHERE user_id = ? AND system = ? ORDER BY name').all(userId, system) as CustomNpcRow[]).map(toCustomNpc);
  },
  byId(id: string): CustomNpcDef | undefined {
    const row = stmt('SELECT * FROM custom_npcs WHERE id = ?').get(id) as CustomNpcRow | undefined;
    return row ? toCustomNpc(row) : undefined;
  },
  create(userId: string, system: GameSystem, name: string, ac: number, hp: number, challengeLabel: string, sheet: SheetData, color: string | null, artAssetId: string | null): CustomNpcDef {
    const id = newId();
    stmt('INSERT INTO custom_npcs (id, user_id, system, name, category, challenge_label, ac, hp, sheet_json, color, art_asset_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, system, name, 'Player Added', challengeLabel, ac, hp, JSON.stringify(sheet), color, artAssetId, now());
    return toCustomNpc({ id, user_id: userId, system, name, category: 'Player Added', challenge_label: challengeLabel, ac, hp, sheet_json: JSON.stringify(sheet), color, art_asset_id: artAssetId, created_at: now() });
  },
  delete(id: string): void {
    stmt('DELETE FROM custom_npcs WHERE id = ?').run(id);
  },
};

// ─── map objects (loot items & chests on maps) ──────────────────────

interface MapObjectRow {
  id: string;
  map_id: string;
  name: string;
  description: string;
  kind: string;
  q: number;
  r: number;
  art_asset_id: string | null;
  items_json: string;
  created_at: number;
}

function toMapObject(row: MapObjectRow) {
  return {
    id: row.id,
    mapId: row.map_id,
    name: row.name,
    description: row.description,
    kind: row.kind as 'item' | 'chest',
    q: row.q,
    r: row.r,
    artAssetId: row.art_asset_id,
    items: safeParse<LootItem[]>(row.items_json, []),
  };
}

export const mapObjects = {
  forMap(mapId: string) {
    return (stmt('SELECT * FROM map_objects WHERE map_id = ? ORDER BY created_at').all(mapId) as MapObjectRow[]).map(toMapObject);
  },
  byId(id: string) {
    const row = stmt('SELECT * FROM map_objects WHERE id = ?').get(id) as MapObjectRow | undefined;
    return row ? toMapObject(row) : undefined;
  },
  create(mapId: string, kind: 'item' | 'chest', name: string, description: string, q: number, r: number) {
    const id = newId();
    stmt('INSERT INTO map_objects (id, map_id, name, description, kind, q, r, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, mapId, name, description, kind, q, r, '[]', now());
    return toMapObject({ id, map_id: mapId, name, description, kind, q, r, art_asset_id: null, items_json: '[]', created_at: now() });
  },
  update(id: string, patch: { name?: string; description?: string; artAssetId?: string; q?: number; r?: number; items?: unknown[] }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
    if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description); }
    if (patch.artAssetId !== undefined) { sets.push('art_asset_id = ?'); vals.push(patch.artAssetId); }
    if (patch.q !== undefined) { sets.push('q = ?'); vals.push(patch.q); }
    if (patch.r !== undefined) { sets.push('r = ?'); vals.push(patch.r); }
    if (patch.items !== undefined) { sets.push('items_json = ?'); vals.push(JSON.stringify(patch.items)); }
    if (sets.length === 0) return;
    vals.push(id);
    stmt(`UPDATE map_objects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  },
  delete(id: string): void {
    stmt('DELETE FROM map_objects WHERE id = ?').run(id);
  },
};
