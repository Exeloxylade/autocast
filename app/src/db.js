// SQLite through Node's built-in driver (no native build step on the VPS).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { DATA } = require('./config');

const db = new DatabaseSync(process.env.AUTOCAST_DB || path.join(DATA, 'autocast.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);

-- SHARED -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,          -- youtube | tiktok | instagram | facebook | twitch | kick | rtmp | mock
  kind TEXT NOT NULL,              -- oauth | stream_key | mock
  name TEXT NOT NULL,
  ext_id TEXT,                     -- channel id / page id / ig user id / open_id
  grp TEXT DEFAULT '',
  secret TEXT,                     -- sealed JSON: tokens or {server,key}
  expires_at INTEGER,              -- access token expiry (ms)
  status TEXT DEFAULT 'ok',        -- ok | expired | error
  status_msg TEXT DEFAULT '',
  can_upload INTEGER DEFAULT 0,
  can_live INTEGER DEFAULT 0,
  slots TEXT DEFAULT '["09:00","13:00","20:00"]',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  name TEXT, file TEXT, size INTEGER,
  duration REAL, width INTEGER, height INTEGER, has_audio INTEGER,
  thumb TEXT, source TEXT DEFAULT 'upload',
  prepared TEXT, prepare_state TEXT DEFAULT 'none', prepare_msg TEXT DEFAULT '',
  created_at INTEGER
);

-- AUTO UPLOAD --------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  title TEXT, body TEXT,
  per_app TEXT DEFAULT '{}',        -- {"youtube":{"title":..,"body":..}, ...}
  options TEXT DEFAULT '{}',        -- {"privacy":"public","ai":true,"kids":false}
  rule_id INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS post_targets (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_at INTEGER NOT NULL,
  status TEXT DEFAULT 'queued',      -- queued | running | done | failed | canceled
  attempts INTEGER DEFAULT 0,
  next_try INTEGER,
  url TEXT, error TEXT,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_targets_due ON post_targets(status, run_at);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  name TEXT, enabled INTEGER DEFAULT 1,
  folder TEXT, account_ids TEXT DEFAULT '[]',
  title_tpl TEXT DEFAULT '{name}', body_tpl TEXT DEFAULT '',
  options TEXT DEFAULT '{}',
  seen TEXT DEFAULT '[]', runs INTEGER DEFAULT 0, last_run INTEGER,
  created_at INTEGER
);

-- AUTO LIVE ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY, name TEXT, folder TEXT DEFAULT '', shuffle INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  pos INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY,
  name TEXT, kind TEXT DEFAULT 'file_loop',
  playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  profile TEXT DEFAULT '1080p30',
  schedule TEXT DEFAULT '{"mode":"manual"}',  -- manual | always | daily{start,end,days}
  want_on INTEGER DEFAULT 0,
  overlay TEXT DEFAULT '{}',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT, enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, at INTEGER, area TEXT, level TEXT, msg TEXT, ref TEXT
);
`);

// v2 columns (added in place, safe to run again)
function addCol(table, col, def) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('accounts', 'fmt', "TEXT DEFAULT 'auto'");          // auto | original | vertical
addCol('accounts', 'daily_max', 'INTEGER DEFAULT 0');       // 0 = no limit
addCol('post_targets', 'repeat_days', 'REAL DEFAULT 0');
addCol('post_targets', 'repeat_left', 'INTEGER DEFAULT 0');
addCol('stations', 'music_playlist_id', 'INTEGER');
addCol('stations', 'music_volume', 'REAL DEFAULT 0.25');
addCol('stations', 'record', 'INTEGER DEFAULT 0');
addCol('playlists', 'seen', "TEXT DEFAULT '[]'");
addCol('media', 'parent_id', 'INTEGER');

const q = (sql) => db.prepare(sql);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

function setting(k, def = null) {
  const r = get('SELECT v FROM settings WHERE k=?', k);
  return r ? JSON.parse(r.v) : def;
}
function setSetting(k, v) {
  run('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, JSON.stringify(v));
}
function event(area, level, msg, ref = '') {
  run('INSERT INTO events(at,area,level,msg,ref) VALUES(?,?,?,?,?)', Date.now(), area, level, msg, String(ref));
  run('DELETE FROM events WHERE id < (SELECT MAX(id) - 2000 FROM events)');
  const line = `[${new Date().toISOString()}] ${area} ${level} ${msg}`;
  if (level === 'error') console.error(line); else if (process.env.AUTOCAST_QUIET !== '1') console.log(line);
}

module.exports = { db, q, all, get, run, setting, setSetting, event };
