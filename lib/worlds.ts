import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { bumpStat, db, maxStat } from './db'
import { directorySize } from './files'
import { newWorldId, randomId } from './ids'
import { backupsDir, worldDir } from './paths'
import { runtime } from './runtime'
import type { World, WorldStatus } from './runtime/types'
import { limits } from './settings'
import { findVersion, newerVersions } from './versions'

export type { World, WorldStatus }

export class WorldError extends Error {}

const ACTIVE: WorldStatus[] = ['starting', 'online', 'stopping']
const BUSY: WorldStatus[] = ['queued', ...ACTIVE]

export function worldAddress(world: Pick<World, 'host_label'>): string {
  return `${world.host_label}.${config.serverDomain}`
}

// ───────────────────────── Lesen ─────────────────────────

export function listWorlds(userId: string): World[] {
  return db().prepare('SELECT * FROM worlds WHERE user_id = ? ORDER BY created_at DESC').all(userId) as World[]
}

/** Liefert die Welt nur, wenn sie diesem Konto gehört. */
export function getWorld(userId: string, worldId: string): World | undefined {
  return db().prepare('SELECT * FROM worlds WHERE id = ? AND user_id = ?').get(worldId, userId) as World | undefined
}

function reload(world: World): World {
  return (db().prepare('SELECT * FROM worlds WHERE id = ?').get(world.id) as World | undefined) ?? world
}

export function slotsInUse(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM worlds WHERE status IN ('starting', 'online', 'stopping')`)
    .get() as { n: number }
  return row.n
}

export function slotsFree(): number {
  return Math.max(0, limits().totalSlots - slotsInUse())
}

/** Platz in der Warteschlange, beginnend bei 1. */
export function queuePosition(world: World): number {
  if (world.status !== 'queued' || world.queued_at === null) return 0
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM worlds WHERE status = 'queued' AND queued_at < ?`)
    .get(world.queued_at) as { n: number }
  return row.n + 1
}

export function listWhitelist(worldId: string): string[] {
  const rows = db()
    .prepare('SELECT player FROM whitelist WHERE world_id = ? ORDER BY player COLLATE NOCASE')
    .all(worldId) as Array<{ player: string }>
  return rows.map((row) => row.player)
}

// ───────────────────────── Anlegen, ändern, löschen ─────────────────────────

export type NewWorld = {
  name: string
  version: string
  gamemode: string
  difficulty: string
  seed: string
  whitelist: boolean
}

export function createWorld(userId: string, input: NewWorld): World {
  const version = findVersion(input.version)
  if (!version) throw new WorldError('Diese Minecraft-Version gibt es hier nicht.')

  const create = db().transaction(() => {
    const count = db().prepare('SELECT COUNT(*) AS n FROM worlds WHERE user_id = ?').get(userId) as { n: number }
    const max = limits().maxWorldsPerUser
    if (count.n >= max) {
      throw new WorldError(`Pro Konto sind bis zu ${max} Welten möglich. Lösche eine, um Platz zu schaffen.`)
    }
    const id = newWorldId()
    const now = Date.now()
    db()
      .prepare(
        `INSERT INTO worlds (id, user_id, name, host_label, version, paper_build, gamemode, difficulty, seed,
                             whitelist_enabled, status, status_since, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paused', ?, ?)`,
      )
      .run(
        id,
        userId,
        input.name,
        `mc-${randomId(12)}`,
        version.id,
        version.build,
        input.gamemode,
        input.difficulty,
        input.seed,
        input.whitelist ? 1 : 0,
        now,
        now,
      )
    bumpStat('worlds_created')
    return id
  })
  const id = create()
  return db().prepare('SELECT * FROM worlds WHERE id = ?').get(id) as World
}

export function renameWorld(world: World, name: string): void {
  db().prepare('UPDATE worlds SET name = ? WHERE id = ?').run(name, world.id)
}

export function setAutoBackup(world: World, mode: 'off' | 'on_pause'): void {
  db().prepare('UPDATE worlds SET auto_backup = ? WHERE id = ?').run(mode, world.id)
}

export function changeVersion(world: World, versionId: string): void {
  if (world.status !== 'paused') throw new WorldError('Pausiere die Welt, bevor du die Version wechselst.')
  const version = newerVersions(world.version).find((v) => v.id === versionId)
  if (!version) throw new WorldError('Du kannst nur auf eine neuere Version wechseln.')
  db().prepare('UPDATE worlds SET version = ?, paper_build = ? WHERE id = ?').run(version.id, version.build, world.id)
}

export async function deleteWorld(world: World): Promise<void> {
  const current = reload(world)
  if (ACTIVE.includes(current.status)) {
    await runtime().stop(current)
  }
  db().prepare('DELETE FROM worlds WHERE id = ?').run(world.id)
  fs.rmSync(worldDir(world.id), { recursive: true, force: true })
  fs.rmSync(backupsDir(world.id), { recursive: true, force: true })
}

// ───────────────────────── Einstellungen im laufenden Spiel ─────────────────────────

function requireOnline(world: World): void {
  if (world.status !== 'online') throw new WorldError('Das geht nur, während deine Welt online ist.')
}

export async function updateGameSettings(world: World, gamemode: string, difficulty: string): Promise<void> {
  requireOnline(world)
  db().prepare('UPDATE worlds SET gamemode = ?, difficulty = ? WHERE id = ?').run(gamemode, difficulty, world.id)
  if (difficulty !== world.difficulty) await runtime().command(world, `difficulty ${difficulty}`)
  if (gamemode !== world.gamemode) await runtime().command(world, `defaultgamemode ${gamemode}`)
}

export async function setWhitelistEnabled(world: World, enabled: boolean): Promise<void> {
  requireOnline(world)
  db().prepare('UPDATE worlds SET whitelist_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, world.id)
  await runtime().command(world, `whitelist ${enabled ? 'on' : 'off'}`)
}

export async function addWhitelistPlayer(world: World, player: string): Promise<void> {
  requireOnline(world)
  const count = db().prepare('SELECT COUNT(*) AS n FROM whitelist WHERE world_id = ?').get(world.id) as { n: number }
  if (count.n >= 100) throw new WorldError('Auf der Whitelist ist Platz für höchstens 100 Spieler.')
  const result = db()
    .prepare('INSERT OR IGNORE INTO whitelist (world_id, player, added_at) VALUES (?, ?, ?)')
    .run(world.id, player, Date.now())
  if (result.changes === 0) throw new WorldError(`${player} steht schon auf der Liste.`)
  await runtime().command(world, `whitelist add ${player}`)
}

export async function removeWhitelistPlayer(world: World, player: string): Promise<void> {
  requireOnline(world)
  db().prepare('DELETE FROM whitelist WHERE world_id = ? AND player = ?').run(world.id, player)
  await runtime().command(world, `whitelist remove ${player}`)
}

// ───────────────────────── Dateien, die die Plattform vorgibt ─────────────────────────

/**
 * Schreibt vor jedem Start die Werte in server.properties, die die Plattform festlegt.
 * Alles andere in der Datei bleibt, wie es ist.
 */
export function writeManagedFiles(world: World): void {
  const dir = worldDir(world.id)
  fs.mkdirSync(dir, { recursive: true })

  const managed: Record<string, string> = {
    motd: `${world.name.replace(/[\\\n\r]/g, ' ')} · ${config.brand}`,
    'max-players': String(config.maxPlayers),
    gamemode: world.gamemode,
    difficulty: world.difficulty,
    'level-seed': world.seed,
    'white-list': world.whitelist_enabled ? 'true' : 'false',
    'enforce-whitelist': world.whitelist_enabled ? 'true' : 'false',
    'server-port': '25565',
    'online-mode': 'true',
  }

  const file = path.join(dir, 'server.properties')
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []
  const seen = new Set<string>()
  const lines = existing
    .filter((line, index) => !(index === existing.length - 1 && line === ''))
    .map((line) => {
      const key = line.startsWith('#') ? '' : line.split('=')[0]!.trim()
      if (key in managed) {
        seen.add(key)
        return `${key}=${managed[key]}`
      }
      return line
    })
  for (const [key, value] of Object.entries(managed)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`)
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`)

  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n')
}

// ───────────────────────── Starten, pausieren, neu starten ─────────────────────────

function setStatus(world: World, status: WorldStatus, extra: Partial<World> = {}): void {
  const fields: Partial<World> = { status, status_since: Date.now(), ...extra }
  const keys = Object.keys(fields) as Array<keyof World>
  db()
    .prepare(`UPDATE worlds SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((key) => fields[key] as string | number | null), world.id)
}

async function launch(world: World): Promise<void> {
  writeManagedFiles(world)
  await runtime().start(world)
  setStatus(world, 'starting', { queued_at: null, restart_pending: 0, pause_reason: null })
}

export type StartResult = 'starting' | 'queued'

export async function requestStart(world: World): Promise<StartResult> {
  const current = reload(world)
  if (current.status !== 'paused') throw new WorldError('Diese Welt läuft schon oder wartet auf einen Platz.')

  const busy = db()
    .prepare(
      `SELECT name FROM worlds WHERE user_id = ? AND id != ? AND status IN (${BUSY.map(() => '?').join(', ')}) LIMIT 1`,
    )
    .get(current.user_id, current.id, ...BUSY) as { name: string } | undefined
  if (busy) {
    throw new WorldError(`Pro Konto läuft eine Welt gleichzeitig. Pausiere zuerst „${busy.name}“.`)
  }

  if (directorySize(worldDir(current.id)) > DISK_QUOTA_BYTES) {
    throw new WorldError(
      `Der Speicher deiner Welt (${config.diskGiB} GiB) ist voll. Lösche unter „Dateien“ etwas, dann lässt sie sich wieder starten.`,
    )
  }

  const waiting = db().prepare(`SELECT COUNT(*) AS n FROM worlds WHERE status = 'queued'`).get() as { n: number }
  if (slotsFree() > 0 && waiting.n === 0) {
    await launch(current)
    return 'starting'
  }
  setStatus(current, 'queued', { queued_at: Date.now(), pause_reason: null })
  return 'queued'
}

export async function requestStop(world: World, reason: 'user' | 'idle' | 'admin' | 'disk' = 'user'): Promise<void> {
  const current = reload(world)
  if (current.status === 'queued') {
    setStatus(current, 'paused', { queued_at: null, pause_reason: reason })
    return
  }
  if (current.status === 'starting' || current.status === 'online') {
    await runtime().stop(current)
    setStatus(current, 'stopping', { restart_pending: 0, pause_reason: reason })
  }
}

export async function requestRestart(world: World): Promise<void> {
  const current = reload(world)
  if (current.status !== 'online') throw new WorldError('Neu starten geht nur, während deine Welt online ist.')
  await runtime().stop(current)
  setStatus(current, 'stopping', { restart_pending: 1, pause_reason: null })
}

export async function sendCommand(world: World, command: string): Promise<void> {
  const current = reload(world)
  if (current.status !== 'online') throw new WorldError('Befehle gehen nur, wenn die Welt läuft.')
  await runtime().command(current, command)
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g

/** Log für die Webkonsole — IP-Adressen der Mitspieler werden ausgeblendet. */
export async function consoleLines(world: World): Promise<string[]> {
  if (!ACTIVE.includes(world.status)) return []
  const lines = await runtime().logs(world)
  return lines.map((line) => line.replace(IPV4, '•••'))
}

// ───────────────────────── Taktgeber ─────────────────────────

type Hooks = { afterPause?: (world: World) => Promise<void> | void }
type Globals = { __amTick?: { running: boolean; last: number }; __amDiskChecks?: Map<string, number> }

const DISK_QUOTA_BYTES = config.diskGiB * 1024 ** 3
const DISK_CHECK_MS = 5 * 60_000

/** Die Ordnergröße zu messen kostet Zeit — deshalb je Welt nur alle paar Minuten. */
function diskCheckDue(worldId: string, now: number): boolean {
  const checks = ((globalThis as unknown as Globals).__amDiskChecks ??= new Map())
  if (now - (checks.get(worldId) ?? 0) < DISK_CHECK_MS) return false
  checks.set(worldId, now)
  return true
}
const globals = globalThis as unknown as Globals

/**
 * Gleicht den gespeicherten Status mit dem ab, was der Treiber meldet: schaltet Welten
 * online, pausiert sie nach Leerlauf und vergibt freie Plätze an die Warteschlange.
 */
export async function tick(hooks: Hooks = {}, now = Date.now()): Promise<void> {
  globals.__amTick ??= { running: false, last: now }
  const state = globals.__amTick
  if (state.running) return
  state.running = true
  const elapsedSeconds = Math.min(10, Math.max(0, (now - state.last) / 1000))
  state.last = now

  try {
    const driver = runtime()
    const active = db()
      .prepare(`SELECT * FROM worlds WHERE status IN ('starting', 'online', 'stopping')`)
      .all() as World[]
    let playersOnline = 0
    const autoPauseMs = limits().autoPauseMinutes * 60_000

    for (const world of active) {
      try {
        const actual = await driver.state(world)

        if (world.status === 'starting') {
          if (actual === 'online') {
            setStatus(world, 'online', { started_at: now, last_active_at: now })
            bumpStat('starts')
          } else if (actual === 'stopped') {
            setStatus(world, 'paused', { pause_reason: 'error' })
          }
          continue
        }

        if (world.status === 'online') {
          if (actual === 'stopping') {
            setStatus(world, 'stopping', { pause_reason: world.pause_reason ?? 'user' })
          } else if (actual === 'stopped') {
            setStatus(world, 'paused', { pause_reason: world.pause_reason ?? 'stopped' })
            await hooks.afterPause?.(world)
          } else {
            const players = await driver.players(world)
            playersOnline += players.length
            if (diskCheckDue(world.id, now) && directorySize(worldDir(world.id)) > DISK_QUOTA_BYTES) {
              await requestStop(world, 'disk')
            } else if (players.length > 0) {
              db().prepare('UPDATE worlds SET last_active_at = ? WHERE id = ?').run(now, world.id)
              bumpStat('play_seconds', Math.round(players.length * elapsedSeconds))
            } else if (now - (world.last_active_at ?? world.status_since) >= autoPauseMs) {
              await requestStop(world, 'idle')
            }
          }
          continue
        }

        if (world.status === 'stopping' && actual === 'stopped') {
          if (world.restart_pending) {
            await launch(world)
          } else {
            setStatus(world, 'paused')
            await hooks.afterPause?.(world)
          }
        }
      } catch (error) {
        console.error(`[aboutm.ee] Welt ${world.id}:`, error)
      }
    }
    if (playersOnline > 0) maxStat('peak_players', playersOnline)

    const free = slotsFree()
    if (free > 0) {
      const queued = db()
        .prepare(`SELECT * FROM worlds WHERE status = 'queued' ORDER BY queued_at LIMIT ?`)
        .all(free) as World[]
      for (const world of queued) {
        try {
          await launch(world)
        } catch (error) {
          console.error(`[aboutm.ee] Start von ${world.id} fehlgeschlagen:`, error)
          setStatus(world, 'paused', { queued_at: null, pause_reason: 'error' })
        }
      }
    }
  } finally {
    state.running = false
  }
}
