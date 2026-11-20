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
  })

  it('vergibt jeder Welt einen anderen Port, gibt ihn nach dem Löschen wieder frei und meldet einen vollen Bereich', async () => {
    const user = newUser()
    const { setLimit } = await import('@/lib/settings')
    setLimit('maxWorldsPerUser', 20)
    const created = Array.from({ length: 5 }, () => worlds.createWorld(user, INPUT))
    expect(created.map((world) => world.port).sort()).toEqual([25600, 25601, 25602, 25603, 25604])
    expect(() => worlds.createWorld(user, INPUT)).toThrow(/Adressen vergeben/)

    await worlds.deleteWorld(created[2]!)
    expect(worlds.createWorld(user, INPUT).port).toBe(25602)
    for (const world of worlds.listWorlds(user)) await worlds.deleteWorld(world)
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
    await worlds.deleteWorld(fresh(world))
  })

  it('räumt einen Eintrag später weg, wenn das Löschen zunächst scheitert', async () => {
    const world = worlds.createWorld(newUser(), INPUT)
    await dns.ensureWorldRecord(world)
    const recordId = fresh(world).dns_record_id!

    cloudflare.state.failDns = true
    await worlds.deleteWorld(fresh(world)) // die Welt ist weg, der Eintrag noch da
    expect(worlds.getWorld(world.user_id, world.id)).toBeUndefined()
    expect(srv().some((record) => record.id === recordId)).toBe(true)
    expect(database.db().prepare('SELECT record_id FROM dns_cleanup').all()).toEqual([{ record_id: recordId }])

    cloudflare.state.failDns = false
    await dns.dnsMaintenance()
    expect(srv().some((record) => record.id === recordId)).toBe(false)
    expect(database.db().prepare('SELECT COUNT(*) AS n FROM dns_cleanup').get()).toEqual({ n: 0 })
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
  })
})
