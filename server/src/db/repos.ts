import type {
  AssetFolder, AssetInfo, AudioTrack,
  CampaignInfo, Character, ChatKind, ChatMessage, CustomItem, DiceSpeed, Door, Drawing, GameSystem,
  GridConfig, Handout, InitiativeState, LocationNode, Light, LootItem, Macro, MapDef, MapMeta, MapText,
  Counter, MapZone, RollableTable, RollBreakdown, Role, SheetCard, SheetData, Shop, ShopItem, SoundboardSlot, RollCalloutInfo, Token, Wall, WorldFolder,
} from 'shared';
import { isAceStyle, isCounterPosition, statEntriesFromDice, type AceStyle, type DiceLook, type DieRoll, type RollStatRow, type UndoEntry } from 'shared';
import { db, newId, now, stmt } from './db.js';

/** SWADE's dice roles, and the column each one persists to. */
export type DiceRole = 'trait' | 'wild' | 'raise';
const DICE_ROLE_COLUMNS: Record<DiceRole, string> = {
  trait: 'dice_trait_color',
  wild: 'dice_wild_color',
  raise: 'dice_raise_color',
};

export interface MemberRow {
  userId: string;
  username: string;
  role: Role;
  mapId: string | null;
  diceColor: string | null;
  diceTextColor: string | null;
  diceTraitColor: string | null;
  diceWildColor: string | null;
  diceRaiseColor: string | null;
  playerColor: string | null;
  diceBouncePct: number | null;
  diceAceStyle: AceStyle | null;
  /** 1/0/null in the row; null means never chosen, which is ON. */
  turnGuide: number | null;
}

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
  /** SWADE's per-role dice colors. The column is picked from a fixed map, so
   *  an unknown role can never reach the SQL. */
  setDiceRoleColor(userId: string, role: DiceRole, color: string | null): void {
    const col = DICE_ROLE_COLUMNS[role];
    stmt(`UPDATE users SET ${col} = ? WHERE id = ?`).run(color, userId);
  },
  setPlayerColor(userId: string, color: string | null): void {
    stmt('UPDATE users SET player_color = ? WHERE id = ?').run(color, userId);
  },
  /** Share of this account's dice that bounce off a wall; null = the default. */
  /** How this account's aced dice celebrate; null = the default. */
  setDiceAceStyle(userId: string, style: AceStyle | null): void {
    stmt('UPDATE users SET dice_ace_style = ? WHERE id = ?').run(style, userId);
  },
  setTurnGuide(userId: string, on: boolean): void {
    stmt('UPDATE users SET turn_guide = ? WHERE id = ?').run(on ? 1 : 0, userId);
  },
  setDiceBouncePct(userId: string, pct: number | null): void {
    stmt('UPDATE users SET dice_bounce_pct = ? WHERE id = ?').run(pct, userId);
  },
  /** This account's saved audio mix; null means "never set" (use full volume). */
  volumes(userId: string): { music: number | null; sfx: number | null } {
    const r = stmt('SELECT music_volume as music, sfx_volume as sfx FROM users WHERE id = ?')
      .get(userId) as { music: number | null; sfx: number | null } | undefined;
    return { music: r?.music ?? null, sfx: r?.sfx ?? null };
  },
  setVolumes(userId: string, music: number, sfx: number): void {
    const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
    stmt('UPDATE users SET music_volume = ?, sfx_volume = ? WHERE id = ?').run(clamp(music), clamp(sfx), userId);
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
  dice_speed?: string | null;
}

function toCampaignInfo(row: CampaignRow): CampaignInfo {
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    dmUserId: row.dm_user_id,
    inviteCode: row.invite_code,
    activeMapId: row.active_map_id,
    diceSpeed: isDiceSpeed(row.dice_speed) ? row.dice_speed : 'cinematic',
  };
}

/** A stored value that is still one of the speeds this build knows about. */
export function isDiceSpeed(v: unknown): v is DiceSpeed {
  return v === 'cinematic' || v === 'brisk' || v === 'instant';
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
    // Seed a starter map and make it active: a campaign with no maps opens
    // onto an empty black stage, which reads as a broken load.
    const starter = maps.create(id, 'Starting Map');
    campaigns.setActiveMap(id, starter.id);
    return toCampaignInfo({ id, name, system, dm_user_id: dmUserId, invite_code: inviteCode, active_map_id: starter.id });
  },
  byId(id: string): CampaignInfo | undefined {
    const row = stmt('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
    return row ? toCampaignInfo(row) : undefined;
  },
  /**
   * The GM's Benny pool. The book gives them one per player character each
   * session, and the villains' Jokers pay into the same pot — so it belongs
   * to the campaign rather than to any one NPC sheet.
   */
  gmBennies(id: string): number {
    const r = stmt('SELECT gm_bennies FROM campaigns WHERE id = ?').get(id) as { gm_bennies?: number } | undefined;
    return Math.max(0, Number(r?.gm_bennies ?? 0));
  },
  setGmBennies(id: string, n: number): number {
    const next = Math.max(0, Math.floor(n));
    stmt('UPDATE campaigns SET gm_bennies = ? WHERE id = ?').run(next, id);
    return next;
  },
  /** In-world elapsed seconds — the clock the GM advances. */
  clockSeconds(id: string): number {
    const r = stmt('SELECT clock_seconds FROM campaigns WHERE id = ?').get(id) as { clock_seconds?: number } | undefined;
    return Math.max(0, Number(r?.clock_seconds ?? 0));
  },
  setDiceSpeed(id: string, speed: DiceSpeed): void {
    stmt('UPDATE campaigns SET dice_speed = ? WHERE id = ?').run(speed, id);
  },
  moveLocked(id: string): boolean {
    const row = stmt('SELECT move_locked FROM campaigns WHERE id = ?').get(id) as { move_locked?: number } | undefined;
    return row?.move_locked === 1;
  },
  setMoveLocked(id: string, locked: boolean): void {
    stmt('UPDATE campaigns SET move_locked = ? WHERE id = ?').run(locked ? 1 : 0, id);
  },
  setClockSeconds(id: string, seconds: number): number {
    const next = Math.max(0, Math.floor(seconds));
    stmt('UPDATE campaigns SET clock_seconds = ? WHERE id = ?').run(next, id);
    return next;
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
  removeMember(campaignId: string, userId: string): void {
    stmt('DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?').run(campaignId, userId);
  },
  memberRole(campaignId: string, userId: string): Role | undefined {
    const row = stmt('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, userId) as { role: Role } | undefined;
    return row?.role;
  },
  members(campaignId: string): MemberRow[] {
    return (stmt(
      `SELECT m.user_id as userId, u.username, m.role, m.map_id as mapId,
              u.dice_color as diceColor, u.dice_text_color as diceTextColor,
              u.dice_trait_color as diceTraitColor, u.dice_wild_color as diceWildColor,
              u.dice_raise_color as diceRaiseColor, u.player_color as playerColor,
              u.dice_bounce_pct as diceBouncePct, u.dice_ace_style as diceAceStyle,
              u.turn_guide as turnGuide
       FROM campaign_members m
       JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ?`,
    ).all(campaignId) as MemberRow[]);
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
  linked_character_id: string | null; art_asset_id: string | null;
  detail_asset_id?: string | null;
}
function toShop(r: ShopRow): Shop {
  const items = (safeParse<Array<Partial<ShopItem>>>(r.items_json, [])).map((it) => ({
    name: String(it.name ?? ''),
    price: typeof it.price === 'number' ? it.price : 0,
    qty: typeof it.qty === 'number' ? it.qty : -1,
    notes: String(it.notes ?? ''),
    ...(it.contentId ? { contentId: String(it.contentId) } : {}),
    ...(it.effect === 'heal' || it.effect === 'damage' ? { effect: it.effect } : {}),
    ...(it.amount ? { amount: String(it.amount) } : {}),
    ...(typeof it.range === 'number' ? { range: it.range } : {}),
  }));
  return {
    id: r.id, name: r.name, description: r.description, currency: r.currency,
    playersCanBuy: !!r.players_can_buy, items, parentId: r.parent_id ?? null,
    linkedCharacterId: r.linked_character_id ?? null,
    artAssetId: r.art_asset_id ?? null,
    detailAssetId: r.detail_asset_id ?? null,
    detailUrl: assets.urlFor(r.detail_asset_id ?? null),
  };
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
    stmt('INSERT INTO shops (id, campaign_id, name, currency, players_can_buy, sort_order) VALUES (?, ?, ?, ?, 0, ?)').run(id, campaignId, name, currency, maxOrder + 1);
    // Hidden until the DM opens it: a freshly created shop is prep work, not
    // something the party can already browse and buy from.
    return { id, name, description: '', currency, playersCanBuy: false, items: [] };
  },
  update(id: string, fields: { name?: string; description?: string; currency?: string; playersCanBuy?: boolean; items?: ShopItem[]; parentId?: string | null; linkedCharacterId?: string | null; artAssetId?: string | null; detailAssetId?: string | null }): void {
    const cur = stmt('SELECT * FROM shops WHERE id = ?').get(id) as ShopRow | undefined;
    if (!cur) return;
    stmt('UPDATE shops SET name = ?, description = ?, currency = ?, players_can_buy = ?, items_json = ?, parent_id = ?, linked_character_id = ?, art_asset_id = ?, detail_asset_id = ? WHERE id = ?').run(
      fields.name ?? cur.name,
      fields.description ?? cur.description,
      fields.currency ?? cur.currency,
      fields.playersCanBuy !== undefined ? (fields.playersCanBuy ? 1 : 0) : cur.players_can_buy,
      fields.items !== undefined ? JSON.stringify(fields.items) : cur.items_json,
      fields.parentId !== undefined ? fields.parentId : cur.parent_id,
      fields.linkedCharacterId !== undefined ? fields.linkedCharacterId : (cur.linked_character_id ?? null),
      fields.artAssetId !== undefined ? fields.artAssetId : (cur.art_asset_id ?? null),
      fields.detailAssetId !== undefined ? (fields.detailAssetId || null) : (cur.detail_asset_id ?? null),
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
  items_json: string; display_kind: string; art_asset_id: string | null;
}
function toWorldFolder(r: WorldFolderRow): WorldFolder {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    items: safeParse<LootItem[]>(r.items_json ?? '[]', []),
    displayKind: (r.display_kind ?? 'folder') as 'folder' | 'chest',
    artAssetId: r.art_asset_id ?? null,
  };
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
  create(campaignId: string, name: string, parentId: string | null, opts?: { displayKind?: 'folder' | 'chest'; items?: LootItem[] }): WorldFolder {
    const id = newId();
    const dk = opts?.displayKind ?? 'folder';
    const itemsJson = JSON.stringify(opts?.items ?? []);
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM world_folders WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO world_folders (id, campaign_id, name, parent_id, sort_order, display_kind, items_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, campaignId, name, parentId, maxOrder + 1, dk, itemsJson);
    return { id, name, parentId, items: opts?.items ?? [], displayKind: dk, artAssetId: null };
  },
  update(id: string, fields: Partial<Omit<WorldFolder, 'id'>>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.parentId !== undefined) { sets.push('parent_id = ?'); vals.push(fields.parentId); }
    if (fields.items !== undefined) { sets.push('items_json = ?'); vals.push(JSON.stringify(fields.items)); }
    if (fields.displayKind !== undefined) { sets.push('display_kind = ?'); vals.push(fields.displayKind); }
    if (fields.artAssetId !== undefined) { sets.push('art_asset_id = ?'); vals.push(fields.artAssetId); }
    if (sets.length === 0) return;
    vals.push(id);
    stmt(`UPDATE world_folders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  },
  delete(id: string): void {
    const cur = stmt('SELECT parent_id FROM world_folders WHERE id = ?').get(id) as { parent_id: string | null } | undefined;
    stmt('UPDATE world_folders SET parent_id = ? WHERE parent_id = ?').run(cur?.parent_id ?? null, id);
    stmt('DELETE FROM world_folders WHERE id = ?').run(id);
  },
};

// ---------- audio tracks ----------

export const audioTracks = {
  forCampaign(campaignId: string): AudioTrack[] {
    const rows = stmt(
      `SELECT t.id, t.title, t.playlist, a.ext, a.id as assetId FROM audio_tracks t
       JOIN assets a ON a.id = t.asset_id WHERE t.campaign_id = ? ORDER BY t.playlist, t.sort_order, t.title`,
    ).all(campaignId) as Array<{ id: string; title: string; playlist: number | null; ext: string; assetId: string }>;
    return rows.map((r) => ({ id: r.id, title: r.title, url: `/uploads/${r.assetId}.${r.ext}`, playlist: r.playlist ?? 0 }));
  },
  byId(id: string): { id: string; url: string; campaignId: string } | undefined {
    const r = stmt(
      `SELECT t.id, t.campaign_id, a.ext, a.id as assetId FROM audio_tracks t
       JOIN assets a ON a.id = t.asset_id WHERE t.id = ?`,
    ).get(id) as { id: string; campaign_id: string; ext: string; assetId: string } | undefined;
    return r ? { id: r.id, url: `/uploads/${r.assetId}.${r.ext}`, campaignId: r.campaign_id } : undefined;
  },
  /** How many tracks a playlist already holds — the cap is enforced above. */
  countIn(campaignId: string, playlist: number): number {
    return (stmt('SELECT COUNT(*) as n FROM audio_tracks WHERE campaign_id = ? AND playlist = ?')
      .get(campaignId, playlist) as { n: number }).n;
  },
  add(campaignId: string, assetId: string, title: string, playlist = 0): void {
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM audio_tracks WHERE campaign_id = ? AND playlist = ?')
      .get(campaignId, playlist) as { m: number | null }).m ?? -1;
    stmt('INSERT INTO audio_tracks (id, campaign_id, asset_id, title, sort_order, playlist) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), campaignId, assetId, title, maxOrder + 1, playlist);
  },
  remove(id: string): void {
    stmt('DELETE FROM audio_tracks WHERE id = ?').run(id);
  },
};

// ---------- soundboard ----------

export const SOUNDBOARD_SLOTS = 48; // 3 pages of 4x4

export const soundboard = {
  forCampaign(campaignId: string): SoundboardSlot[] {
    const rows = stmt(
      `SELECT s.slot_index as slotIndex, s.label, a.ext, a.id as assetId FROM soundboard_slots s
       JOIN assets a ON a.id = s.asset_id WHERE s.campaign_id = ? ORDER BY s.slot_index`,
    ).all(campaignId) as Array<{ slotIndex: number; label: string; ext: string; assetId: string }>;
    return rows.map((r) => ({ slotIndex: r.slotIndex, label: r.label, url: `/uploads/${r.assetId}.${r.ext}` }));
  },
  /** One slot's playable URL, scoped to the campaign so a stray index can't
   *  reach another table's sounds. */
  urlAt(campaignId: string, slotIndex: number): string | undefined {
    const r = stmt(
      `SELECT a.ext, a.id as assetId FROM soundboard_slots s
       JOIN assets a ON a.id = s.asset_id WHERE s.campaign_id = ? AND s.slot_index = ?`,
    ).get(campaignId, slotIndex) as { ext: string; assetId: string } | undefined;
    return r ? `/uploads/${r.assetId}.${r.ext}` : undefined;
  },
  /** Assigning to an occupied slot replaces what was there. */
  set(campaignId: string, slotIndex: number, assetId: string, label: string): void {
    stmt('DELETE FROM soundboard_slots WHERE campaign_id = ? AND slot_index = ?').run(campaignId, slotIndex);
    stmt('INSERT INTO soundboard_slots (id, campaign_id, asset_id, label, slot_index) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), campaignId, assetId, label, slotIndex);
  },
  clear(campaignId: string, slotIndex: number): void {
    stmt('DELETE FROM soundboard_slots WHERE campaign_id = ? AND slot_index = ?').run(campaignId, slotIndex);
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
  is_scene?: number;
  texts_json: string;
  zones_json?: string | null;
  spawn_json: string | null;
  terrain_json: string;
  blocked_json?: string;
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

/**
 * Scenes are backdrops for a conversation or a cutscene, not tactical
 * battlemaps: nobody counts hexes across one. So they start with a coarse
 * grid and the lines switched off — the hex math still runs underneath
 * (snapping, distance, vision), it just isn't drawn.
 */
export const DEFAULT_SCENE_GRID: GridConfig = {
  ...DEFAULT_GRID,
  hexSize: 30,
  cols: 50,
  rows: 50,
  gridEnabled: false,
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
    texts: safeParse(row.texts_json, []),
    zones: safeParse(row.zones_json ?? '[]', []),
    isScene: row.is_scene === 1,
    spawn: row.spawn_json ? safeParse(row.spawn_json, null) : null,
    terrain: safeParse(row.terrain_json, []),
    blocked: safeParse(row.blocked_json ?? '[]', []),
  };
}

export const maps = {
  create(campaignId: string, name: string, isScene = false): MapDef & { campaignId: string; bgAssetId: string | null } {
    const id = newId();
    const maxOrder = (stmt('SELECT MAX(sort_order) as m FROM maps WHERE campaign_id = ?').get(campaignId) as { m: number | null }).m ?? -1;
    stmt(
      'INSERT INTO maps (id, campaign_id, name, bg_asset_id, grid_json, sort_order, is_scene) VALUES (?, ?, ?, NULL, ?, ?, ?)',
    ).run(id, campaignId, name, JSON.stringify(isScene ? DEFAULT_SCENE_GRID : DEFAULT_GRID), maxOrder + 1, isScene ? 1 : 0);
    return maps.byId(id)!;
  },
  byId(id: string): (MapDef & { campaignId: string; bgAssetId: string | null }) | undefined {
    const row = stmt('SELECT * FROM maps WHERE id = ?').get(id) as MapRow | undefined;
    return row ? toMapDef(row) : undefined;
  },
  forCampaign(campaignId: string): MapMeta[] {
    const rows = stmt('SELECT id, name, sort_order, parent_id, is_scene FROM maps WHERE campaign_id = ? ORDER BY sort_order').all(campaignId) as Array<{ id: string; name: string; sort_order: number; parent_id: string | null; is_scene: number }>;
    return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, parentId: r.parent_id ?? null, isScene: r.is_scene === 1 }));
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
  setTexts(id: string, texts: MapText[]): void {
    stmt('UPDATE maps SET texts_json = ? WHERE id = ?').run(JSON.stringify(texts), id);
  },
  setZones(id: string, zones: MapZone[]): void {
    stmt('UPDATE maps SET zones_json = ? WHERE id = ?').run(JSON.stringify(zones), id);
  },
  setLights(id: string, lights: Light[]): void {
    stmt('UPDATE maps SET lights_json = ? WHERE id = ?').run(JSON.stringify(lights), id);
  },
  setTerrain(id: string, terrain: number[]): void {
    stmt('UPDATE maps SET terrain_json = ? WHERE id = ?').run(JSON.stringify(terrain), id);
  },
  setBlocked(id: string, blocked: number[]): void {
    stmt('UPDATE maps SET blocked_json = ? WHERE id = ?').run(JSON.stringify(blocked), id);
  },
  delete(id: string): void {
    stmt('DELETE FROM maps WHERE id = ?').run(id);
  },
};

// ---------- tokens ----------

interface TokenRow {
  id: string;
  revealed_at?: number | null;
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
  conditions_json: string | null;
  mountable: number;
  mounted_on: string | null;
  max_riders: number;
  driver_token_id: string | null;
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
    revealedAt: row.revealed_at ?? null,
    size: row.size,
    shape: (row.shape as Token['shape']) ?? 'circle',
    color: row.color,
    vision: row.vision_json ? safeParse(row.vision_json, null) : null,
    bar: row.bar_json ? safeParse(row.bar_json, null) : null,
    conditions: row.conditions_json ? safeParse<string[]>(row.conditions_json, []) : null,
    mountable: row.mountable === 1,
    mountedOn: row.mounted_on,
    maxRiders: Math.max(1, Number(row.max_riders ?? 1)),
    driverTokenId: row.driver_token_id ?? null,
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
  relocate(id: string, mapId: string, q: number, r: number): void {
    stmt('UPDATE tokens SET map_id = ?, q = ?, r = ? WHERE id = ?').run(mapId, q, r, id);
  },
  update(id: string, patch: {
    name?: string; layer?: 'token' | 'gm'; size?: number; shape?: string; color?: string;
    characterId?: string | null; artAssetId?: string | null;
    vision?: object | null; bar?: object | null; light?: object | null;
    conditions?: string[] | null;
    mountable?: boolean; mountedOn?: string | null; maxRiders?: number; driverTokenId?: string | null;
  }): void {
    const cur = stmt('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined;
    if (!cur) return;
    stmt(
      `UPDATE tokens SET name = ?, layer = ?, size = ?, shape = ?, color = ?, character_id = ?, art_asset_id = ?, vision_json = ?, bar_json = ?, conditions_json = ?, mountable = ?, mounted_on = ?, max_riders = ?, driver_token_id = ?, light_json = ?, revealed_at = ?
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
      patch.conditions !== undefined ? (patch.conditions ? JSON.stringify(patch.conditions) : null) : cur.conditions_json,
      patch.mountable !== undefined ? (patch.mountable ? 1 : 0) : cur.mountable,
      patch.mountedOn !== undefined ? patch.mountedOn : cur.mounted_on,
      patch.maxRiders !== undefined ? Math.max(1, Math.floor(patch.maxRiders)) : cur.max_riders,
      patch.driverTokenId !== undefined ? patch.driverTokenId : cur.driver_token_id,
      patch.light !== undefined ? (patch.light ? JSON.stringify(patch.light) : null) : cur.light_json,
      // Crossing from the GM layer onto the visible one is a reveal: stamp it
      // so players fade the piece in rather than have it blink into being.
      patch.layer === 'token' && cur.layer === 'gm' ? now() : cur.revealed_at ?? null,
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
  /** Every macro bound to this character, across all users — a DM and a
   *  player can both have pinned the same weapon. */
  forCharacter(characterId: string): { id: string; userId: string; actionId: string | null; rollableId: string | null }[] {
    return stmt(
      'SELECT id, user_id AS userId, action_id AS actionId, rollable_id AS rollableId FROM macros WHERE character_id = ?',
    ).all(characterId) as { id: string; userId: string; actionId: string | null; rollableId: string | null }[];
  },
  /** Repoint one macro's bindings without touching its name, color or owner. */
  setBinding(id: string, actionId: string | null, rollableId: string | null): void {
    stmt('UPDATE macros SET action_id = ?, rollable_id = ? WHERE id = ?').run(actionId, rollableId, id);
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
    stmt('INSERT INTO rollable_tables (id, campaign_id, name, players_can_roll, items_json, sort_order) VALUES (?, ?, ?, 0, ?, ?)')
      .run(id, campaignId, name, '[]', maxOrder + 1);
    // DM prep by default — the DM flips playersCanRoll when the table is
    // meant to be public.
    return { id, name, playersCanRoll: false, items: [] };
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
  id: number; user_id: string | null; from_name: string; from_character: string | null; character_id: string | null; action_name: string | null; outcome_note: string | null; kind: ChatKind; text: string;
  roll_json: string | null; recipients_json: string | null; hidden: number; created_at: number;
  card_json: string | null; callout_json: string | null; thread_id: number | null;
}

/** Redact a hidden message for non-DM recipients (DM sees the original). */
export function redactChat(msg: ChatMessage, isDm: boolean): ChatMessage {
  if (!msg.hidden || isDm) return msg;
  return { ...msg, text: 'The DM has hidden this message.', roll: null, recipients: null, card: null };
}

function toChatMsg(r: ChatRow): ChatMessage {
  return {
    id: r.id,
    kind: r.kind,
    fromUserId: r.user_id,
    fromName: r.from_name,
    fromCharacter: r.from_character,
    characterId: r.character_id ?? null,
    actionName: r.action_name,
    outcomeNote: r.outcome_note,
    text: r.text,
    roll: r.roll_json ? safeParse(r.roll_json, null) : null,
    recipients: r.recipients_json ? safeParse<string[] | null>(r.recipients_json, null) : null,
    at: r.created_at,
    hidden: r.hidden === 1,
    ...(r.card_json ? { card: safeParse<ChatMessage['card']>(r.card_json, null) } : {}),
    ...(r.callout_json ? { callout: safeParse<ChatMessage['callout']>(r.callout_json, null) } : {}),
  };
}

export type WorldVisKind = 'map' | 'token' | 'character';

/** In-memory dedupe so the per-vision-sync discovery writes stay cheap.
 *  Keyed `${campaignId}:${userId}`; the empty-user key caches the union of
 *  every player's knowledge (the DM's world-tab badges). */
const discoveryCache = new Map<string, Set<string>>();

/**
 * World-tab knowledge, PER PLAYER: what this player's own tokens have had in
 * sight. A new member starts blank — they inherit nothing from the party.
 * The DM's manual reveal/hide overrides stay campaign-wide.
 */
export const worldVis = {
  /**
   * Wipe one player's world knowledge (or the whole campaign's when no user
   * is named): they go back to a blank map and rediscover by looking. Needed
   * because knowledge belongs to the ACCOUNT, not the character — rolling a
   * new character doesn't forget what that player already scouted, and a
   * campaign that predates per-player tracking seeded everyone with the
   * party's shared history.
   */
  forget(campaignId: string, userId?: string): number {
    const res = userId
      ? stmt('DELETE FROM world_discovery WHERE campaign_id = ? AND user_id = ?').run(campaignId, userId)
      : stmt('DELETE FROM world_discovery WHERE campaign_id = ?').run(campaignId);
    // Drop this campaign's cached sets, including the DM's union key.
    for (const k of [...discoveryCache.keys()]) {
      if (k.startsWith(`${campaignId}:`)) discoveryCache.delete(k);
    }
    return res.changes;
  },

  /** Record newly-seen things for one player; returns how many were new. */
  discover(campaignId: string, userId: string, entries: Array<{ kind: WorldVisKind; key: string }>): number {
    const cacheKey = `${campaignId}:${userId}`;
    let cache = discoveryCache.get(cacheKey);
    if (!cache) {
      cache = new Set(
        (stmt('SELECT kind, key FROM world_discovery WHERE campaign_id = ? AND user_id = ?')
          .all(campaignId, userId) as Array<{ kind: string; key: string }>)
          .map((r) => `${r.kind}:${r.key}`),
      );
      discoveryCache.set(cacheKey, cache);
    }
    const ins = stmt('INSERT OR IGNORE INTO world_discovery (campaign_id, user_id, kind, key) VALUES (?, ?, ?, ?)');
    let added = 0;
    for (const e of entries) {
      const k = `${e.kind}:${e.key}`;
      if (cache.has(k)) continue;
      cache.add(k);
      ins.run(campaignId, userId, e.kind, e.key);
      added++;
    }
    // The union view (DM badges) is stale the moment any player learns more.
    if (added > 0) discoveryCache.delete(`${campaignId}:`);
    return added;
  },
  /** One player's knowledge; omit userId for the union across all players
   *  (what the DM's world-tab badges report as "seen by someone"). */
  discovered(campaignId: string, userId?: string): Set<string> {
    const cacheKey = `${campaignId}:${userId ?? ''}`;
    let cache = discoveryCache.get(cacheKey);
    if (!cache) {
      const rows = userId
        ? stmt('SELECT kind, key FROM world_discovery WHERE campaign_id = ? AND user_id = ?').all(campaignId, userId)
        : stmt('SELECT DISTINCT kind, key FROM world_discovery WHERE campaign_id = ?').all(campaignId);
      cache = new Set((rows as Array<{ kind: string; key: string }>).map((r) => `${r.kind}:${r.key}`));
      discoveryCache.set(cacheKey, cache);
    }
    return cache;
  },
  overrides(campaignId: string): Map<string, 'reveal' | 'hide'> {
    const rows = stmt('SELECT kind, key, mode FROM world_override WHERE campaign_id = ?').all(campaignId) as Array<{ kind: string; key: string; mode: 'reveal' | 'hide' }>;
    return new Map(rows.map((r) => [`${r.kind}:${r.key}`, r.mode]));
  },
  setOverride(campaignId: string, kind: WorldVisKind, key: string, mode: 'reveal' | 'hide' | null): void {
    if (mode === null) {
      stmt('DELETE FROM world_override WHERE campaign_id = ? AND kind = ? AND key = ?').run(campaignId, kind, key);
    } else {
      stmt(`INSERT INTO world_override (campaign_id, kind, key, mode) VALUES (?, ?, ?, ?)
            ON CONFLICT(campaign_id, kind, key) DO UPDATE SET mode = excluded.mode`).run(campaignId, kind, key, mode);
    }
  },
};

/** DM counters: segmented banner bars pinned to a map pane. */
export const counters = {
  create(campaignId: string, mapId: string): Counter {
    const id = newId();
    stmt(`INSERT INTO counters (id, campaign_id, map_id, created_at) VALUES (?, ?, ?, ?)`).run(id, campaignId, mapId, now());
    return this.byId(id)!;
  },
  byId(id: string): Counter | undefined {
    const row = stmt('SELECT * FROM counters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toCounter(row) : undefined;
  },
  forMap(mapId: string): Counter[] {
    return (stmt('SELECT * FROM counters WHERE map_id = ? ORDER BY created_at').all(mapId) as Array<Record<string, unknown>>).map(toCounter);
  },
  forCampaign(campaignId: string): Counter[] {
    return (stmt('SELECT * FROM counters WHERE campaign_id = ? ORDER BY created_at').all(campaignId) as Array<Record<string, unknown>>).map(toCounter);
  },
  update(id: string, patch: Partial<Counter>): void {
    const cur = this.byId(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    stmt(`UPDATE counters SET map_id = ?, name = ?, color = ?, max = ?, value = ?, visible = ?, shared_with = ?, position = ? WHERE id = ?`)
      .run(next.mapId, next.name, next.color, next.max, next.value, next.visible ? 1 : 0,
        next.sharedWith === null ? null : JSON.stringify(next.sharedWith), next.position, id);
  },
  delete(id: string): void {
    stmt('DELETE FROM counters WHERE id = ?').run(id);
  },
};

/** Manual world-tree sibling ordering: "kind:id" → rank, campaign-scoped. */
export const worldSort = {
  forCampaign(campaignId: string): Record<string, number> {
    const rows = stmt('SELECT key, sort_order FROM world_sort WHERE campaign_id = ?').all(campaignId) as Array<{ key: string; sort_order: number }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.sort_order]));
  },
  /** Assign ranks 0..n−1 to the given keys (one parent's ordered children). */
  set(campaignId: string, keys: string[]): void {
    const upsert = stmt('INSERT INTO world_sort (campaign_id, key, sort_order) VALUES (?, ?, ?) ON CONFLICT(campaign_id, key) DO UPDATE SET sort_order = excluded.sort_order');
    db.transaction(() => {
      keys.forEach((key, i) => upsert.run(campaignId, key, i));
    })();
  },
};

function toCounter(row: Record<string, unknown>): Counter {
  return {
    id: String(row.id), campaignId: String(row.campaign_id), mapId: String(row.map_id),
    name: String(row.name), color: String(row.color),
    max: Number(row.max), value: Number(row.value),
    visible: row.visible === 1,
    sharedWith: parseSharedWith(row.shared_with),
    // Any unrecognised value falls back to the top banner rather than
    // vanishing into a dock that doesn't render.
    position: isCounterPosition(row.position) ? row.position : 'top',
  };
}

/** NULL (or anything unparseable) means the whole table, which is both the
 *  pre-existing behaviour and the safe direction: a corrupt row shows a
 *  counter the DM meant to share rather than silently hiding one. */
function parseSharedWith(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
}

/** Per-player private notes on characters (the public sheet scratchpad). */
export const privateNotes = {
  get(userId: string, characterId: string): string {
    const row = stmt('SELECT text FROM private_notes WHERE user_id = ? AND character_id = ?').get(userId, characterId) as { text: string } | undefined;
    return row?.text ?? '';
  },
  set(userId: string, campaignId: string, characterId: string, text: string): void {
    stmt(`INSERT INTO private_notes (user_id, character_id, campaign_id, text) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, character_id) DO UPDATE SET text = excluded.text`).run(userId, characterId, campaignId, text);
  },
};

/** DM-only secret notes per character — never part of the sheet payload. */
export const dmNotes = {
  get(characterId: string): string {
    const r = stmt('SELECT text FROM dm_notes WHERE character_id = ?').get(characterId) as { text: string } | undefined;
    return r?.text ?? '';
  },
  set(campaignId: string, characterId: string, text: string): void {
    stmt(`INSERT INTO dm_notes (character_id, campaign_id, text) VALUES (?, ?, ?)
          ON CONFLICT(character_id) DO UPDATE SET text = excluded.text`).run(characterId, campaignId, text);
  },
};

/** Lifetime roll statistics, aggregated so they never grow with playtime. */
export const rollStats = {
  /** Fold one roll's dice into the aggregates for this user + character. */
  record(campaignId: string, userId: string, characterId: string, dice: DieRoll[]): void {
    const up = stmt(
      `INSERT INTO roll_stats (campaign_id, user_id, character_id, kind, key, value, count)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(campaign_id, user_id, character_id, kind, key, value)
       DO UPDATE SET count = count + 1`,
    );
    for (const e of statEntriesFromDice(dice)) {
      up.run(campaignId, userId, characterId, e.kind, e.key, e.value);
    }
  },
  /** Everything this account rolled in this campaign, across all its characters. */
  forUser(campaignId: string, userId: string): RollStatRow[] {
    return stmt(
      `SELECT kind, key, value, SUM(count) AS count FROM roll_stats
       WHERE campaign_id = ? AND user_id = ? GROUP BY kind, key, value`,
    ).all(campaignId, userId) as RollStatRow[];
  },
  /** Everything rolled AS this character, broken out by who was rolling. */
  forCharacter(campaignId: string, characterId: string): Array<RollStatRow & { user_id: string }> {
    return stmt(
      `SELECT user_id, kind, key, value, count FROM roll_stats
       WHERE campaign_id = ? AND character_id = ? AND character_id != ''`,
    ).all(campaignId, characterId) as Array<RollStatRow & { user_id: string }>;
  },
};

/**
 * The dice this character throws, where its sheet says anything at all.
 * Null when every slot is blank, which is every sheet nobody has touched —
 * and then the roller's own settings stand, exactly as before.
 */
function diceLookFor(characterId: string): DiceLook | null {
  const row = stmt('SELECT sheet_json FROM characters WHERE id = ?').get(characterId) as { sheet_json: string } | undefined;
  if (!row) return null;
  const sheet = safeParse<Record<string, unknown>>(row.sheet_json, {});
  const pick = (key: string): string | undefined => {
    const v = sheet[key];
    return typeof v === 'string' && v.trim() ? v : undefined;
  };
  const look: DiceLook = {};
  const trait = pick('diceTraitColor'); if (trait) look.trait = trait;
  const wild = pick('diceWildColor'); if (wild) look.wild = wild;
  const traitText = pick('diceTraitTextColor'); if (traitText) look.traitText = traitText;
  const wildText = pick('diceWildTextColor'); if (wildText) look.wildText = wildText;
  const ace = pick('diceAceStyle'); if (ace && isAceStyle(ace)) look.ace = ace;
  return Object.keys(look).length > 0 ? look : null;
}

export const chat = {
  /** Erase a campaign's whole log. The DM's own act — see CHAT_WIPE. */
  clear(campaignId: string): void {
    stmt('DELETE FROM chat_messages WHERE campaign_id = ?').run(campaignId);
  },
  add(campaignId: string, msg: {
    userId: string | null; fromName: string; fromCharacter?: string | null; actionName?: string | null; outcomeNote?: string | null; kind: ChatKind; text: string;
    roll: RollBreakdown | null; recipients: string[] | null;
    /** Who the roll belongs to for lifetime stats (not shown in the message). */
    characterId?: string | null;
    /** Stats-only override for whose ACCOUNT made the roll — for cards posted
     *  by one user but rolled by another's character (a target's save). */
    statsUserId?: string | null;
    /** A sheet card to render in place of `text`. */
    card?: SheetCard | null;
    /** What the "who is rolling" banner says while these dice are in the air. */
    callout?: RollCalloutInfo | null;
    /** The cast card this message belongs to (see thread_id). */
    threadId?: number | null;
  }, undo?: unknown): ChatMessage {
    const at = now();
    // Every roll that lands in chat feeds the lifetime stats, credited to
    // whoever actually made the roll. System rolls (recovery, Bleeding Out…)
    // carry no userId — credit the character's owner.
    if (msg.roll && Array.isArray(msg.roll.dice) && msg.roll.dice.length > 0) {
      const chId = msg.characterId ?? '';
      let uid = (msg.statsUserId !== undefined ? msg.statsUserId : msg.userId) ?? '';
      if (!uid && chId) {
        const r = stmt('SELECT owner_user_id FROM characters WHERE id = ?').get(chId) as { owner_user_id: string | null } | undefined;
        uid = r?.owner_user_id ?? '';
      }
      rollStats.record(campaignId, uid, chId, msg.roll.dice);
    }
    // Who the table sees. A message that names a character IS that character
    // speaking — "Charn the Robo-T-Rex (Jack)" — and every caller having to
    // remember to say so twice is how half of them came out as bare "Jack".
    // Said once, here, from the id the message already carries.
    let fromCharacter = msg.fromCharacter ?? null;
    if (!fromCharacter && msg.characterId) {
      const r = stmt('SELECT name FROM characters WHERE id = ?').get(msg.characterId) as { name: string } | undefined;
      fromCharacter = r?.name ?? null;
    }
    // A character with dice of its own sends them along with the roll, so
    // every screen throws the same dice — including the screens that have
    // never been shown that character's sheet.
    let callout = msg.callout ?? null;
    if (msg.roll && msg.characterId) {
      const look = diceLookFor(msg.characterId);
      if (look) callout = { what: callout?.what ?? msg.roll.expression, ...(callout?.tone ? { tone: callout.tone } : {}), look };
    }
    const info = stmt(
      `INSERT INTO chat_messages (campaign_id, user_id, from_name, from_character, character_id, action_name, outcome_note, kind, text, roll_json, recipients_json, hidden, undo_json, card_json, callout_json, thread_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    ).run(
      campaignId, msg.userId, msg.fromName, fromCharacter, msg.characterId ?? null,
      msg.actionName ?? null, msg.outcomeNote ?? null, msg.kind, msg.text,
      msg.roll ? JSON.stringify(msg.roll) : null,
      msg.recipients ? JSON.stringify(msg.recipients) : null,
      undo ? JSON.stringify(undo) : null,
      msg.card ? JSON.stringify(msg.card) : null,
      callout ? JSON.stringify(callout) : null,
      msg.threadId ?? null,
      at,
    );
    // Read the row back rather than hand-building the return value. The
    // object returned here is what gets broadcast live, while a reload goes
    // through toChatMsg — two representations that silently drift the moment
    // a column is added to one and not the other (fromCharacter did exactly
    // that: right after a refresh, wrong before one). One extra indexed read
    // by primary key buys a single source of truth.
    const row = stmt('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid) as ChatRow;
    return toChatMsg(row);
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
  /** Hide (or unhide) every message belonging to one cast card, the card
   *  itself included. Returns the ids touched so they can be rebroadcast. */
  setThreadHidden(threadId: number, hidden: boolean): number[] {
    stmt('UPDATE chat_messages SET hidden = ? WHERE id = ? OR thread_id = ?')
      .run(hidden ? 1 : 0, threadId, threadId);
    return (stmt('SELECT id FROM chat_messages WHERE id = ? OR thread_id = ?')
      .all(threadId, threadId) as { id: number }[]).map((r) => r.id);
  },
  clearUndo(id: number): void {
    stmt('UPDATE chat_messages SET undo_json = NULL WHERE id = ?').run(id);
  },
  /**
   * Add to a message's recorded effects after it was posted.
   *
   * An area attack announces itself before anything has happened, then rolls
   * saves and damage over the next several seconds. Its lead card has to be
   * the thing the DM rewinds, so the effects are appended to it as they land
   * rather than scattered across the cards that follow.
   */
  appendUndo(id: number, entries: UndoEntry[]): void {
    if (entries.length === 0) return;
    const existing = (chat.undoFor(id) as UndoEntry[] | null) ?? [];
    stmt('UPDATE chat_messages SET undo_json = ? WHERE id = ?')
      .run(JSON.stringify([...existing, ...entries]), id);
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
  world_folder_id: string | null;
  shop_id: string | null;
  interact_range: number;
  detail_asset_id?: string | null;
  locked?: number;
  key_name?: string | null;
  linked_character_id?: string | null;
  created_at: number;
}

function toMapObject(row: MapObjectRow) {
  return {
    id: row.id,
    mapId: row.map_id,
    name: row.name,
    description: row.description,
    kind: row.kind as 'item' | 'chest' | 'shop',
    q: row.q,
    r: row.r,
    artAssetId: row.art_asset_id,
    // Resolved here, not guessed on the client. An upload is stored as
    // `<id>.<ext>` and only the id is on this row, so `/uploads/${artAssetId}`
    // — which is what the client was building — is a 404 every time.
    artUrl: assets.urlFor(row.art_asset_id),
    detailAssetId: row.detail_asset_id ?? null,
    detailUrl: assets.urlFor(row.detail_asset_id ?? null),
    items: safeParse<LootItem[]>(row.items_json, []),
    worldFolderId: row.world_folder_id,
    shopId: row.shop_id,
    interactRange: row.interact_range ?? 1,
    locked: row.locked === 1,
    keyName: row.key_name ?? null,
    linkedCharacterId: row.linked_character_id ?? null,
  };
}

export const mapObjects = {
  forMap(mapId: string) {
    return (stmt('SELECT * FROM map_objects WHERE map_id = ? ORDER BY created_at').all(mapId) as MapObjectRow[]).map(toMapObject);
  },
  forCampaign(campaignId: string) {
    return (stmt(
      `SELECT mo.* FROM map_objects mo JOIN maps m ON m.id = mo.map_id
       WHERE m.campaign_id = ? ORDER BY mo.created_at`,
    ).all(campaignId) as MapObjectRow[]).map(toMapObject);
  },
  byId(id: string) {
    const row = stmt('SELECT * FROM map_objects WHERE id = ?').get(id) as MapObjectRow | undefined;
    return row ? toMapObject(row) : undefined;
  },
  create(mapId: string, kind: 'item' | 'chest' | 'shop', name: string, description: string, q: number, r: number,
    opts?: { worldFolderId?: string; shopId?: string; interactRange?: number }) {
    const id = newId();
    const wfId = opts?.worldFolderId ?? null;
    const sId = opts?.shopId ?? null;
    const range = opts?.interactRange ?? 1;
    stmt('INSERT INTO map_objects (id, map_id, name, description, kind, q, r, items_json, world_folder_id, shop_id, interact_range, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, mapId, name, description, kind, q, r, '[]', wfId, sId, range, now());
    return toMapObject({ id, map_id: mapId, name, description, kind, q, r, art_asset_id: null, detail_asset_id: null, items_json: '[]', world_folder_id: wfId, shop_id: sId, interact_range: range, created_at: now() });
  },
  update(id: string, patch: { mapId?: string; name?: string; description?: string; artAssetId?: string; detailAssetId?: string; q?: number; r?: number; items?: unknown[]; interactRange?: number; locked?: boolean; keyName?: string | null; linkedCharacterId?: string | null }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    // A chest can be carried to another map — one box, moved, rather than a
    // second box minted and the first one left standing on the old map.
    if (patch.mapId !== undefined) { sets.push('map_id = ?'); vals.push(patch.mapId); }
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
    if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description); }
    if (patch.artAssetId !== undefined) { sets.push('art_asset_id = ?'); vals.push(patch.artAssetId); }
    if (patch.detailAssetId !== undefined) { sets.push('detail_asset_id = ?'); vals.push(patch.detailAssetId || null); }
    if (patch.q !== undefined) { sets.push('q = ?'); vals.push(patch.q); }
    if (patch.r !== undefined) { sets.push('r = ?'); vals.push(patch.r); }
    if (patch.items !== undefined) { sets.push('items_json = ?'); vals.push(JSON.stringify(patch.items)); }
    if (patch.interactRange !== undefined) { sets.push('interact_range = ?'); vals.push(patch.interactRange); }
    if (patch.locked !== undefined) { sets.push('locked = ?'); vals.push(patch.locked ? 1 : 0); }
    if (patch.keyName !== undefined) { sets.push('key_name = ?'); vals.push(patch.keyName ?? null); }
    if (patch.linkedCharacterId !== undefined) { sets.push('linked_character_id = ?'); vals.push(patch.linkedCharacterId ?? null); }
    if (sets.length === 0) return;
    vals.push(id);
    stmt(`UPDATE map_objects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  },
  delete(id: string): void {
    stmt('DELETE FROM map_objects WHERE id = ?').run(id);
  },
};

// ---------- custom compendium items ----------

export const customItems = {
  forCampaign(campaignId: string): CustomItem[] {
    return stmt('SELECT * FROM custom_items WHERE campaign_id = ? ORDER BY created_at').all(campaignId) as CustomItem[];
  },
  byId(id: string): (CustomItem & { campaignId: string }) | undefined {
    const r = stmt('SELECT id, campaign_id, entry_json, created_at FROM custom_items WHERE id = ?').get(id) as
      { id: string; campaign_id: string; entry_json: string; created_at: number } | undefined;
    return r ? { id: r.id, campaignId: r.campaign_id, entryJson: r.entry_json, createdAt: r.created_at } : undefined;
  },
  create(campaignId: string, entryJson: string): CustomItem {
    const id = newId();
    const ts = now();
    stmt('INSERT INTO custom_items (id, campaign_id, entry_json, created_at) VALUES (?, ?, ?, ?)').run(id, campaignId, entryJson, ts);
    return { id, campaignId, entryJson, createdAt: ts };
  },
  update(id: string, entryJson: string): void {
    stmt('UPDATE custom_items SET entry_json = ? WHERE id = ?').run(entryJson, id);
  },
  delete(id: string): void {
    stmt('DELETE FROM custom_items WHERE id = ?').run(id);
  },
};
