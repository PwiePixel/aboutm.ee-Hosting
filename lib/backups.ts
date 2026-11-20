import fs from 'node:fs'
import { config } from './config'
import { db } from './db'
import { directorySize } from './files'
import { newBackupId } from './ids'
import { withWorldLock } from './locks'
import { backupDir, backupsDir, worldDir } from './paths'
import { planOf } from './plan'
import type { World } from './runtime/types'
import { removeTree, withDir, withDirAsync } from './safe-fs'

export class BackupError extends Error {}

export type Backup = {
  id: string
  world_id: string
  kind: 'manual' | 'auto'
  version: string
  size_bytes: number
  created_at: number
}

const BUSY = 'Für diese Welt läuft gerade schon ein Backup oder eine Wiederherstellung. Versuch es gleich noch einmal.'

export function listBackups(worldId: string): Backup[] {
  return db().prepare('SELECT * FROM backups WHERE world_id = ? ORDER BY created_at DESC').all(worldId) as Backup[]
}

function getBackup(worldId: string, backupId: string): Backup | undefined {
  return db().prepare('SELECT * FROM backups WHERE id = ? AND world_id = ?').get(backupId, worldId) as
    | Backup
    | undefined
}

function totalBackupBytes(worldId: string): number {
  const row = db().prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM backups WHERE world_id = ?').get(worldId) as {
    n: number
  }
  return row.n
}

/**
 * Kopiert den Weltordner in ein neues Backup. Die Inhalte fließen asynchron (große Welten halten die
 * Website nicht an), und kopiert wird über lib/safe-fs — symbolische Links im Weltordner werden nie
 * verfolgt, sondern ausgelassen.
 */
export async function createBackup(world: World, kind: 'manual' | 'auto'): Promise<Backup> {
  const source = worldDir(world.id)
  const empty = withDir(source, [], (dir) => dir.entries().length === 0, () => true)
  if (empty) throw new BackupError('Hier gibt es noch nichts zu sichern. Starte deine Welt einmal.')

  if (kind === 'manual') {
    const count = listBackups(world.id).filter((backup) => backup.kind === 'manual').length
    if (count >= config.maxManualBackups) {
      throw new BackupError(
        `Du hast schon ${config.maxManualBackups} eigene Backups. Lösche eines, bevor du ein neues erstellst.`,
      )
    }
  }

  const worldBytes = directorySize(source)
  // Alle Backups einer Welt zusammen dürfen höchstens so viel belegen, wie ihr Paket vorsieht.
  const backupGiB = planOf(world.id).backupGiB
  const quotaBytes = backupGiB * 1024 ** 3
  if (kind === 'auto') {
    // Älteste automatische Backups weichen, bis das neue Platz hat.
    const automatic = listBackups(world.id)
      .filter((entry) => entry.kind === 'auto')
      .reverse()
    while (automatic.length > 0 && totalBackupBytes(world.id) + worldBytes > quotaBytes) {
      removeBackup(world.id, automatic.shift()!.id)
    }
  }
  if (totalBackupBytes(world.id) + worldBytes > quotaBytes) {
    throw new BackupError(
      `Für die Backups dieser Welt stehen ${backupGiB} GiB bereit — das reicht für ein weiteres nicht mehr. Lösche ein älteres Backup.`,
    )
  }

  const result = await withWorldLock(world.id, async () => {
    const id = newBackupId()
    const target = backupDir(world.id, id)
    fs.mkdirSync(target, { recursive: true })
    try {
      await withDirAsync(source, (dir) => dir.copyTo(target))
    } catch (error) {
      removeTree(target)
      throw error
    }

    // Wurde die Welt währenddessen gelöscht, gibt es nichts mehr, wozu das Backup gehört.
    if (!db().prepare('SELECT 1 FROM worlds WHERE id = ?').get(world.id)) {
      removeTree(target)
      removeTree(backupsDir(world.id))
      throw new BackupError('Die Welt wurde inzwischen gelöscht.')
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
      for (const old of automatic.slice(config.maxAutoBackups)) removeBackup(world.id, old.id)
    }
    return backup
  })
  if (result === null) throw new BackupError(BUSY)
  return result
}

function removeBackup(worldId: string, backupId: string): void {
  db().prepare('DELETE FROM backups WHERE id = ? AND world_id = ?').run(backupId, worldId)
  removeTree(backupDir(worldId, backupId))
}

export function deleteBackup(world: World, backupId: string): void {
  if (!getBackup(world.id, backupId)) throw new BackupError('Dieses Backup gibt es nicht mehr.')
  removeBackup(world.id, backupId)
}

/** Ersetzt die aktuelle Welt komplett durch das Backup. */
export async function restoreBackup(world: World, backupId: string): Promise<void> {
  const backup = getBackup(world.id, backupId)
  if (!backup) throw new BackupError('Dieses Backup gibt es nicht mehr.')
  const source = backupDir(world.id, backup.id)
  if (!fs.existsSync(source)) throw new BackupError('Die Dateien dieses Backups fehlen.')

  const done = await withWorldLock(world.id, async () => {
    // Erst im gesperrten Zustand prüfen: Ab hier kann die Welt nicht mehr starten.
    const current = db().prepare('SELECT status FROM worlds WHERE id = ?').get(world.id) as { status: string } | undefined
    if (current?.status !== 'paused') throw new BackupError('Pausiere deine Welt, bevor du ein Backup wiederherstellst.')

    const target = worldDir(world.id)
    const staging = `${target}.wiederherstellen`
    removeTree(staging)
    try {
      await withDirAsync(source, (dir) => dir.copyTo(staging))
    } catch (error) {
      removeTree(staging)
      throw error
    }
    removeTree(target)
    fs.renameSync(staging, target)
    // Die Welt läuft danach mit ihrer aktuellen Version weiter — nie mit einer älteren Software.
    return true
  })
  if (done === null) throw new BackupError(BUSY)
}

export async function autoBackupAfterPause(world: World): Promise<void> {
  const current = db().prepare('SELECT * FROM worlds WHERE id = ?').get(world.id) as World | undefined
  if (!current || current.auto_backup !== 'on_pause' || current.status !== 'paused') return
  try {
    await createBackup(current, 'auto')
  } catch (error) {
    if (!(error instanceof BackupError)) console.error(`[aboutm.ee] Auto-Backup ${world.id}:`, error)
  }
}
