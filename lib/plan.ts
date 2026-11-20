import os from 'node:os'
import { config } from './config'
import { db } from './db'
import type { World } from './runtime/types'
import { limits } from './settings'

/**
 * Das Paket einer Welt: wie viel Arbeitsspeicher, Speicherplatz, CPU usw. ihr zusteht.
 *
 * Ohne Eintrag gilt für jede Welt das kostenlose Standardpaket (lib/config.ts). Im Admin-Bereich
 * lässt sich jede Welt einzeln hochstufen; gespeichert wird dann nur, was vom Standard abweicht —
 * alles andere folgt weiter dem Standard.
 */
export type Plan = {
  ramMiB: number
  diskGiB: number
  cpus: number
  maxPlayers: number
  backupGiB: number
  /** Minuten ohne Spieler bis zur Pause; 0 = die Welt wird nie von selbst pausiert. */
  autoPauseMinutes: number
  /** `true`, sobald irgendetwas vom Standardpaket abweicht. */
  upgraded: boolean
  /** Wie das Paket heißt: „Upgrade“ nur, wenn nichts schlechter ist als im Standardpaket. */
  label: 'Kostenlos' | 'Upgrade' | 'Angepasst'
}

export type PlanValues = Omit<Plan, 'upgraded' | 'label'>
type PlanColumns = Pick<World, 'ram_mib' | 'disk_gib' | 'cpus' | 'max_players' | 'backup_gib' | 'auto_pause_minutes'>

export const PLAN_RANGES: Record<keyof PlanValues, { min: number; max: number }> = {
  ramMiB: { min: 2048, max: 64 * 1024 },
  diskGiB: { min: 1, max: 500 },
  cpus: { min: 0.5, max: 64 },
  maxPlayers: { min: 1, max: 500 },
  backupGiB: { min: 1, max: 1000 },
  autoPauseMinutes: { min: 0, max: 24 * 60 },
}

export function defaultPlan(): PlanValues {
  return {
    ramMiB: config.ramMiB,
    diskGiB: config.diskGiB,
    cpus: config.docker.cpus,
    maxPlayers: config.maxPlayers,
    backupGiB: config.backupGiB,
    autoPauseMinutes: limits().autoPauseMinutes,
  }
}

export function worldPlan(world: PlanColumns): Plan {
  const base = defaultPlan()
  const plan: PlanValues = {
    ramMiB: world.ram_mib ?? base.ramMiB,
    diskGiB: world.disk_gib ?? base.diskGiB,
    cpus: world.cpus ?? base.cpus,
    maxPlayers: world.max_players ?? base.maxPlayers,
    backupGiB: world.backup_gib ?? base.backupGiB,
    autoPauseMinutes: world.auto_pause_minutes ?? base.autoPauseMinutes,
  }
  const keys = Object.keys(plan) as Array<keyof PlanValues>
  const upgraded = keys.some((key) => plan[key] !== base[key])
  // Bei der Auto-Pause ist „nie“ (0) das Beste, sonst zählt die längere Frist.
  const rank = (key: keyof PlanValues, value: number) => (key === 'autoPauseMinutes' && value === 0 ? Number.POSITIVE_INFINITY : value)
  const worse = keys.some((key) => rank(key, plan[key]) < rank(key, base[key]))
  return { ...plan, upgraded, label: !upgraded ? 'Kostenlos' : worse ? 'Angepasst' : 'Upgrade' }
}

/** Das Paket einer Welt anhand ihrer Kennung — für Stellen, die nur die Kennung haben. */
export function planOf(worldId: string): Plan {
  const row = db()
    .prepare('SELECT ram_mib, disk_gib, cpus, max_players, backup_gib, auto_pause_minutes FROM worlds WHERE id = ?')
    .get(worldId) as PlanColumns | undefined
  return worldPlan(row ?? { ram_mib: null, disk_gib: null, cpus: null, max_players: null, backup_gib: null, auto_pause_minutes: null })
}

export function planProblem(values: PlanValues): string | null {
  const labels: Record<keyof PlanValues, string> = {
    ramMiB: 'Arbeitsspeicher',
    diskGiB: 'Speicherplatz',
    cpus: 'CPU-Kerne',
    maxPlayers: 'Spielerplätze',
    backupGiB: 'Backup-Speicher',
    autoPauseMinutes: 'Auto-Pause',
  }
  // Was dem Standard entspricht, ist immer in Ordnung — es wird ohnehin nicht eigens gespeichert. So lässt
  // sich ein Paket auch dann ändern, wenn der Standard selbst außerhalb dieser Regeln liegt (etwa mehr
  // CPU-Kerne als der Server hat; beim Start wird das ohnehin auf das Vorhandene begrenzt).
  const base = defaultPlan()
  const changed = (key: keyof PlanValues) => values[key] !== base[key]
  for (const key of Object.keys(labels) as Array<keyof PlanValues>) {
    if (!changed(key)) continue
    const value = values[key]
    const range = PLAN_RANGES[key]
    if (!Number.isFinite(value) || value < range.min || value > range.max) return `${labels[key]}: Der Wert liegt außerhalb des erlaubten Bereichs.`
  }
  if (changed('ramMiB') && !Number.isInteger(values.ramMiB)) return 'Arbeitsspeicher: Bitte in Schritten von 0,5 GiB angeben.'
  for (const key of ['diskGiB', 'maxPlayers', 'backupGiB', 'autoPauseMinutes'] as const) {
    if (changed(key) && !Number.isInteger(values[key])) return `${labels[key]}: Bitte eine ganze Zahl angeben.`
  }
  if (changed('autoPauseMinutes') && values.autoPauseMinutes !== 0 && values.autoPauseMinutes < 5) {
    return 'Auto-Pause: 0 (nie) oder mindestens 5 Minuten.'
  }
  const host = hostCapacity()
  if (changed('cpus') && values.cpus > host.cpus) return `CPU-Kerne: Dieser Server hat nur ${host.cpus}.`
  if (changed('ramMiB') && values.ramMiB > host.ramMiB) return `Arbeitsspeicher: Dieser Server hat nur ${Math.floor(host.ramMiB / 1024)} GiB.`
  return null
}

/** Speichert das Paket einer Welt. Werte, die dem Standard entsprechen, folgen weiter dem Standard. */
export function setWorldPlan(worldId: string, values: PlanValues): void {
  const problem = planProblem(values)
  if (problem) throw new RangeError(problem)
  const base = defaultPlan()
  const column = <K extends keyof PlanValues>(key: K): number | null => (values[key] === base[key] ? null : values[key])
  db()
    .prepare(
      'UPDATE worlds SET ram_mib = ?, disk_gib = ?, cpus = ?, max_players = ?, backup_gib = ?, auto_pause_minutes = ? WHERE id = ?',
    )
    .run(column('ramMiB'), column('diskGiB'), column('cpus'), column('maxPlayers'), column('backupGiB'), column('autoPauseMinutes'), worldId)
}

/** Zurück auf das kostenlose Standardpaket. */
export function resetWorldPlan(worldId: string): void {
  db()
    .prepare(
      'UPDATE worlds SET ram_mib = NULL, disk_gib = NULL, cpus = NULL, max_players = NULL, backup_gib = NULL, auto_pause_minutes = NULL WHERE id = ?',
    )
    .run(worldId)
}

/** Was der Server insgesamt hergibt — als Orientierung beim Vergeben von Paketen. */
export function hostCapacity(): { ramMiB: number; cpus: number } {
  return { ramMiB: Math.floor(os.totalmem() / (1024 * 1024)), cpus: os.availableParallelism() }
}

/** So viel Java-Halde bekommt der Server; der Rest des Containers bleibt für Metaspace, Threads und Netty. */
export function heapMiB(ramMiB: number): number {
  return Math.max(1024, ramMiB - Math.max(512, Math.round(ramMiB * 0.15)))
}
