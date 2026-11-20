import { createHash, randomBytes } from 'node:crypto'
import { db } from './db'

/**
 * Statistik der Plattform. Gezählt wird, was tatsächlich passiert ist:
 * - Welten erstellt
 * - Server-Starts (jeder Start, der online ankommt — auch Neustarts)
 * - Spielzeit: Zeit, in der Spieler verbunden waren. Zwei Spieler eine Stunde lang sind zwei Spielstunden.
 * - Höchstwerte: Spieler gleichzeitig und Server gleichzeitig
 * - verschiedene Spieler: nur als gesalzener Hash des Minecraft-Namens, nie der Name selbst
 * Alles gibt es als Gesamtwert und je Kalendertag (deutsche Zeit).
 */

const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Kalendertag in deutscher Zeit, z. B. "2026-11-20". */
export function berlinDay(timestamp = Date.now()): string {
  return berlin.format(new Date(timestamp))
}

function add(key: string, by: number, now: number): void {
  if (by <= 0) return
  db()
    .prepare('INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value')
    .run(key, by)
  db()
    .prepare(
      'INSERT INTO stats_daily (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = value + excluded.value',
    )
    .run(berlinDay(now), key, by)
}

/** Hebt einen Höchstwert an. Gibt zurück, ob der Gesamtrekord gestiegen ist. */
function raise(key: string, value: number, now: number): boolean {
  if (value <= 0) return false
  db()
    .prepare(
      'INSERT INTO stats_daily (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = MAX(value, excluded.value)',
    )
    .run(berlinDay(now), key, value)
  const result = db()
    .prepare(
      `INSERT INTO stats (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE excluded.value > stats.value`,
    )
    .run(key, value)
  return result.changes > 0
}

function set(key: string, value: number): void {
  db()
    .prepare('INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

function read(key: string): number {
  const row = db().prepare('SELECT value FROM stats WHERE key = ?').get(key) as { value: number } | undefined
  return row?.value ?? 0
}

export function recordWorldCreated(now = Date.now()): void {
  add('worlds_created', 1, now)
}

export function recordStart(worldId: string, now = Date.now()): void {
  add('starts', 1, now)
  db().prepare('UPDATE worlds SET starts = starts + 1 WHERE id = ?').run(worldId)
}

type Globals = { __amSeen?: Set<string>; __amSalt?: string }
const globals = globalThis as unknown as Globals

function salt(): string {
  if (globals.__amSalt) return globals.__amSalt
  const row = db().prepare(`SELECT value FROM settings WHERE key = 'stats_salt'`).get() as { value: string } | undefined
  if (row) return (globals.__amSalt = row.value)
  const created = randomBytes(16).toString('hex')
  db().prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('stats_salt', ?)`).run(created)
  const stored = db().prepare(`SELECT value FROM settings WHERE key = 'stats_salt'`).get() as { value: string }
  return (globals.__amSalt = stored.value)
}

/** Verbundene Spieler einer Welt für die vergangene Zeitspanne verbuchen. */
export function recordPlay(worldId: string, players: string[], elapsedMs: number, now = Date.now()): void {
  if (players.length === 0) return
  const ms = Math.round(players.length * Math.max(0, elapsedMs))
  add('play_ms', ms, now)
  db().prepare('UPDATE worlds SET play_ms = play_ms + ? WHERE id = ?').run(ms, worldId)

  const seen = (globals.__amSeen ??= new Set())
  for (const name of players) {
    const hash = createHash('sha256').update(`${salt()}:${name.toLowerCase()}`).digest('hex')
    if (seen.has(hash)) continue
    seen.add(hash)
    const inserted = db().prepare('INSERT OR IGNORE INTO players_seen (hash, first_seen) VALUES (?, ?)').run(hash, now)
    if (inserted.changes > 0) add('unique_players', 1, now)
  }
}

/** Nach jedem Durchlauf: wie viele Spieler und Server gerade gleichzeitig online sind. */
export function recordConcurrency(playersOnline: number, serversOnline: number, now = Date.now()): void {
  if (raise('peak_players', playersOnline, now)) set('peak_players_at', now)
  if (raise('peak_servers', serversOnline, now)) set('peak_servers_at', now)
}

export type Totals = {
  worldsCreated: number
  starts: number
  playMs: number
  playHours: number
  uniquePlayers: number
  peakPlayers: number
  peakPlayersAt: number | null
  peakServers: number
  peakServersAt: number | null
  /** Seit wann gezählt wird. */
  since: number
}

export function totals(): Totals {
  const playMs = read('play_ms')
  return {
    worldsCreated: read('worlds_created'),
    starts: read('starts'),
    playMs,
    playHours: Math.floor(playMs / 3_600_000),
    uniquePlayers: read('unique_players'),
    peakPlayers: read('peak_players'),
    peakPlayersAt: read('peak_players_at') || null,
    peakServers: read('peak_servers'),
    peakServersAt: read('peak_servers_at') || null,
    since: read('since'),
  }
}

export type DayStats = {
  day: string
  worldsCreated: number
  starts: number
  playMs: number
  uniquePlayers: number
  peakPlayers: number
  peakServers: number
}

/** Die letzten Tage, neuester zuerst — auch Tage, an denen nichts passiert ist. */
export function dailyStats(days = 14, now = Date.now()): DayStats[] {
  const wanted = Array.from({ length: days }, (_, index) => berlinDay(now - index * 86_400_000))
  // Bei der Zeitumstellung kann ein Tag doppelt auftauchen.
  const unique = [...new Set(wanted)]
  const rows = db()
    .prepare(`SELECT day, key, value FROM stats_daily WHERE day >= ?`)
    .all(unique.at(-1)!) as Array<{ day: string; key: string; value: number }>
  const byDay = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, new Map())
    byDay.get(row.day)!.set(row.key, row.value)
  }
  return unique.map((day) => {
    const values = byDay.get(day)
    return {
      day,
      worldsCreated: values?.get('worlds_created') ?? 0,
      starts: values?.get('starts') ?? 0,
      playMs: values?.get('play_ms') ?? 0,
      uniquePlayers: values?.get('unique_players') ?? 0,
      peakPlayers: values?.get('peak_players') ?? 0,
      peakServers: values?.get('peak_servers') ?? 0,
    }
  })
}

/** Spielzeit lesbar: unter einer Stunde in Minuten, darüber in Stunden. */
export function formatPlayTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} Min.`
  const hours = ms / 3_600_000
  return `${hours.toLocaleString('de-DE', { maximumFractionDigits: hours < 100 ? 1 : 0 })} Std.`
}

/**
 * Die große Zahl für Startseite und „in Zahlen“: ab 1.000 Stunden gerundet mit „Über“,
 * darunter genau — und solange noch keine Stunde zusammen ist, in Minuten.
 */
export function playHeadline(ms: number): { prefix: string; value: string; unit: string } {
  const hours = Math.floor(ms / 3_600_000)
  const format = (value: number) => value.toLocaleString('de-DE')
  if (hours >= 1000) return { prefix: 'Über', value: format(Math.floor(hours / 100) * 100), unit: 'Spielstunden' }
  if (hours >= 1) return { prefix: '', value: format(hours), unit: hours === 1 ? 'Spielstunde' : 'Spielstunden' }
  const minutes = Math.floor(ms / 60_000)
  return { prefix: '', value: format(minutes), unit: minutes === 1 ? 'Spielminute' : 'Spielminuten' }
}
