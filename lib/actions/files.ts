'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { requireUser } from '../auth'
import { FileError, createDirectory, isSafeName, removeEntry, writeTextFile } from '../files'
import { getWorld, type World } from '../worlds'
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
    if (error instanceof FileError) return { error: error.message }
    console.error(`[aboutm.ee] Dateien von ${world.id}:`, error)
    return { error: 'Das hat nicht geklappt. Versuch es gleich noch einmal.' }
  }
  revalidatePath(`/app/welten/${world.id}/dateien`)
  return ok ? { ok } : {}
}

function join(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

const NAME_HINT = 'Erlaubt sind Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich und Leerzeichen (höchstens 64 Zeichen).'

export async function createFolderAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const folder = String(formData.get('folder') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!isSafeName(name)) return { error: NAME_HINT }
  return attempt(world, () => createDirectory(world.id, join(folder, name)), 'Ordner angelegt.')
}

export async function saveFileAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const path = String(formData.get('path') ?? '')
  const content = String(formData.get('content') ?? '').replace(/\r\n/g, '\n')
  return attempt(world, () => writeTextFile(world.id, path, content, { create: false }), 'Gespeichert.')
}

export async function deleteEntryAction(worldId: string, path: string): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, () => removeEntry(world.id, String(path)))
}
