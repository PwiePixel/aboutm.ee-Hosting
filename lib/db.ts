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

export function bumpStat(key: string, by = 1): void {
  db()
    .prepare(
      'INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value',
    )
    .run(key, by)
}

export function maxStat(key: string, value: number): void {
  db()
    .prepare(
      'INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)',
    )
    .run(key, value)
}

export function readStat(key: string): number {
  const row = db().prepare('SELECT value FROM stats WHERE key = ?').get(key) as { value: number } | undefined
  return row?.value ?? 0
}
