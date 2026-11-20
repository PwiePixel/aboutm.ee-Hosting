import fs from 'node:fs'
import { config } from './config'
import { db } from './db'
import { directorySize } from './files'
import { newBackupId } from './ids'
import { backupDir, worldDir } from './paths'
import type { World } from './runtime/types'

export class BackupError extends Error {}

export type Backup = {
  id: string
  world_id: string
  kind: 'manual' | 'auto'
  version: string
  size_bytes: number
  created_at: number
}

export function listBackups(worldId: string): Backup[] {
  return db().prepare('SELECT * FROM backups WHERE world_id = ? ORDER BY created_at DESC').all(worldId) as Backup[]
}

function getBackup(worldId: string, backupId: string): Backup | undefined {
  return db().prepare('SELECT * FROM backups WHERE id = ? AND world_id = ?').get(backupId, worldId) as
    | Backup
    | undefined
}

export function createBackup(world: World, kind: 'manual' | 'auto'): Backup {
  const source = worldDir(world.id)
  if (!fs.existsSync(source) || fs.readdirSync(source).length === 0) {
    throw new BackupError('Hier gibt es noch nichts zu sichern. Starte deine Welt einmal.')
  }
  if (kind === 'manual') {
    const count = listBackups(world.id).filter((backup) => backup.kind === 'manual').length
    if (count >= config.maxManualBackups) {
      throw new BackupError(
        `Du hast schon ${config.maxManualBackups} eigene Backups. Lösche eines, bevor du ein neues erstellst.`,
      )
    }
  }

  const id = newBackupId()
  const target = backupDir(world.id, id)
  fs.mkdirSync(target, { recursive: true })
  try {
    fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true })
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true })
    throw error
  }

  const backup: Backup = {
    id,
    world_id: world.id,
    kind,
    version: world.version,
    size_bytes: directorySize(target),
    created_at: Date.now(),
  }
  db()
    .prepare('INSERT INTO backups (id, world_id, kind, version, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(backup.id, backup.world_id, backup.kind, backup.version, backup.size_bytes, backup.created_at)

  if (kind === 'auto') {
    const automatic = listBackups(world.id).filter((entry) => entry.kind === 'auto')
    for (const old of automatic.slice(config.maxAutoBackups)) deleteBackup(world, old.id)
  }
  return backup
}

export function deleteBackup(world: World, backupId: string): void {
  const backup = getBackup(world.id, backupId)
  if (!backup) throw new BackupError('Dieses Backup gibt es nicht mehr.')
  db().prepare('DELETE FROM backups WHERE id = ?').run(backup.id)
  fs.rmSync(backupDir(world.id, backup.id), { recursive: true, force: true })
}

/** Ersetzt die aktuelle Welt komplett durch das Backup. */
export function restoreBackup(world: World, backupId: string): void {
  if (world.status !== 'paused') throw new BackupError('Pausiere deine Welt, bevor du ein Backup wiederherstellst.')
  const backup = getBackup(world.id, backupId)
  if (!backup) throw new BackupError('Dieses Backup gibt es nicht mehr.')
  const source = backupDir(world.id, backup.id)
  if (!fs.existsSync(source)) throw new BackupError('Die Dateien dieses Backups fehlen.')

  const target = worldDir(world.id)
  const staging = `${target}.wiederherstellen`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.cpSync(source, staging, { recursive: true, verbatimSymlinks: true })
  fs.rmSync(target, { recursive: true, force: true })
  fs.renameSync(staging, target)

  // Die Welt läuft danach mit der Version weiter, in der das Backup entstanden ist — nie mit einer älteren Software.
}

export function autoBackupAfterPause(world: World): void {
  const current = db().prepare('SELECT * FROM worlds WHERE id = ?').get(world.id) as World | undefined
  if (!current || current.auto_backup !== 'on_pause') return
  try {
    createBackup(current, 'auto')
  } catch (error) {
    if (!(error instanceof BackupError)) console.error(`[aboutm.ee] Auto-Backup ${world.id}:`, error)
  }
}
