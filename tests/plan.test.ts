import './setup'
import os from 'node:os'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackup, listBackups } from '@/lib/backups'
import { db } from '@/lib/db'
import { writeTextFile } from '@/lib/files'
import { imprint, imprintComplete, saveImprint } from '@/lib/imprint'
import { defaultPlan, heapMiB, hostCapacity, planOf, planProblem, resetWorldPlan, setWorldPlan, worldPlan } from '@/lib/plan'
import { setLimit } from '@/lib/settings'
import { createWorld, getWorld, requestStart, requestStop, tick, type World } from '@/lib/worlds'

const INPUT = { name: 'Paket', version: '26.3', gamemode: 'survival', difficulty: 'easy', seed: '', whitelist: false }
const fresh = (world: World) => getWorld(world.user_id, world.id)!

async function until(world: World, status: string, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    await tick()
    if (fresh(world).status === status) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Status ${status} nicht erreicht — ist ${fresh(world).status}`)
}

/** Die Tests sollen auf jeder Maschine dasselbe prüfen — der Server hat hier 16 GiB und 4 Kerne. */
function fakeHost(ramGiB = 16, cpus = 4) {
  vi.spyOn(os, 'totalmem').mockReturnValue(ramGiB * 1024 ** 3)
  vi.spyOn(os, 'availableParallelism').mockReturnValue(cpus)
}

describe('Paket einer Welt', () => {
  let owner: string
  beforeEach(() => fakeHost())
  afterEach(() => vi.restoreAllMocks())
  beforeAll(() => {
    owner = 'usr_paketpaketpaket1'
    db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(owner, 'paket@example.com', 'x', Date.now())
    setLimit('maxWorldsPerUser', 20)
  })

  it('gilt ohne Eintrag als Standardpaket', () => {
    const world = createWorld(owner, INPUT)
    expect(worldPlan(world)).toEqual({ ...defaultPlan(), upgraded: false, label: 'Kostenlos' })
    expect(worldPlan(world)).toMatchObject({ ramMiB: 2560, diskGiB: 6, maxPlayers: 20, backupGiB: 12, autoPauseMinutes: 30 })
  })

  it('lässt sich hochstufen — gespeichert wird nur, was vom Standard abweicht', () => {
    const world = createWorld(owner, INPUT)
    const other = createWorld(owner, INPUT)
    setWorldPlan(world.id, { ...defaultPlan(), ramMiB: 4096, diskGiB: 25 })
    expect(fresh(world)).toMatchObject({ ram_mib: 4096, disk_gib: 25, cpus: null, max_players: null, backup_gib: null, auto_pause_minutes: null })
    expect(worldPlan(fresh(world))).toMatchObject({ ramMiB: 4096, diskGiB: 25, maxPlayers: 20, upgraded: true, label: 'Upgrade' })
    expect(planOf(world.id)).toEqual(worldPlan(fresh(world)))
    // Andere Welten bleiben beim Standard.
    expect(worldPlan(fresh(other)).upgraded).toBe(false)

    // Was nicht eigens gesetzt ist, folgt weiter dem Standard — auch wenn der sich ändert.
    setLimit('autoPauseMinutes', 45)
    expect(worldPlan(fresh(world)).autoPauseMinutes).toBe(45)
    setLimit('autoPauseMinutes', 30)

    resetWorldPlan(world.id)
    expect(worldPlan(fresh(world))).toEqual({ ...defaultPlan(), upgraded: false, label: 'Kostenlos' })
  })

  it('nennt ein Paket nur dann „Upgrade“, wenn nichts schlechter ist als im Standard', () => {
    const world = createWorld(owner, INPUT)
    const label = (values: Partial<ReturnType<typeof defaultPlan>>) => {
      setWorldPlan(world.id, { ...defaultPlan(), ...values })
      return worldPlan(fresh(world)).label
    }
    expect(label({ ramMiB: 2048 })).toBe('Angepasst') // weniger als kostenlos
    expect(label({ ramMiB: 8192, diskGiB: 3 })).toBe('Angepasst') // teils mehr, teils weniger
    expect(label({ autoPauseMinutes: 10 })).toBe('Angepasst')
    expect(label({ autoPauseMinutes: 0 })).toBe('Upgrade') // „nie pausieren“ ist das Beste
    expect(label({ autoPauseMinutes: 120, maxPlayers: 40 })).toBe('Upgrade')
    expect(label({})).toBe('Kostenlos')
  })

  it('lässt sich auch ändern, wenn der Standard selbst nicht zum Server passt', () => {
    fakeHost(16, 1) // ein Kern, der Standard sieht zwei vor
    const base = defaultPlan()
    expect(base.cpus).toBe(2)
    expect(planProblem(base)).toBeNull()
    expect(planProblem({ ...base, diskGiB: 50 })).toBeNull() // nur der Speicherplatz ändert sich
    expect(planProblem({ ...base, cpus: 1.5 })).toMatch(/CPU-Kerne/) // mehr als vorhanden bleibt abgelehnt
    const world = createWorld(owner, INPUT)
    setWorldPlan(world.id, { ...base, diskGiB: 50 })
    expect(fresh(world)).toMatchObject({ disk_gib: 50, cpus: null })
  })

  it('löscht keine automatischen Backups, wenn das neue ohnehin keinen Platz hätte', async () => {
    const world = createWorld(owner, INPUT)
    writeTextFile(world.id, 'notiz.txt', 'hallo', { create: true })
    setWorldPlan(world.id, { ...defaultPlan(), backupGiB: 1 })
    const GiB = 1024 ** 3
    const insert = db().prepare('INSERT INTO backups (id, world_id, kind, version, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    insert.run('bak_eigenes000000001', world.id, 'manual', '26.3', GiB, Date.now() - 3000) // füllt den Backup-Speicher allein
    insert.run('bak_auto00000000001', world.id, 'auto', '26.3', 1000, Date.now() - 2000)
    insert.run('bak_auto00000000002', world.id, 'auto', '26.3', 1000, Date.now() - 1000)

    await expect(createBackup(fresh(world), 'auto')).rejects.toThrow(/kein Platz/)
    expect(listBackups(world.id).map((backup) => backup.id).sort()).toEqual(['bak_auto00000000001', 'bak_auto00000000002', 'bak_eigenes000000001'])

    // Mit Platz neben den eigenen Backups weicht wie gehabt nur so viel wie nötig.
    db().prepare('UPDATE backups SET size_bytes = ? WHERE id = ?').run(GiB - 1500, 'bak_eigenes000000001')
    const created = await createBackup(fresh(world), 'auto')
    const left = listBackups(world.id).map((backup) => backup.id)
    expect(left).toContain(created.id)
    expect(left).toContain('bak_eigenes000000001')
    expect(left).not.toContain('bak_auto00000000001') // das älteste automatische hat Platz gemacht
  })

  it('weist unsinnige Werte zurück', () => {
    const base = defaultPlan()
    expect(planProblem(base)).toBeNull()
    expect(planProblem({ ...base, ramMiB: 1024 })).toMatch(/Arbeitsspeicher/)
    expect(planProblem({ ...base, ramMiB: Number.NaN })).toMatch(/Arbeitsspeicher/)
    expect(planProblem({ ...base, diskGiB: 0 })).toMatch(/Speicherplatz/)
    expect(planProblem({ ...base, diskGiB: 6.5 })).toMatch(/ganze Zahl/)
    expect(planProblem({ ...base, maxPlayers: 501 })).toMatch(/Spielerplätze/)
    expect(planProblem({ ...base, autoPauseMinutes: 3 })).toMatch(/Auto-Pause/)
    expect(planProblem({ ...base, autoPauseMinutes: 0 })).toBeNull()
    expect(planProblem({ ...base, cpus: hostCapacity().cpus + 1 })).toMatch(/CPU-Kerne/)
    expect(planProblem({ ...base, ramMiB: (Math.floor(hostCapacity().ramMiB / 1024) + 1) * 1024 })).toMatch(/Arbeitsspeicher/)
    const world = createWorld(owner, INPUT)
    expect(() => setWorldPlan(world.id, { ...base, backupGiB: -1 })).toThrow(RangeError)
    expect(worldPlan(fresh(world)).upgraded).toBe(false)
  })

  it('lässt dem Server neben der Java-Halde genug Luft', () => {
    expect(heapMiB(2560)).toBe(2048) // wie bisher im Standardpaket
    expect(heapMiB(2048)).toBe(1536)
    expect(heapMiB(8192)).toBe(8192 - 1229)
    for (const ram of [2048, 4096, 16384, 65536]) expect(heapMiB(ram)).toBeLessThan(ram - 500)
  })

  it('pausiert nach der Auto-Pause des Pakets — und mit 0 gar nicht von selbst', async () => {
    const world = createWorld(owner, INPUT)
    setWorldPlan(world.id, { ...defaultPlan(), autoPauseMinutes: 0 })
    await requestStart(fresh(world))
    await until(world, 'online')
    db().prepare('UPDATE worlds SET last_active_at = ? WHERE id = ?').run(Date.now() - 600 * 60_000, world.id)
    await tick()
    await tick()
    expect(fresh(world).status).toBe('online') // bleibt an

    // Ein kürzeres Limit als der Standard greift sofort, ohne Neustart.
    setWorldPlan(world.id, { ...defaultPlan(), autoPauseMinutes: 5 })
    db().prepare('UPDATE worlds SET last_active_at = ? WHERE id = ?').run(Date.now() - 4 * 60_000, world.id)
    await tick()
    expect(fresh(world).status).toBe('online')
    db().prepare('UPDATE worlds SET last_active_at = ? WHERE id = ?').run(Date.now() - 6 * 60_000, world.id)
    await tick()
    expect(fresh(world).status).toBe('stopping')
    expect(fresh(world).pause_reason).toBe('idle')
    await until(world, 'paused')
    await requestStop(fresh(world))
  }, 60_000)
})

describe('Angaben des Betreibers', () => {
  it('sind anfangs unvollständig und nach dem Speichern vollständig', () => {
    expect(imprintComplete(imprint())).toBe(false)
    expect(imprint().country).toBe('Deutschland')
    saveImprint({ name: 'Erika Muster', street: 'Beispielweg 1', city: '12345 Musterstadt', country: 'Deutschland', email: 'kontakt@example.com', phone: '' })
    const saved = imprint()
    expect(imprintComplete(saved)).toBe(true)
    expect(saved).toMatchObject({ name: 'Erika Muster', email: 'kontakt@example.com', phone: '' })
    expect(saved.updatedAt).toBeGreaterThan(0)
  })
})
