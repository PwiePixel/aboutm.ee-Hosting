import './setup'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { berlinDay, dailyStats, playHeadline, totals } from '@/lib/stats'
import { createWorld, getWorld, requestStart, sendCommand, tick, type World } from '@/lib/worlds'

const INPUT = { name: 'Statistik', version: '26.3', gamemode: 'survival', difficulty: 'easy', seed: '', whitelist: false }
const fresh = (world: World) => getWorld(world.user_id, world.id)!

async function untilOnline(world: World): Promise<void> {
  const end = Date.now() + 15_000
  while (Date.now() < end) {
    await tick()
    if (fresh(world).status === 'online') return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Welt kam nicht online')
}

describe('Statistik', () => {
  it('zählt erstellte Welten, Starts, Spielzeit, Rekorde und verschiedene Spieler', async () => {
    db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('usr_statistikstatis', 's@example.com', 'x', Date.now())
    const before = totals()
    expect(before.since).toBeGreaterThan(0)

    const world = createWorld('usr_statistikstatis', INPUT)
    expect(totals().worldsCreated).toBe(before.worldsCreated + 1)

    await requestStart(world)
    await untilOnline(world)
    expect(totals().starts).toBe(before.starts + 1)
    expect(fresh(world).starts).toBe(1)

    // Ab hier mit festen Zeitpunkten, damit die Rechnung exakt prüfbar ist.
    const t0 = Date.now() + 1000
    await tick({}, t0)
    expect(totals().playMs).toBe(0) // niemand online -> keine Spielzeit

    await sendCommand(fresh(world), 'testjoin Steve')
    await sendCommand(fresh(world), 'testjoin Alex')
    await tick({}, t0 + 2000)
    await tick({}, t0 + 4000)
    // zwei Spieler, zweimal zwei Sekunden = acht Spieler-Sekunden
    expect(totals().playMs).toBe(8000)
    expect(fresh(world).play_ms).toBe(8000)
    expect(totals().peakPlayers).toBe(2)
    expect(totals().peakPlayersAt).toBe(t0 + 2000)
    expect(totals().peakServers).toBe(1)
    expect(totals().uniquePlayers).toBe(2)

    // Derselbe Spieler kommt wieder: Spielzeit läuft weiter, aber er zählt nicht doppelt.
    await sendCommand(fresh(world), 'testleave Alex')
    await tick({}, t0 + 6000)
    await sendCommand(fresh(world), 'testjoin Alex')
    await tick({}, t0 + 8000)
    expect(totals().playMs).toBe(8000 + 2000 + 4000)
    expect(totals().uniquePlayers).toBe(2)
    expect(totals().peakPlayers).toBe(2)

    // Stand der Prozess still, werden höchstens zehn Sekunden nachgetragen.
    await tick({}, t0 + 8000 + 5 * 60_000)
    expect(totals().playMs).toBe(14_000 + 2 * 10_000)

    const today = dailyStats(3, t0).find((day) => day.day === berlinDay(t0))!
    expect(today.worldsCreated).toBe(1)
    expect(today.starts).toBe(1)
    expect(today.peakPlayers).toBe(2)
    expect(today.uniquePlayers).toBe(2)

    // Namen stehen nirgends im Klartext.
    const stored = JSON.stringify(db().prepare('SELECT * FROM players_seen').all())
    expect(stored).not.toMatch(/steve|alex/i)
  }, 60_000)

  it('ordnet Zeitpunkte dem richtigen Tag in deutscher Zeit zu', () => {
    expect(berlinDay(Date.UTC(2026, 10, 20, 22, 30))).toBe('2026-11-20') // 23:30 MEZ
    expect(berlinDay(Date.UTC(2026, 10, 20, 23, 30))).toBe('2026-11-21') // 00:30 MEZ
    expect(berlinDay(Date.UTC(2026, 6, 1, 22, 30))).toBe('2026-07-02') // 00:30 MESZ
  })

  it('listet die letzten Tage lückenlos — auch über die Zeitumstellung hinweg', () => {
    // 29.03.2026 hat in Deutschland nur 23 Stunden. Kurz nach Mitternacht am 30.03.:
    const afterSpringForward = Date.UTC(2026, 2, 29, 22, 30) // 00:30 MESZ am 30.03.
    expect(dailyStats(4, afterSpringForward).map((entry) => entry.day)).toEqual([
      '2026-03-30',
      '2026-03-29',
      '2026-03-28',
      '2026-03-27',
    ])
    // 25.10.2026 hat 25 Stunden. Spät am Abend:
    const lateOnLongDay = Date.UTC(2026, 9, 25, 22, 30) // 23:30 MEZ am 25.10.
    expect(dailyStats(3, lateOnLongDay).map((entry) => entry.day)).toEqual(['2026-10-25', '2026-10-24', '2026-10-23'])
    // Über den Monatswechsel
    expect(dailyStats(3, Date.UTC(2026, 2, 1, 12)).map((entry) => entry.day)).toEqual(['2026-03-01', '2026-02-28', '2026-02-27'])
  })

  it('formuliert die große Zahl passend', () => {
    expect(playHeadline(0)).toEqual({ prefix: '', value: '0', unit: 'Spielminuten' })
    expect(playHeadline(59 * 60_000)).toEqual({ prefix: '', value: '59', unit: 'Spielminuten' })
    expect(playHeadline(3_600_000)).toEqual({ prefix: '', value: '1', unit: 'Spielstunde' })
    expect(playHeadline(999 * 3_600_000)).toEqual({ prefix: '', value: '999', unit: 'Spielstunden' })
    expect(playHeadline(6094 * 3_600_000)).toEqual({ prefix: 'Über', value: '6.000', unit: 'Spielstunden' })
  })
})
