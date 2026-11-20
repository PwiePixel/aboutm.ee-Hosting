import { db } from './db'
import { runtime } from './runtime'
import type { World, WorldStatus } from './runtime/types'
import { limits } from './settings'
import { worldAddress } from './worlds'

export type AdminWorld = {
  id: string
  name: string
  owner: string
  address: string
  status: WorldStatus
  statusSince: number
  version: string
  createdAt: number
}

export type LiveWorld = AdminWorld & { players: string[]; cpuPercent: number | null; ramMiB: number | null }

export type AdminLive = {
  totalSlots: number
  inUse: number
  online: number
  queued: number
  playersOnline: number
  worlds: LiveWorld[]
}

type Row = World & { owner: string }

function toAdminWorld(row: Row): AdminWorld {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    address: worldAddress(row),
    status: row.status,
    statusSince: row.status_since,
    version: row.version,
    createdAt: row.created_at,
  }
}

const WITH_OWNER = `SELECT worlds.*, users.email AS owner FROM worlds JOIN users ON users.id = worlds.user_id`

/** Alles, was gerade läuft oder auf einen Platz wartet. */
export async function adminLive(): Promise<AdminLive> {
  const rows = db()
    .prepare(`${WITH_OWNER} WHERE worlds.status != 'paused' ORDER BY worlds.status_since`)
    .all() as Row[]
  const driver = runtime()

  const worlds = await Promise.all(
    rows.map(async (row): Promise<LiveWorld> => {
      const running = row.status === 'starting' || row.status === 'online'
      const [stats, players] = await Promise.all([
        running ? driver.stats(row).catch(() => null) : null,
        row.status === 'online' ? driver.players(row).catch(() => []) : [],
      ])
      return { ...toAdminWorld(row), players, cpuPercent: stats?.cpuPercent ?? null, ramMiB: stats?.ramMiB ?? null }
    }),
  )

  return {
    totalSlots: limits().totalSlots,
    inUse: worlds.filter((world) => world.status !== 'queued').length,
    online: worlds.filter((world) => world.status === 'online').length,
    queued: worlds.filter((world) => world.status === 'queued').length,
    playersOnline: worlds.reduce((sum, world) => sum + world.players.length, 0),
    worlds,
  }
}

export function adminWorlds(): AdminWorld[] {
  return (db().prepare(`${WITH_OWNER} ORDER BY worlds.created_at DESC LIMIT 500`).all() as Row[]).map(toAdminWorld)
}

/** Ohne Besitzprüfung — nur für Aktionen, die vorher requireAdmin() aufgerufen haben. */
export function adminGetWorld(worldId: string): World | undefined {
  return db().prepare('SELECT * FROM worlds WHERE id = ?').get(worldId) as World | undefined
}

export type AdminUser = { id: string; email: string; createdAt: number; isAdmin: boolean; worlds: number }

export function adminUsers(): AdminUser[] {
  const rows = db()
    .prepare(
      `SELECT users.id, users.email, users.created_at, users.is_admin,
              (SELECT COUNT(*) FROM worlds WHERE worlds.user_id = users.id) AS worlds
       FROM users ORDER BY users.created_at DESC LIMIT 500`,
    )
    .all() as Array<{ id: string; email: string; created_at: number; is_admin: number; worlds: number }>
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
    worlds: row.worlds,
  }))
}

export type AdminFeedback = { id: string; category: string; email: string | null; message: string; createdAt: number }

export function adminFeedback(): AdminFeedback[] {
  const rows = db()
    .prepare('SELECT id, category, email, message, created_at FROM feedback ORDER BY created_at DESC LIMIT 200')
    .all() as Array<{ id: string; category: string; email: string | null; message: string; created_at: number }>
  return rows.map((row) => ({ ...row, createdAt: row.created_at }))
}

export function adminCounts(): { users: number; worlds: number; feedback: number } {
  const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  return { users: count('users'), worlds: count('worlds'), feedback: count('feedback') }
}
