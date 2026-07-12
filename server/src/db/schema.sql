CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system TEXT NOT NULL CHECK (system IN ('dnd5e', 'swn', 'swade')),
  dm_user_id TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT UNIQUE NOT NULL,
  active_map_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('dm', 'player')),
  -- Per-member map override; NULL = follow the campaign's active (party) map.
  map_id TEXT,
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS assets (
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
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  system TEXT NOT NULL,
  sheet_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bg_asset_id TEXT REFERENCES assets(id),
  grid_json TEXT NOT NULL,
  walls_json TEXT NOT NULL DEFAULT '[]',
  doors_json TEXT NOT NULL DEFAULT '[]',
  lights_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT,
  spawn_json TEXT,
  terrain_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  art_asset_id TEXT REFERENCES assets(id),
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('token', 'gm')),
  size INTEGER NOT NULL DEFAULT 1,
  shape TEXT NOT NULL DEFAULT 'circle',
  color TEXT NOT NULL DEFAULT '#6c9bd2',
  vision_json TEXT,
  bar_json TEXT,
  light_json TEXT
);

CREATE TABLE IF NOT EXISTS fog_explored (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  hexes BLOB NOT NULL,
  PRIMARY KEY (user_id, map_id)
);

-- Per-player memory of doors they've discovered: a snapshot of each door as
-- last observed (open/closed, position), so a door a player has seen once
-- stays visible to them -- in its last-seen state -- even after they walk
-- out of line of sight, instead of vanishing until rediscovered.
CREATE TABLE IF NOT EXISTS door_memory (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  doors_json TEXT NOT NULL,
  PRIMARY KEY (user_id, map_id)
);

CREATE TABLE IF NOT EXISTS handouts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  asset_id TEXT REFERENCES assets(id),
  shared_all INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS handout_shares (
  handout_id TEXT NOT NULL REFERENCES handouts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (handout_id, user_id)
);

CREATE TABLE IF NOT EXISTS macros (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  from_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('say', 'roll', 'whisper', 'system')),
  text TEXT NOT NULL,
  roll_json TEXT,
  recipients_json TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  undo_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_campaign ON chat_messages(campaign_id, id);

CREATE TABLE IF NOT EXISTS initiative (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_folders (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'art',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audio_tracks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'gp',
  players_can_buy INTEGER NOT NULL DEFAULT 1,
  items_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  linked_character_id TEXT,
  art_asset_id TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'settlement',
  notes TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  visible_to_players INTEGER NOT NULL DEFAULT 0,
  links_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS world_folders (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL DEFAULT '[]',
  display_kind TEXT NOT NULL DEFAULT 'folder',
  art_asset_id TEXT
);

CREATE TABLE IF NOT EXISTS rollable_tables (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  players_can_roll INTEGER NOT NULL DEFAULT 1,
  items_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_npcs (
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
);
CREATE INDEX IF NOT EXISTS idx_custom_npcs_user ON custom_npcs(user_id);

CREATE TABLE IF NOT EXISTS map_objects (
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
);
CREATE INDEX IF NOT EXISTS idx_map_objects_map ON map_objects(map_id);

CREATE TABLE IF NOT EXISTS custom_items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_items_campaign ON custom_items(campaign_id);

CREATE TABLE IF NOT EXISTS drawings (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('map', 'gm')),
  shape_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Hot-path lookup indexes. tokens(map_id) matters most: it's scanned on every
-- vision pass (every token move); the rest back the per-campaign list queries
-- that run on every join/broadcast. (chat_messages already has its own above.)
CREATE INDEX IF NOT EXISTS idx_tokens_map ON tokens(map_id);
CREATE INDEX IF NOT EXISTS idx_tokens_character ON tokens(character_id);
CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_assets_campaign ON assets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_handouts_campaign ON handouts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_maps_campaign ON maps(campaign_id);
CREATE INDEX IF NOT EXISTS idx_drawings_map ON drawings(map_id);
