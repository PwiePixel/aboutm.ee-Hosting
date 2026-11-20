import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — reines JavaScript-Hilfsmodul ohne Typen
import { startCloudflareMock } from './helpers/cloudflare-mock.mjs'
// @ts-expect-error — reines JavaScript-Hilfsmodul ohne Typen
import { startDockerMock } from './helpers/docker-mock.mjs'

/**
 * Eigene Adresse je Welt: fester Port aus dem Bereich und ein SRV-Eintrag bei Cloudflare,
 * der beim Anlegen entsteht und beim Löschen verschwindet.
 */

type DnsRecord = { id: string; type: string; name: string; ttl?: number; proxied?: boolean; data?: { priority: number; weight: number; port: number; target: string } }
type CloudflareMock = { url: string; close: () => Promise<void>; state: { dns: DnsRecord[]; failDns: boolean; calls: Array<{ method: string; path: string }> } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aboutmee-dns-'))
const INPUT = { name: 'Adresse', version: '26.3', gamemode: 'survival', difficulty: 'easy', seed: '', whitelist: false }

let cloudflare: CloudflareMock
let docker: { close: () => Promise<void> }
let worlds: typeof import('@/lib/worlds')
let dns: typeof import('@/lib/dns')
let database: typeof import('@/lib/db')
let counter = 0

beforeAll(async () => {
  cloudflare = await startCloudflareMock({ zones: ['example.com'] })
  docker = await startDockerMock(path.join(dir, 'docker.sock'))
  Object.assign(process.env, {
    DATA_DIR: path.join(dir, 'data'),
    RUNTIME_DRIVER: 'docker',
    DOCKER_SOCKET: path.join(dir, 'docker.sock'),
    SERVER_DOMAIN: 'example.com',
    NODE_HOST: 'node.example.com',
    MC_PORT_MIN: '25600',
    MC_PORT_MAX: '25604', // nur fünf Ports, damit sich die Grenze prüfen lässt
    CLOUDFLARE_API_TOKEN: 'test-token',
    CLOUDFLARE_ZONE_ID: 'zone1',
    CLOUDFLARE_API_BASE: cloudflare.url,
  })
  worlds = await import('@/lib/worlds')
  dns = await import('@/lib/dns')
  database = await import('@/lib/db')
})
afterAll(async () => {
  await cloudflare.close()
  await docker.close()
})

function newUser(): string {
  const id = `usr_dns${String(++counter).padStart(13, '0')}`
  database.db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, `${id}@example.com`, 'x', Date.now())
  return id
}
const fresh = (world: { id: string; user_id: string }) => worlds.getWorld(world.user_id, world.id)!
const srv = () => cloudflare.state.dns.filter((record) => record.type === 'SRV')
/** Lässt die Sperrfrist nach dem Entfernen eines Eintrags ablaufen (im Betrieb: fünf Minuten). */
const expireHolds = () => database.db().prepare('UPDATE dns_cleanup SET removed_at = removed_at - 6 * 60000 WHERE removed_at IS NOT NULL').run()
const pending = () => database.db().prepare('SELECT name, record_id, port FROM dns_cleanup WHERE removed_at IS NULL').all()
async function deleteAll() {
  for (const row of database.db().prepare('SELECT * FROM worlds').all() as Array<{ id: string; user_id: string }>) {
    await worlds.deleteWorld(fresh(row))
  }
  expireHolds()
  await dns.dnsMaintenance()
}

describe('Adresse einer Welt', () => {
  it('bekommt einen eigenen Port und einen SRV-Eintrag, der auf den Server zeigt', async () => {
    const world = worlds.createWorld(newUser(), INPUT)
    expect(world.port).toBe(25600)
    // Solange es den Eintrag noch nicht gibt, gilt die Adresse des Servers mit dem Port.
    expect(worlds.worldAddress(world)).toBe('node.example.com:25600')

    expect(await dns.ensureWorldRecord(world)).toBe(true)
    expect(srv()).toHaveLength(1)
    expect(srv()[0]).toMatchObject({
      type: 'SRV',
      name: `_minecraft._tcp.${world.host_label}.example.com`,
      data: { priority: 0, weight: 5, port: 25600, target: 'node.example.com' },
      ttl: 60,
    })
    expect(srv()[0]!.proxied).not.toBe(true)
    expect(fresh(world).dns_record_id).toBe(srv()[0]!.id)
    expect(worlds.worldAddress(fresh(world))).toBe(`${world.host_label}.example.com`)

    // Ein zweiter Aufruf legt nichts doppelt an.
    expect(await dns.ensureWorldRecord(fresh(world))).toBe(true)
    expect(srv()).toHaveLength(1)

    await worlds.deleteWorld(fresh(world))
    expect(srv()).toHaveLength(0)
    await deleteAll()
  })

  it('vergibt jeder Welt einen anderen Port, gibt ihn nach dem Löschen wieder frei und meldet einen vollen Bereich', async () => {
    const user = newUser()
    const { setLimit } = await import('@/lib/settings')
    setLimit('maxWorldsPerUser', 20)
    const created = Array.from({ length: 5 }, () => worlds.createWorld(user, INPUT))
    expect(created.map((world) => world.port).sort()).toEqual([25600, 25601, 25602, 25603, 25604])
    expect(() => worlds.createWorld(user, INPUT)).toThrow(/Adressen vergeben/)

    await worlds.deleteWorld(created[2]!)
    // Direkt nach dem Löschen bleibt der Port noch gesperrt: Resolver kennen den alten Eintrag noch kurz.
    expect(() => worlds.createWorld(user, INPUT)).toThrow(/Adressen vergeben/)
    expireHolds()
    expect(worlds.createWorld(user, INPUT).port).toBe(25602)
    await deleteAll()
  })

  it('bleibt nutzbar, wenn Cloudflare gerade nicht antwortet — und holt den Eintrag später nach', async () => {
    cloudflare.state.failDns = true
    const world = worlds.createWorld(newUser(), INPUT)
    await expect(dns.ensureWorldRecord(world)).rejects.toThrow(dns.DnsError)
    expect(fresh(world).dns_record_id).toBeNull()
    expect(worlds.worldAddress(fresh(world))).toBe(`node.example.com:${world.port}`)

    await dns.dnsMaintenance() // weiterhin gestört: nichts passiert, kein Absturz
    expect(fresh(world).dns_record_id).toBeNull()

    cloudflare.state.failDns = false
    await dns.dnsMaintenance()
    expect(fresh(world).dns_record_id).not.toBeNull()
    expect(srv().map((record) => record.data!.port)).toContain(world.port)
    await deleteAll()
  })

  it('räumt einen Eintrag später weg, wenn das Löschen zunächst scheitert', async () => {
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    const recordId = fresh(world).dns_record_id!

    cloudflare.state.failDns = true
    await worlds.deleteWorld(fresh(world)) // die Welt ist weg, der Eintrag noch da
    expect(worlds.getWorld(world.user_id, world.id)).toBeUndefined()
    expect(srv().some((record) => record.id === recordId)).toBe(true)
    expect(pending()).toEqual([{ name: dns.recordName(world), record_id: recordId, port: world.port }])

    // Solange der alte Name noch auf den Port zeigt, bekommt keine neue Welt diesen Port.
    const next = worlds.createWorld(newUser(), INPUT)
    expect(next.port).not.toBe(world.port)

    cloudflare.state.failDns = false
    await dns.dnsMaintenance()
    expect(srv().some((record) => record.id === recordId)).toBe(false)
    expect(pending()).toEqual([])
    // Nach der Sperrfrist ist der Port wieder frei.
    await worlds.deleteWorld(fresh(next))
    expireHolds()
    expect(worlds.createWorld(newUser(), INPUT).port).toBe(world.port)
    await deleteAll()
  })

  it('gibt den Port auch dann nicht frei, wenn während des Löschens schon die nächste Welt entsteht', async () => {
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    const recordId = fresh(world).dns_record_id
    cloudflare.state.failDns = true
    const deleting = worlds.deleteWorld(fresh(world)) // läuft noch — Cloudflare antwortet nicht
    // Sobald die Welt aus der Datenbank verschwunden ist, legt jemand anderes eine neue an.
    for (let i = 0; i < 200 && worlds.getWorld(world.user_id, world.id); i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(worlds.getWorld(world.user_id, world.id)).toBeUndefined()
    const other = worlds.createWorld(newUser(), INPUT)
    expect(other.port).not.toBe(world.port)
    await deleting
    expect(pending()).toEqual([{ name: dns.recordName(world), record_id: recordId, port: world.port }])
    cloudflare.state.failDns = false
    await deleteAll()
    expect(srv()).toHaveLength(0)
  })

  it('merkt Einträge gelöschter Welten auch vor, wenn der Cloudflare-Zugang inzwischen fehlt', async () => {
    const { config } = await import('@/lib/config')
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    const token = config.cloudflare.token
    ;(config.cloudflare as { token: string }).token = '' // wie nach dem Entfernen aus der .env
    try {
      expect(worlds.worldAddress(fresh(world))).toBe(`${world.host_label}.example.com`) // der Eintrag gilt ja weiter
      await worlds.deleteWorld(fresh(world))
      expect(srv()).toHaveLength(1)
      expect(pending()).toHaveLength(1)
      expect(worlds.createWorld(newUser(), INPUT).port).not.toBe(world.port)
    } finally {
      ;(config.cloudflare as { token: string }).token = token
    }
    await dns.dnsMaintenance() // Zugang wieder da: der alte Eintrag verschwindet
    expect(srv().filter((record) => record.name === dns.recordName(world))).toHaveLength(0)
    await deleteAll()
  })

  it('zieht alle Einträge um, wenn sich die Domain der Welten oder die Adresse des Servers ändert', async () => {
    const { config } = await import('@/lib/config')
    const mutable = config as { serverDomain: string; nodeHost: string }
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    await dns.dnsMaintenance() // merkt sich den aktuellen Stand
    const oldName = dns.recordName(world)

    // Erst nur die Adresse des Servers: derselbe Eintrag bekommt das neue Ziel.
    mutable.nodeHost = 'server2.example.com'
    try {
      await dns.dnsMaintenance()
      expect(srv()).toHaveLength(1)
      expect(srv()[0]).toMatchObject({ name: oldName, data: { target: 'server2.example.com', port: world.port } })
      expect(fresh(world).dns_record_id).toBe(srv()[0]!.id)

      // Dann die Domain der Welten: neuer Name, der alte Eintrag verschwindet.
      mutable.serverDomain = 'welten.example.com'
      await dns.dnsMaintenance()
      expect(srv().map((record) => record.name)).toEqual([`_minecraft._tcp.${world.host_label}.welten.example.com`])
      expect(worlds.worldAddress(fresh(world))).toBe(`${world.host_label}.welten.example.com`)
      // Der Port der Welt war dabei nie gesperrt oder neu vergeben.
      expect(fresh(world).port).toBe(world.port)
    } finally {
      mutable.nodeHost = 'node.example.com'
      mutable.serverDomain = 'example.com'
    }
    await dns.dnsMaintenance()
    expect(srv().map((record) => record.name)).toEqual([oldName])
    await deleteAll()
    expect(srv()).toHaveLength(0)
  })

  it('löscht keinen Eintrag einer bestehenden Welt, wenn ein Domainwechsel zurückgenommen wird', async () => {
    const { config } = await import('@/lib/config')
    const mutable = config as { serverDomain: string }
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    await dns.dnsMaintenance()
    const name = dns.recordName(world)

    // Domain geändert, während Cloudflare nicht antwortet: die alten Namen bleiben vorgemerkt.
    mutable.serverDomain = 'welten.example.com'
    cloudflare.state.failDns = true
    try {
      await dns.dnsMaintenance()
      expect(pending()).toEqual([{ name, record_id: expect.any(String), port: world.port }])
    } finally {
      mutable.serverDomain = 'example.com'
      cloudflare.state.failDns = false
    }
    // Zurückgestellt: der Eintrag der Welt gilt wieder und darf nicht mehr gelöscht werden.
    await dns.dnsMaintenance()
    await dns.dnsMaintenance()
    expect(srv().map((record) => record.name)).toEqual([name])
    expect(fresh(world).dns_record_id).toBe(srv()[0]!.id)
    expect(pending()).toEqual([])
    await deleteAll()
  })

  it('hält nach einem Domainwechsel den Port einer gelöschten Welt gesperrt, bis auch ihr alter Name weg ist', async () => {
    const { config } = await import('@/lib/config')
    const mutable = config as { serverDomain: string }
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    await dns.dnsMaintenance()
    const oldName = dns.recordName(world)
    mutable.serverDomain = 'welten.example.com'
    try {
      dns.reconcileDnsConfig() // der alte Name ist vorgemerkt, aber noch nicht entfernt
      await worlds.deleteWorld(fresh(world))
      expireHolds() // die Sperrfrist des neuen Namens ist um — der alte Eintrag besteht aber noch
      expect(srv().map((record) => record.name)).toContain(oldName)
      expect(worlds.createWorld(newUser(), INPUT).port).not.toBe(world.port)
      await dns.dnsMaintenance()
      expect(srv().map((record) => record.name)).not.toContain(oldName)
    } finally {
      mutable.serverDomain = 'example.com'
    }
    await dns.dnsMaintenance()
    await deleteAll()
    expect(srv()).toHaveLength(0)
  })

  it('lässt eine Welt nicht im Zwischenzustand hängen, wenn beim Start kein Port frei ist', async () => {
    const user = newUser()
    const { setLimit } = await import('@/lib/settings')
    setLimit('maxWorldsPerUser', 20)
    const all = Array.from({ length: 5 }, () => worlds.createWorld(user, INPUT)) // der Bereich ist damit voll
    database.db().prepare('UPDATE worlds SET port = NULL WHERE id = ?').run(all[0]!.id)
    const extra = worlds.createWorld(newUser(), INPUT) // nimmt den frei gewordenen Port
    expect(extra.port).toBe(all[0]!.port)
    await expect(worlds.requestStart(fresh(all[0]!))).rejects.toThrow(/Adressen vergeben/)
    expect(fresh(all[0]!)).toMatchObject({ status: 'paused', port: null })
    // Auch die Übernahme alter Welten startet nur neu, wer einen Port bekommen hat.
    database.db().prepare(`UPDATE worlds SET status = 'online' WHERE id = ?`).run(all[0]!.id)
    worlds.adoptLegacyWorlds()
    expect(fresh(all[0]!)).toMatchObject({ status: 'online', port: null })
    database.db().prepare(`UPDATE worlds SET status = 'paused' WHERE id = ?`).run(all[0]!.id)
    await deleteAll()
  })

  it('löscht beim Entfernen eines Kontos auch eine Welt, die währenddessen noch angelegt wurde', async () => {
    const user = newUser()
    const first = worlds.createWorld(user, INPUT)
    await dns.ensureWorldRecord(first)
    const deleting = worlds.deleteUserWithWorlds(user)
    // Während die erste Welt gelöscht wird, legt dasselbe Konto in einem anderen Fenster noch eine an.
    const late = worlds.createWorld(user, INPUT)
    await dns.ensureWorldRecord(late)
    await deleting
    expect(database.db().prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(user)).toEqual({ n: 0 })
    expect(database.db().prepare('SELECT COUNT(*) AS n FROM worlds WHERE user_id = ?').get(user)).toEqual({ n: 0 })
    expect(srv()).toHaveLength(0)
    expect(pending()).toEqual([])
    await deleteAll()
  })

  it('übernimmt Welten aus älteren Ständen: Port sofort, laufende werden neu gestartet', async () => {
    const paused = worlds.createWorld(newUser(), INPUT)
    const running = worlds.createWorld(newUser(), INPUT)
    database.db().prepare('UPDATE worlds SET port = NULL WHERE id IN (?, ?)').run(paused.id, running.id)
    database.db().prepare(`UPDATE worlds SET status = 'online' WHERE id = ?`).run(running.id)

    worlds.adoptLegacyWorlds()
    expect(fresh(paused)).toMatchObject({ status: 'paused' })
    expect(fresh(paused).port).not.toBeNull()
    expect(fresh(running)).toMatchObject({ status: 'stopping', restart_pending: 1 })
    expect(fresh(running).port).not.toBeNull()
    expect(fresh(running).port).not.toBe(fresh(paused).port)

    await dns.dnsMaintenance() // die Einträge stehen, bevor jemand die Welt startet
    expect(worlds.worldAddress(fresh(paused))).toBe(`${paused.host_label}.example.com`)
    worlds.adoptLegacyWorlds() // ein zweiter Lauf ändert nichts mehr
    expect(fresh(running)).toMatchObject({ status: 'stopping', restart_pending: 1 })
    database.db().prepare(`UPDATE worlds SET status = 'paused', restart_pending = 0 WHERE id = ?`).run(running.id)
    await deleteAll()
  })

  it('räumt beim Löschen auch einen Eintrag weg, dessen Kennung nie gespeichert wurde', async () => {
    const world = worlds.createWorld(newUser(), INPUT)
    // Der Eintrag existiert bei Cloudflare, aber die Datenbank weiß nichts davon (etwa nach einem Absturz).
    await fetch(`${cloudflare.url}/zones/zone1/dns_records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SRV', name: dns.recordName(world), data: { priority: 0, weight: 5, port: world.port, target: 'node.example.com' }, ttl: 60 }),
    })
    expect(fresh(world).dns_record_id).toBeNull()
    await worlds.deleteWorld(fresh(world))
    expect(srv().filter((record) => record.name === dns.recordName(world))).toHaveLength(0)
    await deleteAll()
  })

  it('übernimmt einen schon vorhandenen Eintrag und stellt ihn auf den richtigen Port', async () => {
    const world = worlds.createWorld(newUser(), INPUT)
    // Unter dem Namen der Welt liegt noch ein alter Eintrag mit falschem Port.
    await fetch(`${cloudflare.url}/zones/zone1/dns_records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SRV', name: dns.recordName(world), data: { priority: 0, weight: 5, port: 31337, target: 'alt.example.com' }, ttl: 60 }),
    })
    expect(await dns.ensureWorldRecord(world)).toBe(true)
    const own = srv().filter((record) => record.name === dns.recordName(world))
    expect(own).toHaveLength(1)
    expect(own[0]!.data).toMatchObject({ port: world.port, target: 'node.example.com' })
    await worlds.deleteWorld(fresh(world))
    expect(srv()).toHaveLength(0)
    await deleteAll()
  })
})
