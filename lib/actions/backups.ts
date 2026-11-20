'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { requireUser } from '../auth'
import { BackupError, createBackup, deleteBackup, restoreBackup } from '../backups'
import { allowAttempt } from '../ratelimit'
import { getWorld, sendCommand, setAutoBackup, type World } from '../worlds'
import type { ActionState } from './state'

async function owned(worldId: unknown): Promise<World> {
  const user = await requireUser()
  if (typeof worldId !== 'string') notFound()
  const world = getWorld(user.id, worldId)
  if (!world) notFound()
  return world
}

function attempt(world: World, run: () => void, ok?: string): ActionState {
  try {
    run()
  } catch (error) {
    if (error instanceof BackupError) return { error: error.message }
    console.error(`[aboutm.ee] Backups von ${world.id}:`, error)
    return { error: 'Das hat nicht geklappt. Versuch es gleich noch einmal.' }
  }
  revalidatePath(`/app/welten/${world.id}`, 'layout')
  return ok ? { ok } : {}
}

export async function createBackupAction(worldId: string): Promise<ActionState> {
  const world = await owned(worldId)
  if (!allowAttempt(`backup:${world.user_id}`, 10, 60 * 60 * 1000)) {
    return { error: 'Du hast gerade viele Backups erstellt. Versuch es später noch einmal.' }
  }
  // Läuft die Welt, muss der Server erst alles auf die Platte schreiben und das Speichern
  // kurz anhalten — sonst landet ein halb geschriebener Stand im Backup.
  const live = world.status === 'online'
  try {
    if (live) {
      await sendCommand(world, 'save-off')
      await sendCommand(world, 'save-all flush')
      await new Promise((resolve) => setTimeout(resolve, 4000))
    }
    return attempt(world, () => void createBackup(world, 'manual'), 'Backup erstellt.')
  } catch (error) {
    console.error(`[aboutm.ee] Backup von ${world.id} vorbereiten:`, error)
    return { error: 'Das hat nicht geklappt. Versuch es gleich noch einmal.' }
  } finally {
    if (live) await sendCommand(world, 'save-on').catch(() => undefined)
  }
}

export async function restoreBackupAction(worldId: string, backupId: string): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, () => restoreBackup(world, String(backupId)), 'Backup wiederhergestellt.')
}

export async function deleteBackupAction(worldId: string, backupId: string): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, () => deleteBackup(world, String(backupId)))
}

export async function setAutoBackupAction(worldId: string, mode: string): Promise<ActionState> {
  const world = await owned(worldId)
  if (mode !== 'off' && mode !== 'on_pause') return { error: 'Ungültige Auswahl.' }
  return attempt(world, () => setAutoBackup(world, mode))
}
