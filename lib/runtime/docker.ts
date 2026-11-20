import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { db } from '../db'
import { heapMiB, hostCapacity, worldPlan } from '../plan'
import { findVersion } from '../versions'
import { cleanOutput, demux, docker, exec, expectOk, json } from './docker-api'
import { removeTree, withDir } from '../safe-fs'
import type { RuntimeDriver, RuntimeState, RuntimeStats, World } from './types'

/**
 * Docker-Treiber: jede laufende Welt ist ein eigener Container mit Paper darin.
 * Der Weltordner liegt auf dem Host und wird nach /data eingehängt; pausieren heißt
 * Container sauber stoppen und entfernen — die Dateien bleiben.
 */

type Memory = {
  /** Läuft, solange Image geladen und Container angelegt wird. */
  launching: boolean
  /** Während des Anlegens kam ein Stopp: Der Container wird dann gleich wieder entfernt statt gestartet. */
  cancelled: boolean
  /** Die Welt wurde währenddessen gelöscht: danach auch den Ordner wieder entfernen, den Docker angelegt hat. */
  destroyed: boolean
  stopping: boolean
  online: boolean
  lastError: string | null
  logs: { at: number; lines: string[] } | null
  players: { at: number; names: string[] } | null
  cpu: { total: number; system: number } | null
  /**
   * Womit der laufende Container gestartet wurde. Ein geändertes Paket gilt erst ab dem nächsten Start —
   * bis dahin rechnen Anzeige und Spielerliste mit diesen Werten.
   */
  limits: { cpus: number; ramMiB: number; maxPlayers: number } | null
}

type Globals = { __amDocker?: Map<string, Memory> }
const globals = globalThis as unknown as Globals

function memoryOf(worldId: string): Memory {
  globals.__amDocker ??= new Map()
  let memory = globals.__amDocker.get(worldId)
  if (!memory) {
    memory = {
      launching: false,
      cancelled: false,
      destroyed: false,
      stopping: false,
      online: false,
      lastError: null,
      logs: null,
      players: null,
      cpu: null,
      limits: null,
    }
    globals.__amDocker.set(worldId, memory)
  }
  return memory
}

function forget(worldId: string): void {
  globals.__amDocker?.delete(worldId)
}

/**
 * Liest die Namen aus der Antwort auf „list“, z. B. „There are 2 of a max of 20 players online: Steve, Alex“.
 * Die Ausgabe stammt vom Server des Nutzers und ist damit nicht vertrauenswürdig: nur gültige
 * Minecraft-Namen, jeder einmal, und nie mehr als es Spielerplätze gibt.
 */
export function parsePlayerList(output: string, maxPlayers: number = config.maxPlayers): string[] {
  const match = /players online:(.*)$/m.exec(output)
  const names = new Map<string, string>()
  for (const raw of (match?.[1] ?? '').split(',')) {
    // Plugins hängen gern Ränge davor („[Admin] Steve“) — der Name ist das letzte Wort.
    const name = raw.trim().split(/\s+/).pop() ?? ''
    // Bedrock-Spieler über Geyser/Floodgate tragen ein Präfix wie „.“ oder „*“.
    if (!/^[.*]?[A-Za-z0-9_]{2,16}$/.test(name)) continue
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
    if (names.size >= maxPlayers) break
  }
  return [...names.values()]
}

export function containerName(world: Pick<World, 'id'>): string {
  return `aboutmee-${world.id}`
}

const LOG_TAIL = 400
const STOP_SECONDS = 120
// Die Spielerabfrage läuft über RCON und würde das Log sonst alle paar Sekunden füllen.
const RCON_NOISE = /Thread RCON Client .* (started|shutting down)/
const PLAYERS_FRESH_MS = 10_000
const PLAYERS_STALE_MS = 30_000
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
function chownWorld(dir: string): void {
  if (process.getuid?.() !== 0) return
  // Über lib/safe-fs: ändert Links selbst statt ihr Ziel und verlässt den Weltordner nie.
  withDir(dir, [], (root) => root.chownTree({ uid: config.docker.uid, gid: config.docker.gid }))
}

async function ensureNetwork(): Promise<void> {
  const existing = await docker('GET', `/networks/${config.docker.network}`)
  if (existing.status === 200) return
  expectOk(
    await docker('POST', '/networks/create', {
      body: {
        Name: config.docker.network,
        Driver: 'bridge',
        // Welten sollen einander nicht erreichen können — nur das Internet und, über ihren Port, die Spieler.
        Options: { 'com.docker.network.bridge.enable_icc': 'false' },
      },
    }),
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
  const whitelist = whitelistNames(world.id)
  const plan = worldPlan(world)
  // Der Container darf etwas mehr als die Java-Halde belegen (Metaspace, Threads, Netty).
  const heap = heapMiB(plan.ramMiB)
  const env: Record<string, string> = {
    EULA: 'TRUE',
    TYPE: 'PAPER',
    VERSION: world.version,
    PAPER_BUILD: String(world.paper_build),
    // Klein anfangen und nach Bedarf wachsen: eine leere Welt belegt so nicht sofort den vollen Speicher.
    INIT_MEMORY: '512M',
    MAX_MEMORY: `${heap}M`,
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
    MAX_PLAYERS: String(plan.maxPlayers),
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
  const memoryBytes = plan.ramMiB * 1024 * 1024

  return {
    Image: imageFor(world),
    User: `${config.docker.uid}:${config.docker.gid}`,
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    Labels: { 'aboutmee.world': world.id },
    StopTimeout: STOP_SECONDS,
    ExposedPorts: { '25565/tcp': {} },
    HostConfig: {
      Binds: [`${path.join(config.docker.hostDataDir, 'worlds', world.id)}:/data`],
      // Im Container lauscht der Server immer auf 25565; nach außen hat jede Welt ihren eigenen Port.
      PortBindings: { '25565/tcp': [{ HostPort: String(world.port) }] },
      NetworkMode: config.docker.network,
      RestartPolicy: { Name: 'no' },
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      // Docker lehnt mehr Kerne ab, als der Server hat — deshalb höchstens so viele.
      NanoCpus: Math.round(Math.min(plan.cpus, hostCapacity().cpus) * 1e9),
      PidsLimit: 1024,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      LogConfig: { Type: 'json-file', Config: { 'max-size': '5m', 'max-file': '2' } },
    },
  }
}

async function launch(world: World): Promise<void> {
  if (world.port === null) throw new Error('Der Welt ist kein Port zugewiesen.')
  const name = containerName(world)
  const dir = path.join(config.dataDir, 'worlds', world.id)
  fs.mkdirSync(dir, { recursive: true })

  await ensureNetwork()
  // Erst einen etwaigen alten Container entfernen: Solange einer läuft, darf niemand am Besitz der Dateien drehen.
  await removeContainer(name)
  chownWorld(dir)

  const spec = containerSpec(world)
  let created = await docker('POST', `/containers/create?name=${name}`, { body: spec })
  if (created.status === 404) {
    await pullImage(spec.Image as string)
    created = await docker('POST', `/containers/create?name=${name}`, { body: spec })
  }
  expectOk(created, 'Container anlegen')
  expectOk(await docker('POST', `/containers/${name}/start`), 'Container starten', [304])
}

type Inspect = {
  State: { Running: boolean }
  HostConfig?: { NanoCpus?: number; Memory?: number }
  Config?: { Env?: string[] }
}

/** Liest aus der Beschreibung des Containers, mit welchen Grenzen er läuft. */
function limitsOf(inspect: Inspect, world: World): NonNullable<Memory['limits']> {
  const plan = worldPlan(world)
  const nano = inspect.HostConfig?.NanoCpus
  const bytes = inspect.HostConfig?.Memory
  const players = Number.parseInt(inspect.Config?.Env?.find((entry) => entry.startsWith('MAX_PLAYERS='))?.slice('MAX_PLAYERS='.length) ?? '', 10)
  return {
    cpus: nano && nano > 0 ? nano / 1e9 : Math.min(plan.cpus, hostCapacity().cpus),
    ramMiB: bytes && bytes > 0 ? Math.round(bytes / (1024 * 1024)) : plan.ramMiB,
    maxPlayers: Number.isInteger(players) && players > 0 ? players : plan.maxPlayers,
  }
}

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

/** Bereit ist der Server, sobald er „Done“ meldet — oder, falls diese Zeile schon aus dem Log gerutscht ist, sobald er auf Befehle antwortet. */
async function isReady(world: World, memory: Memory): Promise<boolean> {
  if ((await fetchLogs(world, memory)).some((line) => READY.test(line))) return true
  try {
    const { exitCode, output } = await exec(containerName(world), ['rcon-cli', 'list'], 4000)
    return exitCode === 0 && /players online/.test(output)
  } catch {
    return false
  }
}

function sendStop(world: World, memory: Memory): void {
  memory.stopping = true
  docker('POST', `/containers/${containerName(world)}/stop?t=${STOP_SECONDS}`, {
    timeoutMs: (STOP_SECONDS + 30) * 1000,
  })
    .then((response) => {
      // 204 gestoppt, 304 lief schon nicht mehr, 404 gibt es nicht mehr — alles andere ist ein Fehlschlag.
      if (![204, 304, 404].includes(response.status)) throw new Error(`HTTP ${response.status}`)
    })
    .catch((error: unknown) => {
      console.error(`[aboutm.ee] Stoppen von ${world.id}:`, error)
      // Nicht als „stoppt“ stehen lassen: Der Taktgeber sieht den Server dann wieder laufen und stößt den Stopp erneut an.
      memory.stopping = false
    })
}

export const dockerDriver: RuntimeDriver = {
  name: 'docker',
  preview: false,

  async start(world: World): Promise<void> {
    const memory = memoryOf(world.id)
    if (memory.launching) return
    Object.assign(memory, {
      launching: true,
      cancelled: false,
      destroyed: false,
      stopping: false,
      online: false,
      lastError: null,
      logs: null,
      players: null,
      cpu: null,
    })
    // Image laden kann beim ersten Mal Minuten dauern — deshalb nicht darauf warten.
    launch(world)
      .then(async () => {
        // Kam währenddessen ein Stopp, wird der frisch angelegte Container gleich wieder entfernt.
        if (memory.cancelled) await removeContainer(containerName(world))
        if (memory.destroyed) removeTree(path.join(config.dataDir, 'worlds', world.id))
      })
      .catch((error: unknown) => {
        memory.lastError = error instanceof Error ? error.message : String(error)
        console.error(`[aboutm.ee] Start von ${world.id} fehlgeschlagen:`, memory.lastError)
      })
      .finally(() => {
        memory.launching = false
        memory.cancelled = false
        if (memory.destroyed) forget(world.id)
      })
  },

  async stop(world: World): Promise<void> {
    const memory = memoryOf(world.id)
    if (memory.launching) {
      memory.cancelled = true
      return
    }
    if (!memory.stopping) sendStop(world, memory)
  },

  async destroy(world: World): Promise<void> {
    const memory = memoryOf(world.id)
    memory.cancelled = true
    memory.destroyed = true
    // Sofort beenden und entfernen; ein gerade laufendes Anlegen räumt wegen `cancelled` selbst hinter sich auf.
    await removeContainer(containerName(world))
    if (!memory.launching) forget(world.id)
  },

  async state(world: World): Promise<RuntimeState> {
    const memory = memoryOf(world.id)
    if (memory.launching) return memory.cancelled ? 'stopping' : 'starting'

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
    memory.limits = limitsOf(inspect, world)
    if (memory.stopping) return 'stopping'
    if (memory.online) return 'online'

    if (await isReady(world, memory)) {
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
    if (memory.players && now - memory.players.at < PLAYERS_FRESH_MS) return memory.players.names
    try {
      const { output, exitCode } = await exec(containerName(world), ['rcon-cli', 'list'], 4000)
      if (exitCode !== 0) throw new Error('rcon-cli antwortet nicht')
      const names = parsePlayerList(output, memory.limits?.maxPlayers ?? worldPlan(world).maxPlayers)
      memory.players = { at: now, names }
      return names
    } catch {
      // Antwortet der Server nicht, gilt die letzte Liste nur noch kurz weiter. Danach zählt niemand mehr als
      // online — sonst liefe die Spielzeit weiter und die Welt würde nie von selbst pausieren.
      if (memory.players && now - memory.players.at < PLAYERS_STALE_MS) return memory.players.names
      return []
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
      const allowed = memory.limits?.cpus ?? Math.min(worldPlan(world).cpus, hostCapacity().cpus)
      cpuPercent = Math.min(100, Math.round((used / allowed) * 100))
    }
    const cache = stats.memory_stats?.stats?.inactive_file ?? stats.memory_stats?.stats?.total_inactive_file ?? 0
    const ramMiB = Math.max(0, Math.round(((stats.memory_stats?.usage ?? 0) - cache) / (1024 * 1024)))
    return { cpuPercent, ramMiB, ramLimitMiB: memory.limits?.ramMiB ?? worldPlan(world).ramMiB }
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
