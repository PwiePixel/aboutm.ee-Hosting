import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'

/**
 * Bilder der Website. Die Seite bringt keine eigenen mit: Der Betreiber lädt sie im Admin-Bereich
 * hoch (z. B. eigene Minecraft-Screenshots); sie liegen unter <DATA_DIR>/bilder. Solange ein Platz
 * leer ist, zeigt die Seite dort eine neutrale Fläche.
 */
export const WORLD_IMAGE_COUNT = 6
export const IMAGE_SLOTS = ['hero', ...Array.from({ length: WORLD_IMAGE_COUNT }, (_, i) => `welt-${i + 1}`)] as const
export type ImageSlot = (typeof IMAGE_SLOTS)[number]

export const IMAGE_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' } as const
export type ImageExtension = keyof typeof IMAGE_TYPES

export function imagesDir(): string {
  return path.join(config.dataDir, 'bilder')
}

export function isImageSlot(value: unknown): value is ImageSlot {
  return typeof value === 'string' && (IMAGE_SLOTS as readonly string[]).includes(value)
}

export type CustomImage = { file: string; type: string; version: number }

export function customImage(slot: ImageSlot): CustomImage | null {
  for (const extension of Object.keys(IMAGE_TYPES) as ImageExtension[]) {
    const file = path.join(imagesDir(), `${slot}.${extension}`)
    const stat = fs.statSync(file, { throwIfNoEntry: false })
    if (stat?.isFile()) return { file, type: IMAGE_TYPES[extension], version: Math.round(stat.mtimeMs) }
  }
  return null
}

/** Adresse des hochgeladenen Bildes — oder `null`, wenn der Platz noch leer ist. */
export function imageUrl(slot: ImageSlot): string | null {
  const custom = customImage(slot)
  return custom ? `/bilder/${slot}?v=${custom.version}` : null
}

/** Jede Welt bekommt dauerhaft dasselbe der hochgeladenen Welt-Bilder — abgeleitet aus ihrer Kennung. */
export function worldArt(worldId: string): string | null {
  const uploaded = IMAGE_SLOTS.filter((slot) => slot !== 'hero' && customImage(slot) !== null)
  if (uploaded.length === 0) return null
  let hash = 0
  for (let i = 0; i < worldId.length; i++) hash = (hash * 31 + worldId.charCodeAt(i)) >>> 0
  return imageUrl(uploaded[hash % uploaded.length]!)
}
