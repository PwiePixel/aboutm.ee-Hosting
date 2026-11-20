import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { db } from '../db'
import { findVersion } from '../versions'
import { cleanOutput, demux, docker, exec, expectOk, json } from './docker-api'
import type { RuntimeDriver, RuntimeState, RuntimeStats, World } from './types'

/**
 * Docker-Treiber: jede laufende Welt ist ein eigener Container mit Paper darin.
 * Der Weltordner liegt auf dem Host und wird nach /data eingehängt; pausieren heißt
 * Container sauber stoppen und entfernen — die Dateien bleiben.
 */

type Memory = {
  /** Läuft, solange Image geladen und Container angelegt wird. */
  launching: boolean
  stopping: boolean
  online: boolean
  lastError: string | null
  logs: { at: number; lines: string[] } | null
  players: { at: number; names: string[] } | null
  cpu: { total: number; system: number } | null
}

type Globals = { __amDocker?: Map<string, Memory> }
const globals = globalThis as unknown as Globals

function memoryOf(worldId: string): Memory {
  globals.__amDocker ??= new Map()
  let memory = globals.__amDocker.get(worldId)
  if (!memory) {
    memory = { launching: false, stopping: false, online: false, lastError: null, logs: null, players: null, cpu: null }
    globals.__amDocker.set(worldId, memory)
  }
  return memory
}

function forget(worldId: string): void {
  globals.__amDocker?.delete(worldId)
}

export function containerName(world: Pick<World, 'id'>): string {
  return `aboutmee-${world.id}`
}

const LOG_TAIL = 400
const STOP_SECONDS = 120
// Die Spielerabfrage läuft über RCON und würde das Log sonst alle paar Sekunden füllen.
const RCON_NOISE = /Thread RCON Client .* (started|shutting down)/
const READY = /\bDone \(\d[\d.,]*s\)!/

function imageFor(world: World): string {
  const java = findVersion(world.version)?.java ?? 25
  return java >= 25 ? config.docker.imageJava25 : config.docker.imageJava21
}

function whitelistNames(worldId: string): string[] {
  const rows = db().prepare('SELECT player FROM whitelist WHERE world_id = ?').all(worldId) as Array<{ player: string }>
  return rows.map((row) => row.player)
}

/** Der Server läuft im Container als eigener Benutzer — ihm müssen die Dateien gehören. */
function chownTree(target: string, uid: number, gid: number): void {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false })
  if (!stat || stat.isSymbolicLink()) return
  if (stat.uid !== uid || stat.gid !== gid) fs.chownSync(target, uid, gid)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) chownTree(path.join(target, entry), uid, gid)
  }
}

async function ensureNetwork(): Promise<void> {
  const existing = await docker('GET', `/networks/${config.docker.network}`)
  if (existing.status === 200) return
  expectOk(
    await docker('POST', '/networks/create', { body: { Name: config.docker.network, Driver: 'bridge' } }),
    'Netzwerk anlegen',
    [409],
  )
}

async function pullImage(image: string): Promise<void> {
  const separator = image.lastIndexOf(':')
  const hasTag = separator > image.lastIndexOf('/')
  const name = hasTag ? image.slice(0, separator) : image
  const tag = hasTag ? image.slice(separator + 1) : 'latest'
  const response = await docker(
    'POST',
    `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
    { timeoutMs: 15 * 60_000 },
  )
  expectOk(response, `Image ${image} laden`)
  // Fehler beim Laden stehen im Datenstrom, nicht im Statuscode.
  const failure = response.body
    .toString('utf8')
    .split('\n')
    .find((line) => line.includes('"error"'))
  if (failure) throw new Error(`Image ${image} laden: ${failure}`)
}

async function removeContainer(name: string): Promise<void> {
  expectOk(await docker('DELETE', `/containers/${name}?force=true&v=true`), 'Container entfernen', [404, 409])
}

function containerSpec(world: World): Record<string, unknown> {
  const address = `${world.host_label}.${config.serverDomain}`
  const whitelist = whitelistNames(world.id)
  // Der Container darf etwas mehr als die Java-Halde belegen (Metaspace, Threads, Netty).
  const heapMiB = Math.max(1024, config.ramMiB - 512)
  const env: Record<string, string> = {
    EULA: 'TRUE',
    TYPE: 'PAPER',
    VERSION: world.version,
    PAPER_BUILD: String(world.paper_build),
    // Klein anfangen und nach Bedarf wachsen: eine leere Welt belegt so nicht sofort den vollen Speicher.
    INIT_MEMORY: '512M',
    MAX_MEMORY: `${heapMiB}M`,
    JVM_XX_OPTS: [
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+DisableExplicitGC',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:+PerfDisableSharedMem',
    ].join(' '),
    TZ: 'Europe/Berlin',
    MOTD: `${world.name.replace(/[\\\n\r§]/g, ' ')} · ${config.brand}`,
    MAX_PLAYERS: String(config.maxPlayers),
    MODE: world.gamemode,
    DIFFICULTY: world.difficulty,
    SEED: world.seed,
    ENABLE_WHITELIST: world.whitelist_enabled ? 'true' : 'false',
    ENFORCE_WHITELIST: world.whitelist_enabled ? 'true' : 'false',
    WHITELIST: whitelist.join(','),
    EXISTING_WHITELIST_FILE: 'SYNCHRONIZE',
    ONLINE_MODE: 'true',
    SERVER_PORT: '25565',
    ENABLE_RCON: 'true',
    CREATE_CONSOLE_IN_PIPE: 'true',
    ENABLE_AUTOPAUSE: 'false',
    STOP_DURATION: String(STOP_SECONDS - 10),
  }
  const memoryBytes = config.ramMiB * 1024 * 1024

  return {
    Image: imageFor(world),
    User: `${config.docker.uid}:${config.docker.gid}`,
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    Labels: {
      'aboutmee.world': world.id,
      'mc-router.host': address,
      'mc-router.port': '25565',
      'mc-router.network': config.docker.network,
    },
    StopTimeout: STOP_SECONDS,
    HostConfig: {
      Binds: [`${path.join(config.docker.hostDataDir, 'worlds', world.id)}:/data`],
      NetworkMode: config.docker.network,
      RestartPolicy: { Name: 'no' },
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(config.docker.cpus * 1e9),
      PidsLimit: 1024,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      LogConfig: { Type: 'json-file', Config: { 'max-size': '5m', 'max-file': '2' } },
    },
  }
}

async function launch(world: World): Promise<void> {
  const name = containerName(world)
  const dir = path.join(config.dataDir, 'worlds', world.id)
  fs.mkdirSync(dir, { recursive: true })
  if (process.getuid?.() === 0) chownTree(dir, config.docker.uid, config.docker.gid)

  await ensureNetwork()
  await removeContainer(name)

  const spec = containerSpec(world)
  let created = await docker('POST', `/containers/create?name=${name}`, { body: spec })
  if (created.status === 404) {
    await pullImage(spec.Image as string)
    created = await docker('POST', `/containers/create?name=${name}`, { body: spec })
  }
  expectOk(created, 'Container anlegen')
  expectOk(await docker('POST', `/containers/${name}/start`), 'Container starten', [304])
}

type Inspect = { State: { Running: boolean; Health?: { Status: string } } }

async function fetchLogs(world: World, memory: Memory): Promise<string[]> {
  const now = Date.now()
  if (memory.logs && now - memory.logs.at < 900) return memory.logs.lines
  const response = await docker('GET', `/containers/${containerName(world)}/logs?stdout=1&stderr=1&tail=${LOG_TAIL}`)
  if (response.status !== 200) return memory.logs?.lines ?? []
  const lines = cleanOutput(demux(response.body))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !RCON_NOISE.test(line))
  memory.logs = { at: now, lines }
  return lines
}

export const dockerDriver: RuntimeDriver = {
  name: 'docker',
  preview: false,

  async start(world: World): Promise<void> {
    const memory = memoryOf(world.id)
    if (memory.launching) return
    Object.assign(memory, { launching: true, stopping: false, online: false, lastError: null, logs: null, players: null, cpu: null })
    // Image laden kann beim ersten Mal Minuten dauern — deshalb nicht darauf warten.
    launch(world)
      .catch((error: unknown) => {
        memory.lastError = error instanceof Error ? error.message : String(error)
        console.error(`[aboutm.ee] Start von ${world.id} fehlgeschlagen:`, memory.lastError)
      })
      .finally(() => {
        memory.launching = false
      })
  },

  async stop(world: World): Promise<void> {
    const memory = memoryOf(world.id)
    memory.stopping = true
    docker('POST', `/containers/${containerName(world)}/stop?t=${STOP_SECONDS}`, {
      timeoutMs: (STOP_SECONDS + 30) * 1000,
    }).catch((error: unknown) => console.error(`[aboutm.ee] Stoppen von ${world.id}:`, error))
  },

  async state(world: World): Promise<RuntimeState> {
    const memory = memoryOf(world.id)
    if (memory.launching) return 'starting'

    const name = containerName(world)
    const response = await docker('GET', `/containers/${name}/json`)
    if (response.status === 404) {
      forget(world.id)
      return 'stopped'
    }
    expectOk(response, 'Container abfragen')
    const inspect = json<Inspect>(response)
    if (!inspect.State.Running) {
      await removeContainer(name)
      forget(world.id)
      return 'stopped'
    }
    if (memory.stopping) return 'stopping'
    if (memory.online) return 'online'

    if (inspect.State.Health?.Status === 'healthy' || (await fetchLogs(world, memory)).some((line) => READY.test(line))) {
      memory.online = true
      return 'online'
    }
    return 'starting'
  },

  async startupStep(world: World): Promise<number> {
    const memory = memoryOf(world.id)
    if (memory.launching) return 0
    const lines = await fetchLogs(world, memory)
    if (lines.some((line) => line.includes('Preparing level') || line.includes('Preparing start region'))) return 2
    if (lines.some((line) => line.includes('Starting minecraft server') || line.includes('Loading libraries'))) return 1
    return 0
  },

  async players(world: World): Promise<string[]> {
    const memory = memoryOf(world.id)
    const now = Date.now()
    if (memory.players && now - memory.players.at < 10_000) return memory.players.names
    try {
      const { output } = await exec(containerName(world), ['rcon-cli', 'list'])
      const match = /players online:(.*)$/m.exec(output)
      const names = (match?.[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => /^[A-Za-z0-9_.*-]{1,32}$/.test(name))
      memory.players = { at: now, names }
      return names
    } catch {
      return memory.players?.names ?? []
    }
  },

  async stats(world: World): Promise<RuntimeStats | null> {
    const memory = memoryOf(world.id)
    if (memory.launching) return null
    const response = await docker('GET', `/containers/${containerName(world)}/stats?stream=false&one-shot=true`)
    if (response.status !== 200) return null
    const stats = json<{
      cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number }
      memory_stats?: { usage?: number; stats?: { inactive_file?: number; total_inactive_file?: number } }
    }>(response)

    const total = stats.cpu_stats?.cpu_usage?.total_usage ?? 0
    const system = stats.cpu_stats?.system_cpu_usage ?? 0
    const previous = memory.cpu
    memory.cpu = { total, system }
    let cpuPercent = 0
    if (previous && system > previous.system && total >= previous.total) {
      const cores = stats.cpu_stats?.online_cpus ?? 1
      // Anteil an der erlaubten Obergrenze, nicht an der ganzen Maschine.
      const used = ((total - previous.total) / (system - previous.system)) * cores
      cpuPercent = Math.min(100, Math.round((used / config.docker.cpus) * 100))
    }
    const cache = stats.memory_stats?.stats?.inactive_file ?? stats.memory_stats?.stats?.total_inactive_file ?? 0
    const ramMiB = Math.max(0, Math.round(((stats.memory_stats?.usage ?? 0) - cache) / (1024 * 1024)))
    return { cpuPercent, ramMiB }
  },

  async logs(world: World): Promise<string[]> {
    const memory = memoryOf(world.id)
    if (memory.launching) return ['Der Server wird vorbereitet …']
    return fetchLogs(world, memory)
  },

  async command(world: World, command: string): Promise<void> {
    const memory = memoryOf(world.id)
    const { exitCode, output } = await exec(containerName(world), ['mc-send-to-console', command])
    if (exitCode !== 0) throw new Error(`Befehl nicht angenommen: ${output.trim() || `Code ${exitCode}`}`)
    memory.logs = null
    memory.players = null
  },
}
