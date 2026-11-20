import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { worldDir } from '../paths'
import type { RuntimeDriver, RuntimeState, RuntimeStats, World } from './types'

/**
 * Vorschau-Treiber: verhält sich nach außen wie ein Paper-Server (Startphasen, Log,
 * ein paar Befehle), startet aber keinen Prozess. Niemand kann sich verbinden.
 */

type Line = { at: number; text: string }
type Instance = {
  phase: 'starting' | 'online' | 'stopping'
  startedAt: number
  readyAt: number
  stoppedAt: number | null
  pending: Line[]
  logs: string[]
  logFile: string
  players: string[]
}

const START_MS = 8000
const STOP_MS = 2500
const MAX_LINES = 500

type Globals = { __amSim?: Map<string, Instance> }
const globals = globalThis as unknown as Globals

function instances(): Map<string, Instance> {
  globals.__amSim ??= new Map()
  return globals.__amSim
}

const clock = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/Berlin',
})

function stamp(at: number, text: string, level = 'INFO'): string {
  return `[${clock.format(new Date(at))} ${level}]: ${text}`
}

function emit(instance: Instance, line: string): void {
  instance.logs.push(line)
  if (instance.logs.length > MAX_LINES) instance.logs.splice(0, instance.logs.length - MAX_LINES)
  try {
    fs.appendFileSync(instance.logFile, `${line}\n`)
  } catch {
    // Das Log im Arbeitsspeicher reicht für die Konsole.
  }
}

/** Zeilen ausgeben, deren Zeitpunkt erreicht ist, und Phasen weiterschalten. */
function advance(id: string, now: number): Instance | undefined {
  const map = instances()
  const instance = map.get(id)
  if (!instance) return undefined

  while (instance.pending.length > 0 && instance.pending[0]!.at <= now) {
    const line = instance.pending.shift()!
    emit(instance, line.text)
  }
  if (instance.phase === 'starting' && now >= instance.readyAt) instance.phase = 'online'
  if (instance.phase === 'stopping' && instance.stoppedAt !== null && now >= instance.stoppedAt) {
    map.delete(id)
    return undefined
  }
  return instance
}

function queue(instance: Instance, from: number, lines: Array<[number, string, string?]>): void {
  for (const [offset, text, level] of lines) {
    instance.pending.push({ at: from + offset, text: stamp(from + offset, text, level) })
  }
  instance.pending.sort((a, b) => a.at - b.at)
}

function reply(instance: Instance, text: string): void {
  emit(instance, stamp(Date.now(), text))
}

function beginStop(instance: Instance, now: number): void {
  if (instance.phase === 'stopping') return
  instance.phase = 'stopping'
  instance.stoppedAt = now + STOP_MS
  instance.pending = []
  queue(instance, now, [
    [0, 'Stopping the server'],
    [300, 'Stopping server'],
    [700, 'Saving players'],
    [1100, 'Saving worlds'],
    [1900, "Saving chunks for level 'ServerLevel[world]'/minecraft:overworld"],
    [2300, 'All dimensions are saved'],
  ])
}

export const simulatedDriver: RuntimeDriver = {
  name: 'simulated',
  preview: true,

  async start(world: World): Promise<void> {
    const now = Date.now()
    const dir = worldDir(world.id)
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    const logFile = path.join(dir, 'logs', 'latest.log')
    fs.writeFileSync(logFile, '')

    const instance: Instance = {
      phase: 'starting',
      startedAt: now,
      readyAt: now + START_MS,
      stoppedAt: null,
      pending: [],
      logs: [],
      logFile,
      players: [],
    }
    const mode = world.gamemode.toUpperCase()
    queue(instance, now, [
      [0, `Vorschau-Modus: Hier läuft kein echter Minecraft-Server. Verbinden ist noch nicht möglich.`, 'HINWEIS'],
      [400, 'Loading libraries, please wait...'],
      [1500, `Starting minecraft server version ${world.version}`],
      [1600, 'Loading properties'],
      [1800, `This server is running Paper version ${world.version}-${world.paper_build} (MC: ${world.version})`],
      [2600, `Default game type: ${mode}`],
      [2700, 'Starting Minecraft server on *:25565'],
      [3600, 'Preparing level "world"'],
      [4600, 'Preparing start region for dimension minecraft:overworld'],
      [5600, 'Preparing spawn area: 38%'],
      [6600, 'Preparing spawn area: 84%'],
      [7600, 'Time elapsed: 3962 ms'],
      [START_MS, 'Done (6.412s)! For help, type "help"'],
    ])
    instances().set(world.id, instance)
  },

  async stop(world: World): Promise<void> {
    const instance = advance(world.id, Date.now())
    if (instance) beginStop(instance, Date.now())
  },

  async state(world: World): Promise<RuntimeState> {
    return advance(world.id, Date.now())?.phase ?? 'stopped'
  },

  async startupStep(world: World): Promise<number> {
    const now = Date.now()
    const instance = advance(world.id, now)
    if (!instance) return 0
    const elapsed = now - instance.startedAt
    if (elapsed < 1500) return 0
    if (elapsed < 3600) return 1
    return 2
  },

  async players(world: World): Promise<string[]> {
    const instance = advance(world.id, Date.now())
    return instance?.phase === 'online' ? [...instance.players] : []
  },

  async stats(world: World): Promise<RuntimeStats | null> {
    const now = Date.now()
    const instance = advance(world.id, now)
    if (!instance) return null
    const age = (now - instance.startedAt) / 1000
    const wobble = Math.sin(now / 4000) * 0.5 + 0.5
    const starting = instance.phase === 'starting'
    return {
      cpuPercent: Math.round(starting ? 55 + wobble * 30 : 3 + wobble * 6),
      ramMiB: Math.round(Math.min(config.ramMiB * 0.55, 420 + age * 18) + wobble * 40),
    }
  },

  async logs(world: World): Promise<string[]> {
    return [...(advance(world.id, Date.now())?.logs ?? [])]
  },

  async command(world: World, command: string): Promise<void> {
    const now = Date.now()
    const instance = advance(world.id, now)
    if (!instance || instance.phase !== 'online') return

    const [name = '', ...rest] = command.split(' ')
    const argument = rest.join(' ')
    switch (name.toLowerCase()) {
      case 'stop':
        beginStop(instance, now)
        break
      case 'list':
        reply(
          instance,
          `There are ${instance.players.length} of a max of ${config.maxPlayers} players online: ${instance.players.join(', ')}`,
        )
        break
      // Nur im Vorschau-Modus: so tun, als käme oder ginge ein Spieler — zum Ausprobieren von Statistik und Auto-Pause.
      case 'testjoin':
        if (/^[A-Za-z0-9_]{3,16}$/.test(argument) && !instance.players.includes(argument)) {
          instance.players.push(argument)
          reply(instance, `${argument} joined the game`)
        } else {
          reply(instance, 'Aufruf: testjoin <Minecraft-Name>')
        }
        break
      case 'testleave':
        if (instance.players.includes(argument)) {
          instance.players = instance.players.filter((name) => name !== argument)
          reply(instance, `${argument} left the game`)
        } else {
          reply(instance, 'Aufruf: testleave <Minecraft-Name>')
        }
        break
      case 'say':
        reply(instance, `[Server] ${argument}`)
        break
      case 'seed':
        reply(instance, `Seed: [${world.seed || 'zufällig'}]`)
        break
      case 'difficulty':
        reply(instance, argument ? `The difficulty has been set to ${argument}` : `The difficulty is ${world.difficulty}`)
        break
      case 'defaultgamemode':
        reply(instance, `The default game mode is now ${argument}`)
        break
      case 'whitelist':
        if (rest[0] === 'on') reply(instance, 'Whitelist is now turned on')
        else if (rest[0] === 'off') reply(instance, 'Whitelist is now turned off')
        else if (rest[0] === 'add' && rest[1]) reply(instance, `Added ${rest[1]} to the whitelist`)
        else if (rest[0] === 'remove' && rest[1]) reply(instance, `Removed ${rest[1]} from the whitelist`)
        else if (rest[0] === 'reload') reply(instance, 'Reloaded the whitelist')
        else reply(instance, 'Unknown or incomplete command, see below for error')
        break
      case 'save-all':
        reply(instance, 'Saving the game (this may take a moment!)')
        reply(instance, 'Saved the game')
        break
      case 'save-off':
        reply(instance, 'Automatic saving is now disabled')
        break
      case 'save-on':
        reply(instance, 'Automatic saving is now enabled')
        break
      case 'help':
        reply(instance, 'Vorschau-Modus kennt: list, say, seed, difficulty, defaultgamemode, whitelist, save-all, stop, testjoin, testleave')
        break
      default:
        reply(instance, `Unknown or incomplete command, see below for error`)
        reply(instance, `${command}<--[HERE]`)
    }
  },
}
