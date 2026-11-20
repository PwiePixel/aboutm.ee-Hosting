import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — reines JavaScript-Hilfsmodul ohne Typen
import { startDockerMock } from './helpers/docker-mock.mjs'

/**
 * Der Docker-Treiber gegen eine nachgebaute Docker-Engine: Abläufe, bei denen es auf die
 * Reihenfolge ankommt (Stopp während des Starts, Löschen im Betrieb, verlorene Stopps).
 */

type DockerMock = {
  close: () => Promise<void>
  state: {
    calls: string[]
    containers: Map<string, { running: boolean; spec: { Env: string[]; User: string; HostConfig: Record<string, unknown> } }>
    createDelayMs: number
    players: string
    failStops: boolean
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aboutmee-docker-'))
process.env.DATA_DIR = path.join(dir, 'data')
process.env.RUNTIME_DRIVER = 'docker'
process.env.DOCKER_SOCKET = path.join(dir, 'docker.sock')
process.env.TOTAL_SLOTS = '5'

const INPUT = { name: 'Docker', version: '26.3', gamemode: 'survival', difficulty: 'easy', seed: '', whitelist: false }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let mock: DockerMock
let lib: typeof import('@/lib/worlds')
let database: typeof import('@/lib/db')
let counter = 0

beforeAll(async () => {
  mock = await startDockerMock(process.env.DOCKER_SOCKET)
  lib = await import('@/lib/worlds')
  database = await import('@/lib/db')
})
afterAll(() => mock.close())

function newWorld() {
  const id = `usr_docker${String(++counter).padStart(10, '0')}`
  database.db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, `${id}@example.com`, 'x', Date.now())
  return lib.createWorld(id, INPUT)
}
const status = (world: { id: string; user_id: string }) => lib.getWorld(world.user_id, world.id)!.status
const container = (world: { id: string }) => mock.state.containers.get(`aboutmee-${world.id}`)

async function ticksUntil(world: { id: string; user_id: string }, wanted: string, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await lib.tick()
    if (status(world) === wanted) return
    await sleep(60)
  }
  throw new Error(`Status ${wanted} nicht erreicht — ist ${status(world)}`)
}

describe('Docker-Treiber', () => {
  it('startet den Server abgesichert und meldet ihn online', async () => {
    const world = newWorld()
    await lib.requestStart(world)
    await ticksUntil(world, 'online')

    const spec = container(world)!.spec
    expect(spec.User).toBe('1000:1000')
    expect(spec.HostConfig).toMatchObject({ CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], RestartPolicy: { Name: 'no' } })
    expect(spec.HostConfig.Memory).toBe(2560 * 1024 * 1024)
    expect(spec.Env).toEqual(expect.arrayContaining(['EULA=TRUE', 'TYPE=PAPER', 'VERSION=26.3', 'ONLINE_MODE=true']))
    // Jede Welt ist über ihren eigenen Port erreichbar; im Container bleibt es bei 25565.
    const port = lib.getWorld(world.user_id, world.id)!.port
    expect(port).toBeGreaterThanOrEqual(25600)
    expect(spec.HostConfig.PortBindings).toEqual({ '25565/tcp': [{ HostPort: String(port) }] })
    expect(spec.Env).toContain('SERVER_PORT=25565')

    await lib.requestStop(world)
    await ticksUntil(world, 'paused')
    expect(container(world)).toBeUndefined() // nach dem Stoppen wird der Container entfernt
  })

  it('stellt vor dem Start sicher, dass Paper direkte Verbindungen annimmt', async () => {
    const world = newWorld()
    const configDir = path.join(process.env.DATA_DIR!, 'worlds', world.id, 'config')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'paper-global.yml'), 'proxies:\n  bungee-cord:\n    online-mode: true\n  proxy-protocol: true\n  velocity:\n    enabled: false\n')
    await lib.requestStart(world)
    expect(fs.readFileSync(path.join(configDir, 'paper-global.yml'), 'utf8')).toBe(
      'proxies:\n  bungee-cord:\n    online-mode: true\n  proxy-protocol: false\n  velocity:\n    enabled: false\n',
    )
    await ticksUntil(world, 'online')
    await lib.requestStop(world)
    await ticksUntil(world, 'paused')
  })

  it('bricht den Start ab, wenn währenddessen pausiert wird — statt hängen zu bleiben', async () => {
    mock.state.createDelayMs = 400 // so lange braucht „Container anlegen“
    const world = newWorld()
    await lib.requestStart(world)
    await sleep(100)
    await lib.requestStop(world) // kommt mitten im Anlegen
    expect(status(world)).toBe('stopping')

    await ticksUntil(world, 'paused')
    expect(container(world)?.running ?? false).toBe(false)
    expect(container(world)).toBeUndefined()

    // Danach lässt sich die Welt ganz normal wieder starten.
    mock.state.createDelayMs = 0
    await lib.requestStart(world)
    await ticksUntil(world, 'online')
    await lib.requestStop(world)
    await ticksUntil(world, 'paused')
  })

  it('stößt einen verlorenen Stopp von selbst erneut an', async () => {
    const world = newWorld()
    await lib.requestStart(world)
    await ticksUntil(world, 'online')

    mock.state.failStops = true // Docker lehnt den Stopp ab
    await lib.requestStop(world)
    for (let i = 0; i < 5; i++) {
      await lib.tick()
      await sleep(40)
    }
    expect(status(world)).toBe('stopping')
    expect(container(world)!.running).toBe(true)

    mock.state.failStops = false // beim nächsten Versuch klappt es
    await ticksUntil(world, 'paused')
    expect(container(world)).toBeUndefined()
  })

  it('heilt eine Welt, die nach einem Neustart der Website noch auf „pausiert …“ steht', async () => {
    const world = newWorld()
    await lib.requestStart(world)
    await ticksUntil(world, 'online')
    // Wie nach einem Neustart: in der Datenbank steht „stopping“, der Treiber weiß von nichts mehr.
    database.db().prepare(`UPDATE worlds SET status = 'stopping', status_since = ? WHERE id = ?`).run(Date.now(), world.id)
    ;(globalThis as { __amDocker?: Map<string, unknown> }).__amDocker?.clear()

    await ticksUntil(world, 'paused')
    expect(container(world)).toBeUndefined()
  })

  it('entfernt beim Löschen einer laufenden Welt zuerst den Container', async () => {
    const world = newWorld()
    await lib.requestStart(world)
    await ticksUntil(world, 'online')
    const worldPath = path.join(process.env.DATA_DIR!, 'worlds', world.id)
    expect(fs.existsSync(worldPath)).toBe(true)

    mock.state.calls.length = 0
    await lib.deleteWorld(lib.getWorld(world.user_id, world.id)!)
    expect(mock.state.calls).toContain(`DELETE /containers/aboutmee-${world.id}`)
    expect(container(world)).toBeUndefined()
    expect(fs.existsSync(worldPath)).toBe(false)
    expect(lib.getWorld(world.user_id, world.id)).toBeUndefined()
  })

  it('lässt nie zwei Welten eines Kontos gleichzeitig starten, auch nicht bei gleichzeitigen Klicks', async () => {
    const id = 'usr_gleichzeitig0001'
    database.db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, 'g@example.com', 'x', Date.now())
    const first = lib.createWorld(id, INPUT)
    const second = lib.createWorld(id, INPUT)

    const results = await Promise.allSettled([lib.requestStart(first), lib.requestStart(second)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect([status(first), status(second)].sort()).toEqual(['paused', 'starting'])

    const started = status(first) === 'starting' ? first : second
    await ticksUntil(started, 'online')
    await lib.requestStop(started)
    await ticksUntil(started, 'paused')
  })

  it('zählt gemeldete Spieler nur gültig, einmal und höchstens bis zur Platzzahl', async () => {
    const { parsePlayerList } = await import('@/lib/runtime/docker')
    expect(parsePlayerList('There are 0 of a max of 20 players online: ')).toEqual([])
    expect(parsePlayerList('There are 2 of a max of 20 players online: Steve, Alex')).toEqual(['Steve', 'Alex'])
    expect(parsePlayerList('There are 3 of a max of 20 players online: Steve, steve, STEVE')).toEqual(['Steve'])
    expect(parsePlayerList('There are 2 of a max of 20 players online: [Admin] Notch, .BedrockSpieler')).toEqual(['Notch', '.BedrockSpieler'])
    expect(parsePlayerList('players online: <script>, ../../etc, x, viel-zu-langer-name-fuer-minecraft')).toEqual([])
    const many = Array.from({ length: 500 }, (_, i) => `Spieler${i}`).join(', ')
    expect(parsePlayerList(`There are 500 of a max of 20 players online: ${many}`)).toHaveLength(20)
    expect(parsePlayerList('etwas ganz anderes')).toEqual([])
  })
})
