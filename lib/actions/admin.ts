'use server'

import fs from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { adminGetWorld } from '../admin'
import { IMAGE_TYPES, imagesDir, isImageSlot, type ImageExtension } from '../art'
import { requireAdmin } from '../auth'
import { db } from '../db'
import { LIMIT_RANGES, setLimit, type Limits } from '../settings'
import { deleteUserWithWorlds, deleteWorld, requestStop } from '../worlds'
import type { ActionState } from './state'

const FAILED = 'Das hat nicht geklappt. Versuch es gleich noch einmal.'

export async function saveLimitsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const labels: Record<keyof Limits, string> = {
    totalSlots: 'Gleichzeitig laufende Server',
    autoPauseMinutes: 'Auto-Pause',
    maxWorldsPerUser: 'Welten pro Konto',
  }
  const next: Partial<Limits> = {}
  for (const key of Object.keys(labels) as Array<keyof Limits>) {
    const raw = String(formData.get(key) ?? '').trim()
    const value = Number(raw)
    const range = LIMIT_RANGES[key]
    if (!/^\d+$/.test(raw) || value < range.min || value > range.max) {
      return { error: `${labels[key]}: Erlaubt sind ganze Zahlen von ${range.min} bis ${range.max}.` }
    }
    next[key] = value
  }
  for (const [key, value] of Object.entries(next) as Array<[keyof Limits, number]>) setLimit(key, value)
  revalidatePath('/', 'layout')
  return { ok: 'Gespeichert. Die neuen Werte gelten sofort.' }
}

export async function adminPauseWorldAction(worldId: string): Promise<ActionState> {
  await requireAdmin()
  const world = adminGetWorld(String(worldId))
  if (!world) return { error: 'Diese Welt gibt es nicht mehr.' }
  try {
    await requestStop(world, 'admin')
  } catch (error) {
    console.error(`[aboutm.ee] Admin pausiert ${world.id}:`, error)
    return { error: FAILED }
  }
  revalidatePath('/admin', 'layout')
  return {}
}

export async function adminDeleteWorldAction(worldId: string): Promise<ActionState> {
  await requireAdmin()
  const world = adminGetWorld(String(worldId))
  if (!world) return { error: 'Diese Welt gibt es nicht mehr.' }
  try {
    await deleteWorld(world)
  } catch (error) {
    console.error(`[aboutm.ee] Admin löscht ${world.id}:`, error)
    return { error: FAILED }
  }
  revalidatePath('/admin', 'layout')
  return {}
}

export async function adminDeleteUserAction(userId: string): Promise<ActionState> {
  const admin = await requireAdmin()
  if (userId === admin.id) return { error: 'Dein eigenes Konto löschst du unter „Dein Konto“.' }
  const user = db().prepare('SELECT id, is_admin FROM users WHERE id = ?').get(String(userId)) as
    | { id: string; is_admin: number }
    | undefined
  if (!user) return { error: 'Dieses Konto gibt es nicht mehr.' }
  if (user.is_admin) return { error: 'Admin-Konten lassen sich hier nicht löschen.' }
  try {
    await deleteUserWithWorlds(user.id)
  } catch (error) {
    console.error(`[aboutm.ee] Admin löscht Konto ${user.id}:`, error)
    return { error: FAILED }
  }
  revalidatePath('/admin', 'layout')
  return {}
}

export async function adminDeleteFeedbackAction(feedbackId: string): Promise<ActionState> {
  await requireAdmin()
  db().prepare('DELETE FROM feedback WHERE id = ?').run(String(feedbackId))
  revalidatePath('/admin/nachrichten')
  return {}
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024

/** Erkennt das Format am Dateianfang — die Endung allein sagt nichts. */
function detectImage(bytes: Buffer): ImageExtension | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

function removeImage(slot: string): void {
  for (const extension of Object.keys(IMAGE_TYPES)) {
    fs.rmSync(path.join(/*turbopackIgnore: true*/ imagesDir(), `${slot}.${extension}`), { force: true })
  }
}

export async function uploadImageAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const slot = formData.get('slot')
  const file = formData.get('file')
  if (!isImageSlot(slot)) return { error: 'Unbekannter Bildplatz.' }
  if (!(file instanceof File) || file.size === 0) return { error: 'Wähle ein Bild aus.' }
  if (file.size > MAX_IMAGE_BYTES) return { error: 'Das Bild ist größer als 6 MB.' }

  const bytes = Buffer.from(await file.arrayBuffer())
  const extension = detectImage(bytes)
  if (!extension) return { error: 'Erlaubt sind JPG, PNG und WebP.' }

  fs.mkdirSync(imagesDir(), { recursive: true })
  removeImage(slot)
  fs.writeFileSync(path.join(/*turbopackIgnore: true*/ imagesDir(), `${slot}.${extension}`), bytes)
  revalidatePath('/', 'layout')
  return { ok: 'Bild gespeichert.' }
}

export async function removeImageAction(slot: string): Promise<ActionState> {
  await requireAdmin()
  if (!isImageSlot(slot)) return { error: 'Unbekannter Bildplatz.' }
  removeImage(slot)
  revalidatePath('/', 'layout')
  return {}
}
