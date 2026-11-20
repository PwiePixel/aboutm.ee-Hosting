export type WorldStatus = 'paused' | 'queued' | 'starting' | 'online' | 'stopping'

export type World = {
  id: string
  user_id: string
  name: string
  host_label: string
  version: string
  paper_build: number
  gamemode: string
  difficulty: string
  seed: string
  whitelist_enabled: number
  auto_backup: string
  status: WorldStatus
  status_since: number
  queued_at: number | null
  started_at: number | null
  last_active_at: number | null
  restart_pending: number
  pause_reason: string | null
  created_at: number
  /** Gemessene Spielzeit: Summe über alle Spieler, in Millisekunden. */
  play_ms: number
  starts: number
  /** Port auf dem Server, unter dem die Welt von außen erreichbar ist. */
  port: number | null
  /** Kennung des SRV-Eintrags bei Cloudflare — `null`, solange er (noch) nicht angelegt ist. */
  dns_record_id: string | null
  /** Paket der Welt — `null` heißt jeweils „wie im Standardpaket“ (siehe lib/plan.ts). */
  ram_mib: number | null
  disk_gib: number | null
  cpus: number | null
  max_players: number | null
  backup_gib: number | null
  auto_pause_minutes: number | null
}

/** Was der Treiber über den tatsächlichen Prozess weiß. */
export type RuntimeState = 'stopped' | 'starting' | 'online' | 'stopping'

export type RuntimeStats = { cpuPercent: number; ramMiB: number }

/**
 * Ein Treiber führt Welten tatsächlich aus. Die Website kennt nur diese Schnittstelle —
 * ob dahinter eine Vorschau oder echte Container stehen, entscheidet RUNTIME_DRIVER.
 */
export interface RuntimeDriver {
  readonly name: string
  /** `true`, wenn kein echter Minecraft-Server läuft. */
  readonly preview: boolean
  start(world: World): Promise<void>
  stop(world: World): Promise<void>
  /** Beendet den Server sofort und räumt alles weg, was der Treiber für die Welt angelegt hat. */
  destroy(world: World): Promise<void>
  state(world: World): Promise<RuntimeState>
  /** 0 = Server wird gestartet, 1 = Paper wird vorbereitet, 2 = Welt wird geladen. */
  startupStep(world: World): Promise<number>
  players(world: World): Promise<string[]>
  stats(world: World): Promise<RuntimeStats | null>
  logs(world: World): Promise<string[]>
  command(world: World, command: string): Promise<void>
}
