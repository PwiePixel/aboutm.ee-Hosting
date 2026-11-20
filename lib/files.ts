import fs from 'node:fs'
import { config } from './config'
import { worldDir } from './paths'
import { Dir, UnsafeEntryError, withDir, type Owner } from './safe-fs'

/**
 * Dateimanager einer Welt. Alle Zugriffe laufen über lib/safe-fs.ts und folgen symbolischen
 * Links nie — der Inhalt des Weltordners gilt als nicht vertrauenswürdig (siehe dort).
 */

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

/** Neue Dateien und Ordner sollen dem Benutzer gehören, unter dem der Minecraft-Server läuft. */
const OWNER: Owner = { uid: config.docker.uid, gid: config.docker.gid }

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

/** Führt `use` im Ordner `parts` der Welt aus und übersetzt Zugriffsfehler in verständliche Meldungen. */
function inFolder<T>(worldId: string, parts: string[], use: (dir: Dir) => T, onMissingRoot?: () => T): T {
  try {
    return withDir(worldDir(worldId), parts, use, onMissingRoot)
  } catch (error) {
    if (error instanceof FileError) throw error
    if (error instanceof UnsafeEntryError) throw new FileError('Ungültiger Pfad.')
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new FileError('Das gibt es nicht (mehr).')
    if (code === 'EEXIST') throw new FileError('Unter diesem Namen gibt es schon etwas.')
    if (code === 'EISDIR') throw new FileError('Das ist ein Ordner.')
    if (code === 'ENOTEMPTY') throw new FileError('Der Ordner ließ sich nicht leeren.')
    throw error
  }
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0)
}

/** Größe eines Ordners samt Inhalt; 0, wenn es ihn nicht gibt. Links werden nicht verfolgt. */
export function directorySize(dir: string): number {
  try {
    return withDir(dir, [], (root) => root.size(), () => 0)
  } catch {
    return 0
  }
}

export function worldDiskUsage(worldId: string): number {
  return directorySize(worldDir(worldId))
}

export function listDirectory(worldId: string, relative: string): FileEntry[] {
  const parts = splitPath(relative)
  return inFolder(
    worldId,
    parts,
    (dir) => {
      const entries: FileEntry[] = []
      for (const { name, stat } of dir.entries()) {
        // Links, FIFOs und Ähnliches tauchen im Dateimanager gar nicht erst auf.
        if (!isSafeName(name) || (!stat.isDirectory() && !stat.isFile())) continue
        entries.push({
          name,
          path: [...parts, name].join('/'),
          type: stat.isDirectory() ? 'dir' : 'file',
          size: stat.isDirectory() ? 0 : stat.size,
          modifiedAt: stat.mtimeMs,
          editable: stat.isFile() && stat.size <= config.maxEditableBytes,
        })
      }
      return entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, 'de')
      })
    },
    () => {
      if (parts.length === 0) return []
      throw new FileError('Diesen Ordner gibt es nicht.')
    },
  )
}

export function readTextFile(worldId: string, relative: string): string {
  const parts = splitPath(relative)
  const name = parts.pop()
  if (!name) throw new FileError('Das ist keine Datei.')
  return inFolder(worldId, parts, (dir) => {
    const stat = dir.lstat(name)
    if (!stat?.isFile()) throw new FileError('Diese Datei gibt es nicht.')
    const buffer = dir.readFile(name, config.maxEditableBytes)
    if (buffer === null) throw new FileError('Die Datei ist zu groß, um sie hier zu öffnen.')
    if (looksBinary(buffer)) throw new FileError('Das ist keine Textdatei.')
    return buffer.toString('utf8')
  })
}

export function writeTextFile(worldId: string, relative: string, content: string, options: { create: boolean }): void {
  const parts = splitPath(relative)
  const name = parts.pop()
  if (!name) throw new FileError('Das ist keine Datei.')

  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > config.maxEditableBytes) throw new FileError('Der Inhalt ist größer als 512 KiB.')
  if (content.includes('\0')) throw new FileError('Der Inhalt enthält ungültige Zeichen.')

  const root = worldDir(worldId)
  // Eine neue Datei direkt im Hauptordner darf den Weltordner anlegen, falls es ihn noch nicht gibt.
  if (options.create && parts.length === 0) fs.mkdirSync(root, { recursive: true })
  const used = directorySize(root)

  inFolder(
    worldId,
    parts,
    (dir) => {
      const existing = dir.lstat(name)
      if (existing && !existing.isFile()) {
        throw new FileError(existing.isDirectory() ? 'Unter diesem Namen gibt es schon einen Ordner.' : 'Ungültiger Pfad.')
      }
      if (existing && options.create) throw new FileError('Diese Datei gibt es schon.')
      if (!existing && !options.create) throw new FileError('Diese Datei gibt es nicht mehr.')
      if (used - (existing?.size ?? 0) + bytes > QUOTA_BYTES) {
        throw new FileError(`Der Speicher deiner Welt (${config.diskGiB} GiB) ist voll.`)
      }
      if (existing) dir.overwriteFile(name, content)
      else dir.createFile(name, content, OWNER)
    },
    () => {
      throw new FileError('Diesen Ordner gibt es nicht.')
    },
  )
}

export function createDirectory(worldId: string, relative: string): void {
  const parts = splitPath(relative)
  const name = parts.pop()
  if (!name) throw new FileError('Gib dem Ordner einen Namen.')
  if (parts.length === 0) fs.mkdirSync(worldDir(worldId), { recursive: true })
  inFolder(
    worldId,
    parts,
    (dir) => {
      if (dir.lstat(name)) throw new FileError('Unter diesem Namen gibt es schon etwas.')
      dir.mkdir(name, OWNER)
    },
    () => {
      throw new FileError('Den übergeordneten Ordner gibt es nicht.')
    },
  )
}

export function removeEntry(worldId: string, relative: string): void {
  const parts = splitPath(relative)
  const name = parts.pop()
  if (!name) throw new FileError('Der Hauptordner lässt sich nicht löschen.')
  inFolder(
    worldId,
    parts,
    (dir) => {
      if (!dir.lstat(name)) throw new FileError('Das gibt es nicht mehr.')
      dir.remove(name)
    },
    () => {
      throw new FileError('Das gibt es nicht mehr.')
    },
  )
}
