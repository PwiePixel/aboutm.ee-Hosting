import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE worlds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    host_label TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL,
    paper_build INTEGER NOT NULL,
    gamemode TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    seed TEXT NOT NULL DEFAULT '',
    whitelist_enabled INTEGER NOT NULL DEFAULT 0,
    auto_backup TEXT NOT NULL DEFAULT 'off',
    status TEXT NOT NULL DEFAULT 'paused',
    status_since INTEGER NOT NULL,
    queued_at INTEGER,
    started_at INTEGER,
    last_active_at INTEGER,
    restart_pending INTEGER NOT NULL DEFAULT 0,
    pause_reason TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX worlds_user ON worlds(user_id);
  CREATE INDEX worlds_status ON worlds(status);

  CREATE TABLE whitelist (
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    player TEXT NOT NULL COLLATE NOCASE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (world_id, player)
  );

  CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    version TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX backups_world ON backups(world_id);

  CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    email TEXT,
    message TEXT NOT NULL,
    user_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE stats (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Statistik: Tageswerte, verschiedene Spieler (nur als Hash) und Zähler je Welt.
  CREATE TABLE stats_daily (
    day TEXT NOT NULL,
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (day, key)
  );

  CREATE TABLE players_seen (
    hash TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL
  );

  ALTER TABLE worlds ADD COLUMN play_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE worlds ADD COLUMN starts INTEGER NOT NULL DEFAULT 0;

  -- Spielzeit wird ab jetzt in Millisekunden gezählt, damit beim Runden nichts verloren geht.
  INSERT INTO stats (key, value) SELECT 'play_ms', value * 1000 FROM stats WHERE key = 'play_seconds';
  DELETE FROM stats WHERE key = 'play_seconds';
  -- „Gezählt seit“: bei einer bestehenden Installation das älteste Konto, sonst jetzt.
  INSERT OR IGNORE INTO stats (key, value)
  VALUES ('since', COALESCE((SELECT MIN(created_at) FROM users), CAST(strftime('%s', 'now') AS INTEGER) * 1000));
  `,
]

type Globals = { __amDb?: Database.Database }
const globals = globalThis as unknown as Globals

function open(): Database.Database {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const db = new Database(path.join(config.dataDir, 'aboutmee.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  const current = db.pragma('user_version', { simple: true }) as number
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!)
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
  return db
}

export function db(): Database.Database {
  globals.__amDb ??= open()
  return globals.__amDb
}
