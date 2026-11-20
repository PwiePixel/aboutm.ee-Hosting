import path from 'node:path'
import { config } from './config'

const ID = /^[a-z]+_[a-z0-9]{8,32}$/

function assertId(id: string): void {
  if (!ID.test(id)) throw new Error('Ungültige Kennung')
}

export function worldDir(worldId: string): string {
  assertId(worldId)
  return path.join(config.dataDir, 'worlds', worldId)
}

export function backupsDir(worldId: string): string {
  assertId(worldId)
  return path.join(config.dataDir, 'backups', worldId)
}

export function backupDir(worldId: string, backupId: string): string {
  assertId(backupId)
  return path.join(backupsDir(worldId), backupId)
}
