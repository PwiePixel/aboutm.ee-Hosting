import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { worldDir } from './paths'

export class FileError extends Error {}

export type FileEntry = {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  modifiedAt: number
  editable: boolean
}

const NAME = /^[A-Za-z0-9._ -]{1,64}$/
const QUOTA_BYTES = config.diskGiB * 1024 ** 3

export function isSafeName(name: string): boolean {
  return NAME.test(name) && name !== '.' && name !== '..' && name.trim() === name
}

/** Zerlegt einen relativen Pfad und lehnt alles ab, was aus dem Ordner herausführen könnte. */
export function splitPath(relative: string): string[] {
  if (relative.includes('\0') || relative.includes('\\')) throw new FileError('Ungültiger Pfad.')
  const parts = relative.split('/').filter((part) => part.length > 0)
  if (parts.length > 16) throw new FileError('Der Pfad ist zu tief verschachtelt.')
  for (const part of parts) {
    if (!isSafeName(part)) throw new FileError('Ungültiger Pfad.')
  }
  return parts
}

/**
 * Löst einen Pfad innerhalb des Weltordners auf. Symbolische Links werden nirgends
 * im Pfad akzeptiert, damit nichts außerhalb des Ordners erreichbar ist.
 */
function resolveInside(root: string, relative: string): { absolute: string; parts: string[] } {
  const parts = splitPath(relative)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink()) throw new FileError('Ungültiger Pfad.')
  }
  if (current !== root && !current.startsWith(root + path.sep)) throw new FileError('Ungültiger Pfad.')
  return { absolute: current, parts }
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0)
}

export function directorySize(dir: string): number {
  let total = 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) total += directorySize(full)
    else if (entry.isFile()) total += fs.statSync(full, { throwIfNoEntry: false })?.size ?? 0
  }
  return total
}

export function worldDiskUsage(worldId: string): number {
  return directorySize(worldDir(worldId))
}

export function listDirectory(worldId: string, relative: string): FileEntry[] {
  const root = worldDir(worldId)
  const { absolute, parts } = resolveInside(root, relative)
  const stat = fs.statSync(absolute, { throwIfNoEntry: false })
  if (!stat) {
    if (parts.length === 0) return []
    throw new FileError('Diesen Ordner gibt es nicht.')
  }
  if (!stat.isDirectory()) throw new FileError('Das ist kein Ordner.')

  const entries: FileEntry[] = []
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !isSafeName(entry.name)) continue
    if (!entry.isDirectory() && !entry.isFile()) continue
    const info = fs.statSync(path.join(absolute, entry.name), { throwIfNoEntry: false })
    if (!info) continue
    entries.push({
      name: entry.name,
      path: [...parts, entry.name].join('/'),
      type: entry.isDirectory() ? 'dir' : 'file',
      size: entry.isDirectory() ? 0 : info.size,
      modifiedAt: info.mtimeMs,
      editable: entry.isFile() && info.size <= config.maxEditableBytes,
    })
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'de')
  })
}

export function readTextFile(worldId: string, relative: string): string {
  const { absolute, parts } = resolveInside(worldDir(worldId), relative)
  if (parts.length === 0) throw new FileError('Das ist keine Datei.')
  const stat = fs.statSync(absolute, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw new FileError('Diese Datei gibt es nicht.')
  if (stat.size > config.maxEditableBytes) throw new FileError('Die Datei ist zu groß, um sie hier zu öffnen.')
  const buffer = fs.readFileSync(absolute)
  if (looksBinary(buffer)) throw new FileError('Das ist keine Textdatei.')
  return buffer.toString('utf8')
}

export function writeTextFile(worldId: string, relative: string, content: string, options: { create: boolean }): void {
  const root = worldDir(worldId)
  const { absolute, parts } = resolveInside(root, relative)
  if (parts.length === 0) throw new FileError('Das ist keine Datei.')

  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > config.maxEditableBytes) throw new FileError('Der Inhalt ist größer als 512 KiB.')
  if (content.includes('\0')) throw new FileError('Der Inhalt enthält ungültige Zeichen.')

  const existing = fs.statSync(absolute, { throwIfNoEntry: false })
  if (existing && !existing.isFile()) throw new FileError('Unter diesem Namen gibt es schon einen Ordner.')
  if (existing && options.create) throw new FileError('Diese Datei gibt es schon.')
  if (!existing && !options.create) throw new FileError('Diese Datei gibt es nicht mehr.')
  if (!fs.statSync(path.dirname(absolute), { throwIfNoEntry: false })?.isDirectory()) {
    if (parts.length > 1) throw new FileError('Diesen Ordner gibt es nicht.')
    fs.mkdirSync(root, { recursive: true })
  }
  if (directorySize(root) - (existing?.size ?? 0) + bytes > QUOTA_BYTES) {
    throw new FileError(`Der Speicher deiner Welt (${config.diskGiB} GiB) ist voll.`)
  }
  fs.writeFileSync(absolute, content, 'utf8')
}

export function createDirectory(worldId: string, relative: string): void {
  const root = worldDir(worldId)
  const { absolute, parts } = resolveInside(root, relative)
  if (parts.length === 0) throw new FileError('Gib dem Ordner einen Namen.')
  if (fs.statSync(absolute, { throwIfNoEntry: false })) throw new FileError('Unter diesem Namen gibt es schon etwas.')
  const parent = path.dirname(absolute)
  if (parent !== root && !fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new FileError('Den übergeordneten Ordner gibt es nicht.')
  }
  fs.mkdirSync(absolute, { recursive: true })
}

export function removeEntry(worldId: string, relative: string): void {
  const { absolute, parts } = resolveInside(worldDir(worldId), relative)
  if (parts.length === 0) throw new FileError('Der Hauptordner lässt sich nicht löschen.')
  if (!fs.statSync(absolute, { throwIfNoEntry: false })) throw new FileError('Das gibt es nicht mehr.')
  fs.rmSync(absolute, { recursive: true, force: true })
}
