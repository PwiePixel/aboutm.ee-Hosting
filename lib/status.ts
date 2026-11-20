import { runtime } from './runtime'
import type { World, WorldStatus } from './runtime/types'
import { queuePosition, slotsFree } from './worlds'

/** Was die Welt-Seite alle paar Sekunden abfragt. */
export type LiveStatus = {
  status: WorldStatus
  statusSince: number
  queuePosition: number
  startupStep: number
  players: string[]
  cpuPercent: number | null
  ramMiB: number | null
  slotsFree: number
  pauseReason: string | null
  preview: boolean
}

export async function buildStatus(world: World): Promise<LiveStatus> {
  const driver = runtime()
  const running = world.status === 'starting' || world.status === 'online'
  const [stats, players, startupStep] = await Promise.all([
    running ? driver.stats(world) : null,
    world.status === 'online' ? driver.players(world) : [],
    world.status === 'starting' ? driver.startupStep(world) : 0,
  ])
  return {
    status: world.status,
    statusSince: world.status_since,
    queuePosition: queuePosition(world),
    startupStep,
    players,
    cpuPercent: stats?.cpuPercent ?? null,
    ramMiB: stats?.ramMiB ?? null,
    slotsFree: slotsFree(),
    pauseReason: world.pause_reason,
    preview: driver.preview,
  }
}
